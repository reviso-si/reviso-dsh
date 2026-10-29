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
let unauthorizedOnce = false
let duplicateDocuments = []
let duplicateQueryStatus = 200
let documentKind = 'html_deck'
let updateStatus = 201
let updateResponse = {
  document_id: 'doc_123',
  version_id: 'ver_updated',
  workspace_id: 'wsp_personal',
}

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
        body: raw === ''
          ? null
          : String(req.headers['content-type'] || '').includes('application/json')
            ? JSON.parse(raw)
            : raw,
      })
      if (req.url === '/oauth/token') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          access_token: 'rak_refreshed',
          refresh_token: 'rft_refreshed',
          expires_in: 3600,
        }))
        return
      }
      if (req.url === '/api/workspaces') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ workspaces: [{ workspace_id: 'wsp_cli', workspace_type: 'personal' }] }))
        return
      }
      if (req.url === '/api/agent-connection/self') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ connection: { id: 'con_cli', workspace_id: 'wsp_cli' } }))
        return
      }
      if (req.url === '/api/documents?session_key=dsh%3Asess_123') {
        res.writeHead(duplicateQueryStatus, { 'Content-Type': 'application/json' })
        res.end(duplicateQueryStatus === 200
          ? JSON.stringify({ documents: duplicateDocuments })
          : JSON.stringify({ error: 'lookup failed' }))
        return
      }
      if (req.url === '/api/documents/doc_123/latest-content') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          document_id: 'doc_123',
          document_kind: documentKind,
          version_id: 'ver_1',
        }))
        return
      }
      if (req.url === '/api/documents/doc_123/agent-update') {
        res.writeHead(updateStatus, { 'Content-Type': 'application/json' })
        res.end(updateStatus >= 200 && updateStatus < 300
          ? JSON.stringify(updateResponse)
          : '{"error":{"code":"CAS_CONFLICT","message":"base_version_changed"}}')
        return
      }
      if (req.url === '/api/documents/doc_123/assets') {
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          asset_id: 'ast_123',
          url: '/api/documents/doc_123/assets/ast_123',
          content_type: 'image/png',
          size_bytes: 68,
        }))
        return
      }
      if (req.url === '/api/documents') {
        if (unauthorizedOnce) {
          unauthorizedOnce = false
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'expired' }))
          return
        }
        const requestBody = raw === '' ? {} : JSON.parse(raw)
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          document_id: 'doc_123',
          review_url: '/documents/doc_123',
          version_id: 'ver_created',
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
    set: async (ref, value) => { values[ref] = value },
    unset: async ref => { delete values[ref] },
  }
}

test('publishes with credential refs and binds the agent session', async () => {
  captured = []
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_test',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: `${baseUrl}/`,
    REVISO_DSH_CONNECTION_ID: 'con_test',
  }))

  const result = await tool.execute({
    title: 'Session plan',
    content: '# Plan\n\nShip the spike.',
  }, execContext('sess_123'))

  assert.deepEqual(result, {
    document_id: 'doc_123',
    review_url: '/documents/doc_123',
    workspace_id: 'wsp_personal',
    updated: false,
    version_id: 'ver_created',
  })
  assert.equal(captured.length, 2)
  assert.equal(captured[0].method, 'GET')
  assert.equal(captured[0].url, '/api/documents?session_key=dsh%3Asess_123')
  assert.equal(captured[1].method, 'POST')
  assert.equal(captured[1].url, '/api/documents')
  assert.equal(captured[1].authorization, 'Bearer rak_test')
  assert.deepEqual(captured[1].body, {
    title: 'Session plan',
    content: '# Plan\n\nShip the spike.',
    source_format: 'markdown',
    description: 'Published from DeepSeek Harness',
    workspace_id: 'wsp_personal',
    source_kind: 'dsh',
    source_session_id: 'sess_123',
    operation_id: captured[1].body.operation_id,
  })
  assert.match(captured[1].body.operation_id, /^op_/);
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

