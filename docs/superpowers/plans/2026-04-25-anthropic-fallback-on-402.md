# Anthropic Fallback on 402 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando o Copilot retorna 402 em `/v1/messages`, fazer fallback automático para `api.anthropic.com/v1/messages` usando credenciais OAuth de `.credentials.json`, com refresh automático do token.

**Architecture:** Três componentes: (1) `src/lib/anthropic-credentials.ts` — carrega, cacheia e refresha o OAuth token; (2) `src/services/anthropic/create-message.ts` — chama a Anthropic API com passthrough do payload; (3) `src/routes/messages/handler.ts` — try/catch em `createChatCompletions`, fallback em 402. O logger ganha campo `methodColor` para colorir o verbo em amarelo no fallback.

**Tech Stack:** Bun, TypeScript, Hono, `fetch-event-stream` (já instalado), `node:fs/promises`, `node:crypto`

> **Nota:** Este projeto não possui suite de testes. Verificação é feita via `bun run typecheck` e smoke test manual.

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `src/lib/logger.ts` | Modificar | Adicionar `methodColor?` a `RequestLogInfo` e `methodFallback` a `LOG_CONFIG.colors` |
| `src/lib/anthropic-credentials.ts` | Criar | Carregar `.credentials.json`, cachear, refreshar OAuth token, singleton in-flight |
| `src/services/anthropic/create-message.ts` | Criar | Chamar `api.anthropic.com/v1/messages` com auth OAuth, retornar streaming ou JSON |
| `src/routes/messages/handler.ts` | Modificar | try/catch em `createChatCompletions`, `handleAnthropicFallback`, `consumeAnthropicPassthroughStream` |

---

### Task 1: Extend logger with `methodColor`

**Files:**
- Modify: `src/lib/logger.ts`

- [ ] **Step 1: Adicionar `methodFallback` ao `LOG_CONFIG.colors` e `methodColor` ao `RequestLogInfo`**

Em `src/lib/logger.ts`, fazer as seguintes alterações:

```diff
// Em LOG_CONFIG.colors (após a linha `method: (s: string) => ansi.cyan(s),`):
+    methodFallback: (s: string) => ansi.yellow(s),
```

```diff
// Em RequestLogInfo (após `outputTokens?: number`):
+  methodColor?: (s: string) => string
```

```diff
// Em logRequest, linha:
-  const methodField = c.method(padRight(info.method, w.method))
+  const methodField = (info.methodColor ?? c.method)(padRight(info.method, w.method))
```

O arquivo final das três áreas modificadas deve ficar assim:

**`LOG_CONFIG.colors` (trecho):**
```ts
  colors: {
    date: (s: string) => ansi.dim(s),
    method: (s: string) => ansi.cyan(s),
    methodFallback: (s: string) => ansi.yellow(s),
    path: (s: string) => s,
    // ... demais entradas inalteradas
  },
```

**`RequestLogInfo` (trecho):**
```ts
export interface RequestLogInfo {
  method: string
  path: string
  status: number
  durationMs: number
  requestSizeKb?: number
  model?: string
  deviceId?: string
  inputTokens?: number
  outputTokens?: number
  methodColor?: (s: string) => string
}
```

**`logRequest` (trecho):**
```ts
  const methodField = (info.methodColor ?? c.method)(padRight(info.method, w.method))
```

- [ ] **Step 2: Verificar tipos**

```bash
bun run typecheck
```

Saída esperada: zero erros.

- [ ] **Step 3: Commit**

```bash
git add src/lib/logger.ts
git commit -m "feat(logger): add methodColor option to logRequest for fallback visual"
```

---

### Task 2: Criar `src/lib/anthropic-credentials.ts`

**Files:**
- Create: `src/lib/anthropic-credentials.ts`

- [ ] **Step 1: Criar o arquivo**

Criar `src/lib/anthropic-credentials.ts` com o seguinte conteúdo:

```ts
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

interface CredentialsFile {
  claudeAiOauth: {
    accessToken: string
    refreshToken: string
    expiresAt: number
    scopes: Array<string>
    subscriptionType: string
    rateLimitTier: string
  }
}

interface OAuthRefreshResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

const CREDENTIALS_PATH = join(process.cwd(), ".credentials.json")
const OAUTH_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token"
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const REFRESH_MARGIN_MS = 60_000

let cache: CredentialsFile["claudeAiOauth"] | undefined
let inflight: Promise<string> | undefined

async function loadCredentials(): Promise<CredentialsFile["claudeAiOauth"]> {
  let raw: string
  try {
    raw = await readFile(CREDENTIALS_PATH, "utf-8")
  } catch {
    throw new Error(
      `Anthropic credentials not found or invalid at ${CREDENTIALS_PATH}`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(
      `Anthropic credentials not found or invalid at ${CREDENTIALS_PATH}`,
    )
  }
  const creds = (parsed as CredentialsFile).claudeAiOauth
  if (!creds?.accessToken || !creds.refreshToken || !creds.expiresAt) {
    throw new Error(
      `Anthropic credentials not found or invalid at ${CREDENTIALS_PATH}`,
    )
  }
  return creds
}

async function doRefresh(
  current: CredentialsFile["claudeAiOauth"],
): Promise<string> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
      client_id: CLIENT_ID,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Anthropic OAuth refresh failed: ${response.status} ${body}`,
    )
  }

  const data = (await response.json()) as OAuthRefreshResponse
  const updated: CredentialsFile["claudeAiOauth"] = {
    ...current,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  cache = updated
  const file: CredentialsFile = { claudeAiOauth: updated }
  await writeFile(CREDENTIALS_PATH, JSON.stringify(file, null, "\t"), "utf-8")
  return updated.accessToken
}

