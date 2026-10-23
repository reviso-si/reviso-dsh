import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOAuthBridge } from '../host/oauth.js'

function response() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers = {}) {
      this.status = status
      this.headers = headers
    },
    end(body = '') {
      this.body += body
    },
  }
}

function request(url, host = '127.0.0.1:3080', options = {}) {
  return {
    url,
    headers: { host, ...(options.headers || {}) },
    socket: { remoteAddress: options.remoteAddress || '127.0.0.1' },
  }
}

function setupBridge() {
  const routes = new Map()
  const values = new Map()
  let dispose
  const ctx = {
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    credentials: {
      async describe(ref) {
        return { configured: values.has(ref), writable: true }
      },
      async resolve(ref) {
        return values.has(ref) ? { value: values.get(ref), source: 'file' } : undefined
      },
      async set(ref, value) {
        values.set(ref, value)
      },
      async unset(ref) {
        values.delete(ref)
      },
    },
  }
  dispose = createOAuthBridge(ctx, { server: 'https://reviso.work' })
  return { routes, values, dispose: () => dispose() }
}

function installFetch(control = {}) {
  const calls = []
  const saved = globalThis.fetch
  globalThis.fetch = async (url, requestOptions = {}) => {
    calls.push({ url: String(url), options: requestOptions })
    if (String(url).endsWith('/.well-known/oauth-authorization-server')) {
      return json(200, {
        issuer: 'https://reviso.work',
        authorization_endpoint: 'https://reviso.work/oauth/authorize',
        token_endpoint: 'https://reviso.work/oauth/token',
        registration_endpoint: 'https://reviso.work/oauth/register',
        code_challenge_methods_supported: ['S256'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
      })
    }
    if (String(url).endsWith('/oauth/register')) return json(201, { client_id: 'client_1' })
    if (String(url).endsWith('/oauth/token')) {
      const body = String(requestOptions.body || '')
      if (body.includes('grant_type=refresh_token')) {
        return json(200, {
          access_token: 'rak_refreshed',
          refresh_token: 'rft_refreshed',
          expires_in: 3600,
        })
      }
      return json(200, {
        access_token: 'rak_oauth',
        refresh_token: 'rft_oauth',
        expires_in: 3600,
      })
    }
    if (String(url).endsWith('/api/workspaces')) {
      return json(200, {
        workspaces: [{ workspace_id: 'wsp_personal', workspace_type: 'personal' }],
      })
    }
    if (String(url).endsWith('/api/agent-connection/self')) {
      return json(200, { connection: { id: 'con_1' } })
    }
    if (String(url).includes('/api/agent/connections/con_1/revoke')) {
      return json(200, { connection: { id: 'con_1', active: false } })
    }
    if (String(url).endsWith('/api/embed/v1/sessions/ems_abcdef123456/revoke')) {
      if (control.failEmbed === 'ems_abcdef123456') {
        return json(503, { error: { code: 'temporarily_unavailable', message: 'embed revoke failed' } })
      }
      return json(200, { session_id: 'ems_abcdef123456', revoked: true })
    }
    if (String(url).endsWith('/api/embed/v1/sessions/ems_ffffffffffff/revoke')) {
      return json(200, { session_id: 'ems_ffffffffffff', revoked: true })
    }
    if (String(url).includes('/api/documents?session_key=dsh:sess_1')) {
      return json(200, { documents: [{ document_id: 'doc_1', title: 'Doc' }] })
    }
    if (String(url).endsWith('/api/embed/v1/documents/doc_ffffffffffff/sessions')) {
      return json(201, {
        session_id: 'ems_ffffffffffff',
        document_id: 'doc_ffffffffffff',
        embed_url: 'https://reviso-api.fly.dev/embed/v1/documents/doc_ffffffffffff?session=ems_ffffffffffff#code=rem_code_secret',
        code_expires_at: '2026-01-01T00:01:00+00:00',
        code_expires_in: 60,
        token_expires_in: 900,
      })
    }
    if (String(url).endsWith('/api/embed/v1/documents/doc_abcdef123456/sessions')) {
      return json(201, {
        session_id: 'ems_abcdef123456',
        document_id: 'doc_abcdef123456',
        embed_url: 'https://reviso-api.fly.dev/embed/v1/documents/doc_abcdef123456?session=ems_abcdef123456#code=rem_code_secret',
        code_expires_at: '2026-01-01T00:01:00+00:00',
        code_expires_in: 60,
        token_expires_in: 900,
      })
    }
    if (String(url).includes('/api/documents/doc_abcdef123456/latest-content')) {
      return json(200, {
        document_id: 'doc_abcdef123456',
        version_id: 'ver_1',
        version_no: 1,
        source_format: 'markdown',
        content: '# Doc',
      })
    }
    if (String(url).includes('/api/dashboard/documents?workspace_id=wsp_personal')) {
      if (String(url).includes('source_kind=dsh')) return json(200, { reviews: [{ document_id: 'doc_1', title: 'Doc', source_session_id: 'sess_1' }], has_more: true, next_offset: 1 })
      return json(200, { reviews: [{ document_id: 'doc_1', title: 'Doc' }] })
    }
    return json(404, { error: 'not found' })
  }
  return { calls, restore: () => { globalThis.fetch = saved } }
}

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}


