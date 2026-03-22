import { Hono } from "hono"

import { queryRecentRequests, queryStats } from "~/lib/db"

import { DASHBOARD_HTML } from "./html"

export const dashboardRoutes = new Hono()

dashboardRoutes.get("/", (c) => c.html(DASHBOARD_HTML))

dashboardRoutes.get("/api/stats", (c) => {
  const days = queryStats()
  const totals = days.reduce(
    (acc, d) => ({
      input_tokens: acc.input_tokens + d.input_tokens,
      output_tokens: acc.output_tokens + d.output_tokens,
      request_count: acc.request_count + d.request_count,
    }),
    { input_tokens: 0, output_tokens: 0, request_count: 0 },
  )
  return c.json({ days, totals })
})

dashboardRoutes.get("/api/requests", (c) => {
  const requests = queryRecentRequests(20)
  return c.json({ requests })
})
