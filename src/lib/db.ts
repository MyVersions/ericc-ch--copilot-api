import { Database } from "bun:sqlite"

import consola from "consola"

import { PATHS } from "./paths"

export interface LogEntry {
  timestamp: number
  model: string
  device_id?: string
  session_id?: string
  input_tokens: number
  output_tokens: number
  duration_ms: number
  request_body?: string
  response_body?: string
}

export interface DailyStats {
  day: string
  input_tokens: number
  output_tokens: number
  request_count: number
}

export interface RequestLogRow extends LogEntry {
  id: number
}

let db: Database | undefined

export function getDb(): Database {
  if (db) return db

  db = new Database(PATHS.LOGS_DB_PATH)

  db.run(`
    CREATE TABLE IF NOT EXISTS request_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp     INTEGER NOT NULL,
      model         TEXT    NOT NULL,
      device_id     TEXT,
      session_id    TEXT,
      input_tokens  INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      duration_ms   INTEGER NOT NULL DEFAULT 0,
      request_body  TEXT,
      response_body TEXT
    )
  `)

  db.run(
    "CREATE INDEX IF NOT EXISTS idx_timestamp ON request_logs(timestamp)",
  )
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_device_id ON request_logs(device_id)",
  )
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_session_id ON request_logs(session_id)",
  )

  return db
}

export function insertLog(entry: LogEntry): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO request_logs
          (timestamp, model, device_id, session_id, input_tokens, output_tokens, duration_ms, request_body, response_body)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.timestamp,
        entry.model,
        entry.device_id ?? null,
        entry.session_id ?? null,
        entry.input_tokens,
        entry.output_tokens,
        entry.duration_ms,
        entry.request_body ?? null,
        entry.response_body ?? null,
      )
  } catch (error) {
    consola.warn("Failed to insert log entry:", error)
  }
}

export function queryStats(): DailyStats[] {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  return getDb()
    .prepare(`
      SELECT
        date(timestamp / 1000, 'unixepoch') AS day,
        SUM(input_tokens)  AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        COUNT(*)           AS request_count
      FROM request_logs
      WHERE timestamp >= ?
      GROUP BY day
      ORDER BY day ASC
    `)
    .all(thirtyDaysAgo) as DailyStats[]
}

export function queryRecentRequests(limit = 20): Omit<RequestLogRow, "request_body" | "response_body">[] {
  return getDb()
    .prepare(`
      SELECT id, timestamp, model, device_id, session_id, input_tokens, output_tokens, duration_ms
      FROM request_logs
      ORDER BY timestamp DESC
      LIMIT ?
    `)
    .all(limit) as Omit<RequestLogRow, "request_body" | "response_body">[]
}
