import { useEffect, useState } from 'react'
import type { RevisoStatus } from './state.ts'
import {
  connectionStatus, onRevisoConnected, sessionDocuments, startRevisoOAuth,
  type RevisoRow,
} from './host.ts'

interface SessionViewProps {
  /** Framework-standard prop for session-scope slots. */
  sessionId: string | undefined
}

interface SessionDoc {
  id: string
  title: string
  url: string
  creator: string
  updatedAt: number | null
  kind: 'document' | 'html_deck' | 'other'
  unresolved: number
}

const statusLabel: Record<RevisoStatus, string> = {
  unconfigured: '未连接 Reviso',
  loading: '加载中…',
  live: '已连接 Reviso',
  error: '出错',
}

const kindLabel: Record<SessionDoc['kind'], string> = {
  document: '文档',
  html_deck: '演示',
  other: '文档',
}

function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (typeof iso !== 'string' || iso === '') return '-'
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return '-'
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function mapRow(row: RevisoRow, server: string): SessionDoc | null {
  if (typeof row.title !== 'string' || row.title === '') return null
  const documentId = row.document_id || row.id || ''
  const kind = row.document_kind === 'html_deck' ? 'html_deck'
    : row.document_kind === 'document' ? 'document' : 'other'
  const updated = typeof row.updated_at === 'string' ? Date.parse(row.updated_at) : NaN
  return {
    id: documentId || row.title,
    title: row.title,
    url: row.url || row.review_url
      || (documentId !== '' ? `${server}/documents/${documentId}` : ''),
    creator: row.creator_name || '-',
    updatedAt: Number.isFinite(updated) ? updated : null,
    kind,
    unresolved: typeof row.unresolved_count === 'number' ? row.unresolved_count : 0,
  }
}

const STYLE_ID = 'reviso-dsh-session-styles'

const CSS = `
.rs-session{container-type:inline-size;height:100%;overflow:auto;padding:16px 18px;font:13px/1.6 -apple-system,"Segoe UI",system-ui,sans-serif;color:inherit}
.rs-session-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:2px}
.rs-session-title{font-size:13px;font-weight:600;letter-spacing:0}
.rs-session-key{font-size:11px;color:var(--dsw-text-tertiary,#8b949e);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rs-session-status{display:flex;align-items:center;gap:8px;margin:8px 0 4px;font-size:11px;color:var(--dsw-text-secondary,#57606a)}
.rs-session-status[data-state="error"]{color:#b35900}
.rs-session-connect{border:1px solid var(--dsw-border,#d0d7de);background:transparent;color:inherit;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer}
.rs-session-empty{margin-top:28px;text-align:center;color:var(--dsw-text-tertiary,#8b949e);font-size:12px}
.rs-file-table{margin-top:10px;border-top:1px solid var(--dsw-border,#d8dee4)}
.rs-file-row{display:grid;grid-template-columns:minmax(0,2.6fr) minmax(0,.9fr) minmax(0,86px) 52px;align-items:center;gap:12px;min-width:0;min-height:52px;border-bottom:1px solid var(--dsw-border,#d8dee4);padding:0 10px;font-size:13px}
.rs-file-row-head{min-height:36px;color:var(--dsw-text-tertiary,#8b949e);font-size:12px;font-weight:600}
.rs-file-row:not(.rs-file-row-head):hover{background:var(--dsw-elevated,#f6f8fa)}
.rs-file-row>*{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-text-tertiary,#6e7781)}
.rs-file-name{display:flex;align-items:center;gap:10px;color:inherit}
.rs-file-name>a{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:inherit;font-weight:500;text-decoration:none}
.rs-file-name>a:hover{color:var(--dsw-accent,#0969da)}
.rs-file-icon{display:grid;place-items:center;flex:0 0 22px;width:22px;height:22px;border-radius:5px;background:var(--dsw-file-bg,#ddf4ff);color:var(--dsw-accent,#0969da)}
.rs-file-icon[data-kind="html_deck"]{background:var(--dsw-deck-bg,#fff1e5);color:#bc4c00}
.rs-file-meta{font-size:12px}
.rs-file-pending{color:#bc4c00}
@container (max-width: 460px){
  .rs-file-row{grid-template-columns:minmax(0,1fr) 64px;gap:8px}
  .rs-file-row>.rs-file-creator,.rs-file-row>.rs-file-kind{display:none}
}
`

