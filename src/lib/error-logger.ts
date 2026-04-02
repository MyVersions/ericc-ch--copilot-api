import consola, { type ConsolaReporter, type LogObject } from "consola"
import fs from "node:fs"

import { PATHS } from "~/lib/paths"

let seqCounter = 0

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

function formatShort(log: LogObject): string {
  const status = extractHttpStatus(log.args)
  const message = String(log.args[0] ?? "Unknown error")
  return status ? `HTTP ${status} – ${message}` : message
}

function formatFull(log: LogObject): string {
  const ts = new Date().toISOString()
  const lines: Array<string> = [`[${ts}] ERROR`, ""]

  for (const arg of log.args) {
    if (arg instanceof Error) {
      lines.push(`${arg.name}: ${arg.message}`)
      if (arg.stack) lines.push(arg.stack)
      if ("response" in arg) {
        const r = (arg as { response: Response }).response
        lines.push(`Response status: ${r.status}`)
      }
    } else if (typeof arg === "object" && arg !== null) {
      lines.push(JSON.stringify(arg, null, 2))
    } else {
      lines.push(String(arg))
    }
    lines.push("")
  }

  return lines.join("\n")
}

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

      const ts = new Date()
        .toISOString()
        .replaceAll(":", "-")
        .replaceAll(".", "-")
      const seq = String(++seqCounter).padStart(4, "0")
      const filepath = `${PATHS.LOGS_DIR}/error-${ts}-${seq}.txt`

      try {
        fs.mkdirSync(PATHS.LOGS_DIR, { recursive: true })
        fs.writeFileSync(filepath, formatFull(log), "utf8")
      } catch {
        // Silently ignore — avoid infinite error loops
      }
    },
  }

  consola.setReporters([stdoutReporter, fileReporter])
}
