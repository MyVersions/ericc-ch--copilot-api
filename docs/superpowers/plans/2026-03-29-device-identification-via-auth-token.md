# Device Identification via Auth Token — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `device_id` from the `x-api-key` / `Authorization` HTTP header instead of the request body, so every client (Claude Code, custom apps) is automatically identified by the token they send — while keeping `session_id` extraction from the body intact.

**Architecture:** A new helper `extractDeviceId` reads the auth header and normalizes the value. The two existing handlers replace their per-handler `device_id` body-parsing with a call to the helper. The embeddings route gains full logging for the first time.

**Tech Stack:** Bun, TypeScript, Hono (`Context` from `"hono"`), existing `~/lib/db` (`insertLog`), existing `~/lib/logger` (`logRequest`, `markRequestLogged`).

---

## File Map

| Action | File | Purpose |
|---|---|---|
| **Create** | `src/lib/extract-device-id.ts` | New helper — reads header, returns normalized device ID |
| **Modify** | `src/routes/chat-completions/handler.ts` | Use helper for `deviceId`; keep `sessionId` from body |
| **Modify** | `src/routes/messages/handler.ts` | Use helper for `deviceId`; keep `sessionId` from body |
| **Modify** | `src/routes/embeddings/route.ts` | Add full `insertLog` + `logRequest` + `markRequestLogged` |

No database changes. No UI changes.

---

## Task 1: Create `extractDeviceId` helper

**Files:**
- Create: `src/lib/extract-device-id.ts`

This is a pure function — no side effects, easy to reason about in isolation.

- [ ] **Step 1: Create the helper file**

```ts
// src/lib/extract-device-id.ts
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
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/extract-device-id.ts
git commit -m "feat: add extractDeviceId helper that reads device id from auth header"
```

---

## Task 2: Update `chat-completions` handler

**Files:**
- Modify: `src/routes/chat-completions/handler.ts`

Replace `deviceId` extraction with the new helper. Keep the `sessionId` extraction from `payload.user` exactly as-is.

- [ ] **Step 1: Update imports** — add `extractDeviceId` import at the top of the file, alongside existing imports:

```ts
import { extractDeviceId } from "~/lib/extract-device-id"
```

- [ ] **Step 2: Replace the `device_id` extraction**

Find the existing block (lines ~28–39):
```ts
// Extract device_id and session_id from the user field (JSON string)
let deviceId: string | undefined
let sessionId: string | undefined
try {
  if (payload.user) {
    const userMeta = JSON.parse(payload.user) as { device_id?: string; session_id?: string }
    deviceId = userMeta.device_id
    sessionId = userMeta.session_id
  }
} catch {
  // user field is not JSON — ignore
}
```

Replace with:
```ts
// device_id comes from the auth header (x-api-key or Authorization: Bearer)
const deviceId = extractDeviceId(c)

// session_id comes from the request body (Claude Code only)
let sessionId: string | undefined
try {
  if (payload.user) {
    const userMeta = JSON.parse(payload.user) as { session_id?: string }
    sessionId = userMeta.session_id
  }
} catch {
  // user field is not JSON — ignore
}
```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/routes/chat-completions/handler.ts
git commit -m "feat: extract device_id from auth header in chat-completions handler"
```

---

## Task 3: Update `messages` handler

**Files:**
- Modify: `src/routes/messages/handler.ts`

Same pattern as Task 2, but the session is in `anthropicPayload.metadata.user_id`.

- [ ] **Step 1: Update imports** — add `extractDeviceId` import:

```ts
import { extractDeviceId } from "~/lib/extract-device-id"
```

- [ ] **Step 2: Replace the `device_id` extraction**

Find the existing block (lines ~36–46):
```ts
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
```

Replace with:
```ts
// device_id comes from the auth header (x-api-key or Authorization: Bearer)
const deviceId = extractDeviceId(c)

// session_id comes from the request body (Claude Code only)
let sessionId: string | undefined
try {
  if (anthropicPayload.metadata?.user_id) {
    const userMeta = JSON.parse(anthropicPayload.metadata.user_id) as { session_id?: string }
    sessionId = userMeta.session_id
  }
} catch {
  // user_id is not JSON — ignore
}
```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/routes/messages/handler.ts
git commit -m "feat: extract device_id from auth header in messages handler"
```

---

## Task 4: Add logging to `embeddings` route

**Files:**
- Modify: `src/routes/embeddings/route.ts`

This route currently has zero logging. Add full `insertLog` + `logRequest` + `markRequestLogged` on the success path only.

- [ ] **Step 1: Rewrite the embeddings route with logging**

Replace the entire file content with:

```ts
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

  try {
    const response = await createEmbeddings(payload)

    const durationMs = Date.now() - startTime
    const inputTokens = response.usage.prompt_tokens

    insertLog({
      timestamp: startTime,
      model: payload.model,
      device_id: deviceId,
      session_id: undefined,
      input_tokens: inputTokens,
      output_tokens: 0,
      duration_ms: durationMs,
      request_body: JSON.stringify(payload),
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
      requestSizeKb: JSON.stringify(payload).length / 1024,
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
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 3: Run linter**

Run: `bun run lint`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/routes/embeddings/route.ts
git commit -m "feat: add device_id logging to embeddings route"
```

---

## Task 5: Final verification

- [ ] **Step 1: Full typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: no errors

- [ ] **Step 2: Manual smoke test — device_id via header**

Start the server:
```bash
bun run dev
```

Send a request with a device identifier in the header:
```bash
curl -s -X POST http://localhost:4141/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-api-key: meu-laptop" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"ping"}]}' \
  | head -c 200
```

Then open `http://localhost:4141/devices` and confirm `meu-laptop` appears in the device list.

- [ ] **Step 3: Verify `dummy` token returns null device_id**

```bash
curl -s -X POST http://localhost:4141/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-api-key: dummy" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"ping"}]}' \
  | head -c 200
```

In the SQLite viewer (`http://localhost:4141/sqlite`), confirm the last log row has `device_id = NULL`.

- [ ] **Step 4: Verify session_id still works for Anthropic route**

Send a request that mimics what Claude Code sends (session in `metadata.user_id`):
```bash
curl -s -X POST http://localhost:4141/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: meu-laptop" \
  -d '{
    "model": "claude-sonnet-4-5",
    "max_tokens": 10,
    "messages": [{"role": "user", "content": "ping"}],
    "metadata": {"user_id": "{\"session_id\": \"test-session-abc\"}"}
  }' | head -c 200
```

In SQLite viewer, confirm the log row has both `device_id = "meu-laptop"` and `session_id = "test-session-abc"`.
