import { useEffect, useState } from 'react'
import type { RevisoDoc, RevisoStatus } from './state.ts'
import { demoDocs } from './state.ts'

interface SessionViewProps {
  /** Framework-standard prop for session-scope slots. */
  sessionId: string | undefined
}

const statusLabel: Record<RevisoStatus, string> = {
  demo: '演示数据',
  loading: '加载中…',
  live: '已连接 Reviso',
  error: '出错',
}

/**
 * Per-session Reviso view (conversation.view ring, session scope): documents
 * produced by THIS session. The binding key is the L0 contract's
 * `session_key = 'dsh:' + sessionId`; the reviso main repo serves it once the
 * document_sources phase lands. Demo rows keep the view alive until then.
 */
export function RevisoSessionView(props: SessionViewProps) {
  const sessionId = props.sessionId ?? ''
  const [status, setStatus] = useState<RevisoStatus>('demo')
  const [message, setMessage] = useState('')
  const [docs, setDocs] = useState<RevisoDoc[]>([])

  useEffect(() => {
    if (sessionId === '') return
    let alive = true
    const server = (localStorage.getItem('reviso.dsh.server') ?? '').replace(/\/$/, '')
    const token = localStorage.getItem('reviso.dsh.token') ?? ''
    if (server === '' || token === '') {
      setStatus('demo')
      setDocs(demoDocs())
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
        const mapped = rows.flatMap(row => {
          const r = row as Record<string, unknown>
          if (typeof r.title !== 'string') return []
          const documentId = typeof r.document_id === 'string' ? r.document_id : ''
          return [{
            id: typeof r.id === 'string' ? r.id : documentId || r.title,
            title: r.title,
            updated: typeof r.updated_at === 'string' ? r.updated_at.slice(0, 10) : '',
            url: typeof r.url === 'string' && r.url !== '' ? r.url
              : documentId !== '' ? `${server}/reviews/${documentId}` : '',
          }]
        })
        if (alive) { setStatus('live'); setDocs(mapped); setMessage('') }
      })
      .catch(err => {
        if (alive) {
          setStatus('demo')
          setDocs(demoDocs())
          setMessage(`拉取失败（${err instanceof Error ? err.message : String(err)}）—— 显示演示数据。检查 server/token 与部署端 REVISO_CORS_ALLOWLIST。本会话键：dsh:${sessionId.slice(0, 12)}`)
        }
      })
    return () => { alive = false }
  }, [sessionId])

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 16, font: '12px/1.6 -apple-system, system-ui, sans-serif' }}>
      <div style={{ marginBottom: 10, fontSize: 11, color: status === 'demo' ? '#9a6700' : '#57606a', background: status === 'demo' ? '#fff8c5' : 'transparent', display: 'inline-block', padding: '2px 8px', borderRadius: 4 }}>
        {statusLabel[status]}{message === '' ? '' : ` — ${message}`}
      </div>
      <div style={{ fontSize: 11, color: '#8c959f', marginBottom: 8 }}>
        本会话产生的 Reviso 文档{sessionId === '' ? '' : `（session_key: dsh:${sessionId.slice(0, 12)}…）`}
      </div>
      {docs.length === 0
        ? <div style={{ color: '#8c959f' }}>本会话还没有产出 Reviso 文档。</div>
        : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {docs.map(doc => (
                <li key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid #d0d7de33' }}>
                  {doc.url === ''
                    ? <span style={{ overflowWrap: 'anywhere' }}>{doc.title}</span>
                    : <a href={doc.url} target='_blank' rel='noreferrer' style={{ color: '#0969da', overflowWrap: 'anywhere' }}>{doc.title}</a>}
                  <span style={{ color: '#8c959f', whiteSpace: 'nowrap', fontSize: 11 }}>{doc.updated}</span>
                </li>
              ))}
            </ul>
          )}
    </div>
  )
}
