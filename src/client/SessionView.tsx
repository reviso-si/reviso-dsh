import { useEffect, useRef, useState } from 'react'
type RevisoStatus = 'unconfigured' | 'loading' | 'live' | 'error'
import { mapRow, sameOrigin, type SessionDoc } from './document.ts'
import { zh, type RevisoLocaleKey } from './locales.ts'
import {
  connectionStatus, documentContent, embedSession, onRevisoConnected, revokeEmbedSession, sessionDocuments, startRevisoOAuth,
  RevisoHttpError, type RevisoDocumentContent, type RevisoRow,
} from './host.ts'

interface SessionViewProps {
  /** Framework-standard prop for session-scope slots. */
  sessionId: string | undefined
  /** Locale seat injected by the slot registry. */
  t?: (key: RevisoLocaleKey) => string
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

function preferredTheme(): 'light' | 'dark' | 'system' {
  const selected = document.documentElement.dataset.theme
  if (selected === 'light' || selected === 'dark') return selected
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

import { CSS, ensureStyles } from './readerStyles.ts'

export function FileIcon({ kind }: { kind: 'document' | 'html_deck' | 'other' }) {
  return (
    <span className='rs-doc-icon' data-kind={kind} aria-hidden>
      {kind === 'html_deck'
        ? <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'><path d='M3 4h18v12H3z' /><path d='M8 20h8M12 16v4M8 8h8M8 11h5' /></svg>
        : <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'><path d='M6 2h8l4 4v16H6z' /><path d='M14 2v5h4M9 11h6M9 15h6M9 19h4' /></svg>}
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
    void embedSession(doc.id, preferredTheme(), embedOrigin || undefined)
      .then(data => {
        setEmbeds(current => ({
          ...current,
          [doc.id]: { status: 'live', url: data.embed_url, sessionId: data.session_id },
        }))
      })
      .catch(async (error: unknown) => {
        if (error instanceof RevisoHttpError && (error.status === 404 || error.status === 501)) {
          try {
            const content = await documentContent(doc.id)
            setEmbeds(current => ({ ...current, [doc.id]: { status: 'fallback', content } }))
            return
          } catch {}
        }
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
    const session = embeds[docId]?.sessionId
    if (session !== undefined) {
      void revokeEmbedSession(session).catch((error: unknown) => {
        setRevokeMessage(`${t('doc.revokeError')}: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
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
  const [revokeMessage, setRevokeMessage] = useState('')
  const [embedOrigin, setEmbedOrigin] = useState('')
  const [docs, setDocs] = useState<SessionDoc[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const [openDocs, setOpenDocs] = useState<SessionDoc[]>([])
  const [activeDocId, setActiveDocId] = useState<string | null>(null)
  const iframeRefs = useRef(new Map<string, HTMLIFrameElement>())
  const [embeds, setEmbeds] = useState<Record<string, {
    status: 'loading' | 'live' | 'fallback' | 'error'
    url?: string
    sessionId?: string
    content?: RevisoDocumentContent
    message?: string
  }>>({})

  useEffect(() => {
    for (const embed of Object.values(embeds)) {
      if (embed.sessionId !== undefined) {
        void revokeEmbedSession(embed.sessionId).catch((error: unknown) => {
          setRevokeMessage(`${t('doc.revokeError')}: ${error instanceof Error ? error.message : String(error)}`)
        })
      }
    }
    setOpenDocs([])
    setActiveDocId(null)
    setEmbeds({})
    iframeRefs.current.clear()
  }, [sessionId])

  useEffect(() => {
    if (sessionId === '') return
    let alive = true
    const load = async () => {
      setStatus('loading')
      try {
        const connection = await connectionStatus()
        if (alive) setEmbedOrigin(connection.capabilities?.embedOrigin || '')
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
        {(message !== '' || revokeMessage !== '') && (
          <div className='rs-session-message' data-state={status === 'error' || revokeMessage !== '' ? 'error' : undefined}>
            {message !== '' ? message : revokeMessage}
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
                      sandbox='allow-scripts'
                      allow='fullscreen'
                      referrerPolicy='no-referrer'
                      loading='eager' />
                  )
                : embed?.status === 'fallback'
                  ? (
                      <div className='rs-reader'>
                        {embed.content?.content_html
                          ? <iframe className='rs-html-frame' title={doc.title} sandbox='' srcDoc={embed.content.content_html} />
                          : embed.content?.content}
                      </div>
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