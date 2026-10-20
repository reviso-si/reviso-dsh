import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, test } from 'node:test'
import { apply } from '../index.js'

let server
let baseUrl
let captured = []

before(async () => {
  server = http.createServer((req, res) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      captured.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body: raw === '' ? null : JSON.parse(raw),
      })
      if (req.url === '/api/documents') {
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          document_id: 'doc_123',
          review_url: '/documents/doc_123',
          workspace_id: 'wsp_personal',
        }))
        return
      }
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise(resolve => server.close(resolve))
})

function registerTool(credentials) {
  let tool
  apply({
    tools: { register(definition) { tool = definition; return () => {} } },
    credentials,
  })
  assert.ok(tool, 'host plugin must register reviso_publish')
  return tool
}

function execContext(sessionId = 'sess_123') {
  return {
    agent: { session: { header: { id: sessionId } } },
    signal: new AbortController().signal,
  }
}

test('publishes with the credential record and binds the agent session', async () => {
  captured = []
  const tool = registerTool({
    readRecord: async key => key === 'REVISO_DSH'
      ? {
          kind: 'grant',
          payload: { token: 'rak_test', workspaceId: 'wsp_personal', server: `${baseUrl}/` },
        }
      : undefined,
  })

  const result = await tool.execute({
    title: 'Session plan',
    content: '# Plan\n\nShip the spike.',
  }, execContext('sess_123'))

  assert.deepEqual(result, {
    document_id: 'doc_123',
    review_url: '/documents/doc_123',
    workspace_id: 'wsp_personal',
  })
  assert.equal(captured.length, 1)
  assert.equal(captured[0].method, 'POST')
  assert.equal(captured[0].url, '/api/documents')
  assert.equal(captured[0].authorization, 'Bearer rak_test')
  assert.deepEqual(captured[0].body, {
    title: 'Session plan',
    content: '# Plan\n\nShip the spike.',
    source_format: 'markdown',
    description: 'Published from DeepSeek Harness',
    workspace_id: 'wsp_personal',
    source_kind: 'dsh',
    source_session_id: 'sess_123',
  })
})

test('refuses to publish outside an agent session', async () => {
  const tool = registerTool({
    readRecord: async () => ({
      kind: 'grant',
      payload: { token: 'rak_test', workspaceId: 'wsp_personal', server: baseUrl },
    }),
  })

  await assert.rejects(
    () => tool.execute({ title: 'T', content: 'C' }, { signal: new AbortController().signal }),
    /must run inside an agent session/,
  )
})

test('refuses to publish without a connected Reviso credential', async () => {
  const saved = {
    REVISO_DSH_TOKEN: process.env.REVISO_DSH_TOKEN,
    REVISO_WORKSPACE_ID: process.env.REVISO_WORKSPACE_ID,
    REVISO_SERVER: process.env.REVISO_SERVER,
  }
  delete process.env.REVISO_DSH_TOKEN
  delete process.env.REVISO_WORKSPACE_ID
  delete process.env.REVISO_SERVER
  try {
    const tool = registerTool({
      readRecord: async () => undefined,
      resolve: async () => undefined,
    })
    await assert.rejects(
      () => tool.execute({ title: 'T', content: 'C' }, execContext()),
      /Reviso is not connected/,
    )
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('surfaces a bounded HTTP failure without echoing the token', async () => {
  const tool = registerTool({
    readRecord: async () => ({
      kind: 'grant',
      payload: { token: 'rak_secret', workspaceId: 'wsp_personal', server: baseUrl },
    }),
  })

  const saved = globalThis.fetch
  globalThis.fetch = async () => new Response('nope', { status: 503 })
  try {
    await assert.rejects(
      () => tool.execute({ title: 'T', content: 'C' }, execContext()),
      error => {
        assert.match(error.message, /HTTP 503/)
        assert.doesNotMatch(error.message, /rak_secret/)
        return true
      },
    )
  } finally {
    globalThis.fetch = saved
  }
})
