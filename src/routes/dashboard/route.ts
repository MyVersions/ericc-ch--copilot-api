import { Hono } from "hono"

import { deleteDevice, getDevices, getKnownDevices, queryRecentRequests, queryStats, upsertDevice } from "~/lib/db"

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

dashboardRoutes.get("/api/devices", (c) => {
  return c.json({ devices: getDevices() })
})

dashboardRoutes.post("/api/devices", async (c) => {
  const { device_id, name } = await c.req.json<{ device_id: string; name: string }>()
  if (!device_id?.trim() || !name?.trim()) {
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