test('dashboard forwards DSH source scope while retaining the host bridge', async () => {
  const { routes, values } = setupBridge()
  values.set('REVISO_DSH_TOKEN', 'rak_dashboard')
  values.set('REVISO_DSH_SERVER', 'https://reviso.work')
  values.set('REVISO_DSH_WORKSPACE_ID', 'wsp_personal')
  const fakeFetch = installFetch()
  try {
    const res = response()
    await routes.get('/plugins/reviso/dashboard')(request('/plugins/reviso/dashboard?limit=25&source_kind=dsh'), res)
    assert.equal(res.status, 200)
    assert.match(fakeFetch.calls.at(-1).url, /workspace_id=wsp_personal/)
    assert.match(fakeFetch.calls.at(-1).url, /limit=25/)
    assert.match(fakeFetch.calls.at(-1).url, /source_kind=dsh/)
    assert.match(res.body, /sess_1/)
  } finally {
    fakeFetch.restore()
  }
})


test('preserves an upstream embed 404 as a typed capability failure', async () => {
  const { routes, values } = setupBridge()
  values.set('REVISO_DSH_TOKEN', 'rak_embed')
  values.set('REVISO_DSH_SERVER', 'https://reviso.work')
  values.set('REVISO_DSH_WORKSPACE_ID', 'wsp_personal')
  const fakeFetch = installFetch()
  try {
    const res = response()
    const req = { url: '/plugins/reviso/embed-session', headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'x-reviso-dsh-request': '1' }, method: 'POST', body: { document_id: 'doc_000000000001' }, socket: { remoteAddress: '127.0.0.1' } }
    await routes.get('/plugins/reviso/embed-session')(req, res)
    assert.equal(res.status, 404)
    const payload = JSON.parse(res.body)
    assert.equal(payload.status, 404)
    assert.equal(payload.code, 'not_found')
  } finally {
    fakeFetch.restore()
  }
})

test('Connect starts as a top-level GET with authenticated peer admission', async () => {
  const { routes } = setupBridge()
  const fakeFetch = installFetch()
  try {
    const res = response()
    await routes.get('/plugins/reviso/auth/start')(request('/plugins/reviso/auth/start'), res)
    assert.equal(res.status, 302)
    assert.match(res.headers.Location, /^https:\/\/reviso\.work\/oauth\/authorize/)
  } finally { fakeFetch.restore() }
})

test('host origin remains DSH while iframe origin is independently validated', async () => {
  const previous = process.env.REVISO_DSH_EMBED_ORIGIN
  process.env.REVISO_DSH_EMBED_ORIGIN = 'https://reviso-api.fly.dev'
  const { routes, values } = setupBridge()
  values.set('REVISO_DSH_TOKEN', 'rak_embed')
  values.set('REVISO_DSH_SERVER', 'https://reviso.work')
  values.set('REVISO_DSH_WORKSPACE_ID', 'wsp_personal')
  const fakeFetch = installFetch()
  try {
    const res = response()
    await routes.get('/plugins/reviso/embed-session')({
      url: '/plugins/reviso/embed-session', method: 'POST',
      headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'x-reviso-dsh-request': '1' },
      body: { document_id: 'doc_abcdef123456' }, socket: { remoteAddress: '127.0.0.1' },
    }, res)
    assert.equal(res.status, 200, res.body)
    const call = fakeFetch.calls.find(row => row.url.endsWith('/api/embed/v1/documents/doc_abcdef123456/sessions'))
    assert.equal(JSON.parse(call.options.body).origin, 'http://127.0.0.1:3080')
  } finally {
    fakeFetch.restore()
    if (previous === undefined) delete process.env.REVISO_DSH_EMBED_ORIGIN
    else process.env.REVISO_DSH_EMBED_ORIGIN = previous
  }
})

