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