function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

function FileIcon({ kind }: { kind: SessionDoc['kind'] }) {
  const path = kind === 'html_deck'
    ? 'M3 3h8l2 2v14l-2-2H3V3zm10 2h5v13l-2.5-2L13 18V5z'
    : 'M5 2h8l4 4v16H5V2zm8 1v3h3l-3-3zM7 9h8v1.5H7V9zm0 3h8v1.5H7V12zm0 3h6v1.5H7V12z'
  return (
    <span className='rs-file-icon' data-kind={kind} aria-hidden>
      <svg width='13' height='13' viewBox='0 0 24 24' fill='currentColor'>
        <path d={path} />
      </svg>
    </span>
  )
}

/**
 * Per-session Reviso view (conversation.view ring, session scope): documents
 * produced by THIS session. All reads go through the same-origin Host bridge,
 * so the browser never sees a Reviso token.
 */
export function RevisoSessionView(props: SessionViewProps) {
  ensureStyles()
  const sessionId = props.sessionId ?? ''
  const [status, setStatus] = useState<RevisoStatus>('unconfigured')
  const [message, setMessage] = useState('')
  const [docs, setDocs] = useState<SessionDoc[]>([])

  useEffect(() => {
    if (sessionId === '') return
    let alive = true
    const load = async () => {
      setStatus('loading')
      try {
        const connection = await connectionStatus()
        if (!connection.connected) {
          if (alive) { setStatus('unconfigured'); setDocs([]); setMessage('') }
          return
        }
        const rows = await sessionDocuments(sessionId)
        if (alive) {
          setStatus('live')
          setDocs(rows.map(row => mapRow(row, connection.server)).filter((d): d is SessionDoc => d !== null))
          setMessage('')
        }
      } catch (err) {
        if (alive) {
          setStatus('error')
          setDocs([])
          setMessage(err instanceof Error ? err.message : String(err))
        }
      }
    }
    void load()
    const off = onRevisoConnected(() => { void load() })
    return () => { alive = false; off() }
  }, [sessionId])

  return (
    <div className='rs-session'>
      <div className='rs-session-head'>
        <span className='rs-session-title'>本会话产生的 Reviso 文档</span>
        <span
          className='rs-session-key'
          title={sessionId === '' ? undefined : `session_key: dsh:${sessionId}`}
        >
          {sessionId === '' ? '' : `dsh:${sessionId}`}
        </span>
      </div>
      {status !== 'live' && (
        <div className='rs-session-status' data-state={status === 'error' ? 'error' : undefined}>
          <span>{statusLabel[status]}{message === '' ? '' : ` — ${message}`}</span>
          <button type='button' className='rs-session-connect' onClick={startRevisoOAuth}>
            连接 Reviso
          </button>
        </div>
      )}
      {docs.length === 0 && status === 'live'
        ? <div className='rs-session-empty'>本会话还没有产出 Reviso 文档。让 agent 调用 reviso_publish 发布。</div>
        : docs.length === 0
          ? null
          : (
              <div className='rs-file-table' role='list' aria-label='本会话的 Reviso 文档'>
                <div className='rs-file-row rs-file-row-head' role='listitem'>
                  <span>名称</span><span className='rs-file-creator'>创建者</span><span>更新时间</span><span className='rs-file-kind'>类型</span>
                </div>
                {docs.map(doc => (
                  <div className='rs-file-row' role='listitem' key={doc.id}>
                    <span className='rs-file-name'>
                      <FileIcon kind={doc.kind} />
                      {doc.url === ''
                        ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.title}</span>
                        : <a href={doc.url} target='_blank' rel='noreferrer'>{doc.title}</a>}
                    </span>
                    <span className='rs-file-creator'>{doc.creator}</span>
                    <span className='rs-file-meta'>
                      {doc.unresolved > 0
                        ? <span className='rs-file-pending'>{doc.unresolved} 条待处理</span>
                        : relativeTime(doc.updatedAt === null ? undefined : new Date(doc.updatedAt).toISOString())}
                    </span>
                    <span className='rs-file-kind'>{kindLabel[doc.kind]}</span>
                  </div>
                ))}
              </div>
            )}
    </div>
  )
}
