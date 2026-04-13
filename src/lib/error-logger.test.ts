import { expect, test, describe } from "bun:test"

// We test the exported helpers directly, not the full consola integration.
// Import after we have the exports wired up.
import {
  buildFilename,
  formatMarkdown,
  type ErrorLogData,
} from "./error-logger"

// ─── buildFilename ────────────────────────────────────────────────────────────

describe("buildFilename", () => {
  test("includes http status code after 'error-'", () => {
    const name = buildFilename(429, "2026-04-13T14-22-05-123Z", "0001")
    expect(name).toMatch(/^error-429-/)
  })

  test("defaults to 500 when status is null", () => {
    const name = buildFilename(null, "2026-04-13T14-22-05-123Z", "0001")
    expect(name).toMatch(/^error-500-/)
  })

  test("ends with .md extension", () => {
    const name = buildFilename(429, "2026-04-13T14-22-05-123Z", "0001")
    expect(name).toMatch(/\.md$/)
  })

  test("full pattern: error-<code>-<ts>-<seq>.md", () => {
    const name = buildFilename(503, "2026-04-13T14-22-05-123Z", "0003")
    expect(name).toBe("error-503-2026-04-13T14-22-05-123Z-0003.md")
  })
})

// ─── formatMarkdown ───────────────────────────────────────────────────────────

describe("formatMarkdown", () => {
  const baseData: ErrorLogData = {
    timestamp: "2026-04-13T14:22:05.123Z",
    httpStatus: 429,
    errorName: "HTTPError",
    errorMessage: "Failed to create chat completions",
    stackTrace:
      "HTTPError: Failed to create chat completions\n    at createChatCompletions (src/services/copilot/create-chat-completions.ts:39)",
    clientMethod: "POST",
    clientPath: "/v1/messages",
    clientBody: '{"model":"claude-sonnet-4-5","messages":[]}',
  }

  test("starts with # 🔴 ERROR <status>", () => {
    const md = formatMarkdown(baseData)
    expect(md).toMatch(/^# 🔴 ERROR 429/)
  })

  test("includes timestamp", () => {
    const md = formatMarkdown(baseData)
    expect(md).toContain("2026-04-13T14:22:05.123Z")
  })

  test("includes route", () => {
    const md = formatMarkdown(baseData)
    expect(md).toContain("POST /v1/messages")
  })

  test("includes error name and message as blockquote", () => {
    const md = formatMarkdown(baseData)
    expect(md).toContain("> HTTPError: Failed to create chat completions")
  })

  test("client body is in a json fenced block", () => {
    const md = formatMarkdown(baseData)
    expect(md).toContain("```json")
    // parsed and pretty-printed
    expect(md).toContain('"model": "claude-sonnet-4-5"')
  })

  test("no copilot request section when copilotRequestUrl absent", () => {
    const md = formatMarkdown(baseData)
    expect(md).not.toContain("## Copilot Request")
  })

  test("no copilot response section when upstream absent", () => {
    const md = formatMarkdown(baseData)
    expect(md).not.toContain("## Copilot Response")
  })

  test("includes copilot request section when copilotRequestUrl present", () => {
    const md = formatMarkdown({
      ...baseData,
      copilotRequestUrl: "https://api.githubcopilot.com/chat/completions",
      copilotRequestHeaders: {
        Authorization: "Bearer ghu_test",
        "content-type": "application/json",
      },
      copilotRequestBody: { model: "gpt-4o", messages: [] },
    })
    expect(md).toContain("## Copilot Request")
    expect(md).toContain("https://api.githubcopilot.com/chat/completions")
    expect(md).toContain('"model": "gpt-4o"')
  })

  test("includes copilot response section when upstream present", () => {
    const md = formatMarkdown({
      ...baseData,
      upstream: { message: "Rate limit exceeded" },
    })
    expect(md).toContain("## Copilot Response")
    expect(md).toContain('"message": "Rate limit exceeded"')
  })

  test("non-JSON client body renders in plain fenced block", () => {
    const md = formatMarkdown({
      ...baseData,
      clientBody: "not json {{",
    })
    // Should have a plain ``` block (not ```json) for the body
    expect(md).toContain("not json {{")
  })

  test("uses 500 status in header when httpStatus is null", () => {
    const md = formatMarkdown({ ...baseData, httpStatus: null })
    expect(md).toMatch(/^# 🔴 ERROR 500/)
  })

  test("strips first line of stack trace when it duplicates errorName: message", () => {
    const md = formatMarkdown(baseData)
    // stackTrace starts with "HTTPError: Failed to create chat completions\n    at ..."
    // The first line should be stripped (already shown in blockquote)
    expect(md).not.toContain(
      "HTTPError: Failed to create chat completions\n    at",
    )
    // But the at-line should still be present
    expect(md).toContain("    at createChatCompletions")
  })
})