test('rejects a create without a title before making a request', async () => {
  captured = []
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_test',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: baseUrl,
  }))
  await assert.rejects(
    () => tool.execute({ content: 'Body' }, execContext('sess_123')),
    /title is required when creating a document/,
  )
  assert.equal(captured.length, 0)
})

test('rejects a duplicate exact active title in the same session before create', async () => {
  captured = []
  duplicateDocuments = [
    {
      document_id: 'doc_old',
      title: 'Session plan',
      current_version_id: 'ver_1',
      updated_at: '2026-10-21T10:00:00Z',
      archived_at: null,
    },
    { document_id: 'doc_archived', title: 'Session plan', archived_at: '2026-01-01T00:00:00Z' },
  ]
  duplicateQueryStatus = 200
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_test',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: baseUrl,
  }))
  try {
    await assert.rejects(
      () => tool.execute({ title: 'Session plan', content: 'Body' }, execContext('sess_123')),
      /document_id: doc_old.*version: ver_1.*updated_at: 2026-10-21T10:00:00Z.*allow_duplicate=true/,
    )
    assert.equal(captured.length, 2)
    assert.equal(captured[1].method, 'GET')
    assert.equal(captured[1].url, '/api/documents?session_key=dsh%3Asess_123')
  } finally {
    duplicateDocuments = []
  }
})

test('allow_duplicate bypasses the duplicate preflight', async () => {
  captured = []
  duplicateDocuments = [{ document_id: 'doc_old', title: 'Session plan', archived_at: null }]
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_test',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: baseUrl,
  }))
  try {
    await tool.execute({
      title: 'Session plan',
      content: 'Body',
      allow_duplicate: true,
    }, execContext('sess_123'))
    assert.deepEqual(captured.map(row => row.url), [
      '/api/agent-connection/self',
      '/api/documents',
    ])
    assert.equal(captured[1].body.title, 'Session plan')
  } finally {
    duplicateDocuments = []
  }
})

test('permits create when the duplicate preflight query fails', async () => {
  captured = []
  duplicateQueryStatus = 503
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_test',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: baseUrl,
  }))
  try {
    await tool.execute({ title: 'Preflight unavailable', content: 'Body' }, execContext('sess_123'))
    assert.deepEqual(captured.map(row => row.url), [
      '/api/agent-connection/self',
      '/api/documents?session_key=dsh%3Asess_123',
      '/api/documents',
    ])
  } finally {
    duplicateQueryStatus = 200
  }
})

