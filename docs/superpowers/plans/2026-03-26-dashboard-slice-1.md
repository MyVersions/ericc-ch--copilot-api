# Dashboard Improvements — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one working item from each major section of the dashboard spec — pricing config, parameterized DB query, `/api/stats?period=` endpoint, and a refreshed HTML page with period filter + summary cards.

**Architecture:** Thin vertical slice — add `src/lib/pricing.ts`, add `queryStatsByPeriod()` to `src/lib/db.ts`, replace the `/api/stats` handler in `route.ts` with the parameterized version, and update `html.ts` to show the segmented period selector and 6 summary cards (removing the old hardcoded 30-day cards). No new section files yet — html.ts stays as one file for this slice.

**Tech Stack:** Bun, TypeScript, Hono, `bun:sqlite`, Chart.js 4 (CDN), no test runner (project has none — verify with `bun run typecheck` and `bun run lint`).

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/pricing.ts` | **Create** | Model pricing table + `estimateCost()` |
| `src/lib/db.ts` | **Modify** | Add `queryStatsByPeriod()` + supporting types |
| `src/routes/dashboard/route.ts` | **Modify** | Replace `/api/stats` with parameterized version; add period resolution + granularity logic |
| `src/routes/dashboard/html.ts` | **Modify** | Replace hardcoded 30-day UI with period filter (8 presets) + 6 summary cards |

---

## Task 1: Create `src/lib/pricing.ts`

**Files:**
- Create: `src/lib/pricing.ts`

- [ ] **Step 1: Create the file**

```ts
// src/lib/pricing.ts
// Prices in USD per million tokens
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Claude — current generation
  "claude-opus-4-6":         { input: 5.00,  output: 25.00 },
  "claude-sonnet-4-6":       { input: 3.00,  output: 15.00 },
  "claude-haiku-4-5":        { input: 1.00,  output:  5.00 },
  // Claude — previous generations
  "claude-opus-4-5":         { input: 5.00,  output: 25.00 },
  "claude-sonnet-4-5":       { input: 3.00,  output: 15.00 },
  "claude-opus-4-1":         { input: 15.00, output: 75.00 },
  "claude-sonnet-4-0":       { input: 3.00,  output: 15.00 },
  "claude-opus-4-0":         { input: 15.00, output: 75.00 },
  "claude-3-haiku-20240307": { input: 0.25,  output:  1.25 },
  // OpenAI
  "gpt-4o":                  { input: 2.50,  output: 10.00 },
  "gpt-4o-mini":             { input: 0.15,  output:  0.60 },
  "o1":                      { input: 15.00, output: 60.00 },
  "o3":                      { input: 10.00, output: 40.00 },
  "o4-mini":                 { input: 1.10,  output:  4.40 },
}

