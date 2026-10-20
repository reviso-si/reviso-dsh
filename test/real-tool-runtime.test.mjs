import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import http from 'node:http'
import { test } from 'node:test'
import { apply } from '../index.js'

function findDshBin() {
  const candidates = [
    process.env.DSH_BIN,
    ...(process.env.PATH || '').split(delimiter).map(dir => join(dir, 'dsh')),
  ]
  const found = candidates.find(candidate => candidate !== undefined && existsSync(candidate))
  if (found === undefined) {
    throw new Error('dsh binary not found; set DSH_BIN or add dsh to PATH')
  }
  return found
}

async function loadDshModules() {
  const requireFromDsh = createRequire(findDshBin())
  const [{ Context }, systemPrompt, tools, credentialsLocal] = await Promise.all([
    import(pathToFileURL(requireFromDsh.resolve('@deepseek-ai/cordis')).href),
    import(pathToFileURL(requireFromDsh.resolve('@deepseek-ai/dsh-system-prompt')).href),
    import(pathToFileURL(requireFromDsh.resolve('@deepseek-ai/dsh-tools')).href),
    import(pathToFileURL(requireFromDsh.resolve('@deepseek-ai/dsh-credentials-local')).href),
  ])
  return {
    Context,
    SystemPrompt: systemPrompt.default,
    ToolRuntime: tools.default,
    LocalCredentialProvider: credentialsLocal.LocalCredentialProvider,
  }
}

test('executes through the real ToolRuntime and credentials provider', async () => {
  const dsh = await loadDshModules()

  const captured = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      captured.push({
        url: req.url,
        authorization: req.headers.authorization,
        body: raw === '' ? null : JSON.parse(raw),
      })
      res.writeHead(201, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        document_id: 'doc_real',
        review_url: '/documents/doc_real',
        workspace_id: 'wsp_personal',
      }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const home = await mkdtemp(join(tmpdir(), 'reviso-dsh-cred-'))
  const credentialsPath = join(home, '.credentials.yaml')

  try {
    await writeFile(credentialsPath, [
      'REVISO_DSH_TOKEN: rak_real',
      'REVISO_DSH_WORKSPACE_ID: wsp_personal',
      `REVISO_DSH_SERVER: ${baseUrl}`,
      '',
    ].join('\n'), { mode: 0o600 })

    const ctx = new dsh.Context()
    await ctx.plugin(dsh.SystemPrompt)
    await ctx.plugin(dsh.ToolRuntime)
    await ctx.plugin(dsh.LocalCredentialProvider, { path: credentialsPath, watch: false })

    assert.deepEqual(await ctx.credentials.resolve('REVISO_DSH_TOKEN'), {
      value: 'rak_real',
      source: 'file',
    })

    apply({ tools: ctx.tools, credentials: ctx.credentials })
    assert.deepEqual(ctx.tools.schemas().map(schema => schema.name), ['reviso_publish'])

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'call_1',
      name: 'reviso_publish',
      arguments: { title: 'Real runtime', content: '# Body' },
      agent: {
        id: 'sess_real',
        session: { header: { id: 'sess_real' } },
        ctx,
      },
    })

    assert.equal(result.isError, false)
    assert.deepEqual(result.value, {
      document_id: 'doc_real',
      review_url: '/documents/doc_real',
      workspace_id: 'wsp_personal',
    })
    assert.equal(captured.length, 1)
    assert.equal(captured[0].url, '/api/documents')
    assert.equal(captured[0].authorization, 'Bearer rak_real')
    assert.equal(captured[0].body.source_kind, 'dsh')
    assert.equal(captured[0].body.source_session_id, 'sess_real')
    assert.equal(captured[0].body.workspace_id, 'wsp_personal')
  } finally {
    await new Promise(resolve => server.close(resolve))
    await rm(home, { recursive: true, force: true })
  }
})
