import type { Context } from "hono"

import consola from "consola"
import { type ServerSentEventMessage } from "fetch-event-stream"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { insertLog } from "~/lib/db"
import { extractDeviceId, extractSessionId } from "~/lib/extract-device-id"
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
  type ToolNameMap,
  translateToAnthropic,
  translateToOpenAI,
} from "./non-stream-translation"
import { translateChunkToAnthropicEvents } from "./stream-translation"

interface LogBase {
  startTime: number
  anthropicPayload: AnthropicMessagesPayload
  openAIPayload: ReturnType<typeof translateToOpenAI>["openAIPayload"]
  payloadJson: string
  deviceId: string | undefined
  sessionId: string | undefined
  requestId: string
  isAgentCall: boolean
  requestSizeKb: number
  c: Context
}

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const startTime = Date.now()

  const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()
  const payloadJson = JSON.stringify(anthropicPayload)
  consola.debug("Anthropic request payload:", payloadJson)

  const deviceId = extractDeviceId(c)
  const sessionId = extractSessionId(anthropicPayload.metadata?.user_id)

  const { openAIPayload, toolNameMap } = translateToOpenAI(anthropicPayload)
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  if (state.manualApprove) await awaitApproval()

  const { result, requestId, isAgentCall } =
    await createChatCompletions(openAIPayload)
  const requestSizeKb = payloadJson.length / 1024
  const logBase = {
    startTime,
    anthropicPayload,
    openAIPayload,
    payloadJson,
    deviceId,
    sessionId,
    requestId,
    isAgentCall,
    requestSizeKb,
    c,
  }

  if (isNonStreaming(result))
    return handleNonStreaming(result, logBase, toolNameMap)

  consola.debug("Streaming response from Copilot")
  markRequestLogged(c.req.raw)
  return streamSSE(c, async (stream) => {
    const { inputTokens, outputTokens, finishReason, accumulatedContent } =
      await consumeAnthropicStream(result, stream, toolNameMap)
    const durationMs = Date.now() - startTime
    insertLog({
      timestamp: startTime,
      model: anthropicPayload.model,
      device_id: deviceId,
      session_id: sessionId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      duration_ms: durationMs,
      request_body: payloadJson,
      response_body: accumulatedContent,
      finish_reason: finishReason,
      stream: true,
      is_agent_call: isAgentCall,
      cached_tokens: null,
      request_id: requestId,
      route: "anthropic",
      tools_count: openAIPayload.tools?.length ?? 0,
      accepted_prediction_tokens: null,
      rejected_prediction_tokens: null,
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

function handleNonStreaming(
  result: ChatCompletionResponse,
  {
    startTime,
    anthropicPayload,
    openAIPayload,
    payloadJson,
    deviceId,
    sessionId,
    requestId,
    isAgentCall,
    requestSizeKb,
    c,
  }: LogBase,
  toolNameMap: ToolNameMap,
) {
  consola.debug(
    "Non-streaming response from Copilot:",
    JSON.stringify(result).slice(-400),
  )
  const anthropicResponse = translateToAnthropic(result, toolNameMap)
  consola.debug(
    "Translated Anthropic response:",
    JSON.stringify(anthropicResponse),
  )
  const durationMs = Date.now() - startTime
  const inputTokens = result.usage?.prompt_tokens ?? 0
  const outputTokens = result.usage?.completion_tokens ?? 0
  insertLog({
    timestamp: startTime,
    model: anthropicPayload.model,
    device_id: deviceId,
    session_id: sessionId,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    duration_ms: durationMs,
    request_body: payloadJson,
    response_body: JSON.stringify(anthropicResponse),
    finish_reason: result.choices[0]?.finish_reason ?? null,
    stream: anthropicPayload.stream ?? false,
    is_agent_call: isAgentCall,
    cached_tokens: result.usage?.prompt_tokens_details?.cached_tokens ?? null,
    request_id: requestId,
    route: "anthropic",
    tools_count: openAIPayload.tools?.length ?? 0,
    accepted_prediction_tokens: null,
    rejected_prediction_tokens: null,
  })
  markRequestLogged(c.req.raw)
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
  return c.json(anthropicResponse)
}

async function consumeAnthropicStream(
  result: AsyncGenerator<ServerSentEventMessage, void, unknown>,
  stream: { writeSSE: (msg: { event: string; data: string }) => Promise<void> },
  toolNameMap: ToolNameMap,
): Promise<{
  inputTokens: number
  outputTokens: number
  finishReason: string | null
  accumulatedContent: string
}> {
  const streamState: AnthropicStreamState = {
    messageStartSent: false,
    contentBlockIndex: 0,
    contentBlockOpen: false,
    toolCalls: {},
  }

  let lastUsage: ChatCompletionChunk["usage"] | undefined
  let accumulatedContent = ""
  let finishReason: string | null = null

  for await (const rawEvent of result) {
    consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
    if (rawEvent.data === "[DONE]") break
    if (!rawEvent.data) continue

    const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
    if (chunk.usage) lastUsage = chunk.usage
    if (chunk.choices[0]?.finish_reason)
      finishReason = chunk.choices[0].finish_reason

    const events = translateChunkToAnthropicEvents(
      chunk,
      streamState,
      toolNameMap,
    )

    for (const event of events) {
      consola.debug("Translated Anthropic event:", JSON.stringify(event))
      if (
        event.type === "content_block_delta"
        && event.delta.type === "text_delta"
      ) {
        accumulatedContent += event.delta.text
      }
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      })
    }
  }

  return {
    inputTokens: lastUsage?.prompt_tokens ?? 0,
    outputTokens: lastUsage?.completion_tokens ?? 0,
    finishReason,
    accumulatedContent,
  }
}

const isNonStreaming = (
  result: Awaited<ReturnType<typeof createChatCompletions>>["result"],
): result is ChatCompletionResponse => Object.hasOwn(result, "choices")
