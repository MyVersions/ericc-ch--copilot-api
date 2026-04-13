#!/usr/bin/env node

import { defineCommand } from "citty"
import clipboard from "clipboardy"
import consola from "consola"
import { serve, type ServerHandler } from "srvx"
import invariant from "tiny-invariant"

import { setupErrorFileLogger } from "./lib/error-logger"
import { ensurePaths } from "./lib/paths"
import { initProxyFromEnv } from "./lib/proxy"
import { generateEnvScript } from "./lib/shell"
import { state } from "./lib/state"
import { setupCopilotToken, setupGitHubToken } from "./lib/token"
import { cacheModels, cacheVSCodeVersion } from "./lib/utils"
import { server } from "./server"
import { type Model } from "./services/copilot/get-models"

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

export async function runServer(options: RunServerOptions): Promise<void> {
  setupErrorFileLogger()

  if (options.proxyEnv) {
    initProxyFromEnv()
  }

  if (options.verbose) {
    consola.level = 5
    consola.info("Verbose logging enabled")
  }

  state.accountType = options.accountType
  if (options.accountType !== "individual") {
    consola.info(`Using ${options.accountType} plan GitHub account`)
  }

  state.manualApprove = options.manual
  state.rateLimitSeconds = options.rateLimit
  state.rateLimitWait = options.rateLimitWait
  state.showToken = options.showToken
  state.dashboardLogs = options.dashboardLogs

  await ensurePaths()
  await cacheVSCodeVersion()

  if (options.githubToken) {
    state.githubToken = options.githubToken
    consola.info("Using provided GitHub token")
  } else {
    await setupGitHubToken()
  }

  await setupCopilotToken()
  await cacheModels()

  consola.info(`Available models:\n${formatModels(state.models?.data ?? [])}`)

  const serverUrl = `http://localhost:${options.port}`

  if (options.claudeCode) {
    invariant(state.models, "Models should be loaded by now")

    const selectedModel = await consola.prompt(
      "Select a model to use with Claude Code",
      {
        type: "select",
        options: state.models.data.map((model) => model.id),
      },
    )

    const selectedSmallModel = await consola.prompt(
      "Select a small model to use with Claude Code",
      {
        type: "select",
        options: state.models.data.map((model) => model.id),
      },
    )

    const deviceName = await consola.prompt(
      "Enter a name to identify this machine (used for usage tracking)",
      { type: "text", default: "default" },
    )

    const authToken =
      !deviceName || deviceName.trim() === "" ? "dummy" : deviceName.trim()

    const command = generateEnvScript(
      {
        ANTHROPIC_BASE_URL: serverUrl,
        ANTHROPIC_AUTH_TOKEN: authToken,
        ANTHROPIC_MODEL: selectedModel,
        ANTHROPIC_DEFAULT_SONNET_MODEL: selectedModel,
        ANTHROPIC_SMALL_FAST_MODEL: selectedSmallModel,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: selectedSmallModel,
        DISABLE_NON_ESSENTIAL_MODEL_CALLS: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
      "claude",
    )

    try {
      clipboard.writeSync(command)
      consola.success("Copied Claude Code command to clipboard!")
    } catch {
      consola.warn(
        "Failed to copy to clipboard. Here is the Claude Code command:",
      )
      consola.log(command)
    }
  }

  consola.box(
    `🌐 Usage Viewer: https://ericc-ch.github.io/copilot-api?endpoint=${serverUrl}/usage`,
  )

  serve({
    fetch: server.fetch as ServerHandler,
    port: options.port,
    bun: { idleTimeout: 120 },
  })
}

const ANSI = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}

function formatModels(models: Array<Model>): string {
  const sorted = [...models].sort((a, b) => a.id.localeCompare(b.id))
  const maxIdLen = Math.max(...sorted.map((m) => m.id.length), 0)

  const groups = new Map<string, Array<Model>>()
  for (const m of sorted) {
    const vendor = m.vendor || "unknown"
    const group = groups.get(vendor) ?? []
    group.push(m)
    groups.set(vendor, group)
  }

  const lines: Array<string> = []
  for (const [vendor, vendorModels] of [...groups.entries()].sort()) {
    lines.push(ANSI.bold(`  ${vendor}`))
    for (const m of vendorModels) {
      const id = m.id.padEnd(maxIdLen)
      const ctxTokens = m.capabilities.limits.max_context_window_tokens
      const outTokens = m.capabilities.limits.max_output_tokens
      const ctx =
        ctxTokens !== undefined ?
          `ctx: ${Math.round(ctxTokens / 1000)}k`
        : "ctx: -"
      const out =
        outTokens !== undefined ?
          `out: ${Math.round(outTokens / 1000)}k`
        : "out: -"
      const tools =
        m.capabilities.supports.tool_calls ?
          ANSI.green("tools: ✓")
        : ANSI.red("tools: ✗")
      const preview = m.preview ? " " + ANSI.yellow("[preview]") : ""
      lines.push(
        `  - ${id}  ${ctx.padEnd(10)}  ${out.padEnd(9)}  ${tools}${preview}`,
      )
    }
  }

  return lines.join("\n")
}

export const start = defineCommand({
  meta: {
    name: "start",
    description: "Start the Copilot API server",
  },
  args: {
    port: {
      alias: "p",
      type: "string",
      default: "4141",
      description: "Port to listen on",
    },
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
    "account-type": {
      alias: "a",
      type: "string",
      default: "individual",
      description: "Account type to use (individual, business, enterprise)",
    },
    manual: {
      type: "boolean",
      default: false,
      description: "Enable manual request approval",
    },
    "rate-limit": {
      alias: "r",
      type: "string",
      description: "Rate limit in seconds between requests",
    },
    wait: {
      alias: "w",
      type: "boolean",
      default: false,
      description:
        "Wait instead of error when rate limit is hit. Has no effect if rate limit is not set",
    },
    "github-token": {
      alias: "g",
      type: "string",
      description:
        "Provide GitHub token directly (must be generated using the `auth` subcommand)",
    },
    "claude-code": {
      alias: "c",
      type: "boolean",
      default: false,
      description:
        "Generate a command to launch Claude Code with Copilot API config",
    },
    "show-token": {
      type: "boolean",
      default: false,
      description: "Show GitHub and Copilot tokens on fetch and refresh",
    },
    "dashboard-logs": {
      type: "boolean",
      default: false,
      description:
        "Enable logging of dashboard API requests (/dashboard/api/*)",
    },
    "proxy-env": {
      type: "boolean",
      default: false,
      description: "Initialize proxy from environment variables",
    },
  },
  run({ args }) {
    const rateLimitRaw = args["rate-limit"]
    const rateLimit =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      rateLimitRaw === undefined ? undefined : Number.parseInt(rateLimitRaw, 10)

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
  },
})
