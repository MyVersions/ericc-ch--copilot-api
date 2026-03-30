import { expect, test, describe } from "bun:test"

import {
  padRight,
  padLeft,
  formatDate,
  formatSize,
  formatTokens,
  formatDuration,
  LOG_CONFIG,
} from "./logger"

const dotPos = (s: string) => s.indexOf(".")

// ─── padRight ────────────────────────────────────────────────────────────────

describe("padRight", () => {
  test("pads short string with spaces on the right", () => {
    expect(padRight("GET", 6)).toBe("GET   ")
  })

  test("returns string unchanged when exact width", () => {
    expect(padRight("DELETE", 6)).toBe("DELETE")
  })

  test("truncates long string and adds ellipsis", () => {
    expect(padRight("/v1/chat/completions/very/long", 25)).toBe(
      "/v1/chat/completions/very…",
    )
  })

  test("handles empty string", () => {
    expect(padRight("", 4)).toBe("    ")
  })
})

// ─── padLeft ─────────────────────────────────────────────────────────────────

describe("padLeft", () => {
  test("pads short string with spaces on the left", () => {
    expect(padLeft("200", 4)).toBe(" 200")
  })

  test("returns string unchanged when exact width", () => {
    expect(padLeft("1234", 4)).toBe("1234")
  })

  test("truncates long string (from right) and adds ellipsis", () => {
    expect(padLeft("12345", 4)).toBe("123…")
  })

  test("handles empty string", () => {
    expect(padLeft("", 4)).toBe("    ")
  })
})

// ─── formatDate ──────────────────────────────────────────────────────────────

describe("formatDate", () => {
  test("returns exactly 17 characters", () => {
    expect(formatDate().length).toBe(17)
  })

  test("matches pattern [DD/MM HH:MM:SS]", () => {
    expect(formatDate()).toMatch(/^\[\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\]$/)
  })
})

// ─── formatSize ──────────────────────────────────────────────────────────────

describe("formatSize", () => {
  test("returns exactly 8 characters", () => {
    expect(formatSize(0.5).length).toBe(8)
    expect(formatSize(1.3).length).toBe(8)
    expect(formatSize(1500).length).toBe(8)
  })

  test("shows bytes (with space+b unit) for values < 1 kb", () => {
    // 0.5 kb = 512 bytes → '  512.0 b' but that's 9... let's check spec:
    // size is [4 int right][.][1 dec][2-char unit] = 8
    // 0.5 kb → 512 bytes → int=512 (3 digits, right in 4) → " 512" + "." + "0" + " b" = " 512.0 b"
    expect(formatSize(0.5)).toBe(" 512.0 b")
  })

  test("shows bytes for small fractions (< 1 kb)", () => {
    // 0.1 kb = 102.4 bytes ≈ 102 bytes → " 102.4 b"  -- wait, kb * 1024 = exact bytes
    // spec says multiply by 1024: 0.1 * 1024 = 102.4 bytes
    expect(formatSize(0.1)).toBe(" 102.4 b")
  })

  test("shows kb for values >= 1 kb and < 1024 kb", () => {
    // 1.3 kb → "   1.3kb"
    expect(formatSize(1.3)).toBe("   1.3kb")
  })

  test("shows kb for larger values in kb range", () => {
    // 1330 kb → "1330.0kb"
    expect(formatSize(1330)).toBe("1330.0kb")
  })

  test("shows Mb for values >= 1024 kb", () => {
    // 1228.8 kb = 1.2 Mb → "   1.2Mb"
    expect(formatSize(1228.8)).toBe("   1.2Mb")
  })

  test("shows Mb for larger Mb values", () => {
    // 12288 kb = 12.0 Mb → "  12.0Mb"
    expect(formatSize(12288)).toBe("  12.0Mb")
  })

  test("decimal point is always at position 5 (0-indexed 4)", () => {
    // byte:  " 512.0 b" → position 4 is '.'
    // kb:    "   1.3kb" → position 4 is '.'
    // Mb:    "   1.2Mb" → position 4 is '.'
    expect(dotPos(formatSize(0.5))).toBe(4)
    expect(dotPos(formatSize(1.3))).toBe(4)
    expect(dotPos(formatSize(1228.8))).toBe(4)
  })
})

// ─── formatTokens ────────────────────────────────────────────────────────────

