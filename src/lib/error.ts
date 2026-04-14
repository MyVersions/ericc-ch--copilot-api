import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import consola from "consola"

import { logRequest, markRequestLogged } from "~/lib/logger"

export class HTTPError extends Error {
  response: Response
  copilotRequestUrl?: string
  copilotRequestHeaders?: Record<string, string>
  copilotRequestBody?: unknown

  constructor(message: string, response: Response) {
    super(message)
    this.response = response
  }
}

export async function forwardError(
  c: Context,
  error: unknown,
  requestBody?: string,
) {
  const requestInfo = {
    method: c.req.method,
    path: c.req.path,
    body: requestBody ?? "<not captured>",
  }

  const deviceId = c.get("logDeviceId" as never) as string | undefined
  const requestSizeKb = c.get("logRequestSizeKb" as never) as number | undefined
  const model = c.get("logModel" as never) as string | undefined

  if (error instanceof HTTPError) {
    const errorText = await error.response.text()
    let errorJson: unknown
    try {
      errorJson = JSON.parse(errorText)
    } catch {
      errorJson = errorText
    }
    consola.error("Error occurred:", error, {
      ...requestInfo,
      upstream: errorJson,
    })
    markRequestLogged(c.req.raw)
    logRequest({
      method: c.req.method,
      path: c.req.path,
      status: error.response.status,
      durationMs: 0,
      requestSizeKb,
      model,
      deviceId,
    })
    return c.json(
      {
        error: {
          message: errorText,
          type: "error",
        },
      },
      error.response.status as ContentfulStatusCode,
    )
  }

  consola.error("Error occurred:", error, requestInfo)
  markRequestLogged(c.req.raw)
  logRequest({
    method: c.req.method,
    path: c.req.path,
    status: 500,
    durationMs: 0,
    requestSizeKb,
    model,
    deviceId,
  })
  return c.json(
    {
      error: {
        message: (error as Error).message,
        type: "error",
      },
    },
    500,
  )
}
