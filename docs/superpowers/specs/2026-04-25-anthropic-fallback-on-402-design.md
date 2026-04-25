# Fallback para Anthropic em resposta 402 do Copilot

**Data:** 2026-04-25
**Escopo:** `/v1/messages` apenas

## Contexto

O endpoint `/v1/messages` traduz requests Anthropic → OpenAI, encaminha ao Copilot, e traduz a resposta de volta. Quando o Copilot retorna **402 Payment Required** (cota esgotada/sem assinatura), o cliente recebe erro. Este design adiciona fallback automático para a API oficial da Anthropic usando credenciais OAuth do Claude Code.

## Decisões fechadas no brainstorming

| # | Decisão |
|---|---------|
| 1 | Fallback aplicado **apenas em `/v1/messages`**. `/v1/chat/completions` e `/v1/embeddings` permanecem inalterados (continuam retornando 402 quando aplicável). |
| 2 | Credenciais OAuth lidas de `.credentials.json` no root do projeto. |
| 3 | Refresh automático do `accessToken` via `refreshToken` antes de expirar, com persistência de volta ao arquivo. |
| 4 | Fallback é **passthrough Anthropic → Anthropic** (nenhuma tradução de payload nem de resposta). |
| 5 | Modelo passado tal qual veio do cliente. |
| 6 | Streaming SSE preservado. |
| 7 | Sempre fazer fallback em 402 (sem flag opt-in). |
| 8 | Não prepender system prompt do Claude Code — payload passa exatamente como recebido. |

## Arquitetura

### Componentes novos

#### `src/lib/anthropic-credentials.ts`

Gerencia credenciais OAuth.

**Interface pública:**
```ts
export async function getValidAccessToken(): Promise<string>
```

**Comportamento:**
1. Carrega `.credentials.json` do `process.cwd()` lazy na primeira chamada, cacheia em memória.
2. Se `expiresAt - Date.now() > 60_000`, retorna `accessToken` do cache.
3. Caso contrário, dispara refresh:
   - `POST https://console.anthropic.com/v1/oauth/token`
   - Body: `{ grant_type: "refresh_token", refresh_token, client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e" }`
   - Resposta esperada: `{ access_token, refresh_token, expires_in }`
4. Atualiza cache (`accessToken`, `refreshToken`, `expiresAt = Date.now() + expires_in*1000`) e reescreve `.credentials.json` preservando o shape `{ claudeAiOauth: { ... } }`.
5. Margem de segurança: 60 segundos antes de `expiresAt` para evitar race em request longo.
6. **Concorrência:** singleton in-flight `Promise<string>`. Chamadas concorrentes durante refresh aguardam a mesma promise; só uma requisição de refresh é disparada.

**Erros:**
- Arquivo ausente/malformado → `Error("Anthropic credentials not found or invalid at <path>")`.
- Refresh retorna não-2xx → `Error("Anthropic OAuth refresh failed: <status> <body>")`.

#### `src/services/anthropic/create-message.ts`

Chamada direta à Anthropic Messages API.

**Interface pública:**
```ts
export async function createAnthropicMessage(
  payload: AnthropicMessagesPayload
): Promise<{
  result:
    | AnthropicMessageResponse
    | AsyncGenerator<ServerSentEventMessage, void, unknown>
  requestId: string
}>
```

**Comportamento:**
1. Obtém access token via `getValidAccessToken()`.
2. Gera `requestId` (UUID) para logging.
3. `POST https://api.anthropic.com/v1/messages` com headers:
   - `Authorization: Bearer <accessToken>`
   - `anthropic-beta: oauth-2025-04-20`
   - `anthropic-version: 2023-06-01`
   - `content-type: application/json`
4. Body: `JSON.stringify(payload)` exato (sem mutação).
5. Se resposta `!ok`, lança `HTTPError` (mesma classe usada pelos serviços Copilot, propaga via `forwardError`).
6. Se `payload.stream === true`, retorna `events(response)` como `result`. Caso contrário, retorna o JSON parseado.

#### Modificações em `src/routes/messages/handler.ts`

Try/catch envolvendo `createChatCompletions`. Em `HTTPError` com `status === 402`, dispara fluxo de fallback.

**Pseudo-código:**
```ts
let copilotResult
try {
  copilotResult = await createChatCompletions(openAIPayload)
} catch (error) {
  if (error instanceof HTTPError && error.response.status === 402) {
    return handleAnthropicFallback(c, anthropicPayload, /* logBase parts */)
  }
  throw error
}
// ... fluxo existente segue inalterado usando copilotResult
```

