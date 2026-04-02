import { Hono } from "hono"

import { insertLog } from "~/lib/db"
import { forwardError } from "~/lib/error"
import { extractDeviceId } from "~/lib/extract-device-id"
import { logRequest, markRequestLogged } from "~/lib/logger"
import {
  createEmbeddings,
  type EmbeddingRequest,
} from "~/services/copilot/create-embeddings"

export const embeddingRoutes = new Hono()

embeddingRoutes.post("/", async (c) => {
  const startTime = Date.now()
  const deviceId = extractDeviceId(c)
  const payload = await c.req.json<EmbeddingRequest>()

  const payloadJson = JSON.stringify(payload)

  try {
    const response = await createEmbeddings(payload)

    const durationMs = Date.now() - startTime
    const inputTokens = response.usage.prompt_tokens

    insertLog({
      timestamp: startTime,
      model: payload.model,
      device_id: deviceId,
      input_tokens: inputTokens,
      output_tokens: 0,
      duration_ms: durationMs,
      request_body: payloadJson,
      response_body: JSON.stringify(response),
      finish_reason: null,
      stream: false,
      is_agent_call: null,
      cached_tokens: null,
      request_id: null,
      route: "openai",
      tools_count: null,
      accepted_prediction_tokens: null,
      rejected_prediction_tokens: null,
    })

    markRequestLogged(c.req.raw)
    logRequest({
      method: c.req.method,
      path: c.req.path,
      status: 200,
      durationMs,
      requestSizeKb: payloadJson.length / 1024,
      model: payload.model,
      deviceId,
      inputTokens,
      outputTokens: 0,
    })

    return c.json(response)
  } catch (error) {
    return await forwardError(c, error)
  }
})