test('falls back to the Reviso CLI OAuth login and resolves the workspace', async () => {
  captured = []
  const home = await mkdtemp(join(tmpdir(), 'reviso-dsh-cli-'))
  const credentialsPath = join(home, 'credentials.json')
  await writeFile(credentialsPath, JSON.stringify({
    server: baseUrl,
    servers: { [baseUrl]: { access_token: 'rak_cli', connection_id: 'con_cli' } },
  }), { mode: 0o600 })
  const saved = process.env.REVISO_DSH_CLI_CREDENTIALS
  process.env.REVISO_DSH_CLI_CREDENTIALS = credentialsPath
  try {
    const tool = registerTool(credentialProvider({}))
    const result = await tool.execute({ title: 'CLI fallback', content: 'Body' }, execContext('sess_cli'))

    assert.equal(result.workspace_id, 'wsp_cli')
    assert.equal(captured[0].url, '/api/workspaces')
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

test('treats the CLI expires_at as epoch seconds and refreshes first', async () => {
  captured = []
  const home = await mkdtemp(join(tmpdir(), 'reviso-dsh-cli-expired-'))
  const credentialsPath = join(home, 'credentials.json')
  await writeFile(credentialsPath, JSON.stringify({
    server: baseUrl,
    servers: {
      [baseUrl]: {
        access_token: 'rak_cli_old',
        refresh_token: 'rft_cli_old',
        client_id: 'client_cli',
        expires_at: Math.floor(Date.now() / 1000) - 10,
      },
    },
  }), { mode: 0o600 })
  const saved = process.env.REVISO_DSH_CLI_CREDENTIALS
  process.env.REVISO_DSH_CLI_CREDENTIALS = credentialsPath
  try {
    const tool = registerTool(credentialProvider({}))
    await tool.execute({ title: 'CLI refresh', content: 'Body' }, execContext('sess_cli_refresh'))
    assert.ok(captured.some(row => row.url === '/oauth/token'))
    const publish = captured.find(row => row.url === '/api/documents')
    assert.equal(publish.authorization, 'Bearer rak_refreshed')
  } finally {
    if (saved === undefined) delete process.env.REVISO_DSH_CLI_CREDENTIALS
    else process.env.REVISO_DSH_CLI_CREDENTIALS = saved
    await rm(home, { recursive: true, force: true })
  }
})

test('updates an existing document without create-only fields or a default source format', async () => {
  captured = []
  documentKind = 'html_deck'
  updateStatus = 201
  updateResponse = {
    document_id: 'doc_123',
    review_url: `${baseUrl}/documents/doc_123`,
    version_id: 'ver_updated',
    workspace_id: 'wsp_personal',
  }
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_test',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: baseUrl,
  }))

  const result = await tool.execute({
    title: 'Ignored on update',
    content: '# Revised',
    document_id: 'doc_123',
    base_version_id: 'ver_1',
    deck_contract_version: 'html-deck/1',
  }, execContext('sess_123'))

  assert.deepEqual(result, {
    document_id: 'doc_123',
    review_url: `${baseUrl}/documents/doc_123`,
    workspace_id: 'wsp_personal',
    updated: true,
    version_id: 'ver_updated',
  })
  assert.deepEqual(captured.map(row => row.url), [
    '/api/agent-connection/self',
    '/api/documents/doc_123/latest-content',
    '/api/documents/doc_123/agent-update',
  ])
  assert.deepEqual(captured[2].body, {
    content: '# Revised',
    base_version_id: 'ver_1',
    description: 'Published from DeepSeek Harness',
    operation_id: captured[2].body.operation_id,
  })
  assert.match(captured[2].body.operation_id, /^op_/)
  assert.equal(Object.hasOwn(captured[2].body, 'deck_contract_version'), false)
})



test('uploads embedded deck images before the final CAS update', async () => {
  captured = []
  updateStatus = 201
  updateResponse = {
    document_id: 'doc_123',
    review_url: `${baseUrl}/documents/doc_123`,
    version_id: 'ver_updated',
    workspace_id: 'wsp_personal',
  }
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_test',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: baseUrl,
  }))
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0YQAAAAASUVORK5CYII='
  const deck = '<div class="hr-deck" data-aspect-ratio="16:9" data-contract-version="html-deck/1">'
    + '<section class="hr-slide" data-slide-id="s01">'
    + `<img src="${image}" alt="pixel" width="1" height="1">`
    + '</section></div>'

  const result = await tool.execute({
    title: 'Large deck',
    content: deck,
    source_format: 'html',
    document_kind: 'html_deck',
    deck_contract_version: 'html-deck/1',
  }, execContext('sess_123'))

  const urls = captured.map(row => row.url)
  assert.deepEqual(urls, [
    '/api/agent-connection/self',
    '/api/documents?session_key=dsh%3Asess_123',
    '/api/documents',
    '/api/documents/doc_123/assets',
    '/api/documents/doc_123/agent-update',
  ])
  const draft = captured[2].body
  const upload = captured[3].body
  const update = captured[4].body
  assert.equal(draft.document_kind, 'html_deck')
  assert.doesNotMatch(draft.content, /data:image\//)
  assert.equal(upload.content_type, 'image/png')
  assert.match(upload.operation_id, /-asset-0-/)
  assert.equal(update.base_version_id, 'ver_created')
  assert.doesNotMatch(update.content, /data:image\//)
  assert.match(update.content, /\/api\/documents\/doc_123\/assets\/ast_123/)
  assert.equal(result.updated, false)
  assert.equal(result.version_id, 'ver_updated')

  updateStatus = 201
})

