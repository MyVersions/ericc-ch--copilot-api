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

  if (isNonStreaming(response)) {
    consola.debug("Non-streaming response:", JSON.stringify(response))
    const durationMs = Date.now() - startTime
    const inputTokens = response.usage?.prompt_tokens ?? 0
    const outputTokens = response.usage?.completion_tokens ?? 0
    insertLog({
      timestamp: startTime,
      model: payload.model,
      device_id: deviceId,
      session_id: sessionId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      duration_ms: durationMs,
      request_body: JSON.stringify(payload),
      response_body: JSON.stringify(response),
    })
    markRequestLogged(c.req.raw)
    logRequest({
      method: c.req.method,
      path: c.req.path,
      status: 200,
      durationMs,
      model: payload.model,
      deviceId,
      sessionId,
      inputTokens,
      outputTokens,
    })
    return c.json(response)
  }

  consola.debug("Streaming response")
  markRequestLogged(c.req.raw)
  return streamSSE(c, async (stream) => {
    let lastUsage: ChatCompletionChunk["usage"] | undefined
    let accumulatedContent = ""

    for await (const chunk of response) {
      consola.debug("Streaming chunk:", JSON.stringify(chunk))

      if (chunk.data && chunk.data !== "[DONE]") {
        try {
          const parsed = JSON.parse(chunk.data) as ChatCompletionChunk
          if (parsed.usage) lastUsage = parsed.usage
          accumulatedContent += parsed.choices[0]?.delta?.content ?? ""
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
    })
    logRequest({
      method: c.req.method,
      path: c.req.path,
      status: 200,
      durationMs,
      model: payload.model,
      deviceId,
      sessionId,
      inputTokens,
      outputTokens,
    })
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
