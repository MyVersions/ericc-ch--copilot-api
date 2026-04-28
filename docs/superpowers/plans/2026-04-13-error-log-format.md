# Error Log Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reformat disk error logs from plain `.txt` to structured `.md` files with HTTP code in filename, Markdown formatting, pretty-printed JSON, and Copilot request/response context.

**Architecture:** Enrich `HTTPError` with optional Copilot request context fields; populate them in service files before throwing; rewrite `formatFull()` in `error-logger.ts` to produce Markdown output and update filename generation to include HTTP code with `.md` extension.

**Tech Stack:** TypeScript, Bun, Node.js `fs`, consola

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/error.ts` | Modify | Add `copilotRequestUrl`, `copilotRequestHeaders`, `copilotRequestBody` optional fields to `HTTPError` |
| `src/services/copilot/create-chat-completions.ts` | Modify | Populate new `HTTPError` fields before throwing |
| `src/services/copilot/create-embeddings.ts` | Modify | Populate new `HTTPError` fields before throwing |
| `src/services/copilot/get-models.ts` | Modify | Populate URL + headers (no body) before throwing |
| `src/lib/error-logger.ts` | Modify | New filename pattern (HTTP code + `.md`); rewrite `formatFull()` to Markdown |
| `src/lib/error-logger.test.ts` | Create | Unit tests for new filename pattern and Markdown output |

---

## Task 1: Enrich `HTTPError` with Copilot request context

**Files:**
- Modify: `src/lib/error.ts`

- [ ] **Step 1: Add optional fields to `HTTPError`**

Replace the class body in `src/lib/error.ts`:

```typescript
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
```

(The rest of the file — `forwardError` — stays untouched.)

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/error.ts
git commit -m "feat: add copilot request context fields to HTTPError"
```

---

## Task 2: Populate Copilot context in `create-chat-completions.ts`

**Files:**
- Modify: `src/services/copilot/create-chat-completions.ts`

The file currently throws `new HTTPError("Failed to create chat completions", response)` on line 40. The `headers` and `payload` are already in scope at that point, and `copilotBaseUrl(state)` gives us the URL.

- [ ] **Step 1: Replace the throw statement**

Find this block (lines 39–41):

```typescript
  if (!response.ok) {
    throw new HTTPError("Failed to create chat completions", response)
  }
```

Replace with:

```typescript
  if (!response.ok) {
    const err = new HTTPError("Failed to create chat completions", response)
    err.copilotRequestUrl = `${copilotBaseUrl(state)}/chat/completions`
    err.copilotRequestHeaders = headers
    err.copilotRequestBody = payload
    throw err
  }
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/copilot/create-chat-completions.ts
git commit -m "feat: attach copilot request context to HTTPError in chat completions"
```

---

## Task 3: Populate Copilot context in `create-embeddings.ts`

**Files:**
- Modify: `src/services/copilot/create-embeddings.ts`

The file currently throws `new HTTPError("Failed to create embeddings", response)` on line 14. The `payload` and headers are in scope; the URL is `${copilotBaseUrl(state)}/embeddings`.

Note: `create-embeddings.ts` calls `copilotHeaders(state)` inline in the fetch call without storing it. We need to extract it to a variable first.

- [ ] **Step 1: Extract headers variable and enrich error**

Replace this block (lines 5–17):

```typescript
export const createEmbeddings = async (payload: EmbeddingRequest) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const response = await fetch(`${copilotBaseUrl(state)}/embeddings`, {
    method: "POST",
    headers: copilotHeaders(state),
    body: JSON.stringify(payload),
  })

  if (!response.ok) throw new HTTPError("Failed to create embeddings", response)

  return (await response.json()) as EmbeddingResponse
}
```

With:

```typescript
export const createEmbeddings = async (payload: EmbeddingRequest) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const headers = copilotHeaders(state)
  const url = `${copilotBaseUrl(state)}/embeddings`

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const err = new HTTPError("Failed to create embeddings", response)
    err.copilotRequestUrl = url
    err.copilotRequestHeaders = headers
    err.copilotRequestBody = payload
    throw err
  }

  return (await response.json()) as EmbeddingResponse
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/copilot/create-embeddings.ts
git commit -m "feat: attach copilot request context to HTTPError in embeddings"
```

---

## Task 4: Populate Copilot context in `get-models.ts`

**Files:**
- Modify: `src/services/copilot/get-models.ts`

`get-models.ts` uses a GET request with no body. Include URL and headers only.

- [ ] **Step 1: Extract headers variable and enrich error**

Replace this block (lines 5–13):

```typescript
export const getModels = async () => {
  const response = await fetch(`${copilotBaseUrl(state)}/models`, {
    headers: copilotHeaders(state),
  })

  if (!response.ok) throw new HTTPError("Failed to get models", response)

  return (await response.json()) as ModelsResponse
}
```