**`handleAnthropicFallback`:**
- Chama `createAnthropicMessage(anthropicPayload)`.
- Se streaming: usa `streamSSE` para encaminhar cada `ServerSentEventMessage` cru ao cliente. Acumula `accumulatedContent` extraindo `delta.text` dos eventos `content_block_delta` para logging. Lê `usage` final do evento `message_delta` ou `message_stop`.
- Se não-streaming: `c.json(response)` direto.
- Logging: `insertLog` + `logRequest` com `route: "anthropic-fallback"`, mesmo formato dos demais.

### Fluxo de dados

**Caminho normal (Copilot OK):**
```
Client → /v1/messages → handler → translateToOpenAI → createChatCompletions (Copilot)
       ← translateToAnthropic ← response
```

**Caminho com fallback (Copilot 402):**
```
Client → /v1/messages → handler → translateToOpenAI → createChatCompletions
                                                            ↓ HTTPError 402 (capturado)
                                  → createAnthropicMessage(anthropicPayload original)
                                                            ↓
                                                  api.anthropic.com/v1/messages
                                                            ↓
       ← passthrough JSON ou SSE ← response (sem tradução)
```

## Tratamento de erros

| Cenário | Comportamento |
|---------|--------------|
| Copilot retorna status ≠ 402 (4xx/5xx) | `forwardError` retorna o status original (sem fallback). |
| Copilot retorna 402 e fallback Anthropic OK | Cliente recebe 200 com resposta da Anthropic. |
| Copilot 402 + Anthropic 4xx/5xx | `HTTPError` da Anthropic propaga para `forwardError`; cliente recebe o status real da Anthropic. |
| Copilot 402 + `.credentials.json` ausente/malformado | `Error` propaga, `forwardError` retorna 500. |
| Copilot 402 + refresh OAuth falha | `Error` propaga, `forwardError` retorna 500. Usuário precisa regerar `.credentials.json`. |
| Falha no meio do streaming Anthropic | Handler `onError` do `streamSSE` escreve evento `error` no SSE (já existe). |

## Logging

- `route: "anthropic-fallback"` distingue requests servidos pelo fallback dos servidos pelo Copilot.
- `request_id` novo (UUID gerado em `createAnthropicMessage`).
- `input_tokens` / `output_tokens` lidos de `usage.input_tokens` / `usage.output_tokens` da Anthropic (não `prompt_tokens` / `completion_tokens` como no OpenAI).
- `tools_count` derivado de `anthropicPayload.tools?.length ?? 0`.
- `cached_tokens`: deixar `null` (Anthropic expõe `cache_read_input_tokens` separado, fora do escopo desta primeira versão).

## Não-objetivos

- Fallback em `/v1/chat/completions` ou `/v1/embeddings`.
- Tradução de formato OpenAI ↔ Anthropic no fallback.
- UI/CLI para gerenciar credenciais Anthropic (assume-se que `.credentials.json` é gerado externamente, ex.: copiado do Claude Code).
- Métricas de cache hit (`cache_read_input_tokens`).
- Retry/backoff em falhas transitórias da Anthropic.
- Suporte a outras strategies de fallback (configurável, multi-provider, etc.).

## Tipos novos

```ts
// Em anthropic-credentials.ts
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

// Em services/anthropic/create-message.ts (mínimo)
interface AnthropicMessageResponse {
  id: string
  type: "message"
  role: "assistant"
  model: string
  content: Array<{ type: string; text?: string; [k: string]: unknown }>
  stop_reason: string | null
  stop_sequence: string | null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
}
```

`AnthropicMessagesPayload` já existe em `src/routes/messages/anthropic-types.ts` e será reusado.

## Arquivos tocados

- **Novo:** `src/lib/anthropic-credentials.ts`
- **Novo:** `src/services/anthropic/create-message.ts`
- **Modificado:** `src/routes/messages/handler.ts` (try/catch + função `handleAnthropicFallback`)
- **Modificado obrigatório:** `.gitignore` — adicionar `.credentials.json` (atualmente o arquivo **não** está ignorado e contém OAuth tokens; commitar seria vazamento de credencial).

## Itens a verificar na implementação

- **Endpoint de refresh OAuth:** Este design assume `https://console.anthropic.com/v1/oauth/token` e `client_id = 9d1c250a-e61b-44d9-88ed-5944d1962f5e` baseado no fluxo conhecido do Claude Code. Validar empiricamente com um refresh real antes de finalizar.
- **Headers obrigatórios:** Confirmar se `anthropic-beta: oauth-2025-04-20` é suficiente ou se OAuth tokens exigem outros headers (ex.: `anthropic-dangerous-direct-browser-access`).
