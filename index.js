import { createHash } from 'node:crypto'
import { createOAuthBridge } from './host/oauth.js'
import { readCredential } from './host/credentials.js'
import { errorFromResponse, messageOf } from './host/errors.js'
import { markPublished } from './host/generation.js'

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

const REQUEST_TIMEOUT_MS = 30_000

const publishParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['content'],
  properties: {
    title: { type: 'string', description: 'Document title.' },
    content: { type: 'string', description: 'Full document content.' },
    document_id: {
      type: 'string',
      description: 'Existing Reviso document id to update. Requires base_version_id.',
    },
    base_version_id: {
      type: 'string',
      description: 'Current version id to update from. Requires document_id.',
    },
    allow_duplicate: {
      type: 'boolean',
      description: 'Allow creating another active document with the same title in this session.',
    },
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
  required: ['document_id', 'review_url', 'workspace_id', 'updated', 'version_id'],
  properties: {
    document_id: { type: 'string' },
    review_url: { type: 'string' },
    workspace_id: { type: 'string' },
    updated: { type: 'boolean' },
    version_id: { type: 'string' },
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

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], webCtx => {
      const register = () => createOAuthBridge(webCtx)
      if (typeof webCtx.effect === 'function') {
        webCtx.effect(register, 'reviso-dsh oauth bridge')
      } else {
        register()
      }
    })
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
        text: `${value.updated ? 'Updated in' : 'Published to'} Reviso: ${value.review_url || value.document_id}`,
      }],
    },
    async execute(args, exec) {
      const sessionId = exec?.agent?.session?.header?.id
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('reviso_publish must run inside an agent session')
      }

      const documentId = String(args.document_id || '').trim()
      const baseVersionId = String(args.base_version_id || '').trim()
      const operationId = publishOperationId(exec, args, sessionId)
      if ((documentId === '') !== (baseVersionId === '')) {
        throw new Error('document_id and base_version_id must be provided together')
      }
      const update = documentId !== ''

      if (update) {
        if (args.document_kind !== undefined) {
          throw new Error('document_kind can only be supplied when creating a document')
        }
        if (args.parent_id !== undefined && args.parent_id !== '') {
          throw new Error('parent_id can only be supplied when creating a document')
        }
        if (args.allow_duplicate !== undefined) {
          throw new Error('allow_duplicate can only be supplied when creating a document')
        }
      }

      if (!update && (typeof args.title !== 'string' || args.title.trim() === '')) {
        throw new Error('title is required when creating a document')
      }

      const credential = await readCredential(ctx)
      if (update) {
        if (args.deck_contract_version !== undefined) {
          await assertDeckUpdateTarget(credential, documentId, exec?.signal)
        }
        const body = {
          content: args.content,
          base_version_id: baseVersionId,
          description: args.description || 'Published from DeepSeek Harness',
        }
        if (args.source_format !== undefined) body.source_format = args.source_format
        const response = await postUpdate(ctx, credential, documentId, body, exec?.signal, operationId)
        const responseDocumentId = String(response.document_id || documentId)
        markPublished(credential.server, credential.workspaceId)
        return {
          document_id: responseDocumentId,
          review_url: canonicalReviewUrl(credential.server, responseDocumentId, response.review_url),
          workspace_id: String(response.workspace_id || credential.workspaceId),
          updated: true,
          version_id: String(response.version_id || ''),
        }
      }

      await preflightCreate(credential, sessionId, args, exec?.signal)
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

      const response = await postDocument(ctx, credential, body, exec?.signal, operationId)
      const responseDocumentId = String(response.document_id || '')
      markPublished(credential.server, credential.workspaceId)
      return {
        document_id: responseDocumentId,
        review_url: canonicalReviewUrl(credential.server, responseDocumentId, response.review_url),
        workspace_id: String(response.workspace_id || credential.workspaceId),
        updated: false,
        version_id: String(response.version_id || ''),
      }
    },
  }
}

async function postDocument(ctx, credential, body, callerSignal, operationId) {
  let current = credential
  let result = await publishAttempt(current, body, callerSignal, '/api/documents', operationId)
  if (result.status === 401 && current.refreshToken !== '') {
    current = await readCredential(ctx, { forceRefresh: true })
    result = await publishAttempt(current, body, callerSignal, '/api/documents', operationId)
  }
  return parseSuccessfulPublish(result)
}

