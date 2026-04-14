import type { Context } from "hono"

import consola from "consola"

import { extractDeviceId } from "~/lib/extract-device-id"
import { logRequest, markRequestLogged } from "~/lib/logger"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"

import { type AnthropicMessagesPayload } from "./anthropic-types"
import { translateToOpenAI } from "./non-stream-translation"

/**
 * Handles token counting for Anthropic messages
 */
export async function handleCountTokens(c: Context) {
  const startTime = Date.now()
  const deviceId = extractDeviceId(c)

  try {
    const anthropicBeta = c.req.header("anthropic-beta")

    const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()
    const payloadJson = JSON.stringify(anthropicPayload)

    // Store early so forwardError can enrich the fallback log line
    c.set("logDeviceId" as never, deviceId as never)
    c.set("logRequestSizeKb" as never, (payloadJson.length / 1024) as never)
    c.set("logModel" as never, anthropicPayload.model as never)

    const { openAIPayload } = translateToOpenAI(anthropicPayload)

    const selectedModel = state.models?.data.find(
      (model) => model.id === anthropicPayload.model,
    )

    if (!selectedModel) {
      consola.warn("Model not found, returning default token count")
      markRequestLogged(c.req.raw)
      logRequest({
        method: c.req.method,
        path: c.req.path,
        status: 200,
        durationMs: Date.now() - startTime,
        requestSizeKb: 0,
        model: anthropicPayload.model,
        deviceId,
      })
      return c.json({
        input_tokens: 1,
      })
    }

    const tokenCount = await getTokenCount(openAIPayload, selectedModel)

    if (anthropicPayload.tools && anthropicPayload.tools.length > 0) {
      let mcpToolExist = false
      if (anthropicBeta?.startsWith("claude-code")) {
        mcpToolExist = anthropicPayload.tools.some((tool) =>
          tool.name.startsWith("mcp__"),
        )
      }
      if (!mcpToolExist) {
        if (anthropicPayload.model.startsWith("claude")) {
          // https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview#pricing
          tokenCount.input = tokenCount.input + 346
        } else if (anthropicPayload.model.startsWith("grok")) {
          tokenCount.input = tokenCount.input + 480
        }
      }
    }

    let finalTokenCount = tokenCount.input + tokenCount.output
    if (anthropicPayload.model.startsWith("claude")) {
      finalTokenCount = Math.round(finalTokenCount * 1.15)
    } else if (anthropicPayload.model.startsWith("grok")) {
      finalTokenCount = Math.round(finalTokenCount * 1.03)
    }

    markRequestLogged(c.req.raw)
    logRequest({
      method: c.req.method,
      path: c.req.path,
      status: 200,
      durationMs: Date.now() - startTime,
      requestSizeKb: payloadJson.length / 1024,
      model: anthropicPayload.model,
      deviceId,
    })

    return c.json({
      input_tokens: finalTokenCount,
    })
  } catch (error) {
    consola.error("Error counting tokens:", error)
    markRequestLogged(c.req.raw)
    logRequest({
      method: c.req.method,
      path: c.req.path,
      status: 500,
      durationMs: Date.now() - startTime,
      requestSizeKb: 0,
      model: "unknown",
      deviceId,
    })
    return c.json({
      input_tokens: 1,
    })
  }
}
