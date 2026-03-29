# Design: Device Identification via ANTHROPIC_AUTH_TOKEN

**Date:** 2026-03-29
**Status:** Approved

## Problem

The server is used from multiple machines (3 Claude Code instances) and other custom applications. There is no reliable way to distinguish which client made each request in the usage logs, making per-device cost and usage tracking impossible.

## Solution

Use two independent identification signals:

- **`device_id`** — extracted from the `x-api-key` (or `Authorization: Bearer`) HTTP header. Identifies the machine or application making the request. Works for all clients on all routes.
- **`session_id`** — extracted from the request body, as today. Identifies a Claude Code session. Only populated when Claude Code sends it; other clients leave it `null`.

No changes to how clients send the session ID. Only the `device_id` source changes (from body → header).

## Scope

### What changes

1. **New helper `extractDeviceId(c: Context): string | undefined`** — reads `x-api-key` or `Authorization: Bearer <token>` from the request header and returns the normalized token value. Returns `undefined` for absent, empty, or placeholder values (e.g. `"dummy"`).

2. **`src/routes/chat-completions/handler.ts`** — replace only the `device_id` extraction from `payload.user` (JSON parse) with a call to `extractDeviceId`. **Keep** the `session_id` extraction from `payload.user` JSON parse intact.

3. **`src/routes/messages/handler.ts`** — replace only the `device_id` extraction from `anthropicPayload.metadata.user_id` (JSON parse) with a call to `extractDeviceId`. **Keep** the `session_id` extraction from `anthropicPayload.metadata.user_id` JSON parse intact.

4. **`src/routes/embeddings/route.ts`** — add `device_id` logging using `extractDeviceId`. This requires:
   - Before the `try` block: capture `startTime = Date.now()`, `deviceId = extractDeviceId(c)`, and `payload = await c.req.json<EmbeddingRequest>()`.
   - The `try/catch` wraps only `createEmbeddings`. On success, call `markRequestLogged(c.req.raw)`, then `insertLog`, then `logRequest`, then return the response.
   - `insertLog` fields: `timestamp: startTime`, `model: payload.model`, `device_id: deviceId`, `session_id: undefined` (embeddings clients don't send a session), `input_tokens: response.usage.prompt_tokens`, `output_tokens: 0` (embeddings produce no generated tokens), `duration_ms`, `route: "openai"`, `stream: false`, `request_body: JSON.stringify(payload)`, `response_body: JSON.stringify(response)`, `cached_tokens: null`, and `null`/`undefined` for the remaining inapplicable fields (`finish_reason`, `is_agent_call`, `tools_count`, `accepted_prediction_tokens`, `rejected_prediction_tokens`, `request_id`).
   - The error path (`forwardError`) does NOT call `insertLog`, `logRequest`, or `markRequestLogged`.

### What does NOT change

- Database schema — `device_id` and `session_id` columns already exist.
- Dashboard and Devices UI — already display per-device data.
- `session_id` extraction logic in both handlers — keeps working exactly as today.

### Explicitly excluded

- **`src/routes/messages/count-tokens-handler.ts`** — handles `POST /v1/messages/count_tokens` but performs no `insertLog` call. No change needed.

## Helper specification

```ts
// Location: src/lib/extract-device-id.ts
// Import alias: ~/lib/extract-device-id
// Context imported from "hono"
export function extractDeviceId(c: Context): string | undefined
```

**Logic:**
1. Read `x-api-key` header first. If both `x-api-key` and `Authorization` are present, `x-api-key` takes precedence and the `Authorization` header value is not read.
2. If `x-api-key` is absent, read `Authorization` header and strip the exact prefix `"Bearer "` (7 characters, case-sensitive — non-standard casing like `bearer` is intentionally not normalized). If `Authorization` is also absent, the value will be empty and step 4 will return `undefined`.
3. Trim the resulting value.
4. If the trimmed value is falsy or equals `"dummy"` (case-insensitive match), return `undefined`.
5. If the trimmed value starts with `sk-ant-` (case-sensitive), it is a real Anthropic API key set by mistake — return `undefined`.
6. Otherwise return the trimmed string value.

## Identification sources summary

| Signal | Source | Who sends it | Route coverage |
|---|---|---|---|
| `device_id` | `x-api-key` / `Authorization` header | All clients (via `ANTHROPIC_AUTH_TOKEN` for Claude Code) | All routes |
| `session_id` | Request body (`metadata.user_id` / `user` JSON) | Claude Code only | `/v1/messages`, `/v1/chat/completions` |

## Client configuration

| Client | Configuration |
|---|---|
| Claude Code laptop-1 | `ANTHROPIC_AUTH_TOKEN=laptop-1` |
| Claude Code laptop-2 | `ANTHROPIC_AUTH_TOKEN=laptop-2` |
| Claude Code servidor | `ANTHROPIC_AUTH_TOKEN=servidor-ci` |
| Custom app (OpenAI route) | `x-api-key: nome-da-app` header |
| Custom app (Anthropic route) | `x-api-key: nome-da-app` header |
| No header / placeholder | `device_id = null` in logs |

## What is removed

- `device_id` extraction from the JSON body parse block in `chat-completions/handler.ts` (the `session_id` extraction from the same block is kept)
- `device_id` extraction from the JSON body parse block in `messages/handler.ts` (the `session_id` extraction from the same block is kept)

## Out of scope

- Authentication / token validation (requests without a recognized token are NOT blocked)
- UI changes to the dashboard
