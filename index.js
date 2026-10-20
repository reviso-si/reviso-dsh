import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Host half for reviso-dsh.
 *
 * The model-facing publish tool lives here, not in the client, so the Reviso
 * credential never enters the browser or an agent child process. The tool
 * reads the DSH credential refs (or the Reviso CLI OAuth login), resolves the
 * calling agent session, and posts the document with `source_kind=dsh` plus
 * that session id. Reviso then archives it into the personal workspace's
 * top-level `dsh` folder.
 */
export const name = 'reviso-dsh'
export const inject = ['tools', 'credentials']

const TOKEN_REF = 'REVISO_DSH_TOKEN'
const WORKSPACE_REF = 'REVISO_DSH_WORKSPACE_ID'
const SERVER_REF = 'REVISO_DSH_SERVER'
const REQUEST_TIMEOUT_MS = 30_000

const publishParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'content'],
  properties: {
    title: { type: 'string', description: 'Document title.' },
    content: { type: 'string', description: 'Full document content.' },
    source_format: {
      type: 'string',
      description: 'Reviso source format. Defaults to markdown.',
    },
    description: {
      type: 'string',
      description: 'Version description. Defaults to an agent publish note.',
    },
    document_kind: {
      type: 'string',
      description: 'Optional Reviso document kind.',
    },
    deck_contract_version: {
      type: 'string',
      description: 'Optional deck contract version.',
    },
    parent_id: {
      type: 'string',
      description: 'Optional explicit parent resource id. Omit to use the dsh source folder.',
    },
  },
}

const publishOutput = {
  type: 'object',
  additionalProperties: false,
  required: ['document_id', 'review_url', 'workspace_id'],
  properties: {
    document_id: { type: 'string' },
    review_url: { type: 'string' },
    workspace_id: { type: 'string' },
  },
}

/**
 * Register the Reviso publish tool on the Host. Fail-soft like the client half:
 * a registration problem must not take down the host boot.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  try {
    ctx.tools.register(revisoPublishTool(ctx))
  } catch (err) {
    console.warn('[reviso-dsh] host tool registration failed:', err)
  }
}

function revisoPublishTool(ctx) {
  return {
    name: 'reviso_publish',
    description: 'Publish a document to Reviso so a human can review it. '
      + 'The document is always bound to the current DSH session and archived '
      + 'under My Documents/dsh.',
    parameters: publishParameters,
    output: {
      schema: publishOutput,
      render: (_args, value) => [{
        type: 'text',
        text: `Published to Reviso: ${value.review_url || value.document_id}`,
      }],
    },
    async execute(args, exec) {
      const sessionId = exec?.agent?.session?.header?.id
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('reviso_publish must run inside an agent session')
      }

      const credential = await readCredential(ctx)
      const body = {
        title: args.title,
        content: args.content,
        source_format: args.source_format || 'markdown',
        description: args.description || 'Published from DeepSeek Harness',
        workspace_id: credential.workspaceId,
        source_kind: 'dsh',
        source_session_id: sessionId,
      }
      if (args.document_kind !== undefined) body.document_kind = args.document_kind
      if (args.deck_contract_version !== undefined) {
        body.deck_contract_version = args.deck_contract_version
      }
      if (args.parent_id !== undefined && args.parent_id !== '') body.parent_id = args.parent_id

      const response = await postDocument(credential, body, exec?.signal)
      return {
        document_id: String(response.document_id || ''),
        review_url: String(response.review_url || ''),
        workspace_id: String(response.workspace_id || credential.workspaceId),
      }
    },
  }
}

async function readCredential(ctx) {
  const token = await resolveRef(ctx, TOKEN_REF)
  const server = normalizeServer(await resolveRef(ctx, SERVER_REF))
  if (token !== '' && server !== '') {
    const workspaceId = await resolveRef(ctx, WORKSPACE_REF)
      || await resolveWorkspaceFromConnection(server, token)
    return { token, workspaceId, server }
  }

  const cli = await readCliCredential(server)
  if (cli !== undefined) return cli

  throw new Error(
    'Reviso is not connected. Run `reviso auth login --server <server>` '
    + 'or store REVISO_DSH_TOKEN and REVISO_DSH_SERVER before publishing.',
  )
}

async function resolveRef(ctx, ref) {
  const resolved = ctx.credentials?.resolve !== undefined
    ? await ctx.credentials.resolve(ref)
    : undefined
  return String(resolved?.value || process.env[ref] || '')
}

async function readCliCredential(fallbackServer) {
  const path = process.env.REVISO_DSH_CLI_CREDENTIALS
    || join(process.env.REVISO_CONFIG_DIR || join(homedir(), '.config', 'reviso'), 'credentials.json')
  let document
  try {
    document = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
  const server = normalizeServer(fallbackServer || String(document.server || 'https://reviso.work'))
  const entry = document?.servers?.[server]
  const token = String(entry?.access_token || '')
  if (token === '') return undefined
  const workspaceId = String(entry?.workspace_id || '')
    || await resolveWorkspaceFromConnection(server, token)
  return { token, workspaceId, server }
}

async function resolveWorkspaceFromConnection(server, token) {
  const response = await fetch(`${normalizeServer(server)}/api/agent-connection/self`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Reviso connection check failed (HTTP ${response.status}): ${text.slice(0, 300)}`)
  }
  const connection = JSON.parse(text)?.connection
  const workspaceId = String(connection?.workspace_id
    || connection?.allowed_workspace_ids?.[0]
    || '')
  if (workspaceId === '') {
    throw new Error('Reviso connection has no workspace scope')
  }
  return workspaceId
}

function normalizeServer(value) {
  return value.replace(/\/+$/, '')
}

async function postDocument(credential, body, callerSignal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const signal = callerSignal === undefined
    ? controller.signal
    : AbortSignal.any([callerSignal, controller.signal])
  try {
    const response = await fetch(`${credential.server}/api/documents`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credential.token}`,
      },
      body: JSON.stringify(body),
      signal,
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`Reviso publish failed (HTTP ${response.status}): ${text.slice(0, 300)}`)
    }
    return JSON.parse(text)
  } finally {
    clearTimeout(timer)
  }
}
