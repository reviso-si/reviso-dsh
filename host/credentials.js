/**
 * Shared Reviso credential resolution for the Host tool and HTTP routes.
 *
 * Primary source: DSH credential refs. OAuth access tokens are short-lived;
 * the refresh token rotates the access token before expiry or after one 401.
 * The personal workspace comes from `/api/workspaces`, the token-compatible
 * membership endpoint, not from the connection metadata.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const TOKEN_REF = 'REVISO_DSH_TOKEN'
export const WORKSPACE_REF = 'REVISO_DSH_WORKSPACE_ID'
export const SERVER_REF = 'REVISO_DSH_SERVER'
export const REFRESH_REF = 'REVISO_DSH_REFRESH_TOKEN'
export const EXPIRES_REF = 'REVISO_DSH_EXPIRES_AT'
export const CLIENT_REF = 'REVISO_DSH_CLIENT_ID'
export const CONNECTION_REF = 'REVISO_DSH_CONNECTION_ID'

const DEFAULT_SERVER = 'https://reviso.work'
const REFRESH_SKEW_MS = 60_000
const REQUEST_TIMEOUT_MS = 30_000

export async function readCredential(ctx, { forceRefresh = false } = {}) {
  let token = await optionalRef(ctx, TOKEN_REF)
  let server = normalizeServer(await optionalRef(ctx, SERVER_REF))
  let workspaceId = await optionalRef(ctx, WORKSPACE_REF)
  let refreshToken = await optionalRef(ctx, REFRESH_REF)
  let clientId = await optionalRef(ctx, CLIENT_REF)
  let expiresAt = normalizeExpiry(await optionalRef(ctx, EXPIRES_REF))
  let connectionId = await optionalRef(ctx, CONNECTION_REF)

  if (token !== '' && server !== '') {
    const shouldRefresh = refreshToken !== ''
      && (forceRefresh || (expiresAt > 0 && Date.now() >= expiresAt - REFRESH_SKEW_MS))
    if (shouldRefresh) {
      const refreshed = await refreshCredential(ctx, { server, refreshToken, clientId })
      token = refreshed.token
      refreshToken = refreshed.refreshToken
      expiresAt = refreshed.expiresAt
      connectionId = refreshed.connectionId
    }
    if (workspaceId === '') {
      workspaceId = await resolvePersonalWorkspace(server, token)
      await ctx.credentials.set(WORKSPACE_REF, workspaceId)
    }
    if (connectionId === '') {
      connectionId = await resolveConnectionId(server, token)
      if (connectionId !== '') await ctx.credentials.set(CONNECTION_REF, connectionId)
    }
    return { token, workspaceId, server, refreshToken, expiresAt, clientId, connectionId }
  }

  const cli = await readCliCredential(ctx, server)
  if (cli !== undefined) return cli

  throw new Error(
    'Reviso is not connected. Open the Reviso tab and connect, or run '
    + '`reviso auth login --server ' + DEFAULT_SERVER + '`.',
  )
}

export async function refreshCredential(ctx, { server, refreshToken, clientId }) {
  if (refreshToken === '') {
    throw new Error('Reviso access token expired and no refresh token is stored')
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    resource: `${server}/mcp`,
  })
  if (clientId !== '') body.set('client_id', clientId)
  const data = await oauthToken(server, body)
  const token = String(data.access_token || '')
  if (token === '') throw new Error('Reviso refresh response had no access_token')
  const nextRefresh = String(data.refresh_token || refreshToken)
  const expiresAt = expiryFrom(data)
  const connectionId = String(data.connection?.id || '')
    || await resolveConnectionId(server, token)
  if (connectionId === '') throw new Error('Reviso refresh response had no connection id')
  await storeCredential(ctx, {
    [TOKEN_REF]: token,
    [REFRESH_REF]: nextRefresh,
    [EXPIRES_REF]: String(expiresAt),
    [CONNECTION_REF]: connectionId,
  })
  return { token, refreshToken: nextRefresh, expiresAt, connectionId }
}

export async function storeCredential(ctx, values) {
  const previous = new Map()
  try {
    for (const [ref, value] of Object.entries(values)) {
      previous.set(ref, await optionalRef(ctx, ref))
      await ctx.credentials.set(ref, value)
    }
  } catch (error) {
    for (const [ref, old] of previous) {
      try {
        if (old === '') await ctx.credentials.unset(ref)
        else await ctx.credentials.set(ref, old)
      } catch {
        // Best-effort rollback; the status route still requires every ref.
      }
    }
    throw error
  }
}

export async function clearCredential(ctx) {
  for (const ref of [TOKEN_REF, WORKSPACE_REF, SERVER_REF, REFRESH_REF,
    EXPIRES_REF, CLIENT_REF, CONNECTION_REF]) {
    try {
      await ctx.credentials.unset(ref)
    } catch {
      // A read-only env layer may shadow a ref; clearing the rest still helps.
    }
  }
}

export async function resolvePersonalWorkspace(server, token) {
  const body = await revisoGet(server, '/api/workspaces', token)
  const rows = Array.isArray(body.workspaces) ? body.workspaces : []
  const personal = rows.find(row => row.workspace_type === 'personal')
  const workspaceId = String(personal?.workspace_id || '')
  if (workspaceId === '') throw new Error('Reviso account has no personal workspace')
  return workspaceId
}

export async function resolveConnectionId(server, token) {
  try {
    const body = await revisoGet(server, '/api/agent-connection/self', token)
    return String(body.connection?.id || '')
  } catch {
    return ''
  }
}

export async function optionalRef(ctx, ref) {
  const resolved = ctx.credentials?.resolve !== undefined
    ? await ctx.credentials.resolve(ref)
    : undefined
  return String(resolved?.value || process.env[ref] || '')
}

export function normalizeServer(value) {
  return String(value || '').replace(/\/+$/, '')
}

export function expiryFrom(tokenResponse) {
  const seconds = Number(tokenResponse.expires_in || 0)
  return seconds > 0 ? Date.now() + seconds * 1000 : 0
}

export function normalizeExpiry(value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  // DSH refs store milliseconds; the Reviso CLI stores epoch seconds.
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
}

async function readCliCredential(ctx, fallbackServer) {
  const path = process.env.REVISO_DSH_CLI_CREDENTIALS
    || join(process.env.REVISO_CONFIG_DIR || join(homedir(), '.config', 'reviso'), 'credentials.json')
  let document
  try {
    document = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
  const server = normalizeServer(fallbackServer || String(document.server || DEFAULT_SERVER))
  const entry = document?.servers?.[server]
  let token = String(entry?.access_token || '')
  if (token === '') return undefined
  let refreshToken = String(entry?.refresh_token || '')
  let clientId = String(entry?.client_id || '')
  let expiresAt = normalizeExpiry(entry?.expires_at)
  let connectionId = String(entry?.connection_id || '')
  if (expiresAt > 0 && Date.now() >= expiresAt - REFRESH_SKEW_MS && refreshToken !== '') {
    const refreshed = await refreshCredential(ctx, { server, refreshToken, clientId })
    token = refreshed.token
    refreshToken = refreshed.refreshToken
    expiresAt = refreshed.expiresAt
    connectionId = refreshed.connectionId
  }
  const workspaceId = String(entry?.workspace_id || '')
    || await resolvePersonalWorkspace(server, token)
  if (connectionId === '') connectionId = await resolveConnectionId(server, token)
  return {
    token,
    workspaceId,
    server,
    refreshToken,
    expiresAt,
    clientId,
    connectionId,
  }
}

async function revisoGet(server, path, token) {
  const response = await fetch(`${server}${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Reviso read failed (HTTP ${response.status}): ${text.slice(0, 300)}`)
  }
  return JSON.parse(text)
}

async function oauthToken(server, body) {
  const response = await fetch(`${server}/oauth/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Reviso token refresh failed (HTTP ${response.status}): ${text.slice(0, 200)}`)
  }
  return JSON.parse(text)
}
