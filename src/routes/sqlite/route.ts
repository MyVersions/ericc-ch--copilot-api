import { Hono } from "hono"

import { getDb } from "~/lib/db"

import { SQLITE_HTML } from "./html"

export const sqliteRoutes = new Hono()

sqliteRoutes.get("/", (c) => c.html(SQLITE_HTML))

sqliteRoutes.post("/api/query", async (c) => {
  const { sql } = await c.req.json<{ sql: string }>()

  if (!sql.trim()) {
    return c.json({ error: "SQL não pode ser vazio." }, 400)
  }

  const isSelect = sql.trim().toUpperCase().startsWith("SELECT")

  try {
    const db = getDb()
    if (isSelect) {
      const rows = db.prepare(sql).all()
      return c.json({ rows })
    }

    const result = db.prepare(sql).run()
    return c.json({ changes: result.changes })
  } catch (error) {
    return c.json({ error: String(error) }, 400)
  }
})
