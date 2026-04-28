# Logging Fixes Design

**Date:** 2026-04-13  
**Scope:** Three independent bugs in the request logging pipeline

---

## Context

The server uses a two-tier logging strategy:

- **Handler-owned logs:** Handlers that have access to rich context (size, model, deviceId, tokens) call `logRequest()` directly and then `markRequestLogged(req)` to suppress the fallback.
- **Middleware fallback:** `requestLogger` runs after every request; if the request is not in `handlerLoggedRequests`, it calls `logRequest()` with only method/path/status/duration.

Three bugs break this contract.

---

## Bug 1 — `count_tokens` log line duplicated

**Root cause:** `handleCountTokens` calls `logRequest()` directly (with full context) but never calls `markRequestLogged(c.req.raw)`. The middleware fallback fires a second time, producing a stripped-down duplicate line.

**Fix:** Add `markRequestLogged(c.req.raw)` before each `return` in `handleCountTokens` — before the early return in the `!selectedModel` branch, before the normal return, and before the return in the catch block.

**File:** `src/routes/messages/count-tokens-handler.ts`

---

## Bug 2 — On 500 errors, caller/size fields missing from the log line

**Root cause:** When a handler throws before reaching its `markRequestLogged` + `logRequest` calls, `forwardError` is invoked. It never calls `markRequestLogged`, so the middleware fallback fires — but the fallback only has method/path/status/duration; it has no access to `deviceId`, `requestSizeKb`, or `model`.

**Fix — use Hono context variables as a side-channel:**

1. Each handler stores values on the context early, as soon as they are computed:
   ```ts
   c.set("deviceId", deviceId)
   c.set("requestSizeKb", payloadJson.length / 1024)
   c.set("model", selectedModel.id)
   ```
2. `forwardError` reads those values from the context and calls `markRequestLogged` + `logRequest` with whatever fields are available (fields not yet set remain `undefined` and render as blank columns, as today).

This requires declaring the variables in Hono's context type via `createFactory` / module augmentation, or using `c.get()` with a cast — the simpler cast approach is sufficient here.

**Files:** `src/lib/error.ts`, `src/routes/messages/handler.ts`, `src/routes/messages/count-tokens-handler.ts`, `src/routes/chat-completions/handler.ts`

---

## Bug 3 — Redundant `✖ ERROR HTTP 500 – Error occurred:` stderr line

**Root cause:** `stdoutReporter` in `error-logger.ts` intercepts every `consola.error()` call and writes a formatted line to stderr. This fires inside `forwardError` before the access-log line, producing two lines per error request. The file reporter (writes `.md` logs) is independent and must be preserved.

**Fix:** Remove the stderr write from `stdoutReporter` for `error`/`fatal` log types. Instead, let those pass through to the `defaultReporter` — or simply do nothing for them in `stdoutReporter`. The 500 status is already shown in red in the access-log line produced by the middleware fallback, so no information is lost.

The `fileReporter` is not touched; error markdown files continue to be written.

**File:** `src/lib/error-logger.ts`

---

## Summary

| Bug | File(s) | Change |
|-----|---------|--------|
| 1 — duplicate count_tokens line | `count-tokens-handler.ts` | Add `markRequestLogged(c.req.raw)` before each `return` |
| 2 — missing fields on 500 | `error.ts`, three handler files | Handlers `c.set()` rich fields early; `forwardError` reads and passes them to `logRequest` |
| 3 — redundant stderr error line | `error-logger.ts` | `stdoutReporter` stops writing to stderr for error/fatal |

No new abstractions. No new files. All changes are additive or subtractive within existing functions.
