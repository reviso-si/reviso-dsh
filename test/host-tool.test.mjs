import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
      if (req.url === '/api/agent-connection/self') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ connection: { workspace_id: 'wsp_cli' } }))
        return
      }
      if (req.url === '/api/documents') {
        const requestBody = raw === '' ? {} : JSON.parse(raw)
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          document_id: 'doc_123',
          review_url: '/documents/doc_123',
          workspace_id: requestBody.workspace_id || 'wsp_personal',
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

function credentialProvider(values) {
  return {
    resolve: async ref => values[ref] === undefined
      ? undefined
      : { value: values[ref], source: 'test' },
  }
}

test('publishes with credential refs and binds the agent session', async () => {
  captured = []
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_test',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: `${baseUrl}/`,
  }))

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
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_test',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: baseUrl,
  }))

  await assert.rejects(
    () => tool.execute({ title: 'T', content: 'C' }, { signal: new AbortController().signal }),
    /must run inside an agent session/,
  )
})

test('refuses to publish without a connected Reviso credential', async () => {
  const saved = {
    REVISO_DSH_TOKEN: process.env.REVISO_DSH_TOKEN,
    REVISO_DSH_WORKSPACE_ID: process.env.REVISO_DSH_WORKSPACE_ID,
    REVISO_DSH_SERVER: process.env.REVISO_DSH_SERVER,
    REVISO_DSH_CLI_CREDENTIALS: process.env.REVISO_DSH_CLI_CREDENTIALS,
  }
  delete process.env.REVISO_DSH_TOKEN
  delete process.env.REVISO_DSH_WORKSPACE_ID
  delete process.env.REVISO_DSH_SERVER
  process.env.REVISO_DSH_CLI_CREDENTIALS = join(tmpdir(), 'missing-reviso-dsh-credential.json')
  try {
    const tool = registerTool(credentialProvider({}))
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

test('falls back to the Reviso CLI OAuth login and resolves the workspace', async () => {
  captured = []
  const home = await mkdtemp(join(tmpdir(), 'reviso-dsh-cli-'))
  const credentialsPath = join(home, 'credentials.json')
  await writeFile(credentialsPath, JSON.stringify({
    server: baseUrl,
    servers: { [baseUrl]: { access_token: 'rak_cli' } },
  }))
  const saved = process.env.REVISO_DSH_CLI_CREDENTIALS
  process.env.REVISO_DSH_CLI_CREDENTIALS = credentialsPath
  try {
    const tool = registerTool(credentialProvider({}))
    const result = await tool.execute({ title: 'CLI fallback', content: 'Body' }, execContext('sess_cli'))

    assert.equal(result.workspace_id, 'wsp_cli')
    assert.equal(captured[0].url, '/api/agent-connection/self')
    assert.equal(captured[0].authorization, 'Bearer rak_cli')
    const publish = captured.find(row => row.url === '/api/documents')
    assert.equal(publish.authorization, 'Bearer rak_cli')
    assert.equal(publish.body.workspace_id, 'wsp_cli')
    assert.equal(publish.body.source_session_id, 'sess_cli')
  } finally {
    if (saved === undefined) delete process.env.REVISO_DSH_CLI_CREDENTIALS
    else process.env.REVISO_DSH_CLI_CREDENTIALS = saved
    await rm(home, { recursive: true, force: true })
  }
})

test('surfaces a bounded HTTP failure without echoing the token', async () => {
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_secret',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: baseUrl,
  }))

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