test('uploads embedded deck images on update without create-only deck identity', async () => {
  captured = []
  documentKind = 'html_deck'
  updateStatus = 201
  updateResponse = {
    document_id: 'doc_123',
    review_url: `${baseUrl}/documents/doc_123`,
    version_id: 'ver_updated',
    workspace_id: 'wsp_personal',
  }
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_test',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: baseUrl,
  }))
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0YQAAAAASUVORK5CYII='
  const deck = '<div class="hr-deck" data-aspect-ratio="16:9" data-contract-version="html-deck/1">'
    + '<section class="hr-slide" data-slide-id="s01">'
    + `<img src="${image}" alt="pixel" width="1" height="1">`
    + '</section></div>'

  await tool.execute({
    content: deck,
    document_id: 'doc_123',
    base_version_id: 'ver_1',
    source_format: 'html',
  }, execContext('sess_123'))

  assert.deepEqual(captured.map(row => row.url), [
    '/api/agent-connection/self',
    '/api/documents/doc_123/assets',
    '/api/documents/doc_123/agent-update',
  ])
  const upload = captured[1].body
  const update = captured[2].body
  assert.equal(upload.content_type, 'image/png')
  assert.equal(update.base_version_id, 'ver_1')
  assert.doesNotMatch(update.content, /data:image\//)
  assert.match(update.content, /\/api\/documents\/doc_123\/assets\/ast_123/)
})


test('detects a declared deck without an explicit document_kind and uploads images', async () => {
  captured = []
  updateStatus = 201
  updateResponse = {
    document_id: 'doc_123',
    review_url: `${baseUrl}/documents/doc_123`,
    version_id: 'ver_updated',
    workspace_id: 'wsp_personal',
  }
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_test',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: baseUrl,
  }))
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0YQAAAAASUVORK5CYII='
  const deck = '<div class="hr-deck" data-aspect-ratio="16:9" data-contract-version="html-deck/1">'
    + '<section class="hr-slide" data-slide-id="s01">'
    + `<img src="${image}" alt="pixel">`
    + '</section></div>'

  await tool.execute({
    title: 'Declared deck',
    content: deck,
    source_format: 'html',
  }, execContext('sess_123'))

  assert.deepEqual(captured.map(row => row.url), [
    '/api/agent-connection/self',
    '/api/documents?session_key=dsh%3Asess_123',
    '/api/documents',
    '/api/documents/doc_123/assets',
    '/api/documents/doc_123/agent-update',
  ])
  assert.equal(captured[2].body.document_kind, 'html_deck')
  assert.equal(captured[2].body.deck_contract_version, 'html-deck/1')
  assert.match(captured[4].body.content, /\/api\/documents\/doc_123\/assets\/ast_123/)
})

test('only img src data URIs are uploaded and rewritten', async () => {
  captured = []
  updateStatus = 201
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_test',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: baseUrl,
  }))
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0YQAAAAASUVORK5CYII='
  const deck = '<div class="hr-deck"><code>' + image + '</code>'
    + `<img src="${image}"></div>`

  await tool.execute({
    title: 'Deck with code',
    content: deck,
    source_format: 'html',
    document_kind: 'html_deck',
  }, execContext('sess_123'))

  const update = captured.find(row => row.url === '/api/documents/doc_123/agent-update')
  assert.equal((update.body.content.match(/data:image\//g) || []).length, 1)
  assert.match(update.body.content, /\/api\/documents\/doc_123\/assets\/ast_123/)
})

test('rejects an oversized supported image before creating a draft', async () => {
  captured = []
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_test',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: baseUrl,
  }))
  const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 1).toString('base64')
  const deck = `<div class="hr-deck"><img src="data:image/png;base64,${oversized}"></div>`
  await assert.rejects(
    () => tool.execute({
      title: 'Too large',
      content: deck,
      source_format: 'html',
      document_kind: 'html_deck',
    }, execContext('sess_123')),
    /maximum upload image size/,
  )
  assert.equal(captured.length, 0)
})

