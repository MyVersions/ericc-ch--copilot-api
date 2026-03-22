import type { MiddlewareHandler } from "hono"

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

function formatTime(): string {
  const now = new Date()
  const dd = String(now.getDate()).padStart(2, "0")
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const hh = String(now.getHours()).padStart(2, "0")
  const min = String(now.getMinutes()).padStart(2, "0")
  const ss = String(now.getSeconds()).padStart(2, "0")
  return `${dd}/${mm} ${hh}:${min}:${ss}`
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function colorStatus(status: number): string {
  const s = String(status)
  if (status >= 500) return ansi.red(s)
  if (status >= 400) return ansi.yellow(s)
  return ansi.green(s)
}

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
  const time = ansi.dim(`[${formatTime()}]`)
  const method = ansi.cyan(info.method.padEnd(4))
  const status = colorStatus(info.status)
  const duration = ansi.dim(formatDuration(info.durationMs))

  const sizeKb =
    info.requestSizeKb !== undefined
      ? ansi.cyan(`${info.requestSizeKb.toFixed(1)}kb`)
      : undefined

  const parts = [
    time,
    method,
    info.path,
    status,
    sizeKb,
    info.inputTokens !== undefined && info.outputTokens !== undefined
      ? ansi.yellow(`↑${formatTokens(info.inputTokens)} ↓${formatTokens(info.outputTokens)}`)
      : undefined,
    info.deviceId ? ansi.dim(`device:${info.deviceId.slice(0, 8)}`) : undefined,
    info.model ? ansi.magenta(info.model) : undefined,
    duration,
  ].filter((p) => p !== undefined)

  console.log(parts.join("  "))
}

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now()
  await next()

  if (handlerLoggedRequests.has(c.req.raw)) return

  logRequest({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - start,
  })
}
