/**
 * Same-origin OAuth bridge for Reviso.
 *
 * The browser never sees a Reviso token. `/plugins/reviso/auth/start` performs
 * dynamic client registration + PKCE and redirects to Reviso; the callback
 * exchanges the code, stores REVISO_DSH_* refs in DSH credentials, and closes
 * the popup. Routes are loopback-only, matching the DSH /api trust boundary.
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  CLIENT_REF, CONNECTION_REF, EXPIRES_REF, REFRESH_REF, SERVER_REF, TOKEN_REF,
  WORKSPACE_REF, clearCredential, expiryFrom, normalizeServer, readCredential,
  resolveConnectionId, resolvePersonalWorkspace, storeCredential,
} from './credentials.js'

const DEFAULT_SERVER = 'https://reviso.work'
const PENDING_TTL_MS = 10 * 60 * 1000
const REQUEST_TIMEOUT_MS = 30_000

export function createOAuthBridge(ctx, options = {}) {
  if (ctx.webServer?.register === undefined) return () => {}

  const defaultServer = normalizeServer(options.server || DEFAULT_SERVER)
  const pending = new Map()
  const clients = new Map()
  const disposers = [
    ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/reviso/auth/status',
      handler: (req, res) => handleStatus(ctx, req, res),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/reviso/auth/start',
      handler: (req, res) => handleStart(ctx, req, res, defaultServer, pending, clients),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/reviso/auth/callback',
      handler: (req, res) => handleCallback(ctx, req, res, pending),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/reviso/auth/logout',
      handler: (req, res) => handleLogout(ctx, req, res),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/reviso/documents',
      handler: (req, res) => handleDocuments(ctx, req, res),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/reviso/dashboard',
      handler: (req, res) => handleDashboard(ctx, req, res),
    }),
  ]
  return () => { for (const dispose of disposers) dispose() }
}

async function handleStatus(ctx, req, res) {
  if (!isLoopback(req)) return forbidden(res)
  const token = await describe(ctx, TOKEN_REF)
  const server = await resolveRef(ctx, SERVER_REF)
  const workspaceId = await resolveRef(ctx, WORKSPACE_REF)
  sendJson(res, 200, {
    connected: token.configured && server !== '' && workspaceId !== '',
    server,
    workspaceId,
  })
}

async function handleDocuments(ctx, req, res) {
  if (!isLoopback(req)) return forbidden(res)
  try {
    const url = new URL(req.url || '', `http://${req.headers.host || '127.0.0.1'}`)
    const sessionId = url.searchParams.get('session_id') || ''
    if (sessionId === '') throw new Error('session_id required')
    const credential = await readCredential(ctx)
    const body = await revisoGet(
      credential,
      `/api/documents?session_key=dsh:${encodeURIComponent(sessionId)}`,
    )
    sendJson(res, 200, body)
  } catch (error) {
    sendJson(res, 502, { error: messageOf(error) })
  }
}

async function handleDashboard(ctx, req, res) {
  if (!isLoopback(req)) return forbidden(res)
  try {
    const credential = await readCredential(ctx)
    const url = new URL(req.url || '', `http://${req.headers.host || '127.0.0.1'}`)
    const limit = url.searchParams.get('limit') || '50'
    const body = await revisoGet(
      credential,
      `/api/dashboard/documents?workspace_id=${encodeURIComponent(credential.workspaceId)}`
      + `&limit=${encodeURIComponent(limit)}`,
    )
    sendJson(res, 200, body)
  } catch (error) {
    sendJson(res, 502, { error: messageOf(error) })
  }
}

async function handleStart(ctx, req, res, defaultServer, pending, clients) {
  if (!isLoopback(req)) return forbidden(res)
  try {
    const server = defaultServer
    const origin = `http://${req.headers.host}`
    const redirectUri = `${origin}/plugins/reviso/auth/callback`
    const metadata = await oauthMetadata(server)
    const clientId = await registerClient(metadata, redirectUri, clients)
    const state = base64url(randomBytes(24))
    const verifier = base64url(randomBytes(32))
    pending.set(state, {
      server,
      redirectUri,
      clientId,
      verifier,
      tokenEndpoint: metadata.token_endpoint,
      createdAt: Date.now(),
    })
    const authorize = new URL(metadata.authorization_endpoint)
    authorize.searchParams.set('response_type', 'code')
    authorize.searchParams.set('client_id', clientId)
    authorize.searchParams.set('redirect_uri', redirectUri)
    authorize.searchParams.set('resource', `${server}/mcp`)
    authorize.searchParams.set('scope', 'mcp')
    authorize.searchParams.set('state', state)
    authorize.searchParams.set('code_challenge', challenge(verifier))
    authorize.searchParams.set('code_challenge_method', 'S256')
    authorize.searchParams.set('client_kind', 'dsh')
    res.writeHead(302, { Location: authorize.toString(), 'Cache-Control': 'no-store' })
    res.end()
  } catch (error) {
    renderError(res, error)
  }
}

async function handleCallback(ctx, req, res, pending) {
  if (!isLoopback(req)) return forbidden(res)
  try {
    const url = new URL(req.url || '', `http://${req.headers.host || '127.0.0.1'}`)
    const state = url.searchParams.get('state') || ''
    const code = url.searchParams.get('code') || ''
    const denied = url.searchParams.get('error')
    const entry = pending.get(state)
    pending.delete(state)
    if (entry === undefined || Date.now() - entry.createdAt > PENDING_TTL_MS) {
      throw new Error('OAuth state expired or unknown; restart the connection')
    }
    if (denied) throw new Error(`Reviso authorization denied (${denied})`)
    if (code === '') throw new Error('Reviso authorization returned no code')

    const token = await oauthJson(entry.tokenEndpoint, {
      grant_type: 'authorization_code',
      client_id: entry.clientId,
      redirect_uri: entry.redirectUri,
      resource: `${entry.server}/mcp`,
      code,
      code_verifier: entry.verifier,
    }, true)
    const access = String(token.access_token || '')
    if (access === '') throw new Error('Reviso token response had no access_token')
    const workspaceId = await resolvePersonalWorkspace(entry.server, access)
    const connectionId = await resolveConnectionId(entry.server, access)
    const refresh = String(token.refresh_token || '')
    const expiresAt = expiryFrom(token)

    await storeCredential(ctx, {
      [TOKEN_REF]: access,
      [SERVER_REF]: entry.server,
      [WORKSPACE_REF]: workspaceId,
      [CLIENT_REF]: entry.clientId,
      ...(refresh !== '' ? { [REFRESH_REF]: refresh } : {}),
      ...(expiresAt > 0 ? { [EXPIRES_REF]: String(expiresAt) } : {}),
      ...(connectionId !== '' ? { [CONNECTION_REF]: connectionId } : {}),
    })
    renderConnected(res)
  } catch (error) {
    renderError(res, error)
  }
}

async function handleLogout(ctx, req, res) {
  if (!isLoopback(req)) return forbidden(res)
  try {
    const token = await resolveRef(ctx, TOKEN_REF)
    const server = normalizeServer(await resolveRef(ctx, SERVER_REF))
    const connectionId = await resolveRef(ctx, CONNECTION_REF)
    if (token !== '' && server !== '' && connectionId !== '') {
      const response = await fetch(
        `${server}/api/agent/connections/${encodeURIComponent(connectionId)}/revoke`,
        {
          method: 'POST',
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
      if (!response.ok && response.status !== 404) {
        const text = await response.text()
        throw new Error(`Reviso revoke failed (HTTP ${response.status}): ${text.slice(0, 200)}`)
      }
    }
    await clearCredential(ctx)
    sendJson(res, 200, { connected: false })
  } catch (error) {
    sendJson(res, 502, { error: messageOf(error) })
  }
}

async function oauthMetadata(server) {
  const data = await oauthJson(`${server}/.well-known/oauth-authorization-server`)
  for (const field of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
    if (typeof data[field] !== 'string' || !data[field].startsWith(`${server}/`)) {
      throw new Error(`Reviso OAuth metadata has an invalid ${field}`)
    }
  }
  if (!Array.isArray(data.code_challenge_methods_supported)
    || !data.code_challenge_methods_supported.includes('S256')) {
    throw new Error('Reviso OAuth server does not support PKCE S256')
  }
  return data
}

async function registerClient(metadata, redirectUri, clients) {
  const cacheKey = `${metadata.registration_endpoint}|${redirectUri}`
  const cached = clients.get(cacheKey)
  if (cached !== undefined) return cached
  const result = await oauthJson(metadata.registration_endpoint, {
    client_name: 'Reviso for DeepSeek Harness',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  })
  if (typeof result.client_id !== 'string' || result.client_id === '') {
    throw new Error('Reviso client registration returned no client_id')
  }
  clients.set(cacheKey, result.client_id)
  return result.client_id
}

async function revisoGet(credential, path) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${credential.server}${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${credential.token}` },
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`Reviso read failed (HTTP ${response.status}): ${text.slice(0, 300)}`)
    }
    return JSON.parse(text)
  } finally {
    clearTimeout(timer)
  }
}

async function oauthJson(url, body, form = false) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : {
          'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
        }),
      },
      ...(body === undefined ? {} : {
        body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
      }),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`Reviso OAuth request failed (HTTP ${response.status}): ${text.slice(0, 200)}`)
    }
    return JSON.parse(text)
  } finally {
    clearTimeout(timer)
  }
}

async function describe(ctx, ref) {
  return ctx.credentials.describe(ref)
}

async function resolveRef(ctx, ref) {
  const resolved = await ctx.credentials.resolve(ref)
  return resolved?.value || ''
}

function challenge(verifier) {
  return base64url(createHash('sha256').update(verifier).digest())
}

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url')
}

function isLoopback(req) {
  const host = String(req.headers.host || '')
  const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname.toLowerCase())) return false
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false
  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      if (new URL(String(origin)).host !== host) return false
    } catch {
      return false
    }
  }
  return true
}

function forbidden(res) {
  sendJson(res, 403, { error: 'loopback_required' })
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

function renderConnected(res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(`<!doctype html><meta charset="utf-8"><title>Reviso connected</title>
<body style="font:14px system-ui;padding:24px">
<p>Reviso connected.</p>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'reviso-dsh:connected' }, window.location.origin)
    window.close()
  }
</script>
</body>`)
}

function renderError(res, error) {
  res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(`<!doctype html><meta charset="utf-8"><title>Reviso connection failed</title>
<body style="font:14px system-ui;padding:24px">
<p>Reviso connection failed.</p>
<pre style="white-space:pre-wrap">${escapeHtml(error instanceof Error ? error.message : String(error))}</pre>
</body>`)
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char])
}
