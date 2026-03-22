import type { Context } from "hono"

import consola from "consola"
import { streamSSE, type SSEMessage } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { insertLog } from "~/lib/db"
import { logRequest, markRequestLogged } from "~/lib/logger"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import { isNullish } from "~/lib/utils"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const startTime = Date.now()

  let payload = await c.req.json<ChatCompletionsPayload>()
  consola.debug("Request payload:", JSON.stringify(payload).slice(-400))

  // Extract device_id and session_id from the user field (JSON string)
  let deviceId: string | undefined
  let sessionId: string | undefined
  try {
    if (payload.user) {
      const userMeta = JSON.parse(payload.user) as { device_id?: string; session_id?: string }
      deviceId = userMeta.device_id
      sessionId = userMeta.session_id
    }
  } catch {
    // user field is not JSON — ignore
  }

  // Find the selected model
  const selectedModel = state.models?.data.find(
    (model) => model.id === payload.model,
  )

  // Pre-flight token estimate (debug only — actual usage logged after response)
  try {
    if (selectedModel) {
      const tokenCount = await getTokenCount(payload, selectedModel)
      consola.debug("Estimated input tokens:", tokenCount)
    }
  } catch (error) {
    consola.debug("Failed to estimate token count:", error)
  }

  if (state.manualApprove) await awaitApproval()

  if (isNullish(payload.max_tokens)) {
    payload = {
      ...payload,
      max_tokens: selectedModel?.capabilities.limits.max_output_tokens,
    }
    consola.debug("Set max_tokens to:", JSON.stringify(payload.max_tokens))
  }

  const response = await createChatCompletions(payload)
  const { result, requestId, isAgentCall } = response

  if (isNonStreaming(result)) {
    consola.debug("Non-streaming response:", JSON.stringify(result))
    const durationMs = Date.now() - startTime
    const inputTokens = result.usage?.prompt_tokens ?? 0
    const outputTokens = result.usage?.completion_tokens ?? 0
    insertLog({
      timestamp: startTime,
      model: payload.model,
      device_id: deviceId,
      session_id: sessionId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      duration_ms: durationMs,
      request_body: JSON.stringify(payload),
      response_body: JSON.stringify(result),
      finish_reason: result.choices[0]?.finish_reason ?? null,
      stream: payload.stream ?? false,
      is_agent_call: isAgentCall,
      cached_tokens: result.usage?.prompt_tokens_details?.cached_tokens ?? null,
      request_id: requestId,
      route: "openai",
      tools_count: payload.tools?.length ?? 0,
      accepted_prediction_tokens: null,
      rejected_prediction_tokens: null,
    })
    const requestSizeKb = JSON.stringify(payload).length / 1024
    markRequestLogged(c.req.raw)
    logRequest({
      method: c.req.method,
      path: c.req.path,
      status: 200,
      durationMs,
      requestSizeKb,
      model: payload.model,
      deviceId,
      inputTokens,
      outputTokens,
    })
    return c.json(result)
  }

  consola.debug("Streaming response")
  const requestSizeKb = JSON.stringify(payload).length / 1024
  markRequestLogged(c.req.raw)
  return streamSSE(c, async (stream) => {
    let lastUsage: ChatCompletionChunk["usage"] | undefined
    let accumulatedContent = ""
    let finishReason: string | null = null

    for await (const chunk of result) {
      consola.debug("Streaming chunk:", JSON.stringify(chunk))

      if (chunk.data && chunk.data !== "[DONE]") {
        try {
          const parsed = JSON.parse(chunk.data) as ChatCompletionChunk
          if (parsed.usage) lastUsage = parsed.usage
          accumulatedContent += parsed.choices[0]?.delta?.content ?? ""
          if (parsed.choices[0]?.finish_reason) finishReason = parsed.choices[0].finish_reason
        } catch {
          // ignore malformed chunks
        }
      }

      await stream.writeSSE(chunk as SSEMessage)
    }

    const durationMs = Date.now() - startTime
    const inputTokens = lastUsage?.prompt_tokens ?? 0
    const outputTokens = lastUsage?.completion_tokens ?? 0
    insertLog({
      timestamp: startTime,
      model: payload.model,
      device_id: deviceId,
      session_id: sessionId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      duration_ms: durationMs,
      request_body: JSON.stringify(payload),
      response_body: accumulatedContent,
      finish_reason: finishReason,
      stream: true,
      is_agent_call: isAgentCall,
      cached_tokens: lastUsage?.prompt_tokens_details?.cached_tokens ?? null,
      request_id: requestId,
      route: "openai",
      tools_count: payload.tools?.length ?? 0,
      accepted_prediction_tokens: lastUsage?.completion_tokens_details?.accepted_prediction_tokens ?? null,
      rejected_prediction_tokens: lastUsage?.completion_tokens_details?.rejected_prediction_tokens ?? null,
    })
    logRequest({
      method: c.req.method,
      path: c.req.path,
      status: 200,
      durationMs,
      requestSizeKb,
      model: payload.model,
      deviceId,
      inputTokens,
      outputTokens,
    })
  })
}

const isNonStreaming = (
  result: Awaited<ReturnType<typeof createChatCompletions>>["result"],
): result is ChatCompletionResponse => Object.hasOwn(result, "choices")