With:

```typescript
export const getModels = async () => {
  const headers = copilotHeaders(state)
  const url = `${copilotBaseUrl(state)}/models`

  const response = await fetch(url, { headers })

  if (!response.ok) {
    const err = new HTTPError("Failed to get models", response)
    err.copilotRequestUrl = url
    err.copilotRequestHeaders = headers
    throw err
  }

  return (await response.json()) as ModelsResponse
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/copilot/get-models.ts
git commit -m "feat: attach copilot request context to HTTPError in get-models"
```

---

## Task 5: Write tests for the new `error-logger` behavior

**Files:**
- Create: `src/lib/error-logger.test.ts`

Before rewriting `error-logger.ts`, write the tests that will drive the new behavior. This project uses `bun:test`.

- [ ] **Step 1: Create test file**

Create `src/lib/error-logger.test.ts` with this content:

```typescript
import { expect, test, describe, beforeEach, afterEach } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

// We test the exported helpers directly, not the full consola integration.
// Import after we have the exports wired up.
import {
  buildFilename,
  formatMarkdown,
  type ErrorLogData,
} from "./error-logger"

// ─── buildFilename ────────────────────────────────────────────────────────────

describe("buildFilename", () => {
  test("includes http status code after 'error-'", () => {
    const name = buildFilename(429, "2026-04-13T14-22-05-123Z", "0001")
    expect(name).toMatch(/^error-429-/)
  })

  test("defaults to 500 when status is null", () => {
    const name = buildFilename(null, "2026-04-13T14-22-05-123Z", "0001")
    expect(name).toMatch(/^error-500-/)
  })

  test("ends with .md extension", () => {
    const name = buildFilename(429, "2026-04-13T14-22-05-123Z", "0001")
    expect(name).toMatch(/\.md$/)
  })

  test("full pattern: error-<code>-<ts>-<seq>.md", () => {
    const name = buildFilename(503, "2026-04-13T14-22-05-123Z", "0003")
    expect(name).toBe("error-503-2026-04-13T14-22-05-123Z-0003.md")
  })
})

// ─── formatMarkdown ───────────────────────────────────────────────────────────

describe("formatMarkdown", () => {
  const baseData: ErrorLogData = {
    timestamp: "2026-04-13T14:22:05.123Z",
    httpStatus: 429,
    errorName: "HTTPError",
    errorMessage: "Failed to create chat completions",
    stackTrace: "HTTPError: Failed to create chat completions\n    at createChatCompletions (src/services/copilot/create-chat-completions.ts:39)",
    clientMethod: "POST",
    clientPath: "/v1/messages",
    clientBody: '{"model":"claude-sonnet-4-5","messages":[]}',
  }

  test("starts with # 🔴 ERROR <status>", () => {
    const md = formatMarkdown(baseData)
    expect(md).toMatch(/^# 🔴 ERROR 429/)
  })

  test("includes timestamp", () => {
    const md = formatMarkdown(baseData)
    expect(md).toContain("2026-04-13T14:22:05.123Z")
  })

  test("includes route", () => {
    const md = formatMarkdown(baseData)
    expect(md).toContain("POST /v1/messages")
  })

  test("includes error name and message as blockquote", () => {
    const md = formatMarkdown(baseData)
    expect(md).toContain("> HTTPError: Failed to create chat completions")
  })

  test("client body is in a json fenced block", () => {
    const md = formatMarkdown(baseData)
    expect(md).toContain("```json")
    // parsed and pretty-printed
    expect(md).toContain('"model": "claude-sonnet-4-5"')
  })

  test("no copilot request section when copilotRequestUrl absent", () => {
    const md = formatMarkdown(baseData)
    expect(md).not.toContain("## Copilot Request")
  })

  test("no copilot response section when upstream absent", () => {
    const md = formatMarkdown(baseData)
    expect(md).not.toContain("## Copilot Response")
  })

  test("includes copilot request section when copilotRequestUrl present", () => {
    const md = formatMarkdown({
      ...baseData,
      copilotRequestUrl: "https://api.githubcopilot.com/chat/completions",
      copilotRequestHeaders: { Authorization: "Bearer ghu_test", "content-type": "application/json" },
      copilotRequestBody: { model: "gpt-4o", messages: [] },
    })
    expect(md).toContain("## Copilot Request")
    expect(md).toContain("https://api.githubcopilot.com/chat/completions")
    expect(md).toContain('"model": "gpt-4o"')
  })

  test("includes copilot response section when upstream present", () => {
    const md = formatMarkdown({
      ...baseData,
      upstream: { message: "Rate limit exceeded" },
    })
    expect(md).toContain("## Copilot Response")
    expect(md).toContain('"message": "Rate limit exceeded"')
  })

  test("non-JSON client body renders in plain fenced block", () => {
    const md = formatMarkdown({
      ...baseData,
      clientBody: "not json {{",
    })
    // Should have a plain ``` block (not ```json) for the body
    expect(md).toContain("not json {{")
  })

  test("uses 500 status in header when httpStatus is null", () => {
    const md = formatMarkdown({ ...baseData, httpStatus: null })
    expect(md).toMatch(/^# 🔴 ERROR 500/)
  })
})
```

- [ ] **Step 2: Run tests — expect failures**

```bash
bun test src/lib/error-logger.test.ts
```

Expected: FAIL — `buildFilename` and `formatMarkdown` are not yet exported from `error-logger.ts`.

- [ ] **Step 3: Commit test file**

```bash
git add src/lib/error-logger.test.ts
git commit -m "test: add failing tests for new error-logger markdown format"
```

---

## Task 6: Rewrite `error-logger.ts` — exports and new logic

**Files:**
- Modify: `src/lib/error-logger.ts`

- [ ] **Step 1: Replace the entire file**

```typescript
import consola, { type ConsolaReporter, type LogObject } from "consola"
import fs from "node:fs"

