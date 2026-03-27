import { Hono } from "hono"

import {
  deleteDevice,
  getDevices,
  getKnownDevices,
  queryRecentRequests,
  queryStatsByPeriod,
  upsertDevice,
  type Granularity,
  type ModelBucket,
} from "~/lib/db"
import { estimateCost } from "~/lib/pricing"

import { DASHBOARD_HTML } from "./html"

// --- Period resolution ---

type Period =
  | "today"
  | "yesterday"
  | "7d"
  | "15d"
  | "30d"
  | "current-month"
  | "prev-month"
  | "ytd"

const VALID_PERIODS = new Set<Period>([
  "today",
  "yesterday",
  "7d",
  "15d",
  "30d",
  "current-month",
  "prev-month",
  "ytd",
])

const MS_PER_DAY = 24 * 60 * 60 * 1000

function daysMs(days: number): number {
  return days * MS_PER_DAY
}

interface ResolvedPeriod {
  period: Period
  from: number
  to: number
  prevFrom: number
  prevTo: number
}

function resolvePeriodRange(
  period: Period,
  now: Date,
  todayStart: number,
): Omit<ResolvedPeriod, "period"> {
  switch (period) {
    case "today": {
      return {
        from: todayStart,
        to: now.getTime(),
        prevFrom: todayStart - daysMs(1),
        prevTo: todayStart,
      }
    }
    case "yesterday": {
      return {
        from: todayStart - daysMs(1),
        to: todayStart,
        prevFrom: todayStart - daysMs(2),
        prevTo: todayStart - daysMs(1),
      }
    }
    case "7d": {
      return {
        from: todayStart - daysMs(6),
        to: now.getTime(),
        prevFrom: todayStart - daysMs(13),
        prevTo: todayStart - daysMs(6),
      }
    }
    case "15d": {
      return {
        from: todayStart - daysMs(14),
        to: now.getTime(),
        prevFrom: todayStart - daysMs(29),
        prevTo: todayStart - daysMs(14),
      }
    }
    case "30d": {
      return {
        from: todayStart - daysMs(29),
        to: now.getTime(),
        prevFrom: todayStart - daysMs(59),
        prevTo: todayStart - daysMs(29),
      }
    }
    case "current-month": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
      const prevFirst = new Date(
        now.getFullYear(),
        now.getMonth() - 1,
        1,
      ).getTime()
      return {
        from: first,
        to: now.getTime(),
        prevFrom: prevFirst,
        prevTo: first,
      }
    }
    case "prev-month": {
      const thisFirst = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
      const prevFirst = new Date(
        now.getFullYear(),
        now.getMonth() - 1,
        1,
      ).getTime()
      const ppFirst = new Date(
        now.getFullYear(),
        now.getMonth() - 2,
        1,
      ).getTime()
      return {
        from: prevFirst,
        to: thisFirst,
        prevFrom: ppFirst,
        prevTo: prevFirst,
      }
    }
    case "ytd": {
      const jan1 = new Date(now.getFullYear(), 0, 1).getTime()
      const jan1Prev = new Date(now.getFullYear() - 1, 0, 1).getTime()
      const sameDayPrev = new Date(
        now.getFullYear() - 1,
        now.getMonth(),
        now.getDate(),
      ).getTime()
      return {
        from: jan1,
        to: now.getTime(),
        prevFrom: jan1Prev,
        prevTo: sameDayPrev,
      }
    }
    default: {
      const exhaustive: never = period
      throw new Error(`Unhandled period: ${String(exhaustive)}`)
    }
  }
}

function resolvePeriod(raw: string | undefined): ResolvedPeriod {
  const period: Period =
    raw && VALID_PERIODS.has(raw as Period) ? (raw as Period) : "7d"
  const now = new Date()
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime()
  return { period, ...resolvePeriodRange(period, now, todayStart) }
}

function granularityFor(period: Period): Granularity {
  if (period === "today" || period === "yesterday") return "hour"
  if (period === "ytd") return "week"
  return "day"
}

function computeCost(modelBuckets: Array<ModelBucket>): number | null {
  let total = 0
  let anyPriceable = false
  for (const row of modelBuckets) {
    const cost = estimateCost(row.model, row.inputTokens, row.outputTokens)
    if (cost !== null) {
      total += cost
      anyPriceable = true
    }
  }
  return anyPriceable ? total : null
}

export const dashboardRoutes = new Hono()

dashboardRoutes.get("/", (c) => c.html(DASHBOARD_HTML))

dashboardRoutes.get("/api/stats", (c) => {
  const { period, from, to, prevFrom, prevTo } = resolvePeriod(
    c.req.query("period"),
  )
  const gran = granularityFor(period)

  const cur = queryStatsByPeriod(from, to, gran)
  const prev = queryStatsByPeriod(prevFrom, prevTo, gran)

  const series = cur.buckets.map((b) => {
    const mBuckets = cur.modelBuckets.filter((m) => m.bucketKey === b.bucketKey)
    return {
      ts: b.ts,
      requests: b.requests,
      inputTokens: b.inputTokens,
      outputTokens: b.outputTokens,
      estimatedCost: computeCost(mBuckets),
      avgDurationMs: Math.round(b.avgDurationMs),
    }
  })

  return c.json({
    period: { from, to },
    granularity: gran,
    current: {
      requests: cur.aggregates.requests,
      inputTokens: cur.aggregates.inputTokens,
      outputTokens: cur.aggregates.outputTokens,
      estimatedCost: computeCost(cur.modelBuckets),
      avgDurationMs: Math.round(cur.aggregates.avgDurationMs),
      activeSessions: cur.aggregates.activeSessions,
      activeDevices: cur.aggregates.activeDevices,
      series,
    },
    previous: {
      requests: prev.aggregates.requests,
      inputTokens: prev.aggregates.inputTokens,
      outputTokens: prev.aggregates.outputTokens,
      estimatedCost: computeCost(prev.modelBuckets),
      avgDurationMs: Math.round(prev.aggregates.avgDurationMs),
      activeSessions: prev.aggregates.activeSessions,
    },
  })
})

dashboardRoutes.get("/api/requests", (c) => {
  const requests = queryRecentRequests(20)
  return c.json({ requests })
})

dashboardRoutes.get("/api/devices", (c) => {
  return c.json({ devices: getDevices() })
})

dashboardRoutes.post("/api/devices", async (c) => {
  const { device_id, name } = await c.req.json<{
    device_id: string
    name: string
  }>()
  if (!device_id.trim() || !name.trim()) {
    return c.json({ error: "device_id e name são obrigatórios." }, 400)
  }
  upsertDevice(device_id.trim(), name.trim())
  return c.json({ ok: true })
})

dashboardRoutes.delete("/api/devices/:id", (c) => {
  const device_id = decodeURIComponent(c.req.param("id"))
  deleteDevice(device_id)
  return c.json({ ok: true })
})

dashboardRoutes.get("/api/known-devices", (c) => {
  return c.json({ devices: getKnownDevices() })
})
