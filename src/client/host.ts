/** Same-origin Reviso host routes; the client never reads a token. */
export interface RevisoConnectionStatus {
  connected: boolean
  server: string
  workspaceId: string
  generation?: number
  capabilities?: { embed?: string; embedOrigin?: string }
}

export interface RevisoRow {
  document_id?: string
  id?: string
  title: string
  creator_name?: string
  updated_at?: string
  document_kind?: string
  unresolved_count?: number
  url?: string
  review_url?: string
  lifecycle_status?: string
  source_session_id?: string
}

export interface RevisoDocumentContent {
  document_id: string
  source_format: string
  document_kind?: string
  content: string
  content_html?: string
  version_id: string
  version_no: number
  updated_at?: string
}

interface CacheEntry<T> { expiresAt: number; value?: T; pending?: Promise<T> }
const pageCache = new Map<string, CacheEntry<RevisoDocumentPage>>()
const PAGE_TTL_MS = 30_000
let cacheScope = 'unknown|unknown|0'

export async function connectionStatus(): Promise<RevisoConnectionStatus> {
  const res = await fetch('/plugins/reviso/auth/status', {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!res.ok) throw await responseError(res, 'status')
  return await res.json() as RevisoConnectionStatus
}

export function setDashboardCacheScope(connection: RevisoConnectionStatus): boolean {
  const next = `${connection.server}|${connection.workspaceId}|${String(connection.generation ?? 0)}`
  if (next === cacheScope) return false
  cacheScope = next
  pageCache.clear()
  return true
}

export interface RevisoDocumentPage {
  rows: RevisoRow[]
  hasMore: boolean
  nextOffset: number | null
}

export async function dashboardDocumentsPage(limit = 50, offset = 0, sourceKind?: string): Promise<RevisoDocumentPage> {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (sourceKind !== undefined) query.set('source_kind', sourceKind)
  const key = `${cacheScope}|${query.toString()}`
  const cached = pageCache.get(key)
  if (cached?.value && cached.expiresAt > Date.now()) return cached.value
  if (cached?.pending) return cached.pending
  const pending = fetch(`/plugins/reviso/dashboard?${query}`, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  }).then(async res => {
    if (!res.ok) throw await responseError(res, 'dashboard')
    const body = await res.json() as { reviews?: RevisoRow[]; has_more?: boolean; next_offset?: number | null }
    const value = {
      rows: Array.isArray(body.reviews) ? body.reviews : [],
      hasMore: body.has_more === true,
      nextOffset: typeof body.next_offset === 'number' ? body.next_offset : null,
    }
    pageCache.set(key, { value, expiresAt: Date.now() + PAGE_TTL_MS })
    return value
  }).finally(() => {
    const entry = pageCache.get(key)
    if (entry?.pending === pending) delete entry.pending
  })
  pageCache.set(key, { ...(cached || {}), pending, expiresAt: cached?.expiresAt || 0 })
  return pending
}

export function clearDashboardDocumentsCache(): void {
  pageCache.clear()
}

export async function dashboardDocuments(limit = 50, sourceKind?: string): Promise<RevisoRow[]> {
  return (await dashboardDocumentsPage(limit, 0, sourceKind)).rows
}

export async function sessionDocuments(sessionId: string): Promise<RevisoRow[]> {
  const res = await fetch(`/plugins/reviso/documents?session_id=${encodeURIComponent(sessionId)}`, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!res.ok) throw await responseError(res, 'documents')
  const body = await res.json() as { documents?: RevisoRow[] }
  return Array.isArray(body.documents) ? body.documents : []
}

export interface RevisoEmbedSession {
  session_id: string
  document_id: string
  embed_url: string
  code_expires_at: string
  code_expires_in: number
  token_expires_in: number
}

export class RevisoHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'request_failed',
    readonly retryable = status === 408 || status === 425 || status === 429 || status >= 500,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'RevisoHttpError'
  }
}

export async function documentContent(documentId: string): Promise<RevisoDocumentContent> {
  const res = await fetch(`/plugins/reviso/document?id=${encodeURIComponent(documentId)}`, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!res.ok) throw await responseError(res, 'document')
  return await res.json() as RevisoDocumentContent
}

export async function revokeEmbedSession(sessionId: string): Promise<void> {
  const res = await fetch('/plugins/reviso/embed-session/revoke', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Reviso-DSH-Request': '1',
    },
    credentials: 'same-origin',
    body: JSON.stringify({ session_id: sessionId }),
  })
  if (!res.ok) throw await responseError(res, 'embed revoke')
}

export async function embedSession(
  documentId: string,
  theme: 'light' | 'dark' | 'system',
): Promise<RevisoEmbedSession> {
  const res = await fetch('/plugins/reviso/embed-session', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Reviso-DSH-Request': '1',
    },
    credentials: 'same-origin',
    body: JSON.stringify({ document_id: documentId, theme, locale: navigator.language }),
  })
  if (!res.ok) throw await responseError(res, 'embed session')
  const body = await res.json() as RevisoEmbedSession
  validateEmbedUrl(body.embed_url)
  return body
}

async function responseError(res: Response, fallback: string): Promise<RevisoHttpError> {
  const body = await res.json().catch(() => ({})) as {
    error?: string; code?: string; retryable?: boolean; request_id?: string; details?: unknown
  }
  return new RevisoHttpError(
    res.status,
    body.error || `${fallback} HTTP ${res.status}`,
    body.code,
    body.retryable,
    body.request_id,
    body.details,
  )
}

function validateEmbedUrl(value: string): void {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('invalid Reviso embed URL') }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error('invalid Reviso embed URL')
  }
}

export function startRevisoOAuth(): void {
  window.open(
    '/plugins/reviso/auth/start',
    'reviso-dsh-oauth',
    'width=520,height=720,menubar=no,toolbar=no',
  )
}

export function onRevisoConnected(handler: () => void): () => void {
  const listener = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return
    if ((event.data as { type?: string } | null)?.type === 'reviso-dsh:connected') handler()
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