import { HTTPError } from "~/lib/error"
import { PATHS } from "~/lib/paths"

let seqCounter = 0

// ─── Exported types ───────────────────────────────────────────────────────────

export interface ErrorLogData {
  timestamp: string
  httpStatus: number | null
  errorName: string
  errorMessage: string
  stackTrace?: string
  clientMethod?: string
  clientPath?: string
  clientBody?: string
  copilotRequestUrl?: string
  copilotRequestHeaders?: Record<string, string>
  copilotRequestBody?: unknown
  upstream?: unknown
}

// ─── Exported helpers (tested directly) ──────────────────────────────────────

export function buildFilename(
  httpStatus: number | null,
  isoTs: string,
  seq: string,
): string {
  const code = httpStatus ?? 500
  return `error-${code}-${isoTs}-${seq}.md`
}

function tryPrettyJson(value: unknown): { isJson: boolean; text: string } {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return { isJson: true, text: JSON.stringify(parsed, null, 2) }
    } catch {
      return { isJson: false, text: value }
    }
  }
  if (typeof value === "object" && value !== null) {
    return { isJson: true, text: JSON.stringify(value, null, 2) }
  }
  return { isJson: false, text: String(value) }
}

function jsonBlock(value: unknown): string {
  const { isJson, text } = tryPrettyJson(value)
  const fence = isJson ? "```json" : "```"
  return `${fence}\n${text}\n\`\`\``
}

