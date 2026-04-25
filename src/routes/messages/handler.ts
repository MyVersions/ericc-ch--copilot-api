import type { Context } from "hono"

import consola from "consola"
import { type ServerSentEventMessage } from "fetch-event-stream"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { insertLog } from "~/lib/db"
import { HTTPError } from "~/lib/error"
import { extractDeviceId, extractSessionId } from "~/lib/extract-device-id"
import { LOG_CONFIG, logRequest, markRequestLogged } from "~/lib/logger"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { createAnthropicMessage } from "~/services/anthropic/create-message"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"

import {
  type AnthropicMessagesPayload,
  type AnthropicStreamEventData,
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

  // Store early so forwardError can enrich the fallback log line
  c.set("logDeviceId" as never, deviceId as never)
  c.set("logRequestSizeKb" as never, (payloadJson.length / 1024) as never)
  c.set("logModel" as never, anthropicPayload.model as never)

  const { openAIPayload, toolNameMap } = translateToOpenAI(anthropicPayload)
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  if (state.manualApprove) await awaitApproval()

  let copilotResult: Awaited<ReturnType<typeof createChatCompletions>>
  try {
    copilotResult = await createChatCompletions(openAIPayload)
  } catch (error) {
    if (error instanceof HTTPError && error.response.status === 402) {
      return handleAnthropicFallback(c, anthropicPayload, {
        startTime,
        payloadJson,
        deviceId,
        sessionId,
        requestSizeKb: payloadJson.length / 1024,
      })
    }
    throw error
  }

  const { result, requestId, isAgentCall } = copilotResult
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

  return handleStreamingCompletion(result, logBase, toolNameMap)
}

function handleStreamingCompletion(
  result: AsyncGenerator<ServerSentEventMessage, void, unknown>,
  logBase: LogBase,
  toolNameMap: ToolNameMap,
) {
  const {
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
  } = logBase
  consola.debug("Streaming response from Copilot")
  markRequestLogged(c.req.raw)
  return streamSSE(
    c,
    async (stream) => {
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
    },
    async (error, stream) => {
      consola.error("Stream error:", error, {
        method: c.req.method,
        path: c.req.path,
        body: payloadJson,
      })
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({
          type: "error",
          error: {
            type: "api_error",
            message: error.message,
          },
        }),
      })
    },
  )
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

interface AnthropicFallbackBase {
  startTime: number
  payloadJson: string
  deviceId: string | undefined
  sessionId: string | undefined
  requestSizeKb: number
}

async function handleAnthropicFallback(
  c: Context,
  anthropicPayload: AnthropicMessagesPayload,
  base: AnthropicFallbackBase,
) {
  const { result, requestId } = await createAnthropicMessage(anthropicPayload)
  const isAgentCall = anthropicPayload.messages.some(
    (m) => m.role === "assistant",
  )

  if (isAnthropicStream(result)) {
    return handleFallbackStream(c, result, {
      anthropicPayload,
      base,
      requestId,
      isAgentCall,
    })
  }

  consola.debug("Anthropic fallback: non-streaming response")
  const durationMs = Date.now() - base.startTime
  const inputTokens = result.usage.input_tokens
  const outputTokens = result.usage.output_tokens
  insertLog({
    timestamp: base.startTime,
    model: anthropicPayload.model,
    device_id: base.deviceId,
    session_id: base.sessionId,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    duration_ms: durationMs,
    request_body: base.payloadJson,
    response_body: JSON.stringify(result),
    finish_reason: result.stop_reason,
    stream: false,
    is_agent_call: isAgentCall,
    cached_tokens: null,
    request_id: requestId,
    route: "anthropic-fallback",
    tools_count: anthropicPayload.tools?.length ?? 0,
    accepted_prediction_tokens: null,
    rejected_prediction_tokens: null,
  })
  markRequestLogged(c.req.raw)
  logRequest({
    method: c.req.method,
    path: c.req.path,
    status: 200,
    durationMs,
    requestSizeKb: base.requestSizeKb,
    model: anthropicPayload.model,
    deviceId: base.deviceId,
    inputTokens,
    outputTokens,
    methodColor: LOG_CONFIG.colors.methodFallback,
  })
  return c.json(result)
}

