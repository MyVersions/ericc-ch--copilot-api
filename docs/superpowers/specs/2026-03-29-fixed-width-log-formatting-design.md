# Fixed-Width Log Formatting — Design Spec

**Date:** 2026-03-29
**Status:** Approved

---

## Overview

Refactor `src/lib/logger.ts` so every log field has a fixed character width, ensuring that fields always appear directly below their counterparts across lines. All widths and colors are centralised in a single `LOG_CONFIG` object so they can be changed in one place.

---

## Field Specification

| Field | Width | Align | Color | Notes |
|---|---|---|---|---|
| `date` | 17 | left | `dim` | `[DD/MM HH:MM:SS]` |
| `method` | 6 | left | `cyan` | `POST  `, `GET   `, `PATCH ` |
| `path` | 25 | left | none | truncate to 24 + `…` if > 25 |
| `status` | 4 | left | green (2xx/3xx) / yellow (4xx) / red (5xx) | `200 `, `404 ` |
| `size` | 8 | see below | `cyan` | kb of request body |
| `input_tokens` | 9 | see below | `yellow` | space + `↑` prefix |
| `output_tokens` | 9 | see below | `yellow` | space + `↓` prefix |
| `device` | 40 | left | `dim` | truncate to 39 + `…` if > 40 |
| `model` | 25 | left | `magenta` | truncate to 24 + `…` if > 25 |
| `time` | 8 | see below | `dim` | always seconds |

Fields are always emitted, even when the value is absent — absent fields render as spaces of the correct width, preserving column alignment across all lines.

Two spaces separate every field.

---

## Numeric Field Alignment

The decimal point must be vertically aligned across all lines within each numeric field.

### `size` — 8 chars: `[4 int right][.][1 dec][2-char unit]`

Input unit: kilobytes (`requestSizeKb`). Units displayed: ` b` (bytes), `kb` (kilobytes), `Mb` (megabytes).

```
   0.1 b    →  < 1 kb (multiply by 1024 to get bytes for display)
 999.0 b    →  < 1 kb
   1.3kb    →  ≥ 1 kb, < 1024 kb
1330.0kb    →  ≥ 1 kb, < 1024 kb
   1.2Mb    →  ≥ 1024 kb
```

Thresholds (input is in kb):
- `< 1` → display as bytes: `value * 1024`, unit ` b`
- `< 1024` → display as kb: `value`, unit `kb`
- `≥ 1024` → display as Mb: `value / 1024`, unit `Mb`

**Overflow:** if the integer part exceeds 4 digits (value ≥ 10 000 in display unit), the field is allowed to expand beyond 8 chars rather than truncate the number.

### `input_tokens` / `output_tokens` — 9 chars: `[space][↑/↓][4 int right][.][1 dec][1-char unit]`

Structure: 1 leading space + 1 prefix char + 4-char integer right-aligned + `.` or ` ` + 1 decimal or ` ` + 1 unit char = 9.

Units: ` ` (< 1 000), `k` (≥ 1 000), `M` (≥ 1 000 000).

```
 ↑  88     →  88, no suffix  (decimal and unit columns are spaces)
 ↑ 128.1k  →  128 100, suffix k
 ↑  28.1M  →  28 100 000, suffix M
 ↓  42     →  42 output tokens
```

- Value < 1 000: integer right-aligned in 4 chars, decimal column = space, unit column = space.
- Value ≥ 1 000: divide by 1 000, format as `NNN.Nk` (integer in 4 chars right, `.`, 1 decimal, `k`).
- Value ≥ 1 000 000: divide by 1 000 000, format as `NNN.NM`.

Each field is rendered independently. If one is absent and the other present, the absent one renders as spaces of width 9.

**Overflow:** if the integer part exceeds 4 digits after dividing by the unit, the field is allowed to expand rather than truncate the number.

### `time` — 8 chars: `[5 int right][.][1 dec][s]`

Always expressed in seconds (`ms ÷ 1000`). Never uses `ms`.

Structure: 5-char integer right-aligned + `.` + 1 decimal + `s` = 8.

```
    0.8s
    1.2s
  123.4s
```

**Overflow:** if the integer part exceeds 5 digits (duration ≥ 100 000 s), the field is allowed to expand beyond 8 chars rather than truncate the number.

---

## Parametrisation — `LOG_CONFIG`

A single constant in `logger.ts`. Change any width or color here — no other edits needed.

```ts
const LOG_CONFIG = {
  widths: {
    date: 17,
    method: 6,
    path: 25,
    status: 4,
    size: 8,
    tokens: 9,   // shared by input_tokens and output_tokens
    device: 40,
    model: 25,
    time: 8,
  },
  colors: {
    date:      (s: string) => ansi.dim(s),
    method:    (s: string) => ansi.cyan(s),
    path:      (s: string) => s,
    status2xx: (s: string) => ansi.green(s),
    status3xx: (s: string) => ansi.green(s),
    status4xx: (s: string) => ansi.yellow(s),
    status5xx: (s: string) => ansi.red(s),
    size:      (s: string) => ansi.cyan(s),
    tokens:    (s: string) => ansi.yellow(s),
    device:    (s: string) => ansi.dim(s),
    model:     (s: string) => ansi.magenta(s),
    time:      (s: string) => ansi.dim(s),
  },
}
```

---

## Absent Fields

When `requestSizeKb`, `inputTokens`, `outputTokens`, `deviceId`, or `model` are not provided in `RequestLogInfo`, the corresponding field is rendered as a blank string of the correct fixed width — never skipped. This ensures all subsequent fields remain column-aligned regardless of which optional fields are present.

Each token field (`inputTokens`, `outputTokens`) is rendered independently — if one is absent and the other present, the absent one renders as spaces of width 9.

---

## Helper Functions

All helpers remain in `logger.ts` (no new files needed):

- `padLeft(s, width)` — right-align string, truncate with `…` if needed
- `padRight(s, width)` — left-align string, truncate with `…` if needed
- `formatDate()` — returns 17-char wall-clock timestamp string (renamed from current `formatTime()`)
- `formatSize(kb)` — returns 8-char fixed string; input in kilobytes
- `formatTokens(n, prefix)` — returns 9-char fixed string with ` ↑` or ` ↓` prefix
- `formatDuration(ms)` — returns 8-char fixed string; always seconds (replaces current `formatDuration()` which returned a variable-width string)

---

## Unchanged

- `RequestLogInfo` interface shape stays the same
- `markRequestLogged` / `requestLogger` middleware unchanged
- All call sites (`handler.ts` in chat-completions and messages) unchanged
- Existing `ansi` color helpers unchanged
