# Error Log Format — Design Spec

**Date:** 2026-04-13  
**Status:** Approved

---

## Overview

Improve the error log files written to disk by `src/lib/error-logger.ts`:

1. Include the HTTP status code in the filename
2. Change extension to `.md` and format content as Markdown
3. Render JSON payloads in fenced code blocks
4. Include the request sent to GitHub Copilot and the response received

---

## 1. Filename

**Pattern:** `error-<HTTP_CODE>-<ISO_TS>-<SEQ>.md`

- `HTTP_CODE` — HTTP status from the upstream `Response` attached to `HTTPError`. Defaults to `500` when no HTTP status is available (generic errors, network failures, etc.)
- `ISO_TS` — ISO 8601 timestamp with `:` and `.` replaced by `-` (filesystem-safe)
- `SEQ` — 4-digit zero-padded sequence counter

**Examples:**
```
error-429-2026-04-13T14-22-05-123Z-0001.md
error-500-2026-04-13T14-23-11-456Z-0002.md
error-503-2026-04-13T14-24-00-789Z-0003.md
```

---

## 2. File Format

Markdown with the following sections. Sections are only rendered when data is available.

```markdown
# 🔴 ERROR <HTTP_CODE>

**Timestamp:** <ISO timestamp>
**Route:** <METHOD> <path>

---

## Error

> <ErrorName>: <error message>

**Stack trace:**
\`\`\`
<stack trace lines>
\`\`\`

**Response status:** `<HTTP_CODE>`

---

## Client Request

**Method/Path:** `<METHOD> <path>`

\`\`\`json
<formatted JSON body>
\`\`\`

---

## Copilot Request

**URL:** `POST <copilot endpoint URL>`

**Headers:**
\`\`\`json
<formatted headers object>
\`\`\`

**Body:**
\`\`\`json
<formatted JSON payload sent to Copilot>
\`\`\`

---

## Copilot Response

**Status:** `<HTTP_CODE>`

\`\`\`json
<formatted upstream error body>
\`\`\`
```

**Rules:**
- The `## Copilot Request` section only appears when the error is an `HTTPError` (i.e., came from an upstream call)
- The `## Copilot Response` section only appears when `upstream` data is present
- JSON bodies are pretty-printed with 2-space indent
- Non-JSON bodies are rendered as plain text fenced blocks (` ```\n...\n``` `)
- Stack traces omit the `Error: <message>` first line (already shown in the quote)

---

## 3. Capturing Copilot Request Context

### Problem

`HTTPError` currently carries only the upstream `Response`. The request payload and headers sent to Copilot are constructed inside `createChatCompletions` / `createEmbeddings` and lost after the `fetch()` call.

### Solution — Enrich `HTTPError`

Add optional fields to `HTTPError`:

```typescript
export class HTTPError extends Error {
  response: Response
  copilotRequestUrl?: string
  copilotRequestHeaders?: Record<string, string>
  copilotRequestBody?: unknown
}
```

In each service (`create-chat-completions.ts`, `create-embeddings.ts`), populate these fields before throwing:

```typescript
const error = new HTTPError("Failed to create chat completions", response)
error.copilotRequestUrl = `${copilotBaseUrl(state)}/chat/completions`
error.copilotRequestHeaders = headers
error.copilotRequestBody = payload
throw error
```

`forwardError` passes the `HTTPError` instance directly to `consola.error` — no changes needed there.

`error-logger.ts` reads the new fields from the error in `formatFull()` and renders the Copilot sections.

---

## 4. Files Changed

| File | Change |
|------|--------|
| `src/lib/error.ts` | Add `copilotRequestUrl`, `copilotRequestHeaders`, `copilotRequestBody` optional fields to `HTTPError` |
| `src/services/copilot/create-chat-completions.ts` | Populate new `HTTPError` fields before throwing |
| `src/services/copilot/create-embeddings.ts` | Populate new `HTTPError` fields before throwing |
| `src/lib/error-logger.ts` | Change filename pattern (add HTTP code, `.md` ext); rewrite `formatFull()` to produce Markdown |

No changes to `src/lib/error.ts` function signatures, route handlers, or `server.ts`.

---

## 5. Out of Scope

- No changes to stdout/stderr console output
- No changes to the SQLite request log
- No changes to the `requestLogger` middleware
- `get-models.ts` does not pass a payload body — include URL and headers only if it throws
