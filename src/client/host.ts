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

export async function connectionStatus(): Promise<RevisoConnectionStatus> {
  const res = await fetch('/plugins/reviso/auth/status', { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`status HTTP ${res.status}`)
  return await res.json() as RevisoConnectionStatus
}

export async function dashboardDocuments(limit = 50): Promise<RevisoRow[]> {
  const res = await fetch(`/plugins/reviso/dashboard?limit=${limit}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`dashboard HTTP ${res.status}`)
  const body = await res.json() as { reviews?: RevisoRow[] }
  return Array.isArray(body.reviews) ? body.reviews : []
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
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error || `embed session HTTP ${res.status}`)
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