test('revokes an embed session through the authenticated host route', async () => {
  const { routes, values } = setupBridge()
  values.set('REVISO_DSH_TOKEN', 'rak_embed')
  values.set('REVISO_DSH_SERVER', 'https://reviso.work')
  values.set('REVISO_DSH_WORKSPACE_ID', 'wsp_personal')
  const fakeFetch = installFetch()
  try {
    const res = response()
    await routes.get('/plugins/reviso/embed-session/revoke')({
      url: '/plugins/reviso/embed-session/revoke', method: 'POST',
      headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'x-reviso-dsh-request': '1' },
      body: { session_id: 'ems_abcdef123456' }, socket: { remoteAddress: '127.0.0.1' },
    }, res)
    assert.equal(res.status, 200, res.body)
    assert.ok(fakeFetch.calls.some(call => call.url.endsWith('/api/embed/v1/sessions/ems_abcdef123456/revoke')))
  } finally { fakeFetch.restore() }
})

test('logout revokes active embed sessions before clearing credentials', async () => {
  const previous = process.env.REVISO_DSH_EMBED_ORIGIN
  process.env.REVISO_DSH_EMBED_ORIGIN = 'https://reviso-api.fly.dev'
  const { routes, values } = setupBridge()
  values.set('REVISO_DSH_TOKEN', 'rak_embed')
  values.set('REVISO_DSH_SERVER', 'https://reviso.work')
  values.set('REVISO_DSH_WORKSPACE_ID', 'wsp_personal')
  values.set('REVISO_DSH_CONNECTION_ID', 'con_1')
  const fakeFetch = installFetch()
  try {
    const created = response()
    await routes.get('/plugins/reviso/embed-session')({
      url: '/plugins/reviso/embed-session', method: 'POST',
      headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'x-reviso-dsh-request': '1' },
      body: { document_id: 'doc_abcdef123456' }, socket: { remoteAddress: '127.0.0.1' },
    }, created)
    assert.equal(created.status, 200, created.body)
    const logout = response()
    await routes.get('/plugins/reviso/auth/logout')({
      url: '/plugins/reviso/auth/logout', method: 'POST', socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'x-reviso-dsh-request': '1' },
    }, logout)
    assert.equal(logout.status, 200, logout.body)
    assert.ok(fakeFetch.calls.some(call => call.url.endsWith('/api/embed/v1/sessions/ems_abcdef123456/revoke')))
  } finally {
    fakeFetch.restore()
    if (previous === undefined) delete process.env.REVISO_DSH_EMBED_ORIGIN
    else process.env.REVISO_DSH_EMBED_ORIGIN = previous
  }
})

