# Logging Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three independent bugs in the request logging pipeline: duplicate `count_tokens` log lines, missing caller/size fields on 500 error log lines, and a redundant stderr error line.

**Architecture:** Bug 1 is a missing `markRequestLogged()` call. Bug 2 uses Hono context variables (`c.set`/`c.get`) as a side-channel so `forwardError` can enrich the fallback log line. Bug 3 removes the stderr write from `stdoutReporter` for error/fatal log types while keeping the file reporter intact.

**Tech Stack:** Bun, TypeScript, Hono, consola

---

### Task 1: Fix duplicate `count_tokens` log line

**Files:**
- Modify: `src/routes/messages/count-tokens-handler.ts`

The handler calls `logRequest()` directly but never calls `markRequestLogged()`, so the middleware fallback fires a second bare line. Fix: add `markRequestLogged(c.req.raw)` before each of the three `return` statements.

- [ ] **Step 1: Verify the bug is observable in the test suite**

Run:
```bash
bun test src/lib/logger.test.ts
```
Expected: all tests pass (baseline check before changes).

- [ ] **Step 2: Add `markRequestLogged` import and calls**

In `src/routes/messages/count-tokens-handler.ts`, change:

```ts
import { logRequest } from "~/lib/logger"
```
to:
```ts
import { logRequest, markRequestLogged } from "~/lib/logger"
```

Then add `markRequestLogged(c.req.raw)` immediately before each of the three returns:

**Early return (model not found, line ~43):**
```ts
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
```

**Normal return (line ~82):**
```ts
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
```

**Catch return (line ~89):**
```ts
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
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/messages/count-tokens-handler.ts
git commit -m "fix: prevent duplicate log line for count_tokens requests"
```

---

### Task 2: Enrich error log lines with caller/size/model via context side-channel

**Files:**
- Modify: `src/routes/messages/handler.ts`
- Modify: `src/routes/messages/count-tokens-handler.ts`
- Modify: `src/routes/chat-completions/handler.ts`
- Modify: `src/lib/error.ts`

When a handler throws before its own `markRequestLogged` + `logRequest` calls, `forwardError` runs the fallback — but the fallback has no access to `deviceId`, `requestSizeKb`, or `model`. Fix: each handler stores these values on the Hono context early; `forwardError` reads them and passes them to `logRequest`.

- [ ] **Step 1: Store context values in `src/routes/messages/handler.ts`**

In `handleCompletion`, immediately after `deviceId` and `payloadJson` are computed (before the `await createChatCompletions` call that can throw), add:

```ts
  const deviceId = extractDeviceId(c)
  const sessionId = extractSessionId(anthropicPayload.metadata?.user_id)

  // Store early so forwardError can enrich the fallback log line
  c.set("logDeviceId" as never, deviceId as never)
  c.set("logRequestSizeKb" as never, (payloadJson.length / 1024) as never)
  c.set("logModel" as never, anthropicPayload.model as never)
```

Place these three `c.set` calls right after the `sessionId` line (before `translateToOpenAI`).

- [ ] **Step 2: Store context values in `src/routes/messages/count-tokens-handler.ts`**

In `handleCountTokens`, inside the `try` block, immediately after `payloadJson` is available and the model lookup has occurred, add:

```ts
    const payloadJson = JSON.stringify(anthropicPayload)

    // Store early so forwardError can enrich the fallback log line
    c.set("logDeviceId" as never, deviceId as never)
    c.set("logRequestSizeKb" as never, (payloadJson.length / 1024) as never)
    c.set("logModel" as never, anthropicPayload.model as never)
```

Place these three lines right after `const payloadJson = JSON.stringify(anthropicPayload)`.

- [ ] **Step 3: Store context values in `src/routes/chat-completions/handler.ts`**

In `handleCompletion`, immediately after `deviceId` and `payloadJson` are computed, add:

```ts
  const deviceId = extractDeviceId(c)
  const sessionId = extractSessionId(payload.user)

  // Store early so forwardError can enrich the fallback log line
  c.set("logDeviceId" as never, deviceId as never)
  c.set("logRequestSizeKb" as never, (payloadJson.length / 1024) as never)
  c.set("logModel" as never, payload.model as never)
```

Place these three lines right after the `sessionId` line.

- [ ] **Step 4: Update `forwardError` in `src/lib/error.ts`**

Import `logRequest` and `markRequestLogged` at the top:

```ts
import { logRequest, markRequestLogged } from "~/lib/logger"
```

Then, in `forwardError`, before each `return c.json(...)` call, read the context values and emit a rich log line. Replace the function body with:

```ts
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
```

Note: `durationMs: 0` is used because the start time is not available in `forwardError`. This is acceptable — the access log line will show `0.0s` for errors, which is a known limitation.

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/error.ts src/routes/messages/handler.ts src/routes/messages/count-tokens-handler.ts src/routes/chat-completions/handler.ts
git commit -m "fix: include deviceId/size/model in error log lines via context side-channel"
```

---

### Task 3: Remove redundant stderr error line

**Files:**
- Modify: `src/lib/error-logger.ts`

`stdoutReporter` intercepts `consola.error()` calls and writes `✖ ERROR HTTP 500 – Error occurred:` to stderr. The 500 status is already visible in the access log line (red). The file reporter must keep working.

- [ ] **Step 1: Update `stdoutReporter` in `src/lib/error-logger.ts`**

In `setupErrorFileLogger`, replace the `stdoutReporter` body:

Current:
```ts
  const stdoutReporter: ConsolaReporter = {
    log(log, ctx) {
      if (log.type === "error" || log.type === "fatal") {
        process.stderr.write(`\x1b[31m✖ ERROR\x1b[0m  ${formatShort(log)}\n`)
        return
      }
      defaultReporter.log(log, ctx)
    },
  }
```

Replace with:
```ts
  const stdoutReporter: ConsolaReporter = {
    log(log, ctx) {
      if (log.type === "error" || log.type === "fatal") {
        return
      }
      defaultReporter.log(log, ctx)
    },
  }
```

- [ ] **Step 2: Run existing error-logger tests**

```bash
bun test src/lib/error-logger.test.ts
```
Expected: all tests pass (tests cover `buildFilename` and `formatMarkdown`, neither of which is affected).

- [ ] **Step 3: Run full typecheck and lint**

```bash
bun run typecheck && bun run lint
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/error-logger.ts
git commit -m "fix: suppress redundant stderr error line, access log already shows 500 status"
```