export async function getValidAccessToken(): Promise<string> {
  if (!cache) {
    cache = await loadCredentials()
  }
  if (cache.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return cache.accessToken
  }
  if (!inflight) {
    inflight = doRefresh(cache).finally(() => {
      inflight = undefined
    })
  }
  return inflight
}
```

- [ ] **Step 2: Verificar tipos**

```bash
bun run typecheck
```

Saída esperada: zero erros.

- [ ] **Step 3: Commit**

```bash
git add src/lib/anthropic-credentials.ts
git commit -m "feat(lib): add anthropic-credentials with OAuth auto-refresh"
```

---

### Task 3: Criar `src/services/anthropic/create-message.ts`

**Files:**
- Create: `src/services/anthropic/create-message.ts`

- [ ] **Step 1: Criar o arquivo**

Criar `src/services/anthropic/create-message.ts` com o seguinte conteúdo:

```ts
import type { ServerSentEventMessage } from "fetch-event-stream"

import { events } from "fetch-event-stream"
import { randomUUID } from "node:crypto"

import { HTTPError } from "~/lib/error"
import { getValidAccessToken } from "~/lib/anthropic-credentials"
import type {
  AnthropicMessagesPayload,
  AnthropicResponse,
} from "~/routes/messages/anthropic-types"

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"

export async function createAnthropicMessage(
  payload: AnthropicMessagesPayload,
): Promise<{
  result:
    | AnthropicResponse
    | AsyncGenerator<ServerSentEventMessage, void, unknown>
  requestId: string
}> {
  const accessToken = await getValidAccessToken()
  const requestId = randomUUID()

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new HTTPError("Anthropic fallback request failed", response)
  }

  if (payload.stream) {
    return { result: events(response), requestId }
  }

  return { result: (await response.json()) as AnthropicResponse, requestId }
}
```

- [ ] **Step 2: Verificar tipos**

```bash
bun run typecheck
```

Saída esperada: zero erros.

- [ ] **Step 3: Commit**

```bash
git add src/services/anthropic/create-message.ts
git commit -m "feat(services): add createAnthropicMessage for direct Anthropic API calls"
```

---

### Task 4: Modificar `src/routes/messages/handler.ts`

**Files:**
- Modify: `src/routes/messages/handler.ts`

Esta task modifica o handler existente em três lugares:
1. Novos imports
2. Try/catch ao redor de `createChatCompletions`
3. Duas novas funções privadas: `handleAnthropicFallback` e `consumeAnthropicPassthroughStream`

- [ ] **Step 1: Adicionar imports ao topo do handler**

Localizar o bloco de imports de `~/services/copilot/create-chat-completions` e adicionar os novos imports logo abaixo:

```diff
 import {
   createChatCompletions,
   type ChatCompletionChunk,
   type ChatCompletionResponse,
 } from "~/services/copilot/create-chat-completions"

+import { createAnthropicMessage } from "~/services/anthropic/create-message"
+import { LOG_CONFIG } from "~/lib/logger"
+import type { AnthropicStreamEventData } from "./anthropic-types"
```

- [ ] **Step 2: Envolver `createChatCompletions` em try/catch**

Localizar o trecho:

```ts
  if (state.manualApprove) await awaitApproval()

  const { result, requestId, isAgentCall } =
    await createChatCompletions(openAIPayload)
  const requestSizeKb = payloadJson.length / 1024
```

Substituir por:

```ts
  if (state.manualApprove) await awaitApproval()

  let copilotResult: Awaited<ReturnType<typeof createChatCompletions>>
  try {
    copilotResult = await createChatCompletions(openAIPayload)
  } catch (error) {
    if (error instanceof HTTPError && error.response.status === 402) {
      return handleAnthropicFallback(c, anthropicPayload, {
        startTime,
        payloadJson,
        deviceId,
        sessionId,
        requestSizeKb: payloadJson.length / 1024,
      })
    }
    throw error
  }

  const { result, requestId, isAgentCall } = copilotResult
  const requestSizeKb = payloadJson.length / 1024
```

- [ ] **Step 3: Adicionar as funções `handleAnthropicFallback` e `consumeAnthropicPassthroughStream` ao final do arquivo**

Adicionar após a função `isNonStreaming` existente:

```ts
interface AnthropicFallbackBase {
  startTime: number
  payloadJson: string
  deviceId: string | undefined
  sessionId: string | undefined
  requestSizeKb: number
}

