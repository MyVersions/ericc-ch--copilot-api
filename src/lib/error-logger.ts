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
      const parsed: unknown = JSON.parse(value)
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

  lines.push(`# 🔴 ERROR ${status}`, "", `**Timestamp:** ${data.timestamp}`)

  if (data.clientMethod && data.clientPath) {
    lines.push(`**Route:** ${data.clientMethod} ${data.clientPath}`)
  }

  lines.push(
    "",
    "---",
    "",
    "## Error",
    "",
    `> ${data.errorName}: ${data.errorMessage}`,
    "",
  )

  if (data.stackTrace) {
    // Strip redundant first line ("Error: <message>") from stack if present
    const stackLines = data.stackTrace.split("\n")
    const filtered =
      stackLines[0]?.startsWith(`${data.errorName}:`) ?
        stackLines.slice(1)
      : stackLines
    if (filtered.length > 0) {
      lines.push("**Stack trace:**", "```", ...filtered, "```", "")
    }
  }

  if (data.httpStatus !== null) {
    lines.push(`**Response status:** \`${data.httpStatus}\``, "")
  }

  // ── Client Request ──────────────────────────────────────────────────────────
  if (data.clientMethod && data.clientPath) {
    lines.push(
      "---",
      "",
      "## Client Request",
      "",
      `**Method/Path:** \`${data.clientMethod} ${data.clientPath}\``,
      "",
    )
    if (data.clientBody !== undefined) {
      lines.push(jsonBlock(data.clientBody), "")
    }
  }

  // ── Copilot Request ─────────────────────────────────────────────────────────
  if (data.copilotRequestUrl !== undefined) {
    lines.push(
      "---",
      "",
      "## Copilot Request",
      "",
      `**URL:** \`${data.copilotRequestUrl}\``,
      "",
    )

    if (data.copilotRequestHeaders !== undefined) {
      lines.push("**Headers:**", jsonBlock(data.copilotRequestHeaders), "")
    }

    if (data.copilotRequestBody !== undefined) {
      lines.push("**Body:**", jsonBlock(data.copilotRequestBody), "")
    }
  }

  // ── Copilot Response ────────────────────────────────────────────────────────
  if (data.upstream !== undefined) {
    lines.push(
      "---",
      "",
      "## Copilot Response",
      "",
      `**Status:** \`${status}\``,
      "",
      jsonBlock(data.upstream),
      "",
    )
  }

  return lines.join("\n")
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function extractHttpStatus(args: Array<unknown>): number | null {
  for (const arg of args) {
    if (arg instanceof Error && "response" in arg) {
      const r = (arg as { response: Response }).response
      return r.status
    }
    if (arg instanceof Response) return arg.status
  }
  return null
}

function buildErrorLogData(log: LogObject, ts: string): ErrorLogData {
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
      const info = arg as {
        method: string
        path: string
        body: string
        upstream?: unknown
      }
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

// ─── Setup ────────────────────────────────────────────────────────────────────

export function setupErrorFileLogger(): void {
  const defaultReporter = consola.options.reporters[0]

  const stdoutReporter: ConsolaReporter = {
    log(log, ctx) {
      if (log.type === "error" || log.type === "fatal") {
        return
      }
      defaultReporter.log(log, ctx)
    },
  }

  const fileReporter: ConsolaReporter = {
    log(log) {
      if (log.type !== "error" && log.type !== "fatal") return

      const now = new Date()
      const data = buildErrorLogData(log, now.toISOString())
      const isoTs = now.toISOString().replaceAll(":", "-").replaceAll(".", "-")
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
