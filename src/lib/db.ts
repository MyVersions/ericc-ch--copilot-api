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
  finish_reason?: string | null
  stream?: boolean | null
  is_agent_call?: boolean | null
  cached_tokens?: number | null
  request_id?: string | null
  route?: string | null
  tools_count?: number | null
  accepted_prediction_tokens?: number | null
  rejected_prediction_tokens?: number | null
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

export interface Device {
  device_id: string
  name: string
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
      response_body TEXT,
      finish_reason TEXT,
      stream        INTEGER,
      is_agent_call INTEGER,
      cached_tokens INTEGER,
      request_id    TEXT,
      route         TEXT,
      tools_count   INTEGER,
      accepted_prediction_tokens  INTEGER,
      rejected_prediction_tokens  INTEGER
    )
  `)

  // Add new columns if the table already existed with the old schema
  for (const col of [
    "device_id TEXT",
    "session_id TEXT",
    "finish_reason TEXT",
    "stream INTEGER",
    "is_agent_call INTEGER",
    "cached_tokens INTEGER",
    "request_id TEXT",
    "route TEXT",
    "tools_count INTEGER",
    "accepted_prediction_tokens INTEGER",
    "rejected_prediction_tokens INTEGER",
  ]) {
    try {
      db.run(`ALTER TABLE request_logs ADD COLUMN ${col}`)
    } catch {
      // Column already exists — ignore
    }
  }

  db.run("CREATE INDEX IF NOT EXISTS idx_timestamp ON request_logs(timestamp)")

  for (const idx of [
    "CREATE INDEX IF NOT EXISTS idx_device_id ON request_logs(device_id)",
    "CREATE INDEX IF NOT EXISTS idx_session_id ON request_logs(session_id)",
  ]) {
    try {
      db.run(idx)
    } catch {
      // Index may fail if column doesn't exist yet (pre-migration) — ignore
    }
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS devices (
      device_id  TEXT PRIMARY KEY,
      name       TEXT NOT NULL
    )
  `)

  return db
}

export function insertLog(entry: LogEntry): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO request_logs
          (timestamp, model, device_id, session_id, input_tokens, output_tokens, duration_ms, request_body, response_body,
           finish_reason, stream, is_agent_call, cached_tokens, request_id, route, tools_count, accepted_prediction_tokens, rejected_prediction_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        entry.finish_reason ?? null,
        entry.stream == null ? null : entry.stream ? 1 : 0,
        entry.is_agent_call == null ? null : entry.is_agent_call ? 1 : 0,
        entry.cached_tokens ?? null,
        entry.request_id ?? null,
        entry.route ?? null,
        entry.tools_count ?? null,
        entry.accepted_prediction_tokens ?? null,
        entry.rejected_prediction_tokens ?? null,
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

export function getDevices(): Device[] {
  return getDb()
    .prepare("SELECT device_id, name FROM devices ORDER BY name ASC")
    .all() as Device[]
}

export function upsertDevice(device_id: string, name: string): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO devices (device_id, name) VALUES (?, ?)")
    .run(device_id, name)
}

export function deleteDevice(device_id: string): void {
  getDb()
    .prepare("DELETE FROM devices WHERE device_id = ?")
    .run(device_id)
}

export function getKnownDevices(): { device_id: string; name: string | null }[] {
  return getDb()
    .prepare(`
      SELECT
        r.device_id,
        d.name
      FROM (SELECT DISTINCT device_id FROM request_logs WHERE device_id IS NOT NULL) r
      LEFT JOIN devices d ON d.device_id = r.device_id
      ORDER BY d.name ASC, r.device_id ASC
    `)
    .all() as { device_id: string; name: string | null }[]
}
