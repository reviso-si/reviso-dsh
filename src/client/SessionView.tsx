import { useEffect, useRef, useState } from 'react'
import type { RevisoStatus } from './state.ts'
import { zh, type RevisoLocaleKey } from './locales.ts'
import {
  connectionStatus, embedSession, onRevisoConnected, sessionDocuments, startRevisoOAuth,
  type RevisoRow,
} from './host.ts'

interface SessionViewProps {
  /** Framework-standard prop for session-scope slots. */
  sessionId: string | undefined
  /** Locale seat injected by the slot registry. */
  t?: (key: RevisoLocaleKey) => string
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

function relativeTime(iso: string | undefined, t: (key: RevisoLocaleKey) => string, now = Date.now()): string {
  if (typeof iso !== 'string' || iso === '') return '-'
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return '-'
  const diff = now - ts
  if (diff < 60_000) return t('time.now')
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} ${t('time.minutes')}`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ${t('time.hours')}`
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} ${t('time.days')}`
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

function preferredTheme(): 'light' | 'dark' | 'system' {
  const selected = document.documentElement.dataset.theme
  if (selected === 'light' || selected === 'dark') return selected
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function sameOrigin(value: string | undefined, origin: string): boolean {
  if (value === undefined || origin === '') return false
  try {
    return new URL(value).origin === origin
  } catch {
    return false
  }
}

const STYLE_ID = 'reviso-dsh-session-styles'

const CSS = `
.rs-session{--rs-accent:#6366f1;--rs-accent-strong:#4f46e5;--rs-accent-tint:rgba(99,102,241,.1);container-type:inline-size;height:100%;overflow:auto;padding:22px 24px 28px;font:var(--dsw-font-body,13px/1.6 -apple-system,"Segoe UI",system-ui,sans-serif);color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-base,transparent)}
@media (prefers-color-scheme: dark){.rs-session{--rs-accent:#818cf8;--rs-accent-strong:#6366f1;--rs-accent-tint:rgba(99,102,241,.2)}}
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
.rs-primary{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 16px;border:1px solid var(--rs-accent-strong);border-radius:6px;background:var(--rs-accent-strong);color:#fff;font:inherit;font-weight:500;cursor:pointer;box-shadow:0 1px 2px rgba(79,70,229,.18)}
.rs-primary:hover{background:var(--rs-accent);border-color:var(--rs-accent)}
.rs-secondary{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#57606a);font:inherit;cursor:pointer}
.rs-secondary:hover{background:var(--dsw-alias-interactive-bg-hover,#f6f8fa)}
.rs-session-message{margin-top:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,#d8dee4);border-radius:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#57606a);background:var(--dsw-alias-bg-module-platform,transparent)}
.rs-session-message[data-state="error"]{border-color:var(--dsw-alias-state-error-secondary,#cf222e);color:var(--dsw-alias-state-error-primary,#cf222e)}
.rs-session-empty{display:grid;justify-items:center;align-content:center;gap:10px;min-height:360px;padding:42px 20px;text-align:center;color:var(--dsw-alias-label-secondary,#57606a)}
.rs-empty-illustration{width:132px;height:112px;margin-bottom:2px}
.rs-session-empty strong{color:var(--dsw-alias-label-primary,inherit);font-size:15px;line-height:1.4;font-weight:600}
.rs-session-empty p{max-width:440px;margin:0;color:var(--dsw-alias-label-secondary,#57606a);font-size:13px;line-height:1.6}
.rs-session-empty .rs-primary{margin-top:4px}
.rs-doc-list{margin-top:16px;display:flex;flex-direction:column;gap:2px}
.rs-doc{display:flex;align-items:flex-start;gap:12px;padding:10px 10px;border:0;border-radius:8px;background:transparent;text-align:left;text-decoration:none;color:inherit;min-width:0;width:100%;font:inherit;cursor:pointer}
.rs-doc:hover{background:var(--dsw-alias-interactive-bg-hover,#f6f8fa)}
.rs-doc-icon{display:grid;place-items:center;flex:0 0 26px;width:26px;height:26px;margin-top:1px;border-radius:6px;background:var(--rs-accent-tint);color:var(--rs-accent)}
.rs-doc-icon[data-kind="html_deck"]{color:#d97706;background:rgba(217,119,6,.12)}
.rs-doc-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.rs-doc-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,inherit);font-weight:500}
.rs-doc:hover .rs-doc-title{color:var(--rs-accent)}
.rs-doc-meta{font:var(--dsw-font-caption,12px/1.5 -apple-system,system-ui,sans-serif);color:var(--dsw-alias-label-tertiary,#8b949e);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rs-doc-badge{flex:0 0 auto;margin-top:1px;padding:1px 7px;border-radius:999px;background:var(--rs-accent-tint);color:var(--rs-accent);font:var(--dsw-font-caption,11px/1.6 -apple-system,system-ui,sans-serif);font-weight:500}
.rs-tabstrip{display:flex;align-items:center;gap:4px;overflow-x:auto;margin:14px -4px 0;padding:0 4px;border-bottom:1px solid var(--dsw-alias-border-l1,#d8dee4);scrollbar-width:none}
.rs-tab{display:flex;align-items:center;gap:6px;max-width:220px;min-height:32px;padding:0 9px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-tertiary,#8b949e);font:inherit;cursor:pointer;white-space:nowrap}
.rs-tab:hover{color:var(--dsw-alias-label-primary,inherit)}
.rs-tab[data-active="true"]{border-bottom-color:var(--rs-accent);color:var(--rs-accent)}
.rs-tab-title{overflow:hidden;text-overflow:ellipsis}
.rs-tab-home{justify-content:center;width:34px;padding:0}
.rs-tab-close{display:grid;place-items:center;width:16px;height:16px;border:0;border-radius:4px;background:transparent;color:inherit;font-size:14px;line-height:1;cursor:pointer}
.rs-tab-close:hover{background:var(--dsw-alias-interactive-bg-hover,#f6f8fa)}
.rs-reader-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 4px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#d8dee4)}
.rs-reader-title{font-weight:600;color:var(--dsw-alias-label-primary,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rs-reader-meta{font:var(--dsw-font-caption,12px/1.5 -apple-system,system-ui,sans-serif);color:var(--dsw-alias-label-tertiary,#8b949e)}
.rs-reader-link{flex:0 0 auto;color:var(--rs-accent);text-decoration:none;font-size:12px}
.rs-reader-link:hover{text-decoration:underline}
.rs-reader{max-width:780px;margin:0 auto;padding:28px 12px 64px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary,inherit);font:var(--dsw-font-reader,15px/1.85 -apple-system,"Segoe UI",system-ui,sans-serif)}
.rs-html-frame{width:100%;min-height:620px;margin-top:14px;border:1px solid var(--dsw-alias-border-l1,#d8dee4);border-radius:8px;background:#fff}
.rs-reader-state{display:grid;gap:10px;place-items:center;min-height:320px;color:var(--dsw-alias-label-tertiary,#8b949e);font-size:12px;text-align:center}
.rs-reader-state[data-state="error"]{color:var(--dsw-alias-state-error-primary,#cf222e)}
.rs-reader-actions{display:flex;align-items:center;gap:10px}
.rs-embed-frame{display:block;width:100%;height:calc(100dvh - 176px);min-height:560px;margin-top:12px;border:0;border-radius:8px;background:var(--dsw-alias-bg-base,#fff)}
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

function HomeIcon() {
  return (
    <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor'
      strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
      <path d='M3 10.8 12 3l9 7.8' />
      <path d='M5 9.5V21h5v-6h4v6h5V9.5' />
    </svg>
  )
}

function EmptyIllustration() {
  return (
    <svg className='rs-empty-illustration' viewBox='0 0 176 150' fill='none' aria-hidden>
      <g filter='url(#rs-empty-shadow)'>
        <path d='M44 56c0-7 5.5-12.5 12.5-12.5h30l11 10H124c6.6 0 12 5.4 12 12v45c0 6.9-5.6 12.5-12.5 12.5h-67C49.6 123 44 117.4 44 110.5V56Z' fill='url(#rs-empty-folder)' />
      </g>
      <rect x='78' y='18' width='66' height='76' rx='7' transform='rotate(10 78 18)' fill='url(#rs-empty-paper)' />
      <path d='M89 45h42M88 57h35M87 69h29' stroke='var(--dsw-alias-bg-base,#fff)' strokeWidth='5' strokeLinecap='round' opacity='.78' />
      <path d='M46 72h44l15 9h31v37c0 6.6-5.4 12-12 12H56c-6.6 0-12-5.4-12-12V74c0-1.1.9-2 2-2Z' fill='url(#rs-empty-front)' />
      <path d='M52 77h34l15 9h29' stroke='var(--dsw-alias-bg-base,#fff)' strokeWidth='2' opacity='.48' />
      <defs>
        <linearGradient id='rs-empty-folder' x1='59' x2='133' y1='43' y2='120' gradientUnits='userSpaceOnUse'>
          <stop stopColor='var(--dsw-alias-bg-base,#fff)' />
          <stop offset='1' stopColor='color-mix(in srgb, var(--rs-accent) 18%, var(--dsw-alias-bg-base, #fff))' />
        </linearGradient>
        <linearGradient id='rs-empty-paper' x1='111' x2='111' y1='18' y2='94' gradientUnits='userSpaceOnUse'>
          <stop stopColor='color-mix(in srgb, var(--rs-accent) 14%, var(--dsw-alias-bg-base, #fff))' />
          <stop offset='1' stopColor='color-mix(in srgb, var(--rs-accent) 28%, var(--dsw-alias-bg-base, #fff))' />
        </linearGradient>
        <linearGradient id='rs-empty-front' x1='59' x2='129' y1='75' y2='129' gradientUnits='userSpaceOnUse'>
          <stop stopColor='var(--dsw-alias-bg-base,#fff)' stopOpacity='.86' />
          <stop offset='1' stopColor='var(--dsw-alias-bg-module-platform,#eaeef2)' stopOpacity='.72' />
        </linearGradient>
        <filter id='rs-empty-shadow' x='20' y='24' width='140' height='126' colorInterpolationFilters='sRGB'>
          <feDropShadow dx='0' dy='14' stdDeviation='14' floodColor='var(--rs-accent)' floodOpacity='.14' />
        </filter>
      </defs>
    </svg>
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
  const t = (key: RevisoLocaleKey): string => props.t?.(key) ?? zh[key]

  function loadEmbed(doc: SessionDoc): void {
    setEmbeds(current => ({ ...current, [doc.id]: { status: 'loading' } }))
    void embedSession(doc.id, preferredTheme())
      .then(data => {
        setEmbeds(current => ({
          ...current,
          [doc.id]: { status: 'live', url: data.embed_url },
        }))
      })
      .catch((error: unknown) => {
        setEmbeds(current => ({
          ...current,
          [doc.id]: {
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          },
        }))
      })
  }

  function openDocument(doc: SessionDoc): void {
    setOpenDocs(current => current.some(item => item.id === doc.id) ? current : [...current, doc])
    setActiveDocId(doc.id)
    if (embeds[doc.id]?.status !== 'live') loadEmbed(doc)
  }

  function closeDocument(docId: string): void {
    setOpenDocs(current => current.filter(item => item.id !== docId))
    setActiveDocId(current => current === docId ? null : current)
    setEmbeds(current => {
      const next = { ...current }
      delete next[docId]
      return next
    })
  }
  const [status, setStatus] = useState<RevisoStatus>('unconfigured')
  const [message, setMessage] = useState('')
  const [docs, setDocs] = useState<SessionDoc[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const [openDocs, setOpenDocs] = useState<SessionDoc[]>([])
  const [activeDocId, setActiveDocId] = useState<string | null>(null)
  const iframeRefs = useRef(new Map<string, HTMLIFrameElement>())
  const [embeds, setEmbeds] = useState<Record<string, {
    status: 'loading' | 'live' | 'error'
    url?: string
    message?: string
  }>>({})

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
  }, [sessionId, reloadKey])

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const data = event.data as {
        type?: string; code?: string; documentId?: string
      } | null
      if (data?.type !== 'reviso:error' && data?.type !== 'reviso:expired') return
      const documentId = data.documentId || ''
      if (iframeRefs.current.get(documentId)?.contentWindow !== event.source) return
      setEmbeds(current => {
        const embed = current[documentId]
        if (embed?.status !== 'live' || !sameOrigin(embed.url, event.origin)) return current
        return {
          ...current,
          [documentId]: { ...embed, status: 'error', message: t('doc.error') },
        }
      })
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [t])

  const emptyTitle = status === 'live'
    ? t('empty.live.title')
    : status === 'error'
      ? t('empty.error.title')
      : status === 'loading' ? t('status.loading') : t('empty.unconfigured.title')
  const emptyBody = status === 'live'
    ? t('empty.live.body')
    : status === 'error'
      ? message || t('empty.error.body')
      : t('empty.unconfigured.body')
  return (
    <div className='rs-session'>
      <div className='rs-session-inner'>
        <div className='rs-session-head'>
          <div>
            <div className='rs-session-title'>Reviso</div>
            <div className='rs-session-subtitle'>{t('subtitle')}</div>
          </div>
          <div className='rs-session-status' data-state={status}>
            <span className='rs-session-dot' aria-hidden />
            <span>{t(`status.${status}` as RevisoLocaleKey)}</span>
          </div>
        </div>
        {openDocs.length > 0 && (
          <div className='rs-tabstrip' role='tablist' aria-label={t('tabs.list')}>
            <button type='button' role='tab' aria-selected={activeDocId === null}
              className='rs-tab rs-tab-home' data-active={activeDocId === null}
              title={t('tabs.home')} aria-label={t('tabs.home')}
              onClick={() => setActiveDocId(null)}>
              <HomeIcon />
            </button>
            {openDocs.map(doc => (
              <div className='rs-tab' data-active={activeDocId === doc.id} key={doc.id}>
                <button type='button' role='tab' aria-selected={activeDocId === doc.id}
                  className='rs-tab-title'
                  style={{ border: 0, background: 'transparent', color: 'inherit', font: 'inherit', padding: 0, cursor: 'pointer', maxWidth: 180 }}
                  onClick={() => setActiveDocId(doc.id)}>
                  {doc.title}
                </button>
                <button type='button' className='rs-tab-close' title={t('tabs.close')}
                  onClick={() => closeDocument(doc.id)}>×</button>
              </div>
            ))}
          </div>
        )}
        {message !== '' && (
          <div className='rs-session-message' data-state={status === 'error' ? 'error' : undefined}>
            {message}
          </div>
        )}
        {openDocs.map(doc => {
          const embed = embeds[doc.id]
          return (
            <div className='rs-reader-view' hidden={activeDocId !== doc.id} key={doc.id}>
              {embed?.status === 'live' && embed.url !== undefined
                ? (
                    <iframe
                      ref={node => {
                        if (node === null) iframeRefs.current.delete(doc.id)
                        else iframeRefs.current.set(doc.id, node)
                      }}
                      className='rs-embed-frame' title={doc.title}
                      src={embed.url}
                      sandbox='allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox'
                      referrerPolicy='no-referrer'
                      loading='eager' />
                  )
                : embed?.status === 'error'
                  ? (
                      <div className='rs-reader-state' data-state='error'>
                        <span>{embed.message || t('doc.error')}</span>
                        <div className='rs-reader-actions'>
                          <button type='button' className='rs-secondary' onClick={() => loadEmbed(doc)}>
                            {t('action.retry')}
                          </button>
                          {doc.url !== '' && (
                            <a className='rs-reader-link' href={doc.url} target='_blank' rel='noreferrer'>
                              {t('doc.openExternal')}
                            </a>
                          )}
                        </div>
                      </div>
                    )
                  : <div className='rs-reader-state'>{t('doc.loading')}</div>}
            </div>
          )
        })}
        {activeDocId === null && (docs.length === 0
          ? (
              <div className='rs-session-empty'>
                <EmptyIllustration />
                <strong>{emptyTitle}</strong>
                <p>{emptyBody}</p>
                {status !== 'live' && status !== 'loading' && (
                  <button type='button' className='rs-primary' onClick={startRevisoOAuth}>
                    {t('action.connect')}
                  </button>
                )}
                {status === 'error' && (
                  <button type='button' className='rs-secondary' onClick={() => setReloadKey(key => key + 1)}>
                    {t('action.retry')}
                  </button>
                )}
              </div>
            )
          : (
              <div className='rs-doc-list' role='list' aria-label={t('subtitle')}>
                {docs.map(doc => {
                  const meta = `${doc.creator} · ${relativeTime(
                    doc.updatedAt === null ? undefined : new Date(doc.updatedAt).toISOString(),
                    t,
                  )}`
                  return (
                    <button type='button' className='rs-doc' role='listitem'
                      key={doc.id} onClick={() => openDocument(doc)}>
                      <FileIcon kind={doc.kind} />
                      <span className='rs-doc-main'>
                        <span className='rs-doc-title'>{doc.title}</span>
                        <span className='rs-doc-meta'>{meta}</span>
                      </span>
                      {doc.unresolved > 0 && (
                        <span className='rs-doc-badge'>{doc.unresolved} {t('doc.pending')}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
      </div>
    </div>
  )
}
