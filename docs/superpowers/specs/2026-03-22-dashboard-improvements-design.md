# Dashboard Improvements — Design Spec

**Date:** 2026-03-22
**Status:** Approved

---

## Overview

Improve the existing `/dashboard` page of `copilot-api` with:

- Flexible date range filtering (8 preset periods)
- Summary cards with period-over-period comparison
- Per-device cost cards
- 6 interactive charts with switchable types (line / bar / area)
- Breakdown table by device and by session
- Centralized model pricing config for estimated cost calculation

The existing request log table is removed. The SQLite and Devices pages remain unchanged.

---

## Architecture

### Approach

Refactor `src/routes/dashboard/html.ts` (currently ~440 lines, all inline) into focused, single-responsibility files. Expand `src/lib/db.ts` with parameterized queries. Add `src/lib/pricing.ts` for model cost config.

### New File Structure

```
src/
├── lib/
│   └── pricing.ts                     # Model pricing table + estimateCost()
├── routes/
│   └── dashboard/
│       ├── route.ts                   # Expanded: parameterized API endpoints
│       ├── html.ts                    # Orchestrates sections into full page
│       ├── sections/
│       │   ├── filters.ts             # Segmented period selector HTML
│       │   ├── cards.ts               # Summary cards + per-device cards HTML
│       │   ├── charts.ts              # Chart.js charts + type switcher HTML
│       │   └── breakdown.ts           # Device/session breakdown table HTML
│       └── utils.ts                   # Number/date/currency formatting helpers
```

---

## Pricing Config (`src/lib/pricing.ts`)

Centralized model pricing table. Easy to update without touching application logic.

```ts
// Prices in USD per million tokens
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Claude — current generation
  "claude-opus-4-6":           { input: 5.00,  output: 25.00 },
  "claude-sonnet-4-6":         { input: 3.00,  output: 15.00 },
  "claude-haiku-4-5":          { input: 1.00,  output:  5.00 },
  // Claude — previous generations
  "claude-opus-4-5":           { input: 5.00,  output: 25.00 },
  "claude-sonnet-4-5":         { input: 3.00,  output: 15.00 },
  "claude-opus-4-1":           { input: 15.00, output: 75.00 },
  "claude-sonnet-4-0":         { input: 3.00,  output: 15.00 },
  "claude-opus-4-0":           { input: 15.00, output: 75.00 },
  "claude-3-haiku-20240307":   { input: 0.25,  output:  1.25 },
  // OpenAI
  "gpt-4o":                    { input: 2.50,  output: 10.00 },
  "gpt-4o-mini":               { input: 0.15,  output:  0.60 },
  "o1":                        { input: 15.00, output: 60.00 },
  "o3":                        { input: 10.00, output: 40.00 },
  "o4-mini":                   { input: 1.10,  output:  4.40 },
}

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

Models not in the table display `N/A` for estimated cost. The table is intentionally flat and human-editable — no abstraction needed.

---

## Period Filter

### UI: Segmented Controls (2 groups)

```
[ Hoje | Ontem | 7d | 15d | 30d ]   [ Mês atual | Mês ant. | YTD ]
                                      16/03 – 22/03/2026
