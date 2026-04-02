# Log Format: Token Counts & Device Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the abbreviated token formatter (`144.1k`) with raw integers using dot-as-thousands-separator, and replace the flat device field with a split-at-`@` formatter that aligns the `@` at a fixed column.

**Architecture:** Two new exported functions — `formatTokenCount` and `formatDevice` — replace `formatTokens` and the inline `padRight(deviceId, 40)` call in `logRequest`. Both functions are pure, fixed-width formatters with deterministic output. `LOG_CONFIG.widths` gains two new keys (`deviceLeft`, `deviceRight`) and `tokens` changes from 9 → 10.

**Tech Stack:** TypeScript, Bun test runner (`bun test`), Hono (no changes to the framework layer)

**Spec:** `docs/superpowers/specs/2026-03-31-log-format-tokens-device-design.md`

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `src/lib/logger.ts` | Modify | Remove `formatTokens`; add `formatTokenCount` and `formatDevice`; update `LOG_CONFIG.widths`; update `logRequest` |
| `src/lib/logger.test.ts` | Modify | Remove `formatTokens` tests and import; add `formatTokenCount` and `formatDevice` tests; update `LOG_CONFIG` assertions |

---

## Task 1: Replace `formatTokens` with `formatTokenCount`

**Files:**
- Modify: `src/lib/logger.ts` — remove `formatTokens`, add `formatTokenCount`, update `LOG_CONFIG.widths.tokens`
- Modify: `src/lib/logger.test.ts` — remove `formatTokens` tests, add `formatTokenCount` tests

### Step-by-step

- [ ] **Step 1: Write the failing tests for `formatTokenCount`**

Open `src/lib/logger.test.ts`. Remove the entire `describe("formatTokens", ...)` block (lines ~122–174) and its `formatTokens` import. Replace with:

```typescript
import {
  padRight,
  padLeft,
  formatDate,
  formatSize,
  formatTokenCount,
  formatDevice,
  formatDuration,
  LOG_CONFIG,
} from "./logger"
```

Add this describe block where the old `formatTokens` block was:

```typescript
// ─── formatTokenCount ────────────────────────────────────────────────────────

describe("formatTokenCount", () => {
  test("returns exactly 10 characters for small values", () => {
    expect(formatTokenCount(88, "↑").length).toBe(10)
  })

  test("returns exactly 10 characters for thousands", () => {
    expect(formatTokenCount(144035, "↑").length).toBe(10)
  })

  test("returns exactly 10 characters for millions", () => {
    expect(formatTokenCount(9999999, "↑").length).toBe(10)
  })

  test("formats small value right-aligned in 7-char zone, no separator", () => {
    // " ↑      88"  — space + ↑ + space + "     88" (7 chars)
    expect(formatTokenCount(88, "↑")).toBe(" ↑      88")
  })

  test("formats single digit", () => {
    expect(formatTokenCount(5, "↑")).toBe(" ↑       5")
  })

  test("formats exactly 1000 with separator", () => {
    // 1000 → "1.000" = 5 chars, right-aligned in 7 → "  1.000"
    expect(formatTokenCount(1000, "↑")).toBe(" ↑   1.000")
  })

  test("formats thousands with dot separator", () => {
    // 144035 → "144.035" = 7 chars, fits exactly in 7
    expect(formatTokenCount(144035, "↑")).toBe(" ↑ 144.035")
  })

  test("formats 10900 correctly", () => {
    // 10900 → "10.900" = 6 chars, right-aligned in 7 → " 10.900"
    expect(formatTokenCount(10900, "↓")).toBe(" ↓  10.900")
  })

  test("formats 9999999 (max 7-char case)", () => {
    // 9999999 → "9.999.999" = 9 chars — overflow, total > 10
    // spec says: overflow allowed for degenerate case, no truncation
    expect(formatTokenCount(9999999, "↑").startsWith(" ↑")).toBe(true)
    expect(formatTokenCount(9999999, "↑")).toContain("9.999.999")
  })

  test("uses ↓ prefix for output tokens", () => {
    expect(formatTokenCount(130, "↓")).toBe(" ↓     130")
  })

  test("the ↑/↓ symbol is always at index 1", () => {
    expect(formatTokenCount(88, "↑")[1]).toBe("↑")
    expect(formatTokenCount(88, "↓")[1]).toBe("↓")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /repos/_mv/ericc-ch--copilot-api && bun test src/lib/logger.test.ts
```