test('update preserves an explicit source format', async () => {
  captured = []
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_test',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: baseUrl,
  }))
  await tool.execute({
    content: '<p>Revised</p>',
    document_id: 'doc_123',
    base_version_id: 'ver_1',
    source_format: 'html',
    description: 'Fresh HTML',
  }, execContext('sess_123'))
  const update = captured.find(row => row.url === '/api/documents/doc_123/agent-update')
  assert.deepEqual(update.body, {
    content: '<p>Revised</p>',
    base_version_id: 'ver_1',
    description: 'Fresh HTML',
    source_format: 'html',
    operation_id: update.body.operation_id,
  })
  assert.match(update.body.operation_id, /^op_/)
})

test('rejects deck contract updates for a non-deck document before POST', async () => {
  captured = []
  documentKind = 'document'
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_test',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: baseUrl,
  }))
  try {
    await assert.rejects(
      () => tool.execute({
        content: '# Revised',
        document_id: 'doc_123',
        base_version_id: 'ver_1',
        deck_contract_version: 'html-deck/1',
      }, execContext('sess_123')),
      /only valid for an html_deck document/,
    )
    assert.deepEqual(captured.map(row => row.url), [
      '/api/agent-connection/self',
      '/api/documents/doc_123/latest-content',
    ])
  } finally {
    documentKind = 'html_deck'
  }
})

test('rejects partial update identity before making a request', async () => {
  captured = []
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_test',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: baseUrl,
  }))
  await assert.rejects(
    () => tool.execute({ content: 'Body', document_id: 'doc_123' }, execContext('sess_123')),
    /document_id and base_version_id must be provided together/,
  )
  await assert.rejects(
    () => tool.execute({ content: 'Body', base_version_id: 'ver_1' }, execContext('sess_123')),
    /document_id and base_version_id must be provided together/,
  )
  assert.equal(captured.length, 0)
})

test('does not retry a 409 update conflict and preserves the response text', async () => {
  captured = []
  documentKind = 'html_deck'
  updateStatus = 409
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_conflict',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: baseUrl,
    REVISO_DSH_REFRESH_TOKEN: 'rft_conflict',
  }))
  try {
    await assert.rejects(
      () => tool.execute({
        content: '# Revised',
        document_id: 'doc_123',
        base_version_id: 'ver_stale',
        deck_contract_version: 'html-deck/1',
      }, execContext('sess_123')),
      error => {
        assert.match(error.message, /HTTP 409/)
        assert.match(error.message, /CAS_CONFLICT/)
        assert.match(error.message, /base_version_changed/)
        return true
      },
    )
    assert.deepEqual(captured.map(row => row.url), [
      '/api/agent-connection/self',
      '/api/documents/doc_123/latest-content',
      '/api/documents/doc_123/agent-update',
    ])
    assert.ok(!captured.some(row => row.url === '/oauth/token'))
  } finally {
    updateStatus = 201
  }
})

test('refreshes once after a 401 and retries the publish', async () => {
  captured = []
  unauthorizedOnce = true
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_old',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: baseUrl,
    REVISO_DSH_CONNECTION_ID: 'con_retry',
    REVISO_DSH_REFRESH_TOKEN: 'rft_old',
    REVISO_DSH_EXPIRES_AT: String(Date.now() + 3_600_000),
    REVISO_DSH_CLIENT_ID: 'client_1',
  }))
  try {
    const result = await tool.execute({ title: 'Retry', content: 'Body' }, execContext('sess_retry'))
    assert.equal(result.document_id, 'doc_123')
    const publishes = captured.filter(row => row.url === '/api/documents')
    assert.equal(publishes.length, 2)
    assert.equal(publishes[0].authorization, 'Bearer rak_old')
    assert.equal(publishes[1].authorization, 'Bearer rak_refreshed')
    assert.ok(captured.some(row => row.url === '/oauth/token'))
  } finally {
    unauthorizedOnce = false
  }
})

test('surfaces a bounded HTTP failure without echoing the token', async () => {
  const tool = registerTool(credentialProvider({
    REVISO_DSH_TOKEN: 'rak_secret',
    REVISO_DSH_WORKSPACE_ID: 'wsp_personal',
    REVISO_DSH_SERVER: baseUrl,
    REVISO_DSH_CONNECTION_ID: 'con_secret',
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