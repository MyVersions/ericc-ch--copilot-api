import { Hono } from "hono"

import { DEVICES_HTML } from "./html"

export const devicesRoutes = new Hono()

devicesRoutes.get("/", (c) => c.html(DEVICES_HTML))