async function preflightCreate(credential, sessionId, args, callerSignal) {
  if (args.allow_duplicate === true) return
  const query = new URLSearchParams({ session_key: `dsh:${sessionId}` })
  let response
  try {
    response = await requestAttempt(credential, 'GET', `/api/documents?${query}`, undefined, callerSignal)
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}`)
    }
    const payload = JSON.parse(response.text)
    const rows = Array.isArray(payload.documents) ? payload.documents : []
    const title = typeof args.title === 'string' ? args.title.trim() : ''
    const duplicate = rows.find(row => (
      row
      && row.archived_at == null
      && String(row.title || '').trim() === title
    ))
    if (duplicate) {
      const documentId = String(duplicate.document_id || duplicate.id || 'unknown')
      const versionNo = duplicate.version_no
      const versionId = String(duplicate.current_version_id || duplicate.version_id || '')
      const updatedAt = String(duplicate.updated_at || duplicate.created_at || '')
      const metadata = [
        `document_id: ${documentId}`,
        versionNo == null ? '' : `version_no: ${versionNo}`,
        versionNo == null && versionId !== '' ? `version: ${versionId}` : '',
        updatedAt === '' ? '' : `updated_at: ${updatedAt}`,
      ].filter(Boolean).join(', ')
      throw new Error(
        `An active Reviso document titled "${title}" already exists in this session (${metadata}). `
        + 'Update it with document_id and base_version_id, or pass allow_duplicate=true to create another.',
      )
    }
  } catch (error) {
    if (String(error?.message || '').startsWith('An active Reviso document')) throw error
    console.warn('[reviso-dsh] duplicate-title preflight failed; allowing create:', messageOf(error))
  }
}

async function assertDeckUpdateTarget(credential, documentId, callerSignal) {
  const response = await requestAttempt(
    credential,
    'GET',
    `/api/documents/${encodeURIComponent(documentId)}/latest-content`,
    undefined,
    callerSignal,
  )
  if (response.status < 200 || response.status >= 300) {
    throw errorFromResponse(response.status, response.text)
  }
  let payload
  try {
    payload = JSON.parse(response.text)
  } catch {
    throw new Error('Reviso publish failed: latest document metadata was not valid JSON')
  }
  if (payload.document_kind !== 'html_deck') {
    throw new Error(
      'deck_contract_version is only valid for an html_deck document; '
      + `document ${documentId} is ${String(payload.document_kind || 'not a deck')}`,
    )
  }
  return payload
}

async function postUpdate(ctx, credential, documentId, body, callerSignal, operationId) {
  let current = credential
  const path = `/api/documents/${encodeURIComponent(documentId)}/agent-update`
  let result = await publishAttempt(current, body, callerSignal, path, operationId)
  if (result.status === 401 && current.refreshToken !== '') {
    current = await readCredential(ctx, { forceRefresh: true })
    result = await publishAttempt(current, body, callerSignal, path, operationId)
  }
  return parseSuccessfulPublish(result)
}

async function publishAttempt(credential, body, callerSignal, path = '/api/documents', operationId = '') {
  return requestAttempt(credential, 'POST', path, body, callerSignal, operationId)
}

function parseSuccessfulPublish(result) {
  if (result.status < 200 || result.status >= 300) {
    throw errorFromResponse(result.status, result.text)
  }
  try {
    const value = JSON.parse(result.text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object')
    return value
  } catch {
    throw new Error('Reviso publish failed: response was not valid JSON')
  }
}

function publishOperationId(exec, args, sessionId) {
  const replay = typeof exec?.callId === 'string' && exec.callId !== ''
    ? exec.callId
    : `${sessionId}:${args.document_id || ''}:${args.base_version_id || ''}:${args.title || ''}:${args.content || ''}`
  return `reviso_dsh_${createHash('sha256').update(replay).digest('hex').slice(0, 40)}`
}

function canonicalReviewUrl(server, documentId, explicit) {
  if (documentId === '') throw new Error('Reviso publish response had no document_id')
  if (typeof explicit === 'string' && explicit !== '') {
    try {
      const candidate = new URL(explicit, `${server}/`)
      const expectedOrigin = new URL(server).origin
      if (candidate.origin !== expectedOrigin) throw new Error('origin mismatch')
      return candidate.toString()
    } catch {
      throw new Error('Reviso publish response had an invalid review_url')
    }
  }
  const match = /^doc_([0-9a-f]{12})$/u.exec(documentId)
  return new URL(`/documents/${match ? match[1] : encodeURIComponent(documentId)}`, `${server}/`).toString()
}

async function requestAttempt(credential, method, path, body, callerSignal, operationId = '') {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const signal = callerSignal === undefined
    ? controller.signal
    : AbortSignal.any([callerSignal, controller.signal])
  const headers = {
    Accept: 'application/json',
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (operationId !== '') headers['Idempotency-Key'] = operationId
  headers.Authorization = `Bearer ${credential.token}`
  try {
    const response = await fetch(`${credential.server}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    })
    return { status: response.status, text: await response.text(), headers: response.headers }
  } finally {
    clearTimeout(timer)
  }
}
