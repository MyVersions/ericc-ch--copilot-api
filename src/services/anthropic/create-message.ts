import type { ServerSentEventMessage } from "fetch-event-stream"

import { events } from "fetch-event-stream"
import { randomUUID } from "node:crypto"

import type {
  AnthropicMessagesPayload,
  AnthropicResponse,
} from "~/routes/messages/anthropic-types"

import { getValidAccessToken } from "~/lib/anthropic-credentials"
import { HTTPError } from "~/lib/error"

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"

export async function createAnthropicMessage(
  payload: AnthropicMessagesPayload,
): Promise<{
  result:
    | AnthropicResponse
    | AsyncGenerator<ServerSentEventMessage, void, unknown>
  requestId: string
}> {
  const accessToken = await getValidAccessToken()
  const requestId = randomUUID()

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new HTTPError("Anthropic fallback request failed", response)
  }

  if (payload.stream) {
    return { result: events(response), requestId }
  }

  return { result: (await response.json()) as AnthropicResponse, requestId }
}
