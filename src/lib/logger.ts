import type { MiddlewareHandler } from "hono"

import { state } from "~/lib/state"

// Requests marked here are logged by their handlers (with token info)
// The middleware skips these to avoid duplicate lines
const handlerLoggedRequests = new WeakSet<Request>()

export function markRequestLogged(req: Request): void {
  handlerLoggedRequests.add(req)
}

// ANSI color helpers
const ansi = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
}

// ─── Config ──────────────────────────────────────────────────────────────────

export const LOG_CONFIG = {
  widths: {
    date: 17,
    method: 6,
    path: 25,
    status: 4,
    size: 8,
    tokens: 9,
    device: 40,
    model: 25,
    time: 8,
  },
  colors: {
    date: (s: string) => ansi.dim(s),
    method: (s: string) => ansi.cyan(s),
    path: (s: string) => s,
    status2xx: (s: string) => ansi.green(s),
    status3xx: (s: string) => ansi.green(s),
    status4xx: (s: string) => ansi.yellow(s),
    status5xx: (s: string) => ansi.red(s),
    size: (s: string) => ansi.cyan(s),
    tokens: (s: string) => ansi.yellow(s),
    device: (s: string) => ansi.dim(s),
    model: (s: string) => ansi.magenta(s),
    time: (s: string) => ansi.dim(s),
  },
}

// ─── Padding helpers ─────────────────────────────────────────────────────────

/** Left-align `s` in a column of `width` chars; append `…` if the string overflows. */
export function padRight(s: string, width: number): string {
  if (s.length > width) return s.slice(0, width) + "…"
  return s.padEnd(width)
}

/** Right-align `s` in exactly `width` chars; truncate with `…` if too long. */
export function padLeft(s: string, width: number): string {
  if (s.length > width) return s.slice(0, width - 1) + "…"
  return s.padStart(width)
}

// ─── Field formatters ────────────────────────────────────────────────────────

/** Wall-clock timestamp: `[DD/MM HH:MM:SS]` — exactly 17 chars. */
export function formatDate(): string {
  const now = new Date()
  const dd = String(now.getDate()).padStart(2, "0")
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const hh = String(now.getHours()).padStart(2, "0")
  const min = String(now.getMinutes()).padStart(2, "0")
  const ss = String(now.getSeconds()).padStart(2, "0")
  return `[${dd}/${mm} ${hh}:${min}:${ss}]`
}

/**
 * Request size — exactly 8 chars: `[4 int right][.][1 dec][2-char unit]`
 *
 * Input is in kilobytes (`requestSizeKb`).
 * Thresholds (in kb): < 1 → show as bytes (` b`), < 1024 → kb, ≥ 1024 → Mb.
 */
export function formatSize(kb: number): string {
  let value: number
  let unit: string

  if (kb < 1) {
    value = kb * 1024
    unit = " b"
  } else if (kb < 1024) {
    value = kb
    unit = "kb"
  } else {
    value = kb / 1024
    unit = "Mb"
  }

  // [4 int right][.][1 dec][2-char unit] = 8
  const intPart = Math.floor(value)
  const decPart = Math.round((value - intPart) * 10)
  const intStr = String(intPart).padStart(4)
  return `${intStr}.${decPart}${unit}`
}

/**
 * Token count — exactly 9 chars: `[space][↑/↓][4 int right][.or space][1 dec or space][1-char unit or space]`
 *
 * Units: ` ` (< 1 000), `k` (≥ 1 000), `M` (≥ 1 000 000).
 */
export function formatTokens(n: number, prefix: "↑" | "↓"): string {
  let intStr: string
  let dot: string
  let dec: string
  let unit: string

  if (n >= 1_000_000) {
    const v = n / 1_000_000
    intStr = String(Math.floor(v)).padStart(4)
    dot = "."
    dec = String(Math.round((v - Math.floor(v)) * 10))
    unit = "M"
  } else if (n >= 1_000) {
    const v = n / 1_000
    intStr = String(Math.floor(v)).padStart(4)
    dot = "."
    dec = String(Math.round((v - Math.floor(v)) * 10))
    unit = "k"
  } else {
    intStr = String(n).padStart(4)
    dot = " "
    dec = " "
    unit = " "
  }

  // [space][prefix][4 int][dot][dec][unit] = 1+1+4+1+1+1 = 9
  return ` ${prefix}${intStr}${dot}${dec}${unit}`
}

/**
 * Request duration — exactly 8 chars: `[5 int right][.][1 dec][s]`
 *
 * Always expressed in seconds. Never uses `ms`.
 */
export function formatDuration(ms: number): string {
  const s = ms / 1000
  const intPart = Math.floor(s)
  const decPart = Math.round((s - intPart) * 10)
  // [5 int right][.][1 dec][s] = 8
  return `${String(intPart).padStart(5)}.${decPart}s`
}

// ─── Status color ─────────────────────────────────────────────────────────────

function colorStatus(status: number, raw: string): string {
  if (status >= 500) return LOG_CONFIG.colors.status5xx(raw)
  if (status >= 400) return LOG_CONFIG.colors.status4xx(raw)
  if (status >= 300) return LOG_CONFIG.colors.status3xx(raw)
  return LOG_CONFIG.colors.status2xx(raw)
}

// ─── Public log function ─────────────────────────────────────────────────────

export interface RequestLogInfo {
  method: string
  path: string
  status: number
  durationMs: number
  requestSizeKb?: number
  model?: string
  deviceId?: string
  inputTokens?: number
  outputTokens?: number
}

export function logRequest(info: RequestLogInfo): void {
  const w = LOG_CONFIG.widths
  const c = LOG_CONFIG.colors

  const dateField = c.date(padRight(formatDate(), w.date))
  const methodField = c.method(padRight(info.method, w.method))
  const pathField = c.path(padRight(info.path, w.path))
  const statusRaw = padRight(String(info.status), w.status)
  const statusField = colorStatus(info.status, statusRaw)

  const sizeField =
    info.requestSizeKb !== undefined ?
      c.size(formatSize(info.requestSizeKb))
    : " ".repeat(w.size)

  const inputField =
    info.inputTokens !== undefined ?
      c.tokens(formatTokens(info.inputTokens, "↑"))
    : " ".repeat(w.tokens)

  const outputField =
    info.outputTokens !== undefined ?
      c.tokens(formatTokens(info.outputTokens, "↓"))
    : " ".repeat(w.tokens)

  const deviceField =
    info.deviceId !== undefined ?
      c.device(padRight(info.deviceId, w.device))
    : " ".repeat(w.device)

  const modelField =
    info.model !== undefined ?
      c.model(padRight(info.model, w.model))
    : " ".repeat(w.model)

  const timeField = c.time(formatDuration(info.durationMs))

  const parts = [
    dateField,
    methodField,
    pathField,
    statusField,
    sizeField,
    inputField,
    outputField,
    deviceField,
    modelField,
    timeField,
  ]

  console.log(parts.join("  "))
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now()
  await next()

  if (handlerLoggedRequests.has(c.req.raw)) return

  if (c.req.path.startsWith("/dashboard/api") && !state.dashboardLogs) return

  logRequest({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - start,
  })
}
