import { Hono } from "hono"

import { forwardError } from "~/lib/error"

import { handleCompletion } from "./handler"

export const completionRoutes = new Hono()

completionRoutes.post("/", async (c) => {
  const body = await c.req.raw.clone().text()
  try {
    return await handleCompletion(c)
  } catch (error) {
    return await forwardError(c, error, body)
  }
})
