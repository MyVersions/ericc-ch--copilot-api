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

export type Granularity = "hour" | "day" | "week"

export interface PeriodBucket {
  ts: number // Unix ms for the start of the bucket
  bucketKey: string // strftime string used for grouping (join key)
  requests: number
  inputTokens: number
  outputTokens: number
  avgDurationMs: number
}

export interface ModelBucket {
  ts: number
  bucketKey: string // strftime string used for grouping (join key)
  model: string
  inputTokens: number
  outputTokens: number
}

export interface DeviceBucket {
  ts: number
  bucketKey: string
  deviceId: string | null
  inputTokens: number
  outputTokens: number
}

export interface PeriodAggregates {
  requests: number
  inputTokens: number
  outputTokens: number
  avgDurationMs: number
  activeSessions: number
  activeDevices: number
}

export interface DeviceAggregate {
  deviceId: string | null
  requests: number
  inputTokens: number
  outputTokens: number
  avgDurationMs: number
  activeSessions: number
}

export interface RawPeriodStats {
  buckets: Array<PeriodBucket>
  modelBuckets: Array<ModelBucket>
  deviceBuckets: Array<DeviceBucket>
  deviceAggregates: Array<DeviceAggregate>
  aggregates: PeriodAggregates
}

let db: Database | undefined

function boolToInt(value: boolean | null | undefined): number | null {
  if (value === null || value === undefined) return null
  return value ? 1 : 0
}

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
        boolToInt(entry.stream),
        boolToInt(entry.is_agent_call),
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

export function queryStats(): Array<DailyStats> {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  return getDb()
    .prepare(
      `
      SELECT
        date(timestamp / 1000, 'unixepoch') AS day,
        SUM(input_tokens)  AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        COUNT(*)           AS request_count
      FROM request_logs
      WHERE timestamp >= ?
      GROUP BY day
      ORDER BY day ASC
    `,
    )
    .all(thirtyDaysAgo) as Array<DailyStats>
}

export function queryRecentRequests(
  limit = 20,
): Array<Omit<RequestLogRow, "request_body" | "response_body">> {
  return getDb()
    .prepare(
      `
      SELECT id, timestamp, model, device_id, session_id, input_tokens, output_tokens, duration_ms
      FROM request_logs
      ORDER BY timestamp DESC
      LIMIT ?
    `,
    )
    .all(limit) as Array<Omit<RequestLogRow, "request_body" | "response_body">>
}

export interface DeviceWithRoute {
  device_id: string
  name: string
  route: string | null
}

export function getDevices(): Array<DeviceWithRoute> {
  return getDb()
    .prepare(
      `SELECT d.device_id, d.name,
              (SELECT route FROM request_logs WHERE device_id = d.device_id AND route IS NOT NULL ORDER BY timestamp DESC LIMIT 1) AS route
       FROM devices d ORDER BY d.name ASC`,
    )
    .all() as Array<DeviceWithRoute>
}

export function upsertDevice(device_id: string, name: string): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO devices (device_id, name) VALUES (?, ?)")
    .run(device_id, name)
}

export function deleteDevice(device_id: string): void {
  getDb().prepare("DELETE FROM devices WHERE device_id = ?").run(device_id)
}

export function getKnownDevices(): Array<{
  device_id: string
  name: string | null
}> {
  return getDb()
    .prepare(
      `
      SELECT
        r.device_id,
        d.name
      FROM (SELECT DISTINCT device_id FROM request_logs WHERE device_id IS NOT NULL) r
      LEFT JOIN devices d ON d.device_id = r.device_id
      ORDER BY d.name ASC, r.device_id ASC
    `,
    )
    .all() as Array<{ device_id: string; name: string | null }>
}

function bucketFmt(granularity: Granularity): string {
  if (granularity === "hour") {
    return "strftime('%Y-%m-%dT%H', timestamp/1000, 'unixepoch', 'localtime')"
  }
  if (granularity === "day") {
    return "strftime('%Y-%m-%d', timestamp/1000, 'unixepoch', 'localtime')"
  }
  return "strftime('%Y-%W', timestamp/1000, 'unixepoch', 'localtime')"
}

type TimeRange = { from: number; to: number }

function queryPeriodBuckets(
  db: Database,
  fmt: string,
  range: TimeRange,
): Array<PeriodBucket> {
  return db
    .prepare(
      `SELECT MIN(timestamp) AS ts, ${fmt} AS bucketKey,
              COUNT(*) AS requests, SUM(input_tokens) AS inputTokens,
              SUM(output_tokens) AS outputTokens, AVG(duration_ms) AS avgDurationMs
       FROM request_logs WHERE timestamp >= ? AND timestamp < ?
       GROUP BY bucketKey ORDER BY ts ASC`,
    )
    .all(range.from, range.to) as Array<PeriodBucket>
}

function queryModelBuckets(
  db: Database,
  fmt: string,
  range: TimeRange,
): Array<ModelBucket> {
  return db
    .prepare(
      `SELECT MIN(timestamp) AS ts, ${fmt} AS bucketKey,
              model, SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens
       FROM request_logs WHERE timestamp >= ? AND timestamp < ?
       GROUP BY bucketKey, model ORDER BY ts ASC`,
    )
    .all(range.from, range.to) as Array<ModelBucket>
}

function queryPeriodAggregates(
  db: Database,
  range: TimeRange,
): PeriodAggregates {
  return db
    .prepare(
      `SELECT COUNT(*) AS requests, SUM(input_tokens) AS inputTokens,
              SUM(output_tokens) AS outputTokens, AVG(duration_ms) AS avgDurationMs,
              COUNT(DISTINCT session_id) AS activeSessions,
              COUNT(DISTINCT device_id) AS activeDevices
       FROM request_logs WHERE timestamp >= ? AND timestamp < ?`,
    )
    .get(range.from, range.to) as PeriodAggregates
}

function queryDeviceBuckets(
  db: Database,
  fmt: string,
  range: TimeRange,
): Array<DeviceBucket> {
  return db
    .prepare(
      `SELECT MIN(timestamp) AS ts, ${fmt} AS bucketKey,
              device_id AS deviceId,
              SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens
       FROM request_logs WHERE timestamp >= ? AND timestamp < ?
       GROUP BY bucketKey, device_id ORDER BY ts ASC`,
    )
    .all(range.from, range.to) as Array<DeviceBucket>
}

function queryDeviceAggregates(
  db: Database,
  range: TimeRange,
): Array<DeviceAggregate> {
  return db
    .prepare(
      `SELECT device_id AS deviceId, COUNT(*) AS requests,
              SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens,
              AVG(duration_ms) AS avgDurationMs,
              COUNT(DISTINCT session_id) AS activeSessions
       FROM request_logs WHERE timestamp >= ? AND timestamp < ?
       GROUP BY device_id ORDER BY inputTokens + outputTokens DESC`,
    )
    .all(range.from, range.to) as Array<DeviceAggregate>
}

/**
 * Returns time-series buckets + per-model buckets + period aggregates.
 * Period resolution and granularity selection must happen in the route layer.
 */
export function queryStatsByPeriod(
  from: number,
  to: number,
  granularity: Granularity,
): RawPeriodStats {
  const db = getDb()
  const fmt = bucketFmt(granularity)
  const range: TimeRange = { from, to }
  return {
    buckets: queryPeriodBuckets(db, fmt, range),
    modelBuckets: queryModelBuckets(db, fmt, range),
    aggregates: queryPeriodAggregates(db, range),
    deviceBuckets: queryDeviceBuckets(db, fmt, range),
    deviceAggregates: queryDeviceAggregates(db, range),
  }
}