test('runs the OAuth start/callback flow without exposing the token', async () => {
  const previousEmbedOrigin = process.env.REVISO_DSH_EMBED_ORIGIN
  process.env.REVISO_DSH_EMBED_ORIGIN = 'https://reviso-api.fly.dev'
  const { routes, values } = setupBridge()
  const fakeFetch = installFetch()
  try {
    const startRes = response()
    await routes.get('/plugins/reviso/auth/start')(request('/plugins/reviso/auth/start', '127.0.0.1:3080', { headers: { 'x-reviso-dsh-request': '1' } }), startRes)
    assert.equal(startRes.status, 302)
    const location = new URL(startRes.headers.Location)
    assert.equal(location.origin + location.pathname, 'https://reviso.work/oauth/authorize')
    assert.equal(location.searchParams.get('client_id'), 'client_1')
    assert.equal(location.searchParams.get('redirect_uri'), 'http://127.0.0.1:3080/plugins/reviso/auth/callback')
    assert.equal(location.searchParams.get('code_challenge_method'), 'S256')
    assert.ok(location.searchParams.get('code_challenge'))
    const state = location.searchParams.get('state')

    const secondStart = response()
    await routes.get('/plugins/reviso/auth/start')(request('/plugins/reviso/auth/start', '127.0.0.1:3080', { headers: { 'x-reviso-dsh-request': '1' } }), secondStart)
    assert.equal(secondStart.status, 302)
    assert.equal(fakeFetch.calls.filter(call => call.url.endsWith('/oauth/register')).length, 1)

    const callbackRes = response()
    await routes.get('/plugins/reviso/auth/callback')(
      {
        url: `/plugins/reviso/auth/callback?code=code_1&state=${state}`,
        headers: {
          host: '127.0.0.1:3080',
          origin: 'https://reviso.work',
          'sec-fetch-site': 'cross-site',
        },
      },
      callbackRes,
    )
    assert.equal(callbackRes.status, 200)
    assert.match(callbackRes.body, /Reviso connected/)
    assert.equal(values.get('REVISO_DSH_TOKEN'), 'rak_oauth')
    assert.equal(values.get('REVISO_DSH_WORKSPACE_ID'), 'wsp_personal')
    assert.equal(values.get('REVISO_DSH_SERVER'), 'https://reviso.work')
    assert.equal(values.get('REVISO_DSH_REFRESH_TOKEN'), 'rft_oauth')
    assert.equal(values.get('REVISO_DSH_CONNECTION_ID'), 'con_1')
    assert.ok(Number(values.get('REVISO_DSH_EXPIRES_AT')) > Date.now())
    assert.doesNotMatch(callbackRes.body, /rak_oauth/)

    const tokenCall = fakeFetch.calls.find(call => call.url.endsWith('/oauth/token'))
    assert.ok(tokenCall)
    assert.match(String(tokenCall.options.body), /code_verifier=/)
    assert.match(String(tokenCall.options.body), /grant_type=authorization_code/)

    const statusRes = response()
    await routes.get('/plugins/reviso/auth/status')(request('/plugins/reviso/auth/status'), statusRes)
    assert.equal(JSON.parse(statusRes.body).capabilities.embed, 'unknown')
    assert.deepEqual(JSON.parse(statusRes.body), {
      connected: true,
      server: 'https://reviso.work',
      workspaceId: 'wsp_personal',
      generation: 0,
      capabilities: { embed: 'unknown', embedOrigin: 'https://reviso-api.fly.dev' },
    })
    assert.doesNotMatch(statusRes.body, /rak_oauth/)

    const sessionRes = response()
    await routes.get('/plugins/reviso/documents')(
      request('/plugins/reviso/documents?session_id=sess_1'),
      sessionRes,
    )
    assert.deepEqual(JSON.parse(sessionRes.body), {
      documents: [{ document_id: 'doc_1', title: 'Doc' }],
    })

    const documentRes = response()
    await routes.get('/plugins/reviso/document')(
      request('/plugins/reviso/document?id=doc_abcdef123456'),
      documentRes,
    )
    assert.deepEqual(JSON.parse(documentRes.body), {
      document_id: 'doc_abcdef123456',
      version_id: 'ver_1',
      version_no: 1,
      source_format: 'markdown',
      content: '# Doc',
    })

    const embedRes = response()
    await routes.get('/plugins/reviso/embed-session')({
      url: '/plugins/reviso/embed-session',
      method: 'POST',
      headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'x-reviso-dsh-request': '1' },
      body: { document_id: 'doc_abcdef123456', theme: 'dark', locale: 'zh-CN' },
      socket: { remoteAddress: '127.0.0.1' },
    }, embedRes)
    assert.equal(embedRes.status, 200, embedRes.body)
    assert.equal(JSON.parse(embedRes.body).session_id, 'ems_abcdef123456')
    const embedCall = fakeFetch.calls.find(call => call.url.endsWith('/api/embed/v1/documents/doc_abcdef123456/sessions'))
    assert.equal(embedCall.options.method, 'POST')
    assert.deepEqual(JSON.parse(embedCall.options.body), {
      host: 'dsh',
      origin: 'http://127.0.0.1:3080',
      capabilities: ['read'],
      theme: 'dark',
      locale: 'zh-CN',
    })
    assert.doesNotMatch(embedRes.body, /rak_oauth/)

    const dashboardRes = response()
    await routes.get('/plugins/reviso/dashboard')(
      request('/plugins/reviso/dashboard?limit=20'),
      dashboardRes,
    )
    assert.deepEqual(JSON.parse(dashboardRes.body), {
      reviews: [{ document_id: 'doc_1', title: 'Doc' }],
    })
    assert.doesNotMatch(sessionRes.body + documentRes.body + dashboardRes.body, /rak_oauth/)
    if (previousEmbedOrigin === undefined) delete process.env.REVISO_DSH_EMBED_ORIGIN
    else process.env.REVISO_DSH_EMBED_ORIGIN = previousEmbedOrigin

    const logoutRes = response()
    await routes.get('/plugins/reviso/auth/logout')(request('/plugins/reviso/auth/logout', '127.0.0.1:3080', { headers: { 'x-reviso-dsh-request': '1' } }), logoutRes)
    assert.deepEqual(JSON.parse(logoutRes.body), {
      connected: false, remoteRevoked: true, embedRevoked: true, embedFailures: [],
    })
    assert.equal(values.size, 0)
    assert.ok(fakeFetch.calls.some(call => call.url.endsWith('/api/agent/connections/con_1/revoke')))
  } finally {
    fakeFetch.restore()
  }
})