/**
 * Returns estimated cost in USD, or null if the model has no pricing.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const pricing = MODEL_PRICING[model]
  if (!pricing) return null
  return (inputTokens / 1_000_000) * pricing.input
       + (outputTokens / 1_000_000) * pricing.output
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: no errors related to `pricing.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pricing.ts
git commit -m "feat: add model pricing table and estimateCost() helper"
```

---

## Task 2: Add `queryStatsByPeriod()` to `src/lib/db.ts`

**Files:**
- Modify: `src/lib/db.ts`

The new function accepts explicit Unix-ms timestamps and a granularity string. It returns two things the route needs:
1. Aggregate totals per granularity bucket (for the time series)
2. Per-model token rows per bucket (so the route layer can call `estimateCost()`)

The old `queryStats()` stays untouched.

- [ ] **Step 1: Add types after the existing `Device` interface (around line 43 in `src/lib/db.ts`)**

```ts
export type Granularity = 'hour' | 'day' | 'week'

export interface PeriodBucket {
  ts: number            // Unix ms for the start of the bucket
  requests: number
  inputTokens: number
  outputTokens: number
  avgDurationMs: number
}

export interface ModelBucket {
  ts: number
  model: string
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

export interface RawPeriodStats {
  buckets: PeriodBucket[]
  modelBuckets: ModelBucket[]
  aggregates: PeriodAggregates
}
```

- [ ] **Step 2: Add the `queryStatsByPeriod()` function at the end of `src/lib/db.ts`**

```ts
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

  const fmt =
    granularity === 'hour' ? "strftime('%Y-%m-%dT%H', timestamp/1000, 'unixepoch')"
    : granularity === 'day'  ? "strftime('%Y-%m-%d', timestamp/1000, 'unixepoch')"
    :                          "strftime('%Y-%W', timestamp/1000, 'unixepoch')"

  const buckets = db
    .prepare(`
      SELECT
        MIN(timestamp)        AS ts,
        COUNT(*)              AS requests,
        SUM(input_tokens)     AS inputTokens,
        SUM(output_tokens)    AS outputTokens,
        AVG(duration_ms)      AS avgDurationMs
      FROM request_logs
      WHERE timestamp >= ? AND timestamp < ?
      GROUP BY ${fmt}
      ORDER BY ts ASC
    `)
    .all(from, to) as PeriodBucket[]

  const modelBuckets = db
    .prepare(`
      SELECT
        MIN(timestamp)        AS ts,
        model,
        SUM(input_tokens)     AS inputTokens,
        SUM(output_tokens)    AS outputTokens
      FROM request_logs
      WHERE timestamp >= ? AND timestamp < ?
      GROUP BY ${fmt}, model
      ORDER BY ts ASC
    `)
    .all(from, to) as ModelBucket[]

  const agg = db
    .prepare(`
      SELECT
        COUNT(*)                   AS requests,
        SUM(input_tokens)          AS inputTokens,
        SUM(output_tokens)         AS outputTokens,
        AVG(duration_ms)           AS avgDurationMs,
        COUNT(DISTINCT session_id) AS activeSessions,
        COUNT(DISTINCT device_id)  AS activeDevices
      FROM request_logs
      WHERE timestamp >= ? AND timestamp < ?
    `)
    .get(from, to) as PeriodAggregates

  return { buckets, modelBuckets, aggregates: agg }
}
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat(db): add queryStatsByPeriod() with granularity support"
```

---

## Task 3: Replace `/api/stats` with parameterized version in `route.ts`

**Files:**
- Modify: `src/routes/dashboard/route.ts`

Period resolution and granularity selection live here. The DB functions always receive explicit timestamps.

> **Note on step order:** Step 1 (update imports, including removing `queryStats` and importing `Granularity`) must be applied together with Step 2 (replace the handler). Do both as a single edit so the file never references an unimported identifier.

- [ ] **Step 1: Replace the entire import block + add period helpers at the top of `route.ts`**

The full new top of the file (replace everything before `export const dashboardRoutes`):

```ts
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

type Period = 'today' | 'yesterday' | '7d' | '15d' | '30d' | 'current-month' | 'prev-month' | 'ytd'

const VALID_PERIODS = new Set<Period>([
  'today', 'yesterday', '7d', '15d', '30d', 'current-month', 'prev-month', 'ytd',
])

function resolvePeriod(raw: string | undefined): {
  period: Period
  from: number
  to: number
  prevFrom: number
  prevTo: number
} {
  const period: Period = (raw && VALID_PERIODS.has(raw as Period)) ? (raw as Period) : '7d'
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const ms = (days: number) => days * 24 * 60 * 60 * 1000

  let from: number
  let to: number
  let prevFrom: number
  let prevTo: number

  switch (period) {
    case 'today':
      from = todayStart; to = now.getTime()
      prevFrom = todayStart - ms(1); prevTo = todayStart
      break
    case 'yesterday':
      from = todayStart - ms(1); to = todayStart
      prevFrom = todayStart - ms(2); prevTo = todayStart - ms(1)
      break
    case '7d':
      from = todayStart - ms(6); to = now.getTime()
      prevFrom = todayStart - ms(13); prevTo = todayStart - ms(6)
      break
    case '15d':
      from = todayStart - ms(14); to = now.getTime()
      prevFrom = todayStart - ms(29); prevTo = todayStart - ms(14)
      break
    case '30d':
      from = todayStart - ms(29); to = now.getTime()
      prevFrom = todayStart - ms(59); prevTo = todayStart - ms(29)
      break
    case 'current-month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
      const prevFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()
      from = first; to = now.getTime()
      prevFrom = prevFirst; prevTo = first
      break
    }
    case 'prev-month': {
      const thisFirst = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
      const prevFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()
      const ppFirst   = new Date(now.getFullYear(), now.getMonth() - 2, 1).getTime()
      from = prevFirst; to = thisFirst
      prevFrom = ppFirst; prevTo = prevFirst
      break
    }
    case 'ytd': {
      const jan1 = new Date(now.getFullYear(), 0, 1).getTime()
      const jan1Prev = new Date(now.getFullYear() - 1, 0, 1).getTime()
      const sameDayPrev = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).getTime()
      from = jan1; to = now.getTime()
      prevFrom = jan1Prev; prevTo = sameDayPrev
      break
    }
    default: {
      const _: never = period
      throw new Error(`Unhandled period: ${_}`)
    }
  }

  return { period, from, to, prevFrom, prevTo }
}

function granularityFor(period: Period): Granularity {
  if (period === 'today' || period === 'yesterday') return 'hour'
  if (period === 'ytd') return 'week'
  return 'day'
}
```

- [ ] **Step 2: Replace the existing `/api/stats` handler**

Find this block in `route.ts`:

```ts
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
```

Replace it with:

```ts
dashboardRoutes.get("/api/stats", (c) => {
  const { period, from, to, prevFrom, prevTo } = resolvePeriod(c.req.query('period'))
  const gran = granularityFor(period)

  const cur  = queryStatsByPeriod(from, to, gran)
  const prev = queryStatsByPeriod(prevFrom, prevTo, gran)

  function computeCost(modelBuckets: ModelBucket[]): number | null {
    let total = 0
    let anyPriceable = false
    for (const row of modelBuckets) {
      const cost = estimateCost(row.model, row.inputTokens, row.outputTokens)
      if (cost !== null) { total += cost; anyPriceable = true }
    }
    return anyPriceable ? total : null
  }

  const series = cur.buckets.map((b) => {
    const mBuckets = cur.modelBuckets.filter((m) => m.ts === b.ts)
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
    current: {
      requests: cur.aggregates.requests,
      inputTokens: cur.aggregates.inputTokens,
      outputTokens: cur.aggregates.outputTokens,
      estimatedCost: computeCost(cur.modelBuckets),
      avgDurationMs: Math.round(cur.aggregates.avgDurationMs ?? 0),
      activeSessions: cur.aggregates.activeSessions,
      activeDevices: cur.aggregates.activeDevices,
      series,
    },
    previous: {
      requests: prev.aggregates.requests,
      inputTokens: prev.aggregates.inputTokens,
      outputTokens: prev.aggregates.outputTokens,
      estimatedCost: computeCost(prev.modelBuckets),
      avgDurationMs: Math.round(prev.aggregates.avgDurationMs ?? 0),
      activeSessions: prev.aggregates.activeSessions,
    },
  })
})
```

- [ ] **Step 3: Typecheck + lint**

```bash
bun run typecheck && bun run lint
```

Expected: no errors.

- [ ] **Step 4: Manual smoke-test**

```bash
bun run dev
# In another terminal:
curl "http://localhost:4141/dashboard/api/stats?period=7d" | jq .
curl "http://localhost:4141/dashboard/api/stats?period=today" | jq .
curl "http://localhost:4141/dashboard/api/stats" | jq .   # should default to 7d
```

Expected: JSON with `period`, `current` (with `series`), and `previous` keys. No 500 errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/dashboard/route.ts
git commit -m "feat(dashboard): parameterized /api/stats with period filter and cost estimation"
```

---

## Task 4: Update `html.ts` — period filter + 6 summary cards

**Files:**
- Modify: `src/routes/dashboard/html.ts`

The current `html.ts` (349 lines) has:
- 4 stat cards (requests, input, output, period=30d) inside `<div class="cards">`
- A chart that reads `data.days[]` from the old stats response shape
- A `loadStats()` function that calls `/dashboard/api/stats` with no params

This task:
1. Adds CSS for the period selector, new card styles, delta indicators, and stats grid
2. Replaces the `<div class="cards">` HTML with the period selector + empty `stats-grid` container
3. Rewrites `loadStats()` to use the new API shape and render 6 dynamic cards
4. Extracts chart update logic into `updateChart(series)` so it can be called when period changes
5. Wires the period buttons

- [ ] **Step 1: Add CSS to the `<style>` block**

Inside `<style>`, after the `.muted` rule (line 143, just before `</style>`), add:

```css
    /* --- Period selector --- */
    .period-selector {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .period-group {
      display: flex;
      gap: 2px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 2px;
    }
    .period-btn {
      background: transparent;
      border: none;
      color: #8b949e;
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
      transition: background 0.15s, color 0.15s;
    }
    .period-btn:hover  { background: #21262d; color: #e6edf3; }
    .period-btn.active { background: #21262d; color: #e6edf3; font-weight: 600; }
    .period-range-label { font-size: 12px; color: #8b949e; margin-left: 4px; }

    /* --- Summary cards (6-up grid) --- */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }
    .stat-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px;
    }
    .stat-label {
      font-size: 12px;
      color: #8b949e;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat-value { font-size: 24px; font-weight: 600; color: #f0f6fc; }
    .delta { font-size: 11px; margin-top: 4px; display: block; }
    .delta.green { color: #3fb950; }
    .delta.red   { color: #f85149; }
    .delta.gray  { color: #8b949e; }
```

- [ ] **Step 2: Replace the HTML cards section**

Find:
```html
  <div class="cards">
    <div class="card"><div class="label">Total de requests</div><div class="value" id="total-requests">—</div></div>
    <div class="card"><div class="label">Tokens de entrada</div><div class="value" id="total-input">—</div></div>
    <div class="card"><div class="label">Tokens de saída</div><div class="value" id="total-output">—</div></div>
    <div class="card"><div class="label">Período</div><div class="value">30d</div></div>
  </div>
```

Replace with:
```html
  <div class="period-selector">
    <div class="period-group">
      <button class="period-btn" data-period="today">Hoje</button>
      <button class="period-btn" data-period="yesterday">Ontem</button>
      <button class="period-btn active" data-period="7d">7d</button>
      <button class="period-btn" data-period="15d">15d</button>
      <button class="period-btn" data-period="30d">30d</button>
    </div>
    <div class="period-group">
      <button class="period-btn" data-period="current-month">Mês atual</button>
      <button class="period-btn" data-period="prev-month">Mês ant.</button>
      <button class="period-btn" data-period="ytd">YTD</button>
    </div>
    <span id="period-range" class="period-range-label"></span>
  </div>
  <div id="summary-cards" class="stats-grid"></div>
```

- [ ] **Step 3: Rewrite `loadStats()` and extract `updateChart()` in the `<script>` block**

The current `loadStats()` (lines 252–296 in the original file) both fetches stats and initializes/updates the chart. We need to:
- Extract chart logic into `updateChart(series)`
- Rewrite `loadStats()` to use the new API shape

Replace the existing `async function loadStats() { ... }` block with:

```js
    let currentPeriod = '7d'

    function pctDelta(cur, prev) {
      if (prev == null || prev === 0) return null
      return ((cur - prev) / Math.abs(prev)) * 100
    }

    function deltaHtml(cur, prev) {
      const d = pctDelta(cur, prev)
      if (d === null) return '<span class="delta gray">—</span>'
      if (Math.abs(d) < 0.5) return '<span class="delta gray">— igual</span>'
      const sign = d > 0 ? '↑' : '↓'
      const cls  = d > 0 ? 'green' : 'red'
      return `<span class="delta ${cls}">${sign} ${Math.abs(d).toFixed(1)}%</span>`
    }

    function formatTokens(n) {
      if (n == null) return '—'
      if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
      if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
      return String(n)
    }

    function formatCost(v) {
      return v == null ? 'N/A' : '$' + v.toFixed(2)
    }

    function formatDuration(ms) {
      if (ms == null) return '—'
      return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms'
    }

    function updateChart(series) {
      const labels = series.map(b => {
        const d = new Date(b.ts)
        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      })
      const inputData  = series.map(b => b.inputTokens)
      const outputData = series.map(b => b.outputTokens)

      if (chart) {
        chart.data.labels = labels
        chart.data.datasets[0].data = inputData
        chart.data.datasets[1].data = outputData
        chart.update()
      } else {
        chart = new Chart(document.getElementById('tokensChart'), {
          type: 'bar',
          data: {
            labels,
            datasets: [
              { label: 'Entrada', data: inputData,  backgroundColor: '#1f6feb', borderRadius: 3, stack: 'tokens' },
              { label: 'Saída',   data: outputData, backgroundColor: '#388bfd', borderRadius: 3, stack: 'tokens' },
            ]
          },
          options: {
            responsive: true,
            plugins: {
              legend: { labels: { color: '#8b949e', boxWidth: 12 } },
              tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) + ' tokens' } }
            },
            scales: {
              x: { stacked: true, ticks: { color: '#8b949e' }, grid: { color: '#21262d' } },
              y: { stacked: true, ticks: { color: '#8b949e', callback: v => fmt(v) }, grid: { color: '#21262d' } }
            }
          }
        })
      }
    }

    async function loadStats() {
      try {
        const res  = await fetch('/dashboard/api/stats?period=' + currentPeriod)
        const data = await res.json()
        const cur  = data.current
        const prev = data.previous

        // Period range label
        const fmtDate = d => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        document.getElementById('period-range').textContent =
          fmtDate(data.period.from) + ' – ' + fmtDate(data.period.to)

        // 6 summary cards
        const cards = [
          { label: 'Requests',       val: cur.requests.toLocaleString('pt-BR'),        delta: deltaHtml(cur.requests,      prev.requests) },
          { label: 'Input Tokens',   val: formatTokens(cur.inputTokens),               delta: deltaHtml(cur.inputTokens,   prev.inputTokens) },
          { label: 'Output Tokens',  val: formatTokens(cur.outputTokens),              delta: deltaHtml(cur.outputTokens,  prev.outputTokens) },
          { label: 'Custo Estimado', val: formatCost(cur.estimatedCost),               delta: cur.estimatedCost != null ? deltaHtml(cur.estimatedCost, prev.estimatedCost) : '' },
          { label: 'Duração Média',  val: formatDuration(cur.avgDurationMs),           delta: deltaHtml(cur.avgDurationMs, prev.avgDurationMs) },
          { label: 'Sessions',       val: cur.activeSessions.toLocaleString('pt-BR'),  delta: deltaHtml(cur.activeSessions, prev.activeSessions) },
        ]

        document.getElementById('summary-cards').innerHTML = cards.map(card => `
          <div class="stat-card">
            <div class="stat-label">${card.label}</div>
            <div class="stat-value">${card.val}</div>
            ${card.delta}
          </div>
        `).join('')

        updateChart(cur.series)
      } catch (e) {
        console.error('Erro ao carregar stats:', e)
      }
    }
```

- [ ] **Step 4: Wire the period buttons (add after the existing `loadDevices` function, before the `Promise.all` call)**

```js
    // Period selector
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        currentPeriod = btn.dataset.period
        loadStats()
      })
    })
