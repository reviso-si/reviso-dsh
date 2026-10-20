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

function request(url, host = '127.0.0.1:3080') {
  return { url, headers: { host } }
}

function setupBridge() {
  const routes = new Map()
  const values = new Map()
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
  createOAuthBridge(ctx, { server: 'https://reviso.work' })
  return { routes, values }
}

function installFetch() {
  const calls = []
  const saved = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })
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
      const body = String(options.body || '')
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
    if (String(url).includes('/api/documents?session_key=dsh:sess_1')) {
      return json(200, { documents: [{ document_id: 'doc_1', title: 'Doc' }] })
    }
    if (String(url).includes('/api/documents/doc_1/latest-content')) {
      return json(200, {
        document_id: 'doc_1',
        version_id: 'ver_1',
        version_no: 1,
        source_format: 'markdown',
        content: '# Doc',
      })
    }
    if (String(url).includes('/api/dashboard/documents?workspace_id=wsp_personal')) {
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

test('runs the OAuth start/callback flow without exposing the token', async () => {
  const { routes, values } = setupBridge()
  const fakeFetch = installFetch()
  try {
    const startRes = response()
    await routes.get('/plugins/reviso/auth/start')(request('/plugins/reviso/auth/start'), startRes)
    assert.equal(startRes.status, 302)
    const location = new URL(startRes.headers.Location)
    assert.equal(location.origin + location.pathname, 'https://reviso.work/oauth/authorize')
    assert.equal(location.searchParams.get('client_id'), 'client_1')
    assert.equal(location.searchParams.get('redirect_uri'), 'http://127.0.0.1:3080/plugins/reviso/auth/callback')
    assert.equal(location.searchParams.get('code_challenge_method'), 'S256')
    assert.ok(location.searchParams.get('code_challenge'))
    const state = location.searchParams.get('state')

    const secondStart = response()
    await routes.get('/plugins/reviso/auth/start')(request('/plugins/reviso/auth/start'), secondStart)
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
    assert.deepEqual(JSON.parse(statusRes.body), {
      connected: true,
      server: 'https://reviso.work',
      workspaceId: 'wsp_personal',
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
      request('/plugins/reviso/document?id=doc_1'),
      documentRes,
    )
    assert.deepEqual(JSON.parse(documentRes.body), {
      document_id: 'doc_1',
      version_id: 'ver_1',
      version_no: 1,
      source_format: 'markdown',
      content: '# Doc',
    })

    const dashboardRes = response()
    await routes.get('/plugins/reviso/dashboard')(
      request('/plugins/reviso/dashboard?limit=20'),
      dashboardRes,
    )
    assert.deepEqual(JSON.parse(dashboardRes.body), {
      reviews: [{ document_id: 'doc_1', title: 'Doc' }],
    })
    assert.doesNotMatch(sessionRes.body + documentRes.body + dashboardRes.body, /rak_oauth/)

    const logoutRes = response()
    await routes.get('/plugins/reviso/auth/logout')(request('/plugins/reviso/auth/logout'), logoutRes)
    assert.deepEqual(JSON.parse(logoutRes.body), { connected: false, remoteRevoked: true })
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

test('rejects non-loopback hosts', async () => {
  const { routes } = setupBridge()
  const res = response()
  await routes.get('/plugins/reviso/auth/status')(
    request('/plugins/reviso/auth/status', 'example.com'),
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
