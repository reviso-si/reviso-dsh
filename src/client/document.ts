import type { RevisoRow } from './host.ts'

export interface SessionDoc {
  id: string
  title: string
  url: string
  creator: string
  updatedAt: number | null
  kind: 'document' | 'html_deck' | 'other'
  unresolved: number
  sessionId?: string
}

/** Build a canonical absolute document URL on the configured Reviso origin. */
export function browserDocumentUrl(server: string, documentId: string, explicit = ''): string {
  const base = validatedServer(server)
  if (base === '') return ''
  if (explicit !== '') {
    try {
      const url = new URL(explicit, `${base}/`)
      return url.origin === base && (url.protocol === 'https:' || isLoopbackHttp(url)) ? url.toString() : ''
    } catch { return '' }
  }
  if (documentId === '') return ''
  const match = /^doc_([0-9a-f]{12})$/u.exec(documentId)
  const path = match?.[1] ?? documentId
  try { return new URL(`/documents/${encodeURIComponent(path)}`, `${base}/`).toString() } catch { return '' }
}

function validatedServer(value: string): string {
  try {
    const url = new URL(value)
    if (url.username !== '' || url.password !== '') return ''
    if (url.protocol === 'https:' || isLoopbackHttp(url)) return url.origin
    return ''
  } catch { return '' }
}

function isLoopbackHttp(url: URL): boolean {
  return url.protocol === 'http:'
    && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '::1')
}

export function mapRow(row: RevisoRow, server: string): SessionDoc | null {
  if (typeof row.title !== 'string' || row.title === '') return null
  const documentId = row.document_id || row.id || ''
  const kind = row.document_kind === 'html_deck' ? 'html_deck'
    : row.document_kind === 'document' ? 'document' : 'other'
  const updated = typeof row.updated_at === 'string' ? Date.parse(row.updated_at) : NaN
  return {
    id: documentId || row.title,
    title: row.title,
    url: browserDocumentUrl(server, documentId, row.url || row.review_url || ''),
    creator: row.creator_name || '-',
    updatedAt: Number.isFinite(updated) ? updated : null,
    kind,
    unresolved: typeof row.unresolved_count === 'number' ? row.unresolved_count : 0,
    ...(row.source_session_id !== undefined ? { sessionId: row.source_session_id } : {}),
  }
}

export function sameOrigin(value: string | undefined, origin: string): boolean {
  if (value === undefined || origin === '') return false
  try {
    return new URL(value).origin === origin
  } catch {
    return false
  }
}
