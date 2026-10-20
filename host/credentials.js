/**
 * Shared Reviso credential resolution for the Host tool and HTTP routes.
 *
 * Primary source: DSH credential refs. Fallback: a prior `reviso auth login`
 * token in the CLI credentials file, with the workspace resolved from the
 * agent-connection self endpoint.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const TOKEN_REF = 'REVISO_DSH_TOKEN'
export const WORKSPACE_REF = 'REVISO_DSH_WORKSPACE_ID'
export const SERVER_REF = 'REVISO_DSH_SERVER'
export const REFRESH_REF = 'REVISO_DSH_REFRESH_TOKEN'

const DEFAULT_SERVER = 'https://reviso.work'

export async function readCredential(ctx) {
  const token = await optionalRef(ctx, TOKEN_REF)
  const server = normalizeServer(await optionalRef(ctx, SERVER_REF))
  if (token !== '' && server !== '') {
    const workspaceId = await optionalRef(ctx, WORKSPACE_REF)
      || await resolveWorkspaceFromConnection(server, token)
    return { token, workspaceId, server }
  }

  const cli = await readCliCredential(server)
  if (cli !== undefined) return cli

  throw new Error(
    'Reviso is not connected. Open the Reviso tab and connect, or run '
    + '`reviso auth login --server ' + DEFAULT_SERVER + '`.',
  )
}

export async function optionalRef(ctx, ref) {
  const resolved = ctx.credentials?.resolve !== undefined
    ? await ctx.credentials.resolve(ref)
    : undefined
  return String(resolved?.value || process.env[ref] || '')
}

export async function resolveWorkspaceFromConnection(server, token) {
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
  if (workspaceId === '') throw new Error('Reviso connection has no workspace scope')
  return workspaceId
}

export function normalizeServer(value) {
  return String(value || '').replace(/\/+$/, '')
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
  const server = normalizeServer(fallbackServer || String(document.server || DEFAULT_SERVER))
  const entry = document?.servers?.[server]
  const token = String(entry?.access_token || '')
  if (token === '') return undefined
  const workspaceId = String(entry?.workspace_id || '')
    || await resolveWorkspaceFromConnection(server, token)
  return { token, workspaceId, server }
}