test('refreshes an expired access token before reading documents', async () => {
  const { routes, values } = setupBridge()
  const fakeFetch = installFetch()
  values.set('REVISO_DSH_TOKEN', 'rak_old')
  values.set('REVISO_DSH_SERVER', 'https://reviso.work')
  values.set('REVISO_DSH_WORKSPACE_ID', 'wsp_personal')
  values.set('REVISO_DSH_REFRESH_TOKEN', 'rft_old')
  values.set('REVISO_DSH_EXPIRES_AT', '1')
  values.set('REVISO_DSH_CLIENT_ID', 'client_1')
  try {
    const res = response()
    await routes.get('/plugins/reviso/documents')(
      request('/plugins/reviso/documents?session_id=sess_1'),
      res,
    )
    assert.equal(res.status, 200)
    assert.equal(values.get('REVISO_DSH_TOKEN'), 'rak_refreshed')
    assert.equal(values.get('REVISO_DSH_REFRESH_TOKEN'), 'rft_refreshed')
    assert.ok(Number(values.get('REVISO_DSH_EXPIRES_AT')) > Date.now())
    const refreshCall = fakeFetch.calls.find(call => String(call.options.body).includes('grant_type=refresh_token'))
    assert.ok(refreshCall)
  } finally {
    fakeFetch.restore()
  }
})

test('refreshes before resolving a missing workspace', async () => {
  const { routes, values } = setupBridge()
  const fakeFetch = installFetch()
  values.set('REVISO_DSH_TOKEN', 'rak_old')
  values.set('REVISO_DSH_SERVER', 'https://reviso.work')
  values.set('REVISO_DSH_REFRESH_TOKEN', 'rft_old')
  values.set('REVISO_DSH_EXPIRES_AT', '1')
  values.set('REVISO_DSH_CLIENT_ID', 'client_1')
  try {
    const res = response()
    await routes.get('/plugins/reviso/documents')(
      request('/plugins/reviso/documents?session_id=sess_1'),
      res,
    )
    assert.equal(res.status, 200)
    assert.equal(values.get('REVISO_DSH_WORKSPACE_ID'), 'wsp_personal')
    const workspaceCall = fakeFetch.calls.find(call => call.url.endsWith('/api/workspaces'))
    assert.equal(workspaceCall.options.headers.Authorization, 'Bearer rak_refreshed')
  } finally {
    fakeFetch.restore()
  }
})

test('rejects non-loopback socket peers even with a spoofed loopback Host', async () => {
  const { routes } = setupBridge()
  const res = response()
  await routes.get('/plugins/reviso/auth/status')(
    request('/plugins/reviso/auth/status', '127.0.0.1:3080', { remoteAddress: '203.0.113.9' }),
    res,
  )
  assert.equal(res.status, 403)
  assert.match(res.body, /loopback_required/)
})

test('rejects a cross-origin same-site request', async () => {
  const { routes } = setupBridge()
  const res = response()
  await routes.get('/plugins/reviso/auth/status')({
    url: '/plugins/reviso/auth/status',
    headers: {
      host: '127.0.0.1:3080',
      origin: 'http://127.0.0.1:9999',
      'sec-fetch-site': 'same-site',
    },
  }, res)
  assert.equal(res.status, 403)
  assert.match(res.body, /loopback_required/)
})