Expected: compile error or test failures — `formatTokenCount` and `formatDevice` are not yet exported.

- [ ] **Step 3: Implement `formatTokenCount` in `logger.ts`**

Open `src/lib/logger.ts`. Find `formatTokens` (lines ~113–140). Replace the entire function with:

```typescript
/**
 * Formats `n` as an integer with dot-as-thousands-separator, right-aligned
 * in a 7-char zone, prefixed by ` ↑ ` or ` ↓ `.
 *
 * Total width: 10 chars = 1(space) + 1(prefix) + 1(space) + 7(number zone)
 *
 * Examples:
 *   formatTokenCount(88, "↑")     → " ↑      88"
 *   formatTokenCount(144035, "↑") → " ↑ 144.035"
 *   formatTokenCount(10900, "↓")  → " ↓  10.900"
 */
export function formatTokenCount(n: number, prefix: "↑" | "↓"): string {
  const formatted = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  const numberZone = formatted.padStart(7)
  return ` ${prefix} ${numberZone}`
}
```

Also update `LOG_CONFIG.widths.tokens` from `9` to `10`:

```typescript
export const LOG_CONFIG = {
  widths: {
    date: 17,
    method: 6,
    path: 25,
    status: 4,
    size: 8,
    tokens: 10,       // was 9
    device: 40,
    deviceLeft: 29,   // new
    deviceRight: 10,  // new
    model: 25,
    time: 8,
  },
  // ... colors unchanged
}
```

Also delete the old `formatTokens` function entirely.

- [ ] **Step 4: Update `logRequest` to use `formatTokenCount`**

In `logRequest`, find the two lines that call `formatTokens` (around lines 194–201):

```typescript
// Before:
const inputField =
  info.inputTokens !== undefined ?
    c.tokens(formatTokens(info.inputTokens, "↑"))
  : " ".repeat(w.tokens)

const outputField =
  info.outputTokens !== undefined ?
    c.tokens(formatTokens(info.outputTokens, "↓"))
  : " ".repeat(w.tokens)
```

Replace with:

```typescript
const inputField =
  info.inputTokens !== undefined ?
    c.tokens(formatTokenCount(info.inputTokens, "↑"))
  : " ".repeat(w.tokens)

const outputField =
  info.outputTokens !== undefined ?
    c.tokens(formatTokenCount(info.outputTokens, "↓"))
  : " ".repeat(w.tokens)
```

- [ ] **Step 5: Run tests — `formatTokenCount` tests must pass, `formatDevice` tests still failing**

```bash
cd /repos/_mv/ericc-ch--copilot-api && bun test src/lib/logger.test.ts
```

Expected: `formatTokenCount` describe block passes; `formatDevice` describe block still fails (not yet implemented). All other existing tests (`padRight`, `padLeft`, `formatDate`, `formatSize`, `formatDuration`) must still pass.

---

## Task 2: Add `formatDevice` and update `logRequest`

**Files:**
- Modify: `src/lib/logger.ts` — add `formatDevice`, update `logRequest`'s device field
- Modify: `src/lib/logger.test.ts` — add `formatDevice` tests, update `LOG_CONFIG` assertions

### Step-by-step

- [ ] **Step 1: Write the failing tests for `formatDevice`**

In `src/lib/logger.test.ts`, add this describe block after the `formatTokenCount` block (and before `formatDuration`):

