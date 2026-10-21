import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { connectionStatus, dashboardDocuments } from './host.ts'

export interface RevisoDoc {
  id: string
  title: string
  url: string
  creator: string
  updated: string
  kind: 'document' | 'html_deck' | 'other'
  unresolved: number
}

export type RevisoStatus = 'unconfigured' | 'loading' | 'live' | 'error'

export interface RevisoState {
  open: boolean
  status: RevisoStatus
  message: string
  docs: RevisoDoc[]
}

type RevisoActions = {
  togglePanel: (d: RevisoState) => void
  closePanel: (d: RevisoState) => void
  setDocs: (d: RevisoState, status: RevisoStatus, docs: RevisoDoc[], message: string) => void
}

export function createRevisoStore(): EngineStoreHandle<RevisoState, RevisoActions> {
  return defineStore({
    init: (): RevisoState => ({
      open: false,
      status: 'unconfigured',
      message: '',
      docs: [],
    }),
    actions: {
      togglePanel: (d) => { d.open = !d.open },
      closePanel: (d) => { d.open = false },
      setDocs: (d, status: RevisoStatus, docs: RevisoDoc[], message: string) => {
        d.status = status
        d.docs = docs
        d.message = message
      },
    },
  })
}

/** Load the personal-workspace dashboard through the Host; no browser token. */
export async function loadDocs(engine: { actions: RevisoActions }): Promise<void> {
  engine.actions.setDocs('loading', [], '')
  try {
    const connection = await connectionStatus()
    if (!connection.connected) {
      engine.actions.setDocs('unconfigured', [], '')
      return
    }
    const rows = await dashboardDocuments()
    engine.actions.setDocs('live', rows.map(row => mapDoc(row, connection.server)), '')
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    engine.actions.setDocs('error', [], reason)
  }
}

function mapDoc(row: {
  document_id?: string
  id?: string
  title: string
  creator_name?: string
  updated_at?: string
  document_kind?: string
  unresolved_count?: number
  url?: string
  review_url?: string
}, server: string): RevisoDoc {
  const documentId = row.document_id || row.id || row.title
  const explicit = row.url || row.review_url || ''
  return {
    id: documentId,
    title: row.title,
    url: explicit !== ''
      ? explicit
      : row.document_id !== undefined ? `${server}/documents/${row.document_id}` : '',
    creator: row.creator_name || '-',
    updated: row.updated_at ? row.updated_at.slice(0, 10) : '',
    kind: row.document_kind === 'html_deck'
      ? 'html_deck'
      : row.document_kind === 'document' ? 'document' : 'other',
    unresolved: typeof row.unresolved_count === 'number' ? row.unresolved_count : 0,
  }
}