```

- [ ] **Step 5: Update the initial load call**

Find:
```js
    Promise.all([loadStats(), loadDevices().then(loadRequests)])
```

Keep as-is — `loadStats()` is already called here with `currentPeriod = '7d'` as default. ✓

Also update the 30-second interval to call `loadStats()` alongside requests:

Find:
```js
    let countdown = 30
    setInterval(() => {
      countdown--
      if (countdown <= 0) {
        countdown = 30
        loadDevices().then(loadRequests)
      }
      document.getElementById('refresh-note').textContent = 'Atualizando em ' + countdown + 's\u2026'
    }, 1000)
```

Replace with:
```js
    let countdown = 30
    setInterval(() => {
      countdown--
      if (countdown <= 0) {
        countdown = 30
        loadStats()
        loadDevices().then(loadRequests)
      }
      document.getElementById('refresh-note').textContent = 'Atualizando em ' + countdown + 's\u2026'
    }, 1000)
```

- [ ] **Step 6: Typecheck + lint**

```bash
bun run typecheck && bun run lint
```

Expected: no errors.

- [ ] **Step 7: Manual smoke-test in browser**

```bash
bun run dev
# Open http://localhost:4141/dashboard
```

Verify:
- 8 period buttons visible in 2 groups; `7d` is the default active button
- Clicking each button triggers a fetch and updates the 6 cards
- Delta indicators show ↑/↓/— with correct colors
- Date range label updates next to the buttons
- Chart updates when period changes (series re-renders with correct date labels)
- No console errors

- [ ] **Step 8: Commit**

```bash
git add src/routes/dashboard/html.ts
git commit -m "feat(dashboard): period selector + 6 summary cards with delta indicators"
```

---

## Verification Checklist

Before declaring this slice done:

- [ ] `bun run typecheck` — 0 errors
- [ ] `bun run lint` — 0 errors
- [ ] `curl /dashboard/api/stats?period=7d` returns correct JSON shape (`period`, `current.series`, `previous`)
- [ ] `curl /dashboard/api/stats?period=today` returns hourly buckets in `current.series`
- [ ] `curl /dashboard/api/stats` (no param) defaults to `7d`
- [ ] Dashboard page loads without JS errors
- [ ] All 8 period buttons switch the data correctly
- [ ] Summary cards show values + delta for all 6 metrics
- [ ] Chart re-renders when period changes
- [ ] `pricing.ts` is importable and `estimateCost('gpt-4o', 1_000_000, 500_000)` returns `7.50`