interface FallbackStreamContext {
  anthropicPayload: AnthropicMessagesPayload
  base: AnthropicFallbackBase
  requestId: string
  isAgentCall: boolean
}

function handleFallbackStream(
  c: Context,
  result: AsyncGenerator<ServerSentEventMessage, void, unknown>,
  ctx: FallbackStreamContext,
) {
  const { anthropicPayload, base, requestId, isAgentCall } = ctx
  consola.debug("Anthropic fallback: streaming response")
  markRequestLogged(c.req.raw)
  return streamSSE(
    c,
    async (stream) => {
      const { inputTokens, outputTokens, finishReason, accumulatedContent } =
        await consumeAnthropicPassthroughStream(result, stream)
      const durationMs = Date.now() - base.startTime
      insertLog({
        timestamp: base.startTime,
        model: anthropicPayload.model,
        device_id: base.deviceId,
        session_id: base.sessionId,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        duration_ms: durationMs,
        request_body: base.payloadJson,
        response_body: accumulatedContent,
        finish_reason: finishReason,
        stream: true,
        is_agent_call: isAgentCall,
        cached_tokens: null,
        request_id: requestId,
        route: "anthropic-fallback",
        tools_count: anthropicPayload.tools?.length ?? 0,
        accepted_prediction_tokens: null,
        rejected_prediction_tokens: null,
      })
      logRequest({
        method: c.req.method,
        path: c.req.path,
        status: 200,
        durationMs,
        requestSizeKb: base.requestSizeKb,
        model: anthropicPayload.model,
        deviceId: base.deviceId,
        inputTokens,
        outputTokens,
        methodColor: LOG_CONFIG.colors.methodFallback,
      })
    },
    async (error, stream) => {
      consola.error("Anthropic fallback stream error:", error)
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({
          type: "error",
          error: { type: "api_error", message: error.message },
        }),
      })
    },
  )
}

async function consumeAnthropicPassthroughStream(
  result: AsyncGenerator<ServerSentEventMessage, void, unknown>,
  stream: { writeSSE: (msg: { event: string; data: string }) => Promise<void> },
): Promise<{
  inputTokens: number
  outputTokens: number
  finishReason: string | null
  accumulatedContent: string
}> {
  let inputTokens = 0
  let outputTokens = 0
  let finishReason: string | null = null
  let accumulatedContent = ""

  for await (const rawEvent of result) {
    consola.debug("Anthropic fallback raw event:", JSON.stringify(rawEvent))
    if (!rawEvent.data || rawEvent.data === "[DONE]") continue

    await stream.writeSSE({
      event: rawEvent.event ?? "message",
      data: rawEvent.data,
    })

    try {
      const parsed = JSON.parse(rawEvent.data) as AnthropicStreamEventData
      if (parsed.type === "message_start") {
        inputTokens = parsed.message.usage.input_tokens
      } else if (
        parsed.type === "content_block_delta"
        && parsed.delta.type === "text_delta"
      ) {
        accumulatedContent += parsed.delta.text
      } else if (parsed.type === "message_delta") {
        if (parsed.usage) outputTokens = parsed.usage.output_tokens
        if (parsed.delta.stop_reason) finishReason = parsed.delta.stop_reason
      }
    } catch {
      // ignore malformed events
    }
  }

  return { inputTokens, outputTokens, finishReason, accumulatedContent }
}

const isAnthropicStream = (
  result: Awaited<ReturnType<typeof createAnthropicMessage>>["result"],
): result is AsyncGenerator<ServerSentEventMessage, void, unknown> =>
  Symbol.asyncIterator in result