describe("formatTokens", () => {
  test("returns exactly 9 characters for small values", () => {
    expect(formatTokens(88, "↑").length).toBe(9)
  })

  test("returns exactly 9 characters for k values", () => {
    expect(formatTokens(128100, "↑").length).toBe(9)
  })

  test("returns exactly 9 characters for M values", () => {
    expect(formatTokens(28100000, "↑").length).toBe(9)
  })

  test("formats small value (< 1000) with leading space and no suffix", () => {
    // spec: " ↑  88   " — space + ↑ + right-4 + space + space + space
    // structure: [space][↑][4 int right]['  '][' ']
    // 88 → "  88" in 4 chars right → " ↑  88   "
    expect(formatTokens(88, "↑")).toBe(" ↑  88   ")
  })

  test("formats single digit value correctly", () => {
    // 5 → "   5" in 4 chars right → " ↑   5   "
    expect(formatTokens(5, "↑")).toBe(" ↑   5   ")
  })

  test("formats k value with one decimal", () => {
    // 128100 → 128.1k → " ↑ 128.1k"
    expect(formatTokens(128100, "↑")).toBe(" ↑ 128.1k")
  })

  test("formats M value with one decimal", () => {
    // 28100000 → 28.1M → " ↑  28.1M"
    expect(formatTokens(28100000, "↑")).toBe(" ↑  28.1M")
  })

  test("uses ↓ prefix for output tokens", () => {
    expect(formatTokens(42, "↓")).toBe(" ↓  42   ")
  })

  test("decimal point is always at position 6 (0-indexed)", () => {
    // " ↑  88   " → no dot, but the 'dot position' slot is space at index 6
    // " ↑ 128.1k" → dot at index 6
    // " ↑  28.1M" → dot at index 6
    const s1 = formatTokens(128100, "↑") // " ↑ 128.1k"
    const s2 = formatTokens(28100000, "↑") // " ↑  28.1M"
    expect(s1[6]).toBe(".")
    expect(s2[6]).toBe(".")
    // for small values, position 6 is a space (no decimal)
    const s3 = formatTokens(88, "↑") // " ↑  88   "
    expect(s3[6]).toBe(" ")
  })
})

// ─── formatDuration ──────────────────────────────────────────────────────────

describe("formatDuration", () => {
  test("returns exactly 8 characters", () => {
    expect(formatDuration(800).length).toBe(8)
    expect(formatDuration(1200).length).toBe(8)
    expect(formatDuration(123400).length).toBe(8)
  })

  test("formats sub-second as seconds with 1 decimal", () => {
    // 800ms → 0.8s → "    0.8s"
    expect(formatDuration(800)).toBe("    0.8s")
  })

  test("formats 1.2 seconds", () => {
    // 1200ms → 1.2s → "    1.2s"
    expect(formatDuration(1200)).toBe("    1.2s")
  })

  test("formats 123.4 seconds", () => {
    // 123400ms → 123.4s → "  123.4s"
    expect(formatDuration(123400)).toBe("  123.4s")
  })

  test("never uses ms", () => {
    expect(formatDuration(500)).not.toContain("ms")
    expect(formatDuration(999)).not.toContain("ms")
  })

  test("decimal point is always at position 5 (0-indexed)", () => {
    // "    0.8s" → dot at index 5
    // "    1.2s" → dot at index 5
    // "  123.4s" → dot at index 5
    expect(formatDuration(800)[5]).toBe(".")
    expect(formatDuration(1200)[5]).toBe(".")
    expect(formatDuration(123400)[5]).toBe(".")
  })
})

// ─── LOG_CONFIG ───────────────────────────────────────────────────────────────

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
    expect(LOG_CONFIG.widths.tokens).toBe(9)
    expect(LOG_CONFIG.widths.device).toBe(40)
    expect(LOG_CONFIG.widths.model).toBe(25)
    expect(LOG_CONFIG.widths.time).toBe(8)
  })

  test("colors object has all required fields", () => {
    const required = [
      "date",
      "method",
      "path",
      "status2xx",
      "status3xx",
      "status4xx",
      "status5xx",
      "size",
      "tokens",
      "device",
      "model",
      "time",
    ]
    for (const field of required) {
      expect(LOG_CONFIG.colors).toHaveProperty(field)
    }
  })

  test("all color values are functions", () => {
    for (const [_key, fn] of Object.entries(LOG_CONFIG.colors)) {
      expect(typeof fn).toBe("function")
      // color functions must return strings
      const result = (fn as (s: string) => string)("test")
      expect(typeof result).toBe("string")
    }
  })
})
