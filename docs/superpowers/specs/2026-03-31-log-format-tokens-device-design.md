# Log Format: Token Counts & Device Field — Design Spec

**Date:** 2026-03-31
**Status:** Approved
**Scope:** `src/lib/logger.ts` and `src/lib/logger.test.ts`

---

## Overview

Two targeted changes to the request log formatter:

1. **Token counts** — display raw integer values with dot-as-thousands-separator (Brazilian/European style), right-aligned, instead of the current `k`/`M` abbreviated format.
2. **Device field** — align the `@` separator at a fixed column so the left part (app identity) and right part (server hostname) are always visually separated at the same position.

---

## Change 1 — Token Count Format

### Current behaviour

`formatTokens(n, prefix)` returns 9 chars using `k`/`M` abbreviations:

```
 ↑ 144.1k   (144,100 tokens)
 ↓  10.9k   (10,900 tokens)
 ↑  88      (88 tokens)
```

### New behaviour

Replace `formatTokens` with `formatTokenCount(n, prefix)` returning **10 chars**:

```
 ↑ 144.035   (144,035 tokens)
 ↓  10.900   (10,900 tokens)
 ↑      88   (88 tokens)
 ↑ 9.999.999 (9,999,999 tokens)
```

### Format specification

```
[space][↑/↓][space][7 chars, integer right-aligned with dot thousands-separator]
 1   +  1  +  1  +  7  =  10 chars total
```

- Separator: **dot** (`.`) as thousands separator, no decimals
- The 7-char right-aligned zone accommodates up to `9.999.999` (7 chars with separators)
- Numbers above `9.999.999` overflow naturally (no truncation attempted — this is a degenerate case)
- Implementation: manual formatting (do NOT use `toLocaleString` — locale may vary by system)

### Manual formatting algorithm

```
function addThousandsSep(n: number): string {
  const s = String(n)
  // insert dots every 3 digits from right
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}
```

Then **left-pad (right-align)** to 7 chars using `padStart(7)` and prepend ` ↑ ` or ` ↓ `.

### Config change

`LOG_CONFIG.widths.tokens`: `9` → `10`

---

## Change 2 — Device Field with Aligned `@`

### Current behaviour

`deviceId` is passed through `padRight(deviceId, 40)` — left-aligned, plain truncation.

```
claude-code:ik_iakan@orthanc              (truncated/padded to 40 chars)
```

### New behaviour

New **exported** function `formatDevice(deviceId: string | undefined, leftWidth: number, rightWidth: number): string` that:

1. Splits `deviceId` on the **last** `@`
2. Right-aligns the left part in `leftWidth` chars
3. Left-aligns the right part in `rightWidth` chars
4. Joins with `@` — total width = `leftWidth + 1 + rightWidth`

```
formatDevice("openclaw@orthanc",               29, 10)
  → "                     openclaw@orthanc   "

formatDevice("claude-code:ik_iakan@orthanc",   29, 10)
  → "         claude-code:ik_iakan@orthanc   "

formatDevice("gemini:bewiser.assistant@erebor", 29, 10)
  → "     gemini:bewiser.assistant@erebor    "
```

The `@` always appears at index 29 (0-based) in the output string.

### Edge cases

| Case | Behaviour |
|------|-----------|
| No `@` in string | Treat entire string as left part; right part is empty string |
| Left part longer than `leftWidth` | Truncate from the right end with `…` (e.g. `"very-long-name:tok…"`) — preserves the beginning of the identifier |
| Right part longer than `rightWidth` | Truncate with `…` (same as `padRight`) |
| `deviceId` is `undefined` | Return `" ".repeat(leftWidth + 1 + rightWidth)` |

### Config change

Add to `LOG_CONFIG.widths`:
```ts
deviceLeft: 29,   // chars before @
deviceRight: 10,  // chars after @  (server hostname)
// device: 40 remains (= deviceLeft + 1 + deviceRight), kept for compatibility
```

---

## Files Changed

| File | Changes |
|------|---------|
| `src/lib/logger.ts` | Remove `formatTokens` export; add exported `formatTokenCount` and `formatDevice`; update `LOG_CONFIG.widths`; update `logRequest` to use new formatters |
| `src/lib/logger.test.ts` | Remove `formatTokens` import and tests; add `formatTokenCount` and `formatDevice` tests; update `LOG_CONFIG` width assertions to include `deviceLeft: 29`, `deviceRight: 10`, and `tokens: 10` |

---

## Visual Before / After

**Before:**
```
[31/03 23:30:31]   POST    /v1/messages               200    473.1kb   ↑ 149.3k   ↓  11.10k  claude-code:ik_iakan@orthanc              claude-sonnet-4.6            160.3s
```

**After:**
```
[31/03 23:30:31]   POST    /v1/messages               200    473.1kb   ↑ 149.300   ↓  11.100           claude-code:ik_iakan@orthanc   claude-sonnet-4.6            160.3s
```

The `@` sits at a fixed column regardless of how long the app identifier is.

---

## Out of Scope

- No changes to `formatSize`, `formatDuration`, `formatDate`, or any other log field
- No changes to how `deviceId` is extracted or passed in (`extractDeviceId` unchanged)
- No changes to the middleware or route handlers