export function formatMarkdown(data: ErrorLogData): string {
  const status = data.httpStatus ?? 500
  const lines: Array<string> = []

  lines.push(`# 🔴 ERROR ${status}`, "")
  lines.push(`**Timestamp:** ${data.timestamp}`)

  if (data.clientMethod && data.clientPath) {
    lines.push(`**Route:** ${data.clientMethod} ${data.clientPath}`)
  }

  lines.push("", "---", "", "## Error", "")
  lines.push(`> ${data.errorName}: ${data.errorMessage}`, "")

  if (data.stackTrace) {
    // Strip redundant first line ("Error: <message>") from stack if present
    const stackLines = data.stackTrace.split("\n")
    const filtered =
      stackLines[0]?.startsWith(`${data.errorName}:`) ?
        stackLines.slice(1)
      : stackLines
    if (filtered.length > 0) {
      lines.push("**Stack trace:**")
      lines.push("```")
      lines.push(...filtered)
      lines.push("```", "")
    }
  }

  if (data.httpStatus !== null) {
    lines.push(`**Response status:** \`${data.httpStatus}\``, "")
  }

  // ── Client Request ──────────────────────────────────────────────────────────
  if (data.clientMethod && data.clientPath) {
    lines.push("---", "", "## Client Request", "")
    lines.push(`**Method/Path:** \`${data.clientMethod} ${data.clientPath}\``, "")
    if (data.clientBody !== undefined) {
      lines.push(jsonBlock(data.clientBody), "")
    }
  }

  // ── Copilot Request ─────────────────────────────────────────────────────────
  if (data.copilotRequestUrl !== undefined) {
    lines.push("---", "", "## Copilot Request", "")
    lines.push(`**URL:** \`POST ${data.copilotRequestUrl}\``, "")

    if (data.copilotRequestHeaders !== undefined) {
      lines.push("**Headers:**")
      lines.push(jsonBlock(data.copilotRequestHeaders), "")
    }

    if (data.copilotRequestBody !== undefined) {
      lines.push("**Body:**")
      lines.push(jsonBlock(data.copilotRequestBody), "")
    }
  }

  // ── Copilot Response ────────────────────────────────────────────────────────
  if (data.upstream !== undefined) {
    lines.push("---", "", "## Copilot Response", "")
    lines.push(`**Status:** \`${status}\``, "")
    lines.push(jsonBlock(data.upstream), "")
  }

  return lines.join("\n")
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function extractHttpStatus(args: Array<unknown>): number | null {
  for (const arg of args) {
    if (arg instanceof Error && "response" in arg) {
      const r = (arg as { response: Response }).response
      if (r.status) return r.status
    }
    if (arg instanceof Response) return arg.status
  }
  return null
}

function buildErrorLogData(log: LogObject): ErrorLogData {
  const ts = new Date().toISOString()
  const httpStatus = extractHttpStatus(log.args)

  let errorName = "Error"
  let errorMessage = "Unknown error"
  let stackTrace: string | undefined
  let clientMethod: string | undefined
  let clientPath: string | undefined
  let clientBody: string | undefined
  let copilotRequestUrl: string | undefined
  let copilotRequestHeaders: Record<string, string> | undefined
  let copilotRequestBody: unknown
  let upstream: unknown

  for (const arg of log.args) {
    if (arg instanceof HTTPError) {
      errorName = arg.name
      errorMessage = arg.message
      stackTrace = arg.stack
      copilotRequestUrl = arg.copilotRequestUrl
      copilotRequestHeaders = arg.copilotRequestHeaders
      copilotRequestBody = arg.copilotRequestBody
    } else if (arg instanceof Error) {
      errorName = arg.name
      errorMessage = arg.message
      stackTrace = arg.stack
    } else if (
      typeof arg === "object"
      && arg !== null
      && "method" in arg
      && "path" in arg
      && "body" in arg
    ) {
      const info = arg as { method: string; path: string; body: string; upstream?: unknown }
      clientMethod = info.method
      clientPath = info.path
      clientBody = info.body
      if (info.upstream !== undefined) upstream = info.upstream
    }
  }

  return {
    timestamp: ts,
    httpStatus,
    errorName,
    errorMessage,
    stackTrace,
    clientMethod,
    clientPath,
    clientBody,
    copilotRequestUrl,
    copilotRequestHeaders,
    copilotRequestBody,
    upstream,
  }
}

function formatShort(log: LogObject): string {
  const status = extractHttpStatus(log.args)
  const message = String(log.args[0] ?? "Unknown error")
  return status ? `HTTP ${status} – ${message}` : message
}

// ─── Setup ────────────────────────────────────────────────────────────────────

export function setupErrorFileLogger(): void {
  const defaultReporter = consola.options.reporters[0]

  const stdoutReporter: ConsolaReporter = {
    log(log, ctx) {
      if (log.type === "error" || log.type === "fatal") {
        process.stderr.write(`\x1b[31m✖ ERROR\x1b[0m  ${formatShort(log)}\n`)
        return
      }
      defaultReporter.log(log, ctx)
    },
  }

  const fileReporter: ConsolaReporter = {
    log(log) {
      if (log.type !== "error" && log.type !== "fatal") return

      const data = buildErrorLogData(log)

      const isoTs = new Date()
        .toISOString()
        .replaceAll(":", "-")
        .replaceAll(".", "-")
      const seq = String(++seqCounter).padStart(4, "0")
      const filename = buildFilename(data.httpStatus, isoTs, seq)
      const filepath = `${PATHS.LOGS_DIR}/${filename}`

      try {
        fs.mkdirSync(PATHS.LOGS_DIR, { recursive: true })
        fs.writeFileSync(filepath, formatMarkdown(data), "utf8")
      } catch {
        // Silently ignore — avoid infinite error loops
      }
    },
  }

  consola.setReporters([stdoutReporter, fileReporter])
}
```

- [ ] **Step 2: Run tests**

```bash
bun test src/lib/error-logger.test.ts
```

Expected: all tests PASS.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/error-logger.ts
git commit -m "feat: rewrite error-logger to produce markdown files with HTTP code in filename"
```

---

## Task 7: Full quality check

**Files:** (none new)

- [ ] **Step 1: Run all tests**

```bash
bun test
```

Expected: all tests PASS (existing `logger.test.ts` + new `error-logger.test.ts`).

- [ ] **Step 2: Lint**

```bash
bun run lint
```

Expected: no errors.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Check for unused exports**

```bash
bun run knip
```

Expected: no new unused exports reported (the new exports `buildFilename`, `formatMarkdown`, `ErrorLogData` are used by the test file).

- [ ] **Step 5: Commit if any lint auto-fixes applied**

```bash
git add -p
git commit -m "chore: lint fixes after error-logger rewrite"
```

(Skip if nothing changed.)