async function handleAnthropicFallback(
  c: Context,
  anthropicPayload: AnthropicMessagesPayload,
  base: AnthropicFallbackBase,
) {
  const { result, requestId } = await createAnthropicMessage(anthropicPayload)
  const isAgentCall = anthropicPayload.messages.some(
    (m) => m.role === "assistant",
  )

  if (isAnthropicStream(result)) {
    consola.debug("Anthropic fallback: streaming response")
    markRequestLogged(c.req.raw)
    return streamSSE(
      c,
      async (stream) => {
        const { inputTokens, outputTokens, finishReason, accumulatedContent } =
          await consumeAnthropicPassthroughStream(result, stream)
        const durationMs = Date.now() - base.startTime
        insertLog({
          timestamp: base.startTime,
          model: anthropicPayload.model,
          device_id: base.deviceId,
          session_id: base.sessionId,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          duration_ms: durationMs,
          request_body: base.payloadJson,
          response_body: accumulatedContent,
          finish_reason: finishReason,
          stream: true,
          is_agent_call: isAgentCall,
          cached_tokens: null,
          request_id: requestId,
          route: "anthropic-fallback",
          tools_count: anthropicPayload.tools?.length ?? 0,
          accepted_prediction_tokens: null,
          rejected_prediction_tokens: null,
        })
        logRequest({
          method: c.req.method,
          path: c.req.path,
          status: 200,
          durationMs,
          requestSizeKb: base.requestSizeKb,
          model: anthropicPayload.model,
          deviceId: base.deviceId,
          inputTokens,
          outputTokens,
          methodColor: LOG_CONFIG.colors.methodFallback,
        })
      },
      async (error, stream) => {
        consola.error("Anthropic fallback stream error:", error)
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({
            type: "error",
            error: { type: "api_error", message: error.message },
          }),
        })
      },
    )
  }

  consola.debug("Anthropic fallback: non-streaming response")
  const durationMs = Date.now() - base.startTime
  const inputTokens = result.usage.input_tokens
  const outputTokens = result.usage.output_tokens
  insertLog({
    timestamp: base.startTime,
    model: anthropicPayload.model,
    device_id: base.deviceId,
    session_id: base.sessionId,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    duration_ms: durationMs,
    request_body: base.payloadJson,
    response_body: JSON.stringify(result),
    finish_reason: result.stop_reason,
    stream: false,
    is_agent_call: isAgentCall,
    cached_tokens: null,
    request_id: requestId,
    route: "anthropic-fallback",
    tools_count: anthropicPayload.tools?.length ?? 0,
    accepted_prediction_tokens: null,
    rejected_prediction_tokens: null,
  })
  markRequestLogged(c.req.raw)
  logRequest({
    method: c.req.method,
    path: c.req.path,
    status: 200,
    durationMs,
    requestSizeKb: base.requestSizeKb,
    model: anthropicPayload.model,
    deviceId: base.deviceId,
    inputTokens,
    outputTokens,
    methodColor: LOG_CONFIG.colors.methodFallback,
  })
  return c.json(result)
}

async function consumeAnthropicPassthroughStream(
  result: AsyncGenerator<ServerSentEventMessage, void, unknown>,
  stream: { writeSSE: (msg: { event: string; data: string }) => Promise<void> },
): Promise<{
  inputTokens: number
  outputTokens: number
  finishReason: string | null
  accumulatedContent: string
}> {
  let inputTokens = 0
  let outputTokens = 0
  let finishReason: string | null = null
  let accumulatedContent = ""

  for await (const rawEvent of result) {
    consola.debug("Anthropic fallback raw event:", JSON.stringify(rawEvent))
    if (!rawEvent.data || rawEvent.data === "[DONE]") continue

    await stream.writeSSE({
      event: rawEvent.event ?? "message",
      data: rawEvent.data,
    })

    try {
      const parsed = JSON.parse(rawEvent.data) as AnthropicStreamEventData
      if (parsed.type === "message_start") {
        inputTokens = parsed.message.usage.input_tokens
      } else if (
        parsed.type === "content_block_delta"
        && parsed.delta.type === "text_delta"
      ) {
        accumulatedContent += parsed.delta.text
      } else if (parsed.type === "message_delta") {
        if (parsed.usage) outputTokens = parsed.usage.output_tokens
        if (parsed.delta.stop_reason) finishReason = parsed.delta.stop_reason
      }
    } catch {
      // ignore malformed events
    }
  }

  return { inputTokens, outputTokens, finishReason, accumulatedContent }
}

const isAnthropicStream = (
  result: Awaited<ReturnType<typeof createAnthropicMessage>>["result"],
): result is AsyncGenerator<ServerSentEventMessage, void, unknown> =>
  Symbol.asyncIterator in result
```

- [ ] **Step 4: Verificar tipos**

```bash
bun run typecheck
```

Saída esperada: zero erros.

- [ ] **Step 5: Smoke test manual**

Com o servidor rodando (`bun run dev`), fazer uma request para `/v1/messages` que force o fallback. Verificar no console:
- Verbo `POST` aparece em amarelo
- Resposta chega ao cliente normalmente

- [ ] **Step 6: Commit**

```bash
git add src/routes/messages/handler.ts
git commit -m "feat(messages): fallback to Anthropic API on Copilot 402"
```
