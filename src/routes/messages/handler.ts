import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { insertLog } from "~/lib/db"
import { logRequest, markRequestLogged } from "~/lib/logger"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"

import {
  type AnthropicMessagesPayload,
  type AnthropicStreamState,
} from "./anthropic-types"
import {
  translateToAnthropic,
  translateToOpenAI,
} from "./non-stream-translation"
import { translateChunkToAnthropicEvents } from "./stream-translation"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const startTime = Date.now()

  const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()
  consola.debug("Anthropic request payload:", JSON.stringify(anthropicPayload))

  // Extract device_id and session_id from metadata.user_id (JSON string)
  let deviceId: string | undefined
  let sessionId: string | undefined
  try {
    if (anthropicPayload.metadata?.user_id) {
      const userMeta = JSON.parse(anthropicPayload.metadata.user_id) as { device_id?: string; session_id?: string }
      deviceId = userMeta.device_id
      sessionId = userMeta.session_id
    }
  } catch {
    // user_id is not JSON — ignore
  }

  const openAIPayload = translateToOpenAI(anthropicPayload)
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  if (state.manualApprove) {
    await awaitApproval()
  }

  const response = await createChatCompletions(openAIPayload)

  if (isNonStreaming(response)) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response).slice(-400),
    )
    const anthropicResponse = translateToAnthropic(response)
    consola.debug(
      "Translated Anthropic response:",
      JSON.stringify(anthropicResponse),
    )
    const durationMs = Date.now() - startTime
    const inputTokens = response.usage?.prompt_tokens ?? 0
    const outputTokens = response.usage?.completion_tokens ?? 0
    insertLog({
      timestamp: startTime,
      model: anthropicPayload.model,
      device_id: deviceId,
      session_id: sessionId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      duration_ms: durationMs,
      request_body: JSON.stringify(anthropicPayload),
      response_body: JSON.stringify(anthropicResponse),
    })
    markRequestLogged(c.req.raw)
    logRequest({
      method: c.req.method,
      path: c.req.path,
      status: 200,
      durationMs,
      requestSizeKb: JSON.stringify(anthropicPayload).length / 1024,
      model: anthropicPayload.model,
      deviceId,
      inputTokens,
      outputTokens,
    })
    return c.json(anthropicResponse)
  }

  consola.debug("Streaming response from Copilot")
  const requestSizeKb = JSON.stringify(anthropicPayload).length / 1024
  markRequestLogged(c.req.raw)
  return streamSSE(c, async (stream) => {
    const streamState: AnthropicStreamState = {
      messageStartSent: false,
      contentBlockIndex: 0,
      contentBlockOpen: false,
      toolCalls: {},
    }

    let lastUsage: ChatCompletionChunk["usage"] | undefined
    let accumulatedContent = ""

    for await (const rawEvent of response) {
      consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
      if (chunk.usage) lastUsage = chunk.usage

      const events = translateChunkToAnthropicEvents(chunk, streamState)

      for (const event of events) {
        consola.debug("Translated Anthropic event:", JSON.stringify(event))
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          accumulatedContent += event.delta.text ?? ""
        }
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        })
      }
    }

    const durationMs = Date.now() - startTime
    const inputTokens = lastUsage?.prompt_tokens ?? 0
    const outputTokens = lastUsage?.completion_tokens ?? 0
    insertLog({
      timestamp: startTime,
      model: anthropicPayload.model,
      device_id: deviceId,
      session_id: sessionId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      duration_ms: durationMs,
      request_body: JSON.stringify(anthropicPayload),
      response_body: accumulatedContent,
    })
    logRequest({
      method: c.req.method,
      path: c.req.path,
      status: 200,
      durationMs,
      requestSizeKb,
      model: anthropicPayload.model,
      deviceId,
      inputTokens,
      outputTokens,
    })
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
