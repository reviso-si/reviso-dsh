/** Same-origin Reviso host routes; the client never reads a token. */
export interface RevisoConnectionStatus {
  connected: boolean
  server: string
  workspaceId: string
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

export async function connectionStatus(): Promise<RevisoConnectionStatus> {
  const res = await fetch('/plugins/reviso/auth/status', { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`status HTTP ${res.status}`)
  return await res.json() as RevisoConnectionStatus
}

export interface RevisoDocumentPage {
  rows: RevisoRow[]
  hasMore: boolean
  nextOffset: number | null
}

export async function dashboardDocumentsPage(limit = 50, offset = 0, sourceKind?: string): Promise<RevisoDocumentPage> {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (sourceKind !== undefined) query.set('source_kind', sourceKind)
  const key = query.toString()
  const cached = pageCache.get(key)
  if (cached?.value && cached.expiresAt > Date.now()) return cached.value
  if (cached?.pending) return cached.pending
  const pending = fetch(`/plugins/reviso/dashboard?${query}`, {
    headers: { Accept: 'application/json' },
  }).then(async res => {
    if (!res.ok) throw new Error(`dashboard HTTP ${res.status}`)
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
  })
  if (!res.ok) throw new Error(`documents HTTP ${res.status}`)
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
  constructor(readonly status: number, message: string, readonly code = 'request_failed') {
    super(message)
    this.name = 'RevisoHttpError'
  }
}

export async function documentContent(documentId: string): Promise<RevisoDocumentContent> {
  const res = await fetch(`/plugins/reviso/document?id=${encodeURIComponent(documentId)}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; code?: string }
    throw new RevisoHttpError(res.status, body.error || `document HTTP ${res.status}`, body.code)
  }
  return await res.json() as RevisoDocumentContent
}

export async function embedSession(
  documentId: string,
  theme: 'light' | 'dark' | 'system',
): Promise<RevisoEmbedSession> {
  const res = await fetch('/plugins/reviso/embed-session', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ document_id: documentId, theme, locale: navigator.language }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; code?: string }
    throw new RevisoHttpError(res.status, body.error || `embed session HTTP ${res.status}`, body.code)
  }
  return await res.json() as RevisoEmbedSession
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
