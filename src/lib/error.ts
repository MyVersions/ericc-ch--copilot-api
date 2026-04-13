import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import consola from "consola"

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