```

The active period label and its resolved date range are shown inline to the right of the controls.

### Period Definitions

| Value | Description | Comparison period |
|---|---|---|
| `today` | Current calendar day | Previous calendar day |
| `yesterday` | Previous calendar day | Day before yesterday |
| `7d` | Last 7 days (rolling) | 7 days before that |
| `15d` | Last 15 days (rolling) | 15 days before that |
| `30d` | Last 30 days (rolling) | 30 days before that |
| `current-month` | 1st of month → today | Previous calendar month |
| `prev-month` | Full previous calendar month | Month before that |
| `ytd` | Jan 1 → today | Same period in previous year |

### Chart Granularity (X-axis)

| Period | Granularity |
|---|---|
| `today`, `yesterday` | Hourly |
| `7d`, `15d`, `30d`, `current-month`, `prev-month` | Daily |
| `ytd` | Weekly |

---

## API Endpoints

All existing endpoints are replaced or extended. All accept `?period=<value>` query param.

### `GET /dashboard/api/stats?period=7d`

Returns aggregated metrics for the selected period **and** the equivalent prior period (for % comparison).

```jsonc
{
  "period": { "from": 1741996800000, "to": 1742601600000 },
  "current": {
    "requests": 1247,
    "inputTokens": 4200000,
    "outputTokens": 892000,
    "estimatedCost": 2.34,      // null if any model has no pricing
    "avgDurationMs": 3200,
    "activeSessions": 38,
    "activeDevices": 3,
    "series": [                  // one entry per granularity bucket
      { "ts": 1741996800000, "requests": 180, "inputTokens": 600000, "outputTokens": 128000, "estimatedCost": 0.33, "avgDurationMs": 3100 }
      // ...
    ]
  },
  "previous": {
    "requests": 1113,
    "inputTokens": 4330000,
    "outputTokens": 826000,
    "estimatedCost": 2.23,
    "avgDurationMs": 3200,
    "activeSessions": 36,
    "activeDevices": 3
    // no series needed for previous period
  }
}
```

### `GET /dashboard/api/models?period=7d`

Returns per-model request counts and token totals for the period, used by the Models chart.

```jsonc
{
  "series": [
    { "ts": 1741996800000, "models": { "claude-sonnet-4-6": 120, "gpt-4o": 40, "o4-mini": 20 } }
    // ...
  ],
  "totals": {
    "claude-sonnet-4-6": { "requests": 840, "inputTokens": 2900000, "outputTokens": 620000 },
    "gpt-4o":            { "requests": 280, "inputTokens": 1100000, "outputTokens": 220000 },
    "o4-mini":           { "requests": 127, "inputTokens":  200000, "outputTokens":  52000 }
  }
}
```

### `GET /dashboard/api/breakdown?period=7d&by=device`
### `GET /dashboard/api/breakdown?period=7d&by=session`

Returns per-device (or per-session) aggregates for the period and prior period.

```jsonc
{
  "rows": [
    {
      "id": "work-macbook",          // device_id or session_id
      "name": "work-macbook",        // friendly name if available, else first 8 chars of id
      "requests": 612,
      "inputTokens": 2400000,
      "outputTokens": 512000,
      "estimatedCost": 1.20,
      "prev": { "requests": 566, "estimatedCost": 1.11 }  // for % delta
    }
    // ...
  ]
}
```

---

## Summary Cards

### Row 1 — Period Metrics (6 cards)

| Card | Value | Delta |
|---|---|---|
| Requests | Count | % vs prior period |
| Input Tokens | Formatted (K/M) | % vs prior period |
| Output Tokens | Formatted (K/M) | % vs prior period |
| Custo Estimado | $X.XX | % vs prior period |
| Duração Média | X.Xs or XXXms | % vs prior period |
| Sessions | Count | % vs prior period |

Delta display: `↑ 12%` in green / `↓ 3%` in red / `— igual` in gray (threshold: < 0.5% = equal).

### Row 2 — Per-Device Cost Cards (dynamic, up to 4 cards)

One card per known device. Shows:
- Device name (friendly name or truncated ID)
- Estimated cost for the period
- % delta vs prior period
- Request count for the period

Devices with no activity in the selected period are shown at reduced opacity with `—` for cost.

---

## Charts

### Layout: 2×3 Grid

| Position | Metric | Default color |
|---|---|---|
| Top-left | Input Tokens | Green (`#238636`) |
| Top-right | Output Tokens | Red (`#f78166`) |
| Mid-left | Requests | Blue (`#58a6ff`) |
| Mid-right | Duração Média | Blue (`#58a6ff`) |
| Bottom-left | Custo Estimado | Yellow (`#d29922`) |
| Bottom-right | Modelos | Multi-color stacked bar |

### Chart Type Switcher

- **Global switcher** (top-right of charts section): Linha / Barra / Área — applies to all charts
- **Per-chart override** button (`▾`) on each chart header — overrides global for that chart only
- Override is indicated visually (border color change + label)

### Chart Type Behavior

- **Barra / Linha** → value per bucket (per hour, per day, or per week depending on period)
- **Área** → cumulative value (each point = sum of all buckets up to and including that point)

The Models chart always renders as a stacked bar regardless of the global type switcher (stacking is intrinsic to multi-model data). It does not show a per-chart override button.

---

## Breakdown Table

Positioned below the charts. Two tabs: **Por Device** / **Por Session**.

Columns: Name · Requests · Input Tokens · Output Tokens · Custo Estimado

- Input tokens column: green
- Output tokens column: red
- Custo estimado column: yellow
- Sorted by estimated cost descending
- Sessions tab shows `session_id` (first 8 chars) — no friendly name mapping

---

## DB Queries

New queries added to `src/lib/db.ts`:

- `queryStatsByPeriod(from: number, to: number): PeriodStats` — aggregates + time series
- `queryModelsByPeriod(from: number, to: number): ModelSeries` — per-model per-bucket counts
- `queryBreakdownByDevice(from: number, to: number): BreakdownRow[]`
- `queryBreakdownBySession(from: number, to: number): BreakdownRow[]`

Period resolution (converting `period` param to `from`/`to` timestamps) happens in `route.ts`, not in `db.ts`. DB functions always receive explicit Unix millisecond timestamps.

---

## Removed

- Recent requests table (last 20 rows) — removed from dashboard entirely
- `GET /dashboard/api/requests` endpoint — no longer needed
- The existing `GET /dashboard/api/stats` (hardcoded 30-day) is replaced by the parameterized version

---

## Out of Scope

- Custom date range picker (not a preset period)
- Per-session friendly name mapping
- Auto-pruning of old log rows
- Export / download of data
- Real-time push updates (auto-refresh every 30s remains as-is)
