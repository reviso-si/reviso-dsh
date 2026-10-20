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
.rs-session{container-type:inline-size;height:100%;overflow:auto;padding:22px 24px 28px;font:var(--dsw-font-body,13px/1.6 -apple-system,"Segoe UI",system-ui,sans-serif);color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-base,transparent)}
.rs-session-inner{max-width:860px;margin:0 auto}
.rs-session-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.rs-session-title{font:var(--dsw-font-title,600 14px/1.4 -apple-system,system-ui,sans-serif);letter-spacing:0;color:var(--dsw-alias-label-primary,inherit)}
.rs-session-subtitle{margin-top:2px;font:var(--dsw-font-caption,12px/1.5 -apple-system,system-ui,sans-serif);color:var(--dsw-alias-label-tertiary,#8b949e)}
.rs-session-status{display:flex;align-items:center;gap:8px;font:var(--dsw-font-caption,12px/1.5 -apple-system,system-ui,sans-serif);color:var(--dsw-alias-label-tertiary,#8b949e);white-space:nowrap}
.rs-session-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#2da44e);flex:0 0 auto}
.rs-session-status[data-state="error"] .rs-session-dot{background:var(--dsw-alias-state-error-primary,#cf222e)}
.rs-session-status[data-state="unconfigured"] .rs-session-dot{background:var(--dsw-alias-label-tertiary,#8b949e)}
.rs-session-connect{border:1px solid var(--dsw-alias-border-l2,#d0d7de);background:var(--dsw-alias-button-elevated-fill,transparent);color:var(--dsw-alias-label-primary,inherit);border-radius:6px;padding:3px 10px;font:inherit;cursor:pointer}
.rs-session-connect:hover{background:var(--dsw-alias-interactive-bg-hover,#f6f8fa)}
.rs-session-message{margin-top:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,#d8dee4);border-radius:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#57606a);background:var(--dsw-alias-bg-module-platform,transparent)}
.rs-session-message[data-state="error"]{border-color:var(--dsw-alias-state-error-secondary,#cf222e);color:var(--dsw-alias-state-error-primary,#cf222e)}
.rs-session-empty{margin-top:56px;text-align:center;color:var(--dsw-alias-label-tertiary,#8b949e);font-size:12px;line-height:1.7}
.rs-session-empty strong{display:block;margin-bottom:4px;color:var(--dsw-alias-label-secondary,#57606a);font-weight:500}
.rs-doc-list{margin-top:16px;display:flex;flex-direction:column;gap:2px}
.rs-doc{display:flex;align-items:flex-start;gap:12px;padding:10px 10px;border-radius:8px;text-decoration:none;color:inherit;min-width:0}
.rs-doc:hover{background:var(--dsw-alias-interactive-bg-hover,#f6f8fa)}
.rs-doc-icon{display:grid;place-items:center;flex:0 0 26px;width:26px;height:26px;margin-top:1px;border-radius:6px;background:var(--dsw-alias-bg-module-platform,#eaeef2);color:var(--dsw-alias-label-secondary,#57606a)}
.rs-doc-icon[data-kind="html_deck"]{color:var(--dsw-alias-state-business-primary,#0969da)}
.rs-doc-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.rs-doc-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,inherit);font-weight:500}
.rs-doc:hover .rs-doc-title{color:var(--dsw-alias-state-business-primary,#0969da)}
.rs-doc-meta{font:var(--dsw-font-caption,12px/1.5 -apple-system,system-ui,sans-serif);color:var(--dsw-alias-label-tertiary,#8b949e);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rs-doc-badge{flex:0 0 auto;margin-top:1px;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-state-business-tertiary,rgba(9,105,218,.1));color:var(--dsw-alias-state-business-primary,#0969da);font:var(--dsw-font-caption,11px/1.6 -apple-system,system-ui,sans-serif);font-weight:500}
@container (max-width: 520px){
  .rs-session{padding:18px 16px 24px}
  .rs-doc{padding:10px 6px}
  .rs-doc-meta{white-space:normal}
  .rs-session-status{white-space:normal;text-align:right}
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
    <span className='rs-doc-icon' data-kind={kind} aria-hidden>
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
      <div className='rs-session-inner'>
        <div className='rs-session-head'>
          <div>
            <div className='rs-session-title'>Reviso</div>
            <div className='rs-session-subtitle'>本会话产生的文档</div>
          </div>
          <div className='rs-session-status' data-state={status}>
            <span className='rs-session-dot' aria-hidden />
            <span>{statusLabel[status]}</span>
            {status !== 'live' && (
              <button type='button' className='rs-session-connect' onClick={startRevisoOAuth}>
                连接 Reviso
              </button>
            )}
          </div>
        </div>
        {message !== '' && (
          <div className='rs-session-message' data-state={status === 'error' ? 'error' : undefined}>
            {message}
          </div>
        )}
        {docs.length === 0 && status === 'live'
          ? (
              <div className='rs-session-empty'>
                <strong>还没有文档</strong>
                让 agent 调用 reviso_publish 发布后，这里会按本会话列出来。
              </div>
            )
          : docs.length === 0
            ? null
            : (
                <div className='rs-doc-list' role='list' aria-label='本会话的 Reviso 文档'>
                  {docs.map(doc => {
                    const meta = `${doc.creator} · ${relativeTime(
                      doc.updatedAt === null ? undefined : new Date(doc.updatedAt).toISOString(),
                    )}`
                    const content = (
                      <>
                        <FileIcon kind={doc.kind} />
                        <span className='rs-doc-main'>
                          <span className='rs-doc-title'>{doc.title}</span>
                          <span className='rs-doc-meta'>{meta}</span>
                        </span>
                        {doc.unresolved > 0 && (
                          <span className='rs-doc-badge'>{doc.unresolved} 待处理</span>
                        )}
                      </>
                    )
                    return doc.url === ''
                      ? <div className='rs-doc' role='listitem' key={doc.id}>{content}</div>
                      : (
                          <a className='rs-doc' role='listitem' key={doc.id}
                            href={doc.url} target='_blank' rel='noreferrer'>
                            {content}
                          </a>
                        )
                  })}
                </div>
              )}
      </div>
    </div>
  )
}
