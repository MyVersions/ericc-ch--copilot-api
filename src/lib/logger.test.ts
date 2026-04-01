import { expect, test, describe } from "bun:test"

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

// ─── formatTokenCount ────────────────────────────────────────────────────────

describe("formatTokenCount", () => {
  test("returns exactly 10 characters for small values", () => {
    expect(formatTokenCount(88, "↑").length).toBe(10)
  })

  test("returns exactly 10 characters for thousands", () => {
    expect(formatTokenCount(144035, "↑").length).toBe(10)
  })

  test("returns exactly 10 characters for 6-digit values", () => {
    expect(formatTokenCount(999999, "↑").length).toBe(10)
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

// ─── formatDevice ─────────────────────────────────────────────────────────────

describe("formatDevice", () => {
  const L = 29
  const R = 10
  const opts = { leftWidth: L, rightWidth: R }

  test("total width = leftWidth + 1 + rightWidth", () => {
    expect(formatDevice("openclaw@orthanc", opts).length).toBe(L + 1 + R)
    expect(formatDevice("claude-code:ik_iakan@orthanc", opts).length).toBe(
      L + 1 + R,
    )
    expect(formatDevice(undefined, opts).length).toBe(L + 1 + R)
  })

  test("@ sign is always at index leftWidth", () => {
    const result1 = formatDevice("openclaw@orthanc", opts)
    expect(result1[L]).toBe("@")

    const result2 = formatDevice("claude-code:ik_iakan@orthanc", opts)
    expect(result2[L]).toBe("@")

    const result3 = formatDevice("gemini:bewiser.assistant@erebor", opts)
    expect(result3[L]).toBe("@")
  })

  test("left part is right-aligned (spaces on the left)", () => {
    // "openclaw" is 8 chars, leftWidth=29 → 21 leading spaces
    const result = formatDevice("openclaw@orthanc", opts)
    expect(result.startsWith(" ".repeat(21))).toBe(true)
    expect(result.slice(21, L)).toBe("openclaw")
  })

  test("right part is left-aligned (spaces on the right)", () => {
    // "orthanc" is 7 chars, rightWidth=10 → 3 trailing spaces
    const result = formatDevice("openclaw@orthanc", opts)
    expect(result.slice(L + 1)).toBe("orthanc   ")
  })

  test("splits on LAST @ when multiple @ present", () => {
    // "a@b@c" → left="a@b", right="c"
    const result = formatDevice("a@b@c", opts)
    expect(result[L]).toBe("@")
    expect(result.trimStart().startsWith("a@b@c")).toBe(true) // full trimmed string starts with left@right
    // The right part after position L is "c" + spaces
    expect(result.slice(L + 1).trimEnd()).toBe("c")
    // The left part ending at position L-1 ends with "a@b"
    expect(result.slice(0, L).trimStart()).toBe("a@b")
  })

  test("no @ in input: entire string is left part, right part empty", () => {
    const result = formatDevice("noatsign", opts)
    expect(result[L]).toBe("@")
    expect(result.slice(0, L).trimStart()).toBe("noatsign")
    // right is all spaces
    expect(result.slice(L + 1)).toBe(" ".repeat(R))
  })

  test("undefined returns all spaces of total width", () => {
    const result = formatDevice(undefined, opts)
    expect(result).toBe(" ".repeat(L + 1 + R))
  })

  test("left overflow: truncated with ellipsis, @ still at leftWidth", () => {
    // left part longer than leftWidth → truncate with "…"
    const longLeft = "a".repeat(L + 5)
    const result = formatDevice(`${longLeft}@host`, opts)
    expect(result[L]).toBe("@")
    expect(result.slice(0, L)).toBe("a".repeat(L - 1) + "…")
  })

  test("right overflow: truncated with ellipsis (total width = L+2+R due to padRight asymmetry)", () => {
    // right part longer than rightWidth → padRight appends "…" after width chars = width+1 chars
    const longRight = "b".repeat(R + 5)
    const result = formatDevice(`user@${longRight}`, opts)
    expect(result[L]).toBe("@")
    expect(result.slice(L + 1)).toBe("b".repeat(R) + "…") // R+1 chars (padRight asymmetry)
  })

  test("spec examples produce correct output", () => {
    // From the JSDoc examples (leftWidth=29, rightWidth=10):
    expect(formatDevice("openclaw@orthanc", opts)).toBe(
      "                     openclaw@orthanc   ",
    )
    expect(formatDevice("claude-code:ik_iakan@orthanc", opts)).toBe(
      "         claude-code:ik_iakan@orthanc   ",
    )
    expect(formatDevice("gemini:bewiser.assistant@erebor", opts)).toBe(
      "     gemini:bewiser.assistant@erebor    ",
    )
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
    expect(LOG_CONFIG.widths.tokens).toBe(10)
    expect(LOG_CONFIG.widths.device).toBe(40)
    expect(LOG_CONFIG.widths.deviceLeft).toBe(29)
    expect(LOG_CONFIG.widths.deviceRight).toBe(10)
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
      const result = (fn as (s: string) => string)("test")
      expect(typeof result).toBe("string")
    }
  })
})
