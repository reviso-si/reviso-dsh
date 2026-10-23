/**
 * Same-origin OAuth bridge for Reviso.
 *
 * The browser never sees a Reviso token. `/plugins/reviso/auth/start` performs
 * dynamic client registration + PKCE and redirects to Reviso; the callback
 * exchanges the code, stores REVISO_DSH_* refs in DSH credentials, and closes
 * the popup. Every route is admitted by the same authenticated DSH browser Peer
 * as `/api`; the wire headers alone never establish identity.
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  CLIENT_REF, CONNECTION_REF, EXPIRES_REF, REFRESH_REF, SERVER_REF, TOKEN_REF,
  WORKSPACE_REF, clearCredential, expiryFrom, normalizeServer, readCredential,
  resolveConnectionId, resolvePersonalWorkspace, storeCredential,
} from './credentials.js'
import { RevisoApiError, apiErrorPayload, errorFromResponse, messageOf } from './errors.js'
import { publishedGeneration } from './generation.js'

const DEFAULT_SERVER = 'https://reviso.work'
const PENDING_TTL_MS = 10 * 60 * 1000
const REQUEST_TIMEOUT_MS = 30_000
const JSON_BODY_LIMIT_BYTES = 64 * 1024
const MAX_PENDING_STATES = 32
const MAX_REGISTERED_CLIENTS = 16
const MUTATION_HEADER = 'x-reviso-dsh-request'
const MUTATION_HEADER_VALUE = '1'

class RevisoHttpError extends RevisoApiError {}

export function createOAuthBridge(ctx, options = {}) {
  if (ctx.webServer?.register === undefined) return () => {}

  const defaultServer = normalizeServer(options.server || DEFAULT_SERVER)
  if (defaultServer === '') throw new Error('Reviso bridge server must be an HTTPS origin')
  const pending = new Map()
  const clients = new Map()
  const activeEmbeds = new Set()
  const admission = bridgeAdmission(ctx)
  const disposers = [
    ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/reviso/auth/status',
      handler: (req, res) => handleStatus(ctx, req, res, admission),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/reviso/auth/start',
      handler: (req, res) => handleStart(ctx, req, res, defaultServer, pending, clients, admission),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/reviso/auth/callback',
      handler: (req, res) => handleCallback(ctx, req, res, pending),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/reviso/auth/logout',
      handler: (req, res) => handleLogout(ctx, req, res, admission, activeEmbeds),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/reviso/documents',
      handler: (req, res) => handleDocuments(ctx, req, res, admission),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/reviso/document',
      handler: (req, res) => handleDocument(ctx, req, res, admission),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/reviso/embed-session',
      handler: (req, res) => handleEmbedSession(ctx, req, res, admission, activeEmbeds),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/reviso/embed-session/revoke',
      handler: (req, res) => handleEmbedRevoke(ctx, req, res, admission, activeEmbeds),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/reviso/dashboard',
      handler: (req, res) => handleDashboard(ctx, req, res, admission),
    }),
  ]
  let disposed
  let disposing
  return async function disposeBridge() {
    if (disposed) return disposed
    if (disposing !== undefined) return disposing
    disposing = (async () => {
      const embedFailures = await revokeActiveEmbeds(ctx, activeEmbeds)
      for (const dispose of disposers) {
        try { await dispose() } catch {}
      }
      const embedRevoked = [...activeEmbeds].length === 0
      activeEmbeds.clear()
      await clearCredential(ctx)
      disposed = { connected: false, embedRevoked, embedFailures }
      return disposed
    })()
    return disposing
  }
}

async function handleStatus(ctx, req, res, admission) {
  if (!requireAdmission(req, res, admission)) return
  const token = await describe(ctx, TOKEN_REF)
  const server = await resolveRef(ctx, SERVER_REF)
  const workspaceId = await resolveRef(ctx, WORKSPACE_REF)
  const advertisedEmbedOrigin = token.configured
    ? await discoverEmbedOrigin(ctx, server).catch(() => resolveEmbedOrigin(server))
    : resolveEmbedOrigin(server)
  sendJson(res, 200, {
    connected: token.configured && server !== '' && workspaceId !== '',
    server,
    workspaceId,
    generation: publishedGeneration(server, workspaceId),
    capabilities: {
      embed: process.env.REVISO_DSH_EMBED_CAPABILITY || 'unknown',
      embedOrigin: advertisedEmbedOrigin,
    },
  })
}

async function handleDocuments(ctx, req, res, admission) {
  if (!requireAdmission(req, res, admission)) return
  try {
    const url = new URL(req.url || '', 'http://reviso-dsh.invalid')
    const sessionId = url.searchParams.get('session_id') || ''
    if (sessionId === '') throw new Error('session_id required')
    const body = await authenticatedGet(
      ctx,
      `/api/documents?session_key=dsh:${encodeURIComponent(sessionId)}`,
    )
    sendJson(res, 200, body)
  } catch (error) {
    sendError(res, error)
  }
}

async function handleDocument(ctx, req, res, admission) {
  if (!requireAdmission(req, res, admission)) return
  try {
    const url = new URL(req.url || '', 'http://reviso-dsh.invalid')
    const documentId = url.searchParams.get('id') || ''
    if (!/^[a-z]{2,4}_[0-9a-f]{12}$/u.test(documentId)) throw new Error('valid id required')
    const body = await authenticatedGet(
      ctx,
      `/api/documents/${encodeURIComponent(documentId)}/latest-content`,
    )
    sendJson(res, 200, body)
  } catch (error) {
    sendError(res, error)
  }
}

async function handleEmbedSession(ctx, req, res, admission, activeEmbeds) {
  if (!requireAdmission(req, res, admission, { mutation: true })) return
  if ((req.method || 'POST') !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }
  let body
  try {
    body = await readJsonRequest(req)
  } catch (error) {
    sendJson(res, 400, { error: messageOf(error) })
    return
  }
  const documentId = String(body.document_id || '')
  if (!/^[a-z]{2,4}_[0-9a-f]{12}$/.test(documentId)) {
    sendJson(res, 400, { error: 'valid document_id required' })
    return
  }
  try {
    const credential = await readCredential(ctx)
    const embedOrigin = await discoverEmbedOrigin(ctx, credential.server)
      .catch(() => resolveEmbedOrigin(credential.server))
    const hostOrigin = requestOrigin(ctx, req)
    const result = await authenticatedPost(
      ctx,
      `/api/embed/v1/documents/${encodeURIComponent(documentId)}/sessions`,
      {
        host: 'dsh',
        origin: hostOrigin,
        capabilities: ['read'],
        theme: normalizeTheme(body.theme),
        locale: String(body.locale || 'en').slice(0, 24),
      },
    )
    const validated = validateEmbedSession(result, embedOrigin, documentId)
    activeEmbeds.add(validated.session_id)
    sendJson(res, 200, validated)
  } catch (error) {
    sendError(res, error)
  }
}

async function handleEmbedRevoke(ctx, req, res, admission, activeEmbeds) {
  if (!requireAdmission(req, res, admission, { mutation: true })) return
  if ((req.method || 'POST') !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed', code: 'unsupported', retryable: false })
    return
  }
  let body
  try { body = await readJsonRequest(req) } catch (error) {
    sendJson(res, 400, apiErrorPayload(error))
    return
  }
  const sessionId = String(body.session_id || '')
  if (!/^ems_[0-9a-f]{12}$/u.test(sessionId)) {
    sendJson(res, 400, { error: 'valid session_id required', code: 'unsupported', retryable: false, status: 400 })
    return
  }
  try {
    const result = await authenticatedPost(
      ctx, `/api/embed/v1/sessions/${encodeURIComponent(sessionId)}/revoke`, {})
    activeEmbeds.delete(sessionId)
    sendJson(res, 200, result)
  } catch (error) { sendError(res, error) }
}

async function handleDashboard(ctx, req, res, admission) {
  if (!requireAdmission(req, res, admission)) return
  try {
    const credential = await readCredential(ctx)
    const url = new URL(req.url || '', 'http://reviso-dsh.invalid')
    const limit = boundedInteger(url.searchParams.get('limit'), 50, 1, 100)
    const offset = boundedInteger(url.searchParams.get('offset'), 0, 0, 1_000_000)
    const sourceKind = normalizeSourceKind(url.searchParams.get('source_kind'))
    const body = await authenticatedGet(
      ctx,
      `/api/dashboard/documents?workspace_id=${encodeURIComponent(credential.workspaceId)}`
      + `&limit=${String(limit)}&offset=${String(offset)}`
      + (sourceKind === '' ? '' : `&source_kind=${encodeURIComponent(sourceKind)}`),
    )
    sendJson(res, 200, body)
  } catch (error) {
    sendError(res, error)
  }
}

async function handleStart(ctx, req, res, defaultServer, pending, clients, admission) {
  // window.open performs a top-level GET and cannot attach a custom header.
  // The authenticated peer + consent screen remain the authorization boundary.
  if (!requireAdmission(req, res, admission)) return
  try {
    const server = defaultServer
    const origin = callbackOrigin(ctx, req)
    const redirectUri = `${origin}/plugins/reviso/auth/callback`
    const metadata = await oauthMetadata(server)
    const clientId = await registerClient(metadata, redirectUri, clients)
    const state = base64url(randomBytes(24))
    const verifier = base64url(randomBytes(32))
    pruneOAuthCaches(pending, clients)
    if (pending.size >= MAX_PENDING_STATES) pending.delete(pending.keys().next().value)
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
  // The provider redirect is a top-level cross-site navigation. An unguessable,
  // single-use state and PKCE authenticate this callback; it never reads creds.
  try {
    const url = new URL(req.url || '', 'http://reviso-dsh.invalid')
    const state = url.searchParams.get('state') || ''
    const code = url.searchParams.get('code') || ''
    const denied = url.searchParams.get('error')
    const entry = pending.get(state)
    pending.delete(state)
    if (entry === undefined || Date.now() - entry.createdAt > PENDING_TTL_MS) {
      throw new Error('OAuth state expired or unknown; restart the connection')
    }
    pruneOAuthCaches(pending)
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
    const connectionId = String(token.connection?.id || '')
      || await resolveConnectionId(entry.server, access)
    if (connectionId === '') throw new Error('Reviso token response had no connection id')
    const refresh = String(token.refresh_token || '')
    const expiresAt = expiryFrom(token)

    await storeCredential(ctx, {
      [TOKEN_REF]: access,
      [SERVER_REF]: entry.server,
      [WORKSPACE_REF]: workspaceId,
      [CLIENT_REF]: entry.clientId,
      ...(refresh !== '' ? { [REFRESH_REF]: refresh } : {}),
      ...(expiresAt > 0 ? { [EXPIRES_REF]: String(expiresAt) } : {}),
      [CONNECTION_REF]: connectionId,
    })
    renderConnected(res)
  } catch (error) {
    renderError(res, error)
  }
}

async function handleLogout(ctx, req, res, admission, activeEmbeds = new Set()) {
  if (!requireAdmission(req, res, admission, { mutation: true })) return
  let credential
  let credentialError = ''
  try {
    credential = await readCredential(ctx, { forceRefresh: true })
  } catch (error) {
    credentialError = messageOf(error)
  }
  const embedFailures = await revokeActiveEmbeds(ctx, activeEmbeds)
  let remoteRevoked = false
  let connectionFailure
  if (credential !== undefined) {
    try {
      const response = await fetch(
        `${credential.server}/api/agent-connection/self/revoke`,
        {
          method: 'POST',
          headers: { Accept: 'application/json', Authorization: `Bearer ${credential.token}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
      const text = await response.text()
      if (!response.ok) throw errorFromResponse(response.status, text)
      remoteRevoked = true
    } catch (error) {
      connectionFailure = failureDiagnostic(error)
    }
  }
  await clearCredential(ctx)
  sendJson(res, 200, {
    connected: false,
    remoteRevoked,
    embedRevoked: activeEmbeds.size === 0,
    embedFailures,
    ...(credentialError === '' ? {} : { message: credentialError }),
    ...(connectionFailure === undefined ? {} : { connectionFailure }),
  })
}

async function revokeActiveEmbeds(ctx, activeEmbeds) {
  const failures = []
  for (const sessionId of [...activeEmbeds]) {
    try {
      await authenticatedPost(ctx, `/api/embed/v1/sessions/${encodeURIComponent(sessionId)}/revoke`, {})
      activeEmbeds.delete(sessionId)
    } catch (error) {
      failures.push({ sessionId, ...failureDiagnostic(error) })
    }
  }
  return failures
}

function failureDiagnostic(error) {
  return {
    code: error instanceof RevisoApiError ? error.code : 'request_failed',
    status: error instanceof RevisoApiError ? error.status : 502,
    message: messageOf(error),
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
  if (cached !== undefined) {
    clients.delete(cacheKey)
    clients.set(cacheKey, cached)
    return cached
  }
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
  while (clients.size > MAX_REGISTERED_CLIENTS) clients.delete(clients.keys().next().value)
  return result.client_id
}

async function authenticatedGet(ctx, path) {
  let credential = await readCredential(ctx)
  let result = await revisoGetRaw(credential, path)
  if (result.status === 401 && credential.refreshToken !== '') {
    credential = await readCredential(ctx, { forceRefresh: true })
    result = await revisoGetRaw(credential, path)
  }
  if (result.status < 200 || result.status >= 300) {
    throw new RevisoHttpError(result.status, messageOf(errorFromResponse(result.status, result.text)))
  }
  return JSON.parse(result.text)
}

async function authenticatedPost(ctx, path, body) {
  let credential = await readCredential(ctx)
  let result = await revisoPostRaw(credential, path, body)
  if (result.status === 401 && credential.refreshToken !== '') {
    credential = await readCredential(ctx, { forceRefresh: true })
    result = await revisoPostRaw(credential, path, body)
  }
  if (result.status < 200 || result.status >= 300) {
    throw errorFromResponse(result.status, result.text)
  }
  return JSON.parse(result.text)
}

async function revisoGetRaw(credential, path) {
  return revisoRaw(credential, path, { method: 'GET' })
}

async function revisoPostRaw(credential, path, body) {
  return revisoRaw(credential, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function revisoRaw(credential, path, options) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${credential.server}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${credential.token}`,
        ...(options.headers || {}),
      },
      signal: controller.signal,
    })
    return { status: response.status, text: await response.text() }
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
    if (!response.ok) throw errorFromResponse(response.status, text)
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

function requestOrigin(ctx, req) {
  const expected = callbackOrigin(ctx, req)
  const origin = String(req.headers.origin || '')
  if (origin === '') return expected
  const parsed = new URL(origin)
  if ((parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.username === '' && parsed.password === ''
      && parsed.origin === expected) return parsed.origin
  throw new Error('browser origin does not match DSH origin')
}

function callbackOrigin(ctx, req) {
  try {
    const origin = ctx.webServer?.getOrigin?.()
    if (typeof origin === 'string' && origin !== '') return new URL(origin).origin
  } catch {}
  const host = String(req.headers.host || '')
  if (!isTrustedLoopbackAuthority(host)) throw new Error('loopback web origin required')
  return `http://${host}`
}

async function discoverEmbedOrigin(ctx, server) {
  const body = await authenticatedGet(ctx, '/api/config')
  const configured = normalizeServer(String(body.embed_origin || ''))
  if (configured !== '' && new URL(configured).protocol === 'https:') return configured
  return resolveEmbedOrigin(server)
}

function resolveEmbedOrigin(server) {
  const configured = normalizeServer(process.env.REVISO_DSH_EMBED_ORIGIN || '')
  if (configured !== '' && new URL(configured).protocol === 'https:') return configured
  const normalizedServer = normalizeServer(server)
  return normalizedServer === '' ? '' : new URL(normalizedServer).origin
}

function normalizeTheme(value) {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

function validateEmbedSession(result, embedOrigin, documentId) {
  if (typeof result !== 'object' || result === null) throw new Error('invalid embed session response')
  const sessionId = String(result.session_id || '')
  if (!/^ems_[0-9a-f]{12}$/u.test(sessionId)) throw new Error('invalid embed session id')
  if (String(result.document_id || '') !== documentId) throw new Error('embed session document mismatch')
  let embedUrl
  try { embedUrl = new URL(String(result.embed_url || '')) } catch { throw new Error('invalid embed session URL') }
  if (embedOrigin === '' || embedUrl.origin !== new URL(embedOrigin).origin) {
    throw new Error('embed session origin mismatch')
  }
  if (embedUrl.username !== '' || embedUrl.password !== '') throw new Error('embed session credentials forbidden')
  if (embedUrl.protocol !== 'https:') throw new Error('embed session HTTPS required')
  if (embedUrl.pathname !== `/embed/v1/documents/${documentId}`) {
    throw new Error('embed session path mismatch')
  }
  if (embedUrl.searchParams.get('session') !== sessionId) {
    throw new Error('embed session id mismatch')
  }
  const code = new URLSearchParams(embedUrl.hash.slice(1)).get('code') || ''
  if (!code.startsWith('rem_code_')) throw new Error('embed session code missing')
  return { ...result, session_id: sessionId, embed_url: embedUrl.toString() }
}

async function readJsonRequest(req) {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) {
      if (req.body.length > JSON_BODY_LIMIT_BYTES) throw new Error('request body too large')
      return JSON.parse(req.body.toString('utf8'))
    }
    if (typeof req.body === 'object') return req.body
    if (String(req.body).length > JSON_BODY_LIMIT_BYTES) throw new Error('request body too large')
    return JSON.parse(String(req.body))
  }
  let body = ''
  for await (const chunk of req) {
    body += Buffer.from(chunk).toString('utf8')
    if (body.length > JSON_BODY_LIMIT_BYTES) throw new Error('request body too large')
  }
  return JSON.parse(body || '{}')
}

function bridgeAdmission(ctx) {
  return req => {
    let connection
    try {
      connection = typeof ctx.get === 'function' ? ctx.get('connection') : ctx.connection
    } catch {
      connection = undefined
    }
    return connection?.admit?.(req)
  }
}

function requireAdmission(req, res, admit, { mutation = false } = {}) {
  if (!isLoopbackPeer(req)) {
    sendJson(res, 403, { error: 'loopback_required', code: 'forbidden', retryable: false, status: 403 })
    return false
  }
  if (admit !== undefined) {
    const value = admit(req)
    if (value?.rejection !== undefined) {
      sendJson(res, value.rejection, {
        error: value.rejection === 401 ? 'authentication_required' : 'request_forbidden',
        code: value.rejection === 401 ? 'auth_expired' : 'forbidden',
        retryable: false,
        status: value.rejection,
      })
      return false
    }
  }
  if (mutation && req.headers[MUTATION_HEADER] !== MUTATION_HEADER_VALUE) {
    sendJson(res, 403, { error: 'same-origin request header required', code: 'forbidden', retryable: false, status: 403 })
    return false
  }
  return true
}

function isLoopbackPeer(req) {
  const address = String(req.socket?.remoteAddress || '')
  if (address === '') return false
  const value = address.toLowerCase()
  return value === '::1' || value === '127.0.0.1' || value.startsWith('127.')
    || value === '::ffff:127.0.0.1'
}

function isTrustedLoopbackAuthority(value) {
  try {
    const url = new URL(`http://${value}`)
    const host = url.hostname.toLowerCase()
    return host === 'localhost' || host === '::1' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/u.test(host)
  } catch { return false }
}

function pruneOAuthCaches(pending, clients = undefined) {
  const now = Date.now()
  for (const [state, entry] of pending) {
    if (now - entry.createdAt > PENDING_TTL_MS) pending.delete(state)
  }
  if (pending.size > MAX_PENDING_STATES) {
    for (const state of pending.keys()) {
      if (pending.size <= MAX_PENDING_STATES) break
      pending.delete(state)
    }
  }
  if (clients !== undefined) {
    while (clients.size > MAX_REGISTERED_CLIENTS) clients.delete(clients.keys().next().value)
  }
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
<pre style="white-space:pre-wrap">${escapeHtml(messageOf(error))}</pre>
</body>`)
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function normalizeSourceKind(value) {
  return value === 'dsh' ? value : ''
}

function sendError(res, error, fallbackStatus = 502) {
  const status = error instanceof RevisoApiError ? error.status : fallbackStatus
  const payload = apiErrorPayload(error instanceof RevisoApiError ? error : new RevisoApiError(status, messageOf(error), {
    code: 'request_failed',
  }))
  sendJson(res, status, {
    ...payload,
    ...(error instanceof RevisoApiError && error.status === 404 ? { code: error.code || 'not_found' } : {}),
  })
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char])
}
