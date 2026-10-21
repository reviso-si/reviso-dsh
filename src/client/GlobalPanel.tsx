import { useEffect, useMemo, useRef, useState } from 'react'
import { connectionStatus, dashboardDocumentsPage, documentContent, embedSession, onRevisoConnected, startRevisoOAuth, RevisoHttpError, type RevisoConnectionStatus, type RevisoDocumentContent } from './host.ts'
import { mapRow, sameOrigin, type SessionDoc } from './document.ts'
import { FileIcon } from './SessionView.tsx'
import { zh, type RevisoLocaleKey } from './locales.ts'
import { ensureStyles } from './readerStyles.ts'

interface GlobalPanelProps {
  t?: (key: RevisoLocaleKey) => string
}

type EmbedState = { status: 'loading' | 'live' | 'fallback' | 'error'; url?: string; content?: RevisoDocumentContent; message?: string }

function globalRevisoUrl(server: string): string {
  return server === '' ? '' : `${server.replace(/\/$/, '')}/documents`
}

function shortSession(value: string | undefined): string {
  if (value === undefined || value === '') return '-'
  const tail = value.length > 12 ? value.slice(-8) : value
  return tail.replace(/^session-/, '')
}

export function RevisoGlobalPanel(props: GlobalPanelProps) {
  ensureStyles()
  const t = (key: RevisoLocaleKey): string => props.t?.(key) ?? zh[key]
  const [status, setStatus] = useState<'unconfigured' | 'loading' | 'live' | 'error'>('loading')
  const [connection, setConnection] = useState<RevisoConnectionStatus | null>(null)
  const [docs, setDocs] = useState<SessionDoc[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState('')
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [sessionFilter, setSessionFilter] = useState('')
  const [sort, setSort] = useState<'recent' | 'title'>('recent')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [embeds, setEmbeds] = useState<Record<string, EmbedState>>({})
  const iframeRefs = useRef(new Map<string, HTMLIFrameElement>())
  const [mobileView, setMobileView] = useState<'list' | 'reader'>('list')

  useEffect(() => {
    let alive = true
    const load = async () => {
      setStatus('loading')
      setMessage('')
      try {
        const state = await connectionStatus()
        if (!alive) return
        setConnection(state)
        if (!state.connected) {
          setStatus('unconfigured')
          setDocs([])
          return
        }
        const page = await dashboardDocumentsPage(50, 0, 'dsh')
        if (!alive) return
        setDocs(page.rows.map(row => mapRow(row, state.server)).filter((doc): doc is SessionDoc => doc !== null))
        setHasMore(page.hasMore)
        setNextOffset(page.nextOffset)
        setLoadMoreError('')
        setStatus('live')
      } catch (error) {
        if (!alive) return
        setStatus('error')
        setMessage(error instanceof Error ? error.message : String(error))
      }
    }
    void load()
    const off = onRevisoConnected(() => { void load() })
    return () => { alive = false; off() }
  }, [reloadKey])

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const data = event.data as { type?: string; documentId?: string } | null
      if (data?.type !== 'reviso:error' && data?.type !== 'reviso:expired') return
      const documentId = data.documentId || ''
      const embed = embeds[documentId]
      if (iframeRefs.current.get(documentId)?.contentWindow !== event.source) return
      if (embed?.status !== 'live' || !sameOrigin(embed.url, event.origin)) return
      setEmbeds(current => current[documentId]?.status === 'live'
        ? { ...current, [documentId]: { status: 'error', message: t('doc.error') } }
        : current)
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [embeds, t])


  async function loadMore(): Promise<void> {
    if (!connection?.connected || nextOffset === null || loadingMore) return
    setLoadingMore(true)
    setLoadMoreError('')
    try {
      const page = await dashboardDocumentsPage(50, nextOffset, 'dsh')
      setDocs(current => [...current, ...page.rows.map(row => mapRow(row, connection.server)).filter((doc): doc is SessionDoc => doc !== null)])
      setHasMore(page.hasMore)
      setNextOffset(page.nextOffset)
    } catch (error) {
      setLoadMoreError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingMore(false)
    }
  }

  const sessions = useMemo(() => {
    const values = new Map<string, number>()
    for (const doc of docs) if (doc.sessionId) values.set(doc.sessionId, (values.get(doc.sessionId) || 0) + 1)
    return [...values.entries()].sort((a, b) => b[1] - a[1])
  }, [docs])

  const visibleDocs = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = docs.filter(doc =>
      (sessionFilter === '' || doc.sessionId === sessionFilter)
      && (needle === '' || doc.title.toLowerCase().includes(needle)))
    return rows.sort((a, b) => sort === 'title'
      ? a.title.localeCompare(b.title)
      : (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }, [docs, query, sessionFilter, sort])

  const active = activeId === null ? undefined : docs.find(doc => doc.id === activeId)

  function openDoc(doc: SessionDoc): void {
    setActiveId(doc.id)
    setMobileView('reader')
    if (embeds[doc.id]?.status === 'live' || embeds[doc.id]?.status === 'loading') return
    setEmbeds(current => ({ ...current, [doc.id]: { status: 'loading' } }))
    void embedSession(doc.id, 'system')
      .then(data => setEmbeds(current => ({ ...current, [doc.id]: { status: 'live', url: data.embed_url } })))
      .catch(async error => {
        if (error instanceof RevisoHttpError && (error.status === 404 || error.status === 501)) {
          try {
            const content = await documentContent(doc.id)
            setEmbeds(current => ({ ...current, [doc.id]: { status: 'fallback', content } }))
            return
          } catch {}
        }
        setEmbeds(current => ({ ...current, [doc.id]: { status: 'error', message: error instanceof Error ? error.message : String(error) } }))
      })
  }

  return (
    <section className='rs-global' data-view={mobileView}>
      <header className='rs-global-head'>
        <div>
          <h1 className='rs-global-title'>{t('global.title')}</h1>
          <div className='rs-global-sub'>{t('global.subtitle')} · {docs.length} docs</div>
        </div>
        <div className='rs-session-status' data-state={status === 'unconfigured' ? 'unconfigured' : status === 'error' ? 'error' : undefined}>
          <span className='rs-session-dot' aria-hidden />
          <span>{status === 'unconfigured' ? t('status.unconfigured') : status === 'error' ? t('status.error') : t('status.live')}</span>
        </div>
      </header>

      <div className='rs-toolbar'>
        <input className='rs-input' value={query} onChange={e => setQuery(e.target.value)} placeholder={t('global.search')} type='search' />
        <select className='rs-select' value={sessionFilter} onChange={e => setSessionFilter(e.target.value)} aria-label={t('global.allSessions')}>
          <option value=''>{t('global.allSessions')}</option>
          {sessions.map(([id, count]) => <option key={id} value={id}>{shortSession(id)} ({count})</option>)}
        </select>
        <select className='rs-select' value={sort} onChange={e => setSort(e.target.value as 'recent' | 'title')} aria-label={t('global.sortRecent')}>
          <option value='recent'>{t('global.sortRecent')}</option>
          <option value='title'>{t('global.sortTitle')}</option>
        </select>
        <button type='button' className='rs-text-btn' onClick={() => setReloadKey(v => v + 1)}>{t('action.retry')}</button>
        {connection?.server && <a className='rs-text-btn' href={globalRevisoUrl(connection.server)} target='_blank' rel='noreferrer'>{t('global.openWeb')}</a>}
      </div>

      {status === 'error' && <div className='rs-global-error'><span>{t('global.listError')}: {message}</span><button type='button' className='rs-text-btn' onClick={() => setReloadKey(v => v + 1)}>{t('action.retry')}</button></div>}

      <div className='rs-global-body'>
        <div className='rs-global-list' role='list'>
          {status === 'unconfigured' && <div className='rs-global-empty'><strong>{t('empty.unconfigured.title')}</strong><p>{t('empty.unconfigured.body')}</p><button type='button' className='rs-primary' onClick={startRevisoOAuth}>{t('action.connect')}</button></div>}
          {status === 'loading' && <div className='rs-global-empty'>{t('global.loading')}</div>}
          {status === 'live' && visibleDocs.length === 0 && <div className='rs-global-empty'>{docs.length === 0 ? t('global.empty') : t('global.noMatches')}</div>}
          {status === 'live' && visibleDocs.length > 0 && hasMore && <div className='rs-global-row-meta' style={{padding:'8px 9px'}}>{t('global.showingLoaded')} {docs.length}</div>}
          {status === 'live' && visibleDocs.map(doc => (
            <button type='button' className='rs-global-row' data-active={activeId === doc.id} role='listitem' key={doc.id} onClick={() => openDoc(doc)}>
              <FileIcon kind={doc.kind} />
              <span className='rs-global-row-main'>
                <span className='rs-global-row-title'>{doc.title}</span>
                <span className='rs-global-row-meta'>{doc.creator} · {doc.updatedAt === null ? '' : new Date(doc.updatedAt).toLocaleDateString()}{doc.unresolved > 0 ? ` · ${doc.unresolved} ${t('doc.pending')}` : ''}</span>
                {doc.sessionId && <span className='rs-global-row-session'>{t('global.session')} {shortSession(doc.sessionId)}</span>}
              </span>
            </button>
          ))}
          {loadMoreError !== '' && <div className='rs-global-error' style={{margin:'8px'}}><span>{t('global.loadMoreError')}: {loadMoreError}</span><button type='button' className='rs-text-btn' onClick={() => { void loadMore() }}>{t('action.retry')}</button></div>}
          {status === 'live' && hasMore && <button type='button' className='rs-text-btn' disabled={loadingMore} onClick={() => { void loadMore() }} style={{margin:'8px'}}>{loadingMore ? t('status.loading') : t('global.loadMore')}</button>}
        </div>
        <div className='rs-global-reader'>
          {active === undefined ? <div className='rs-global-empty'>{t('global.selectDoc')}</div> : <>
            <div className='rs-global-reader-head'>
              <div className='rs-global-reader-head-main'>
                <div className='rs-global-reader-title'>{active.title}</div>
                <div className='rs-reader-meta'>{active.sessionId ? `${t('global.session')} ${shortSession(active.sessionId)} · ` : ''}{active.updatedAt === null ? '' : new Date(active.updatedAt).toLocaleString()}</div>
              </div>
              <div className='rs-reader-actions'>
                <button type='button' className='rs-text-btn' onClick={() => setMobileView('list')}>{t('global.back')}</button>
                {active.url !== '' && <a className='rs-reader-link' href={active.url} target='_blank' rel='noreferrer'>{t('doc.openExternal')}</a>}
              </div>
            </div>
            <div className='rs-global-reader-body'>
              {embeds[active.id]?.status === 'live' && embeds[active.id].url !== undefined
                ? <iframe ref={node => { if (node === null) iframeRefs.current.delete(active.id); else iframeRefs.current.set(active.id, node) }} className='rs-embed-frame' title={active.title} src={embeds[active.id].url} sandbox='allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox' referrerPolicy='no-referrer' loading='eager' />
                : embeds[active.id]?.status === 'fallback'
                  ? <div className='rs-reader'>{embeds[active.id].content?.content_html ? <iframe className='rs-html-frame' title={active.title} sandbox='' srcDoc={embeds[active.id].content?.content_html} /> : embeds[active.id].content?.content}</div>
                  : embeds[active.id]?.status === 'error'
                    ? <div className='rs-reader-state' data-state='error'><span>{embeds[active.id].message || t('doc.error')}</span><button type='button' className='rs-secondary' onClick={() => openDoc(active)}>{t('action.retry')}</button></div>
                    : <div className='rs-reader-state'>{t('doc.loading')}</div>}
            </div>
          </>}
        </div>
      </div>
    </section>
  )
}