```typescript
// ─── formatDevice ────────────────────────────────────────────────────────────

describe("formatDevice", () => {
  const L = 29
  const R = 10
  const TOTAL = L + 1 + R // 40

  test("total width is always L + 1 + R = 40", () => {
    expect(formatDevice("openclaw@orthanc", L, R).length).toBe(TOTAL)
    expect(formatDevice("claude-code:ik_iakan@orthanc", L, R).length).toBe(TOTAL)
    expect(formatDevice("gemini:bewiser.assistant@erebor", L, R).length).toBe(TOTAL)
    expect(formatDevice(undefined, L, R).length).toBe(TOTAL)
    expect(formatDevice("no-at-sign", L, R).length).toBe(TOTAL)
  })

  test("@ is always at index 29 (leftWidth)", () => {
    expect(formatDevice("openclaw@orthanc", L, R)[L]).toBe("@")
    expect(formatDevice("claude-code:ik_iakan@orthanc", L, R)[L]).toBe("@")
    expect(formatDevice("gemini:bewiser.assistant@erebor", L, R)[L]).toBe("@")
  })

  test("openclaw@orthanc — 21 leading spaces, 3 trailing spaces", () => {
    // "openclaw" = 8 chars → 29-8 = 21 spaces left; "orthanc" = 7 → 3 trailing
    expect(formatDevice("openclaw@orthanc", L, R)).toBe(
      "                     openclaw@orthanc   "
    )
  })

  test("claude-code:ik_iakan@orthanc — 9 leading spaces, 3 trailing spaces", () => {
    // "claude-code:ik_iakan" = 20 chars → 29-20 = 9 spaces
    expect(formatDevice("claude-code:ik_iakan@orthanc", L, R)).toBe(
      "         claude-code:ik_iakan@orthanc   "
    )
  })

  test("gemini:bewiser.assistant@erebor — 5 leading spaces, 4 trailing spaces", () => {
    // "gemini:bewiser.assistant" = 24 chars → 29-24 = 5 spaces; "erebor" = 6 → 4 trailing
    expect(formatDevice("gemini:bewiser.assistant@erebor", L, R)).toBe(
      "     gemini:bewiser.assistant@erebor    "
    )
  })

  test("undefined returns all spaces", () => {
    expect(formatDevice(undefined, L, R)).toBe(" ".repeat(TOTAL))
  })

  test("no @ — treats whole string as left part, right is empty string padded", () => {
    // "no-at-sign" = 10 chars → 29-10 = 19 leading spaces; right = "" padded to 10
    const result = formatDevice("no-at-sign", L, R)
    expect(result[L]).toBe("@")
    expect(result.length).toBe(TOTAL)
    expect(result.startsWith("                   no-at-sign")).toBe(true)
  })

  test("left part overflow truncates from the right with ellipsis", () => {
    // left part too long: 30 chars → padLeft(s, 29) → first 28 chars + "…"
    const longLeft = "a".repeat(30)
    const result = formatDevice(`${longLeft}@host`, L, R)
    expect(result[L]).toBe("@")
    expect(result.length).toBe(TOTAL)
    expect(result.slice(L - 1, L)).toBe("…") // last char before @ is ellipsis
  })

  test("right part overflow truncates with ellipsis", () => {
    // right part too long: 11 chars → padRight(s, 10) → first 9 chars + "…"
    const longRight = "b".repeat(11)
    const result = formatDevice(`openclaw@${longRight}`, L, R)
    expect(result[L]).toBe("@")
    expect(result.length).toBe(TOTAL)
    expect(result[TOTAL - 1]).toBe("…") // last char is ellipsis
  })

  test("splits on the LAST @ when multiple @ are present", () => {
    // "user@host@server" → left="user@host", right="server"
    const result = formatDevice("user@host@server", L, R)
    expect(result[L]).toBe("@")
    // left part is "user@host" = 9 chars → 20 leading spaces
    expect(result.slice(0, L).trimStart()).toBe("user@host")
  })
})
```

- [ ] **Step 2: Run tests to verify `formatDevice` tests fail**

```bash
cd /repos/_mv/ericc-ch--copilot-api && bun test src/lib/logger.test.ts
```

Expected: `formatDevice` describe block fails — not yet implemented.

- [ ] **Step 3: Implement `formatDevice` in `logger.ts`**

In `src/lib/logger.ts`, add the `formatDevice` function after `formatTokenCount`:

```typescript
/**
 * Formats a device identifier so the `@` always appears at index `leftWidth`.
 *
 * Splits on the LAST `@`. The left part is right-aligned in `leftWidth` chars;
 * the right part is left-aligned in `rightWidth` chars.
 *
 * Total width = leftWidth + 1 + rightWidth.
 *
 * Left overflow: truncated from the right with `…` (preserves the beginning).
 * Right overflow: truncated from the right with `…`.
 * No `@` in input: entire string treated as left part; right part is empty.
 * undefined: returns spaces of total width.
 *
 * Examples (leftWidth=29, rightWidth=10):
 *   "openclaw@orthanc"              → "                     openclaw@orthanc   "
 *   "claude-code:ik_iakan@orthanc"  → "         claude-code:ik_iakan@orthanc   "
 *   "gemini:bewiser.assistant@erebor" → "     gemini:bewiser.assistant@erebor    "
 */
export function formatDevice(
  deviceId: string | undefined,
  leftWidth: number,
  rightWidth: number,
): string {
  if (deviceId === undefined) {
    return " ".repeat(leftWidth + 1 + rightWidth)
  }

  const atIndex = deviceId.lastIndexOf("@")
  const leftRaw = atIndex === -1 ? deviceId : deviceId.slice(0, atIndex)
  const rightRaw = atIndex === -1 ? "" : deviceId.slice(atIndex + 1)

  const leftField = padLeft(leftRaw, leftWidth)
  const rightField = padRight(rightRaw, rightWidth)

  return `${leftField}@${rightField}`
}
```

- [ ] **Step 4: Update `logRequest` to use `formatDevice`**

In `logRequest`, find the device field section (around lines 203–207):

```typescript
// Before:
const deviceField =
  info.deviceId !== undefined ?
    c.device(padRight(info.deviceId, w.device))
  : " ".repeat(w.device)
```

Replace with:

```typescript
const deviceField = c.device(
  formatDevice(info.deviceId, w.deviceLeft, w.deviceRight),
)
```

Note: `formatDevice` already handles the `undefined` case (returns spaces), so the conditional is no longer needed. The `c.device()` color wrapper is kept so the color still applies.

- [ ] **Step 5: Update `LOG_CONFIG` width assertions in test file**

In `src/lib/logger.test.ts`, find the `LOG_CONFIG` describe block. Update the `required` array and the individual width assertions:

```typescript
describe("LOG_CONFIG", () => {
  test("widths object has all required fields", () => {
    const required = [
      "date",
      "method",
      "path",
      "status",
      "size",
      "tokens",
      "device",
      "deviceLeft",
      "deviceRight",
      "model",
      "time",
    ]
    for (const field of required) {
      expect(LOG_CONFIG.widths).toHaveProperty(field)
    }
  })

  test("widths match spec values", () => {
    expect(LOG_CONFIG.widths.date).toBe(17)
    expect(LOG_CONFIG.widths.method).toBe(6)
    expect(LOG_CONFIG.widths.path).toBe(25)
    expect(LOG_CONFIG.widths.status).toBe(4)
    expect(LOG_CONFIG.widths.size).toBe(8)
    expect(LOG_CONFIG.widths.tokens).toBe(10)       // was 9
    expect(LOG_CONFIG.widths.device).toBe(40)
    expect(LOG_CONFIG.widths.deviceLeft).toBe(29)   // new
    expect(LOG_CONFIG.widths.deviceRight).toBe(10)  // new
    expect(LOG_CONFIG.widths.model).toBe(25)
    expect(LOG_CONFIG.widths.time).toBe(8)
  })

  // colors tests unchanged
})
```

- [ ] **Step 6: Run all tests — everything must pass**

```bash
cd /repos/_mv/ericc-ch--copilot-api && bun test src/lib/logger.test.ts
```

Expected: all describe blocks pass — `padRight`, `padLeft`, `formatDate`, `formatSize`, `formatTokenCount`, `formatDevice`, `formatDuration`, `LOG_CONFIG`.

- [ ] **Step 7: Typecheck**

```bash
cd /repos/_mv/ericc-ch--copilot-api && bun run typecheck
```

Expected: no errors.

- [ ] **Step 8: Lint**

```bash
cd /repos/_mv/ericc-ch--copilot-api && bun run lint
```

Expected: no errors or warnings.

- [ ] **Step 9: Commit**

```bash
git add src/lib/logger.ts src/lib/logger.test.ts
git commit -m "feat(logger): replace token abbreviations with raw integers and align device @ column"
```

---

## Verification Checklist

After both tasks are complete, manually verify log output looks like:

```
[31/03 23:30:31]   POST    /v1/messages               200    473.1kb   ↑ 149.300   ↓  11.100           claude-code:ik_iakan@orthanc   claude-sonnet-4.6            160.3s
```

- `↑` and `↓` token columns show integers with dot thousands-separator, no `k`/`M`
- `@` appears at the same horizontal position regardless of left-part length
- Server field is always 10 chars
- All existing tests still pass
