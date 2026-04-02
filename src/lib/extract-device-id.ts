import type { Context } from "hono"

/**
 * Extracts a device identifier from the request's auth header.
 *
 * Priority: x-api-key > Authorization: Bearer <token>
 * Returns undefined for absent, empty, "dummy" (any case), or real sk-ant- keys.
 */
export function extractDeviceId(c: Context): string | undefined {
  // x-api-key takes precedence when both headers are present
  let raw = c.req.header("x-api-key")

  if (!raw) {
    const auth = c.req.header("authorization")
    if (auth) {
      // Strip exact "Bearer " prefix (7 chars, case-sensitive)
      raw = auth.startsWith("Bearer ") ? auth.slice(7) : auth
    }
  }

  const value = raw?.trim()

  if (!value) return undefined
  if (value.toLowerCase() === "dummy") return undefined
  if (value.startsWith("sk-ant-")) return undefined

  return value
}

/**
 * Extracts a session identifier from a JSON string (Claude Code only).
 * The value is typically the `user` field (OpenAI) or `metadata.user_id` (Anthropic).
 * Returns undefined if the string is absent, not valid JSON, or has no session_id.
 */
export function extractSessionId(
  jsonString: string | null | undefined,
): string | undefined {
  if (!jsonString) return undefined
  try {
    const meta = JSON.parse(jsonString) as { session_id?: string }
    return meta.session_id
  } catch {
    return undefined
  }
}
