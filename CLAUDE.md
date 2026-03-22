# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`copilot-api` is a reverse-engineered proxy that exposes GitHub Copilot as an OpenAI-compatible and Anthropic-compatible API. It handles GitHub OAuth, Copilot token management, and format translation between OpenAI/Anthropic request formats and GitHub's internal Copilot API.

**Runtime:** Bun (not Node.js — use `bun` for all commands)

## Commands

```bash
# Development
bun run dev          # Watch mode
bun run start        # Production (NODE_ENV=production)

# Build
bun run build        # Compile with tsdown → dist/

# Code quality
bun run lint         # ESLint (cached)
bun run lint:all     # ESLint (full, no cache)
bun run typecheck    # TypeScript type check (no emit)
bun run knip         # Detect unused exports/files
```

No test suite exists in this project.

## Architecture

### Request Flow

```
CLI (citty) → start.ts → server.ts (Hono)
                              ↓
                         Route handlers (src/routes/)
                              ↓
                    Rate limit → Manual approval
                              ↓
                    Services (src/services/)
                              ↓
                    GitHub Copilot API
```

### CLI Commands (`src/main.ts`)

Four subcommands via `citty`:
- `start` — configures and launches the HTTP server
- `auth` — runs GitHub device code OAuth flow only
- `check-usage` — displays Copilot quota stats
- `debug` — prints diagnostic information

### Server (`src/server.ts`)

Hono app with CORS and logging middleware. Routes registered:
- `POST /v1/chat/completions` — OpenAI-compatible chat
- `GET /v1/models` — list models
- `POST /v1/embeddings` — embeddings
- `POST /v1/messages` — Anthropic-compatible messages (format-translated)
- `POST /v1/messages/count_tokens` — Anthropic token counting
- `GET /usage` — Copilot quota
- `GET /token` — current Copilot token

### Global State (`src/lib/state.ts`)

Single mutable state object holds: GitHub token, Copilot token, available models, VSCode version, rate limit config, and manual approval flag. All routes and services read from this object.

### Token Management (`src/lib/token.ts`)

- GitHub token: persisted to `~/.local/share/copilot-api/github_token`
- Copilot token: fetched from GitHub's internal endpoint, auto-refreshed before expiry
- Tokens stored in global state after fetch

### Anthropic ↔ OpenAI Translation (`src/routes/messages/`)

The `/v1/messages` route translates Anthropic API requests to OpenAI format (sent to Copilot), then translates responses back. Key files:
- `non-stream-translation.ts` — full response conversion
- `stream-translation.ts` — SSE event-by-event conversion
- `anthropic-types.ts` — local type definitions for Anthropic format

### Services (`src/services/`)

- `github/` — OAuth device flow, token fetching, usage stats
- `copilot/` — chat completions, model listing, embeddings (all forward to GitHub's Copilot API)

## Path Aliases

`~/` maps to `./src/` (configured in `tsconfig.json`). Use `~/lib/state` instead of `../../lib/state`.

## Key Dependencies

- `hono` — web framework
- `citty` — CLI command routing
- `gpt-tokenizer` — token counting (o200k_base, cl100k_base encodings)
- `zod` v4 — schema validation
- `consola` — structured logging
- `fetch-event-stream` — SSE streaming
- `srvx` — HTTP server adapter for Hono