function embedRequest(documentId) {
  return {
    url: '/plugins/reviso/embed-session', method: 'POST',
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'x-reviso-dsh-request': '1' },
    body: { document_id: documentId }, socket: { remoteAddress: '127.0.0.1' },
  }
}

test('logout continues embed revokes after one failure, reports it, and clears credentials', async () => {
  const previous = process.env.REVISO_DSH_EMBED_ORIGIN
  process.env.REVISO_DSH_EMBED_ORIGIN = 'https://reviso-api.fly.dev'
  const { routes, values } = setupBridge()
  values.set('REVISO_DSH_TOKEN', 'rak_embed')
  values.set('REVISO_DSH_SERVER', 'https://reviso.work')
  values.set('REVISO_DSH_WORKSPACE_ID', 'wsp_personal')
  values.set('REVISO_DSH_CONNECTION_ID', 'con_1')
  const fakeFetch = installFetch({ failEmbed: 'ems_abcdef123456' })
  try {
    for (const docId of ['doc_abcdef123456', 'doc_ffffffffffff']) {
      const created = response()
      await routes.get('/plugins/reviso/embed-session')(embedRequest(docId), created)
      assert.equal(created.status, 200, created.body)
    }
    const logout = response()
    await routes.get('/plugins/reviso/auth/logout')({
      url: '/plugins/reviso/auth/logout', method: 'POST', socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'x-reviso-dsh-request': '1' },
    }, logout)
    assert.equal(logout.status, 200, logout.body)
    const payload = JSON.parse(logout.body)
    assert.equal(payload.connected, false)
    assert.equal(payload.remoteRevoked, true)
    assert.equal(payload.embedRevoked, false)
    assert.equal(payload.embedFailures.length, 1)
    assert.equal(payload.embedFailures[0].sessionId, 'ems_abcdef123456')
    assert.ok(fakeFetch.calls.some(call => call.url.endsWith('/api/embed/v1/sessions/ems_ffffffffffff/revoke')))
    assert.equal(values.size, 0)
  } finally {
    fakeFetch.restore()
    if (previous === undefined) delete process.env.REVISO_DSH_EMBED_ORIGIN
    else process.env.REVISO_DSH_EMBED_ORIGIN = previous
  }
})

test('bridge disposer revokes two active embeds and continues after one failure', async () => {
  const previous = process.env.REVISO_DSH_EMBED_ORIGIN
  process.env.REVISO_DSH_EMBED_ORIGIN = 'https://reviso-api.fly.dev'
  const { routes, values, dispose } = setupBridge()
  values.set('REVISO_DSH_TOKEN', 'rak_embed')
  values.set('REVISO_DSH_SERVER', 'https://reviso.work')
  values.set('REVISO_DSH_WORKSPACE_ID', 'wsp_personal')
  const fakeFetch = installFetch({ failEmbed: 'ems_abcdef123456' })
  try {
    for (const docId of ['doc_abcdef123456', 'doc_ffffffffffff']) {
      const created = response()
      await routes.get('/plugins/reviso/embed-session')(embedRequest(docId), created)
      assert.equal(created.status, 200, created.body)
    }
    const first = await dispose()
    const second = await dispose()
    assert.equal(first, second)
    assert.equal(first.embedFailures.length, 1)
    assert.equal(routes.size, 0)
    const revokes = fakeFetch.calls.filter(call => call.url.includes('/api/embed/v1/sessions/'))
    assert.deepEqual(new Set(revokes.map(call => call.url.split('/sessions/')[1].split('/')[0])), new Set(['ems_abcdef123456', 'ems_ffffffffffff']))
    assert.ok(revokes.every(call => call.options.headers.Authorization === 'Bearer rak_embed'))
  } finally {
    fakeFetch.restore()
    if (previous === undefined) delete process.env.REVISO_DSH_EMBED_ORIGIN
    else process.env.REVISO_DSH_EMBED_ORIGIN = previous
  }
})

test('rejects an unknown OAuth state', async () => {
  const { routes } = setupBridge()
  const fakeFetch = installFetch()
  try {
    const res = response()
    await routes.get('/plugins/reviso/auth/callback')(
      request('/plugins/reviso/auth/callback?code=code_1&state=missing'),
      res,
    )
    assert.equal(res.status, 400)
    assert.match(res.body, /state expired or unknown/)
  } finally {
    fakeFetch.restore()
  }
})