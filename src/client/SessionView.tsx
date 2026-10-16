import { useEffect, useState } from 'react'
import type { RevisoStatus } from './state.ts'
import { demoDocs } from './state.ts'

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
}

const statusLabel: Record<RevisoStatus, string> = {
  demo: '演示数据',
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

function mapRow(row: Record<string, unknown>, server: string): SessionDoc | null {
  if (typeof row.title !== 'string' || row.title === '') return null
  const documentId = typeof row.document_id === 'string' ? row.document_id : ''
  const kind = row.document_kind === 'html_deck' ? 'html_deck'
    : row.document_kind === 'document' ? 'document' : 'other'
  return {
    id: typeof row.id === 'string' ? row.id : documentId || row.title,
    title: row.title,
    url: typeof row.url === 'string' && row.url !== '' ? row.url
      : documentId !== '' ? `${server}/reviews/${documentId}` : '',
    creator: typeof row.creator_name === 'string' && row.creator_name !== '' ? row.creator_name : '-',
    updatedAt: typeof row.updated_at === 'string' ? Date.parse(row.updated_at) : null,
    kind,
  }
}

const STYLE_ID = 'reviso-dsh-session-styles'

const CSS = `
.rs-session{container-type:inline-size;height:100%;overflow:auto;padding:16px 18px;font:13px/1.6 -apple-system,"Segoe UI",system-ui,sans-serif;color:inherit}
.rs-session-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:2px}
.rs-session-title{font-size:13px;font-weight:600;letter-spacing:0}
.rs-session-key{font-size:11px;color:#8b949e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rs-session-status{display:inline-block;margin:8px 0 4px;font-size:11px;padding:2px 8px;border-radius:4px;color:#9a6700;background:#fff8c5}
.rs-session-status[data-state="error"]{color:#b35900;background:#fff1e5}
.rs-session-empty{margin-top:28px;text-align:center;color:#8b949e;font-size:12px}
.rs-file-table{margin-top:10px;border-top:1px solid var(--rs-border,#d8dee4)}
.rs-file-row{display:grid;grid-template-columns:minmax(0,2.6fr) minmax(0,.9fr) minmax(0,86px) 52px;align-items:center;gap:12px;min-width:0;min-height:52px;border-bottom:1px solid var(--rs-border,#d8dee4);padding:0 10px;font-size:13px}
.rs-file-row-head{min-height:36px;color:var(--rs-text-tertiary,#8b949e);font-size:12px;font-weight:600}
.rs-file-row:not(.rs-file-row-head):hover{background:var(--rs-elevated,#f6f8fa)}
.rs-file-row>*{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--rs-text-tertiary,#6e7781)}
.rs-file-name{display:flex;align-items:center;gap:10px;color:inherit}
.rs-file-name>a{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:inherit;font-weight:500;text-decoration:none}
.rs-file-name>a:hover{color:var(--rs-accent,#0969da)}
.rs-file-icon{display:grid;place-items:center;flex:0 0 22px;width:22px;height:22px;border-radius:5px;background:var(--rs-file-bg,#ddf4ff);color:var(--rs-accent,#0969da)}
.rs-file-icon[data-kind="html_deck"]{background:var(--rs-deck-bg,#fff1e5);color:#bc4c00}
.rs-file-meta{font-size:12px}
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
 * produced by THIS session, mirroring the reviso workspace file list. The
 * binding key is the L0 contract's `session_key = 'dsh:' + sessionId`.
 */
export function RevisoSessionView(props: SessionViewProps) {
  ensureStyles()
  const sessionId = props.sessionId ?? ''
  const [status, setStatus] = useState<RevisoStatus>('demo')
  const [message, setMessage] = useState('')
  const [docs, setDocs] = useState<SessionDoc[]>([])

  useEffect(() => {
    if (sessionId === '') return
    let alive = true
    const server = (localStorage.getItem('reviso.dsh.server') ?? '').replace(/\/$/, '')
    const token = localStorage.getItem('reviso.dsh.token') ?? ''
    if (server === '' || token === '') {
      setStatus('demo')
      setDocs(demoDocs().map(d => ({
        id: d.id,
        title: d.title,
        url: d.url,
        creator: '演示',
        updatedAt: d.updated !== '' ? Date.parse(d.updated) : null,
        kind: 'document' as const,
      })))
      setMessage('未配置凭证 —— 演示数据。本会话键：dsh:' + sessionId.slice(0, 12))
      return
    }
    setStatus('loading')
    fetch(`${server}/api/documents?session_key=dsh:${sessionId}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body: unknown = await res.json()
        const rows = Array.isArray(body) ? body : (body as Record<string, unknown>)?.documents
        if (!Array.isArray(rows)) throw new Error('响应格式不符')
        const mapped = rows
          .map(row => mapRow(row as Record<string, unknown>, server))
          .filter((d): d is SessionDoc => d !== null)
        if (alive) { setStatus('live'); setDocs(mapped); setMessage('') }
      })
      .catch(err => {
        if (alive) {
          setStatus('error')
          setDocs([])
          setMessage(`拉取失败（${err instanceof Error ? err.message : String(err)}）。检查 server/token 与部署端 REVISO_CORS_ALLOWLIST。本会话键：dsh:${sessionId.slice(0, 12)}`)
        }
      })
    return () => { alive = false }
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
        <span className='rs-session-status' data-state={status === 'error' ? 'error' : undefined}>
          {statusLabel[status]}{message === '' ? '' : ` — ${message}`}
        </span>
      )}
      {docs.length === 0 && status === 'live'
        ? <div className='rs-session-empty'>本会话还没有产出 Reviso 文档。</div>
        : docs.length === 0 && status !== 'live'
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
                    <span className='rs-file-meta'>{relativeTime(doc.updatedAt === null ? undefined : new Date(doc.updatedAt).toISOString())}</span>
                    <span className='rs-file-kind'>{kindLabel[doc.kind]}</span>
                  </div>
                ))}
              </div>
            )}
    </div>
  )
}
