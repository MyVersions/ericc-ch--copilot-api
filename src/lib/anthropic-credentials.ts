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
    raw = await readFile(CREDENTIALS_PATH, "utf8")
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
  if (
    !creds.accessToken
    || !creds.refreshToken
    || typeof creds.expiresAt !== "number"
  ) {
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
  const file: CredentialsFile = { claudeAiOauth: updated }
  await writeFile(CREDENTIALS_PATH, JSON.stringify(file, null, "\t"), "utf8")
  cache = updated
  return updated.accessToken
}

export async function getValidAccessToken(): Promise<string> {
  if (!cache) {
    // eslint-disable-next-line require-atomic-updates
    cache = await loadCredentials()
  }
  const current = cache
  if (current.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return current.accessToken
  }
  if (!inflight) {
    inflight = doRefresh(current).finally(() => {
      inflight = undefined
    })
  }
  return inflight
}
