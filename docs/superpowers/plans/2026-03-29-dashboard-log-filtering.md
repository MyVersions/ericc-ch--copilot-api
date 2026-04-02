# Dashboard Log Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suppress console logs for `/dashboard/api/*` requests by default, enabling them only when `--dashboard-logs` flag is passed to the `start` command.

**Architecture:** Add `dashboardLogs: boolean` to global `state`, set it from a new `--dashboard-logs` CLI arg in `start.ts`, and check it in the `requestLogger` middleware before logging requests whose path starts with `/dashboard/api`.

**Tech Stack:** Bun, TypeScript, Hono, citty

---

## File Map

| File | Action | Change |
|------|--------|--------|
| `src/lib/state.ts` | Modify | Add `dashboardLogs: boolean` to `State` interface and initialize to `false` |
| `src/lib/logger.ts` | Modify | Import `state` and skip logging when path starts with `/dashboard/api` and `state.dashboardLogs` is `false` |
| `src/start.ts` | Modify | Add `dashboard-logs` arg to CLI, add `dashboardLogs` to `RunServerOptions`, set `state.dashboardLogs` |

---

### Task 1: Add `dashboardLogs` to state

**Files:**
- Modify: `src/lib/state.ts`

- [ ] **Step 1: Add field to `State` interface and initialize it**

Open `src/lib/state.ts`. The current content is:

```typescript
import type { ModelsResponse } from "~/services/copilot/get-models"

export interface State {
  githubToken?: string
  copilotToken?: string

  accountType: string
  models?: ModelsResponse
  vsCodeVersion?: string

  manualApprove: boolean
  rateLimitWait: boolean
  showToken: boolean

  // Rate limiting configuration
  rateLimitSeconds?: number
  lastRequestTimestamp?: number
}

export const state: State = {
  accountType: "individual",
  manualApprove: false,
  rateLimitWait: false,
  showToken: false,
}
```

Add `dashboardLogs: boolean` after `showToken` in the interface, and `dashboardLogs: false` in the initial state object:

```typescript
import type { ModelsResponse } from "~/services/copilot/get-models"

export interface State {
  githubToken?: string
  copilotToken?: string

  accountType: string
  models?: ModelsResponse
  vsCodeVersion?: string

  manualApprove: boolean
  rateLimitWait: boolean
  showToken: boolean
  dashboardLogs: boolean

  // Rate limiting configuration
  rateLimitSeconds?: number
  lastRequestTimestamp?: number
}

export const state: State = {
  accountType: "individual",
  manualApprove: false,
  rateLimitWait: false,
  showToken: false,
  dashboardLogs: false,
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/state.ts
git commit -m "feat: add dashboardLogs flag to state"
```

---

### Task 2: Filter dashboard API logs in the middleware

**Files:**
- Modify: `src/lib/logger.ts`

- [ ] **Step 1: Import `state` and add the filter**

Open `src/lib/logger.ts`. Add an import for `state` at the top (after the existing Hono import):

```typescript
import { state } from "~/lib/state"
```

Then, in the `requestLogger` middleware, add a check right after the `handlerLoggedRequests` guard. The updated middleware block should look like:

```typescript
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now()
  await next()

  if (handlerLoggedRequests.has(c.req.raw)) return

  if (c.req.path.startsWith("/dashboard/api") && !state.dashboardLogs) return

  logRequest({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - start,
  })
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Verify lint passes**

```bash
bun run lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/logger.ts
git commit -m "feat: suppress dashboard API logs unless dashboardLogs is enabled"
```

---

### Task 3: Add `--dashboard-logs` CLI flag to `start` command

**Files:**
- Modify: `src/start.ts`

- [ ] **Step 1: Add `dashboardLogs` to `RunServerOptions` interface**

In `src/start.ts`, find the `RunServerOptions` interface and add `dashboardLogs: boolean` after `showToken`:

```typescript
interface RunServerOptions {
  port: number
  verbose: boolean
  accountType: string
  manual: boolean
  rateLimit?: number
  rateLimitWait: boolean
  githubToken?: string
  claudeCode: boolean
  showToken: boolean
  dashboardLogs: boolean
  proxyEnv: boolean
}
```

- [ ] **Step 2: Set `state.dashboardLogs` in `runServer`**

In the `runServer` function body, add the assignment alongside the other state assignments (near `state.showToken = options.showToken`):

```typescript
state.manualApprove = options.manual
state.rateLimitSeconds = options.rateLimit
state.rateLimitWait = options.rateLimitWait
state.showToken = options.showToken
state.dashboardLogs = options.dashboardLogs
```

- [ ] **Step 3: Add the CLI arg definition**

In the `args` object of `defineCommand`, add after the `"show-token"` entry:

```typescript
"dashboard-logs": {
  type: "boolean",
  default: false,
  description: "Enable logging of dashboard API requests (/dashboard/api/*)",
},
```

- [ ] **Step 4: Pass the arg to `runServer`**

In the `run({ args })` call to `runServer`, add:

```typescript
dashboardLogs: args["dashboard-logs"],
```

The full `runServer(...)` call should now be:

```typescript
return runServer({
  port: Number.parseInt(args.port, 10),
  verbose: args.verbose,
  accountType: args["account-type"],
  manual: args.manual,
  rateLimit,
  rateLimitWait: args.wait,
  githubToken: args["github-token"],
  claudeCode: args["claude-code"],
  showToken: args["show-token"],
  dashboardLogs: args["dashboard-logs"],
  proxyEnv: args["proxy-env"],
})
```

- [ ] **Step 5: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Verify lint passes**

```bash
bun run lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/start.ts
git commit -m "feat: add --dashboard-logs CLI flag to start command"
```

---

### Task 4: Manual smoke test

- [ ] **Step 1: Build**

```bash
bun run build
```

Expected: builds without errors to `dist/`.

- [ ] **Step 2: Verify default behavior (logs suppressed)**

Start the server (requires a valid `GH_TOKEN`):

```bash
GH_TOKEN=<your-token> bun run dist/main.js start
```

Open the dashboard in a browser or use curl to hit `/dashboard/api/stats`:

```bash
curl http://localhost:4141/dashboard/api/stats
```

Expected: **no log line** appears in the server console for this request.

- [ ] **Step 3: Verify `--dashboard-logs` enables them**

Restart with the flag:

```bash
GH_TOKEN=<your-token> bun run dist/main.js start --dashboard-logs
```

Hit the same endpoint:

```bash
curl http://localhost:4141/dashboard/api/stats
```

Expected: a log line **does** appear, e.g.:
```
[29/03 14:35:22]  GET   /dashboard/api/stats  200  12ms
```

- [ ] **Step 4: Verify non-dashboard routes still log normally**

Without `--dashboard-logs`, make an AI request or hit `/v1/models`:

```bash
curl http://localhost:4141/v1/models
```

Expected: log line appears as usual.

- [ ] **Step 5: Verify docker-compose usage**

In your `docker-compose.yml`, add `--dashboard-logs` to `command`:

```yaml
services:
  copilot-api:
    image: ghcr.io/ericc-ch/copilot-api:latest
    environment:
      GH_TOKEN: ${GH_TOKEN}
    command: ["start", "--dashboard-logs"]
```

Expected: dashboard API logs appear in `docker compose logs -f`.
