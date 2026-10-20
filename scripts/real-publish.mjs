#!/usr/bin/env node
/**
 * Real Reviso publish verification for the Host-owned tool.
 *
 * Requires real REVISO_DSH_* refs in $DSH_HOME/.credentials.yaml (or --credentials).
 * Runs the same ToolRuntime + credentials provider the Host uses, publishes one
 * document, then reads it back through the session-key endpoint.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { apply } from '../index.js'

const { values } = parseArgs({
  options: {
    credentials: { type: 'string' },
    'session-id': { type: 'string' },
    title: { type: 'string' },
  },
})

const credentialsPath = resolve(
  values.credentials || join(process.env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml'),
)
if (!existsSync(credentialsPath)) {
  fail(`credentials file not found: ${credentialsPath}`)
}

const sessionId = values['session-id'] || `reviso-dsh-spike-${Date.now()}`
const title = values.title || `DSH Reviso spike ${new Date().toISOString()}`

const dsh = await loadDshModules()
const ctx = new dsh.Context()
await ctx.plugin(dsh.SystemPrompt)
await ctx.plugin(dsh.ToolRuntime)
await ctx.plugin(dsh.LocalCredentialProvider, { path: credentialsPath, watch: false })

const server = await resolveRef('REVISO_DSH_SERVER')
const workspaceId = await resolveRef('REVISO_DSH_WORKSPACE_ID')
const token = await resolveRef('REVISO_DSH_TOKEN')

apply({ tools: ctx.tools, credentials: ctx.credentials })

const result = await ctx.tools.execute({
  signal: new AbortController().signal,
  callId: `real_${Date.now()}`,
  name: 'reviso_publish',
  arguments: {
    title,
    content: `# ${title}\n\nThis document was published by the Host-owned reviso_publish tool.`,
    description: 'DSH Host-owned tool real publish verification',
  },
  agent: {
    id: sessionId,
    session: { header: { id: sessionId } },
    ctx,
  },
})

if (result.isError) {
  fail(`reviso_publish failed: ${JSON.stringify(result.content)}`)
}

const document = result.value
console.log(JSON.stringify({
  sessionId,
  workspaceId,
  documentId: document.document_id,
  reviewUrl: document.review_url,
}, null, 2))

const base = server.replace(/\/+$/, '')
const response = await fetch(
  `${base}/api/documents?session_key=dsh:${encodeURIComponent(sessionId)}`,
  { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
)
const text = await response.text()
if (!response.ok) fail(`session readback failed (HTTP ${response.status}): ${text.slice(0, 300)}`)
const body = JSON.parse(text)
const rows = Array.isArray(body) ? body : body.documents
const found = Array.isArray(rows) && rows.some(row => row.document_id === document.document_id)
if (!found) fail(`published document ${document.document_id} was not found in session_key=dsh:${sessionId}`)
console.log(`session readback: found ${document.document_id}`)

async function resolveRef(ref) {
  const resolved = await ctx.credentials.resolve(ref)
  if (resolved === undefined || resolved.value === '') {
    fail(`credential ref missing: ${ref} (expected in ${credentialsPath})`)
  }
  return resolved.value
}

async function loadDshModules() {
  const dshBin = findDshBin()
  const requireFromDsh = createRequire(dshBin)
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

function findDshBin() {
  const candidates = [
    process.env.DSH_BIN,
    ...(process.env.PATH || '').split(delimiter).map(dir => join(dir, 'dsh')),
  ]
  const found = candidates.find(candidate => candidate !== undefined && existsSync(candidate))
  if (found === undefined) fail('dsh binary not found; set DSH_BIN or add dsh to PATH')
  return found
}

function fail(message) {
  console.error(`real-publish: ${message}`)
  process.exit(1)
}
