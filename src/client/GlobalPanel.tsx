import { useEffect, useMemo, useRef, useState } from 'react'
import {
  clearDashboardDocumentsCache, connectionStatus, dashboardDocumentsPage, documentContent,
  embedSession, onRevisoConnected, revokeEmbedSession, setDashboardCacheScope, startRevisoOAuth, RevisoHttpError,
  type RevisoConnectionStatus, type RevisoDocumentContent,
} from './host.ts'
import { mapRow, sameOrigin, type SessionDoc } from './document.ts'
import { FileIcon } from './SessionView.tsx'
import { zh, type RevisoLocaleKey } from './locales.ts'
import { ensureStyles } from './readerStyles.ts'

interface GlobalPanelProps {
  t?: (key: RevisoLocaleKey) => string
}

type EmbedState = { status: 'loading' | 'live' | 'fallback' | 'error'; url?: string; sessionId?: string; content?: RevisoDocumentContent; message?: string }
type ViewMode = 'list' | 'card'
type KindFilter = 'all' | 'document' | 'html_deck'
type SortMode = 'recent' | 'title' | 'creator'
const VIEW_KEY = 'reviso-dsh-global-view'

function loadView(): ViewMode {
  try { return localStorage.getItem(VIEW_KEY) === 'card' ? 'card' : 'list' } catch { return 'list' }
}

function saveView(value: ViewMode): void {
  try { localStorage.setItem(VIEW_KEY, value) } catch {}
}

function globalRevisoUrl(server: string): string {
  return server === '' ? '' : `${server.replace(/\/$/, '')}/documents`
}

function shortSession(value: string | undefined): string {
  if (value === undefined || value === '') return '-'
  const tail = value.length > 12 ? value.slice(-8) : value
  return tail.replace(/^session-/, '')
}

function relativeTime(iso: string | undefined): string {
  if (!iso) return ''
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return ''
  return new Date(time).toLocaleDateString()
}

function SearchIcon() {
  return <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' aria-hidden><circle cx='11' cy='11' r='7' /><path d='m20 20-4-4' /></svg>
}

function SortIcon() {
  return <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' aria-hidden><path d='M8 6h12M8 12h8M8 18h4' /><path d='M4 5v14m0 0-2-2m2 2 2-2' /></svg>
}

function ListIcon() {
  return <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' aria-hidden><path d='M9 6h11M9 12h11M9 18h11' /><path d='M4 6h.01M4 12h.01M4 18h.01' /></svg>
}

function GridIcon() {
  return <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' aria-hidden><rect x='4' y='4' width='6' height='6' rx='1' /><rect x='14' y='4' width='6' height='6' rx='1' /><rect x='4' y='14' width='6' height='6' rx='1' /><rect x='14' y='14' width='6' height='6' rx='1' /></svg>
}

function Thumbnail({ doc }: { doc: SessionDoc }) {
  return <span className='rs-card-preview' data-kind={doc.kind} aria-hidden>
    <span className='rs-card-paper'>
      <span className='rs-card-paper-title' />
      <span className='rs-card-paper-line' />
      <span className='rs-card-paper-line short' />
    </span>
  </span>
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
  const [revokeMessage, setRevokeMessage] = useState('')
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [sessionFilter, setSessionFilter] = useState('')
  const [sort, setSort] = useState<SortMode>('recent')
  const [view, setView] = useState<ViewMode>(loadView)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [embeds, setEmbeds] = useState<Record<string, EmbedState>>({})
  const iframeRefs = useRef(new Map<string, HTMLIFrameElement>())
  const [mobileView, setMobileView] = useState<'list' | 'reader'>('list')
  const embedSessions = useRef(new Set<string>())

  useEffect(() => {
    embedSessions.current = new Set(Object.values(embeds)
      .map(embed => embed.sessionId).filter((id): id is string => id !== undefined))
  }, [embeds])

  function surfaceRevokeError(error: unknown): void {
    setRevokeMessage(`${t('doc.revokeError')}: ${error instanceof Error ? error.message : String(error)}`)
  }

  function revokeEmbed(documentId: string): void {
    const sessionId = embeds[documentId]?.sessionId
    if (sessionId !== undefined) void revokeEmbedSession(sessionId).catch(surfaceRevokeError)
  }

  useEffect(() => () => {
    for (const sessionId of embedSessions.current) {
      void revokeEmbedSession(sessionId).catch(surfaceRevokeError)
    }
  }, [])

  useEffect(() => {
    let alive = true
    const load = async () => {
      setStatus('loading')
      setMessage('')
      try {
        const state = await connectionStatus()
        if (!alive) return
        setConnection(state)
        if (setDashboardCacheScope(state)) {
          for (const sessionId of embedSessions.current) {
            void revokeEmbedSession(sessionId).catch(surfaceRevokeError)
          }
          setActiveId(null)
          setEmbeds({})
          iframeRefs.current.clear()
        }
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
    const off = onRevisoConnected(() => { clearDashboardDocumentsCache(); void load() })
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

  function changeView(next: ViewMode): void {
    setView(next)
    saveView(next)
  }

  function refresh(): void {
    clearDashboardDocumentsCache()
    setReloadKey(value => value + 1)
  }

  const sessions = useMemo(() => {
    const values = new Map<string, number>()
    for (const doc of docs) if (doc.sessionId) values.set(doc.sessionId, (values.get(doc.sessionId) || 0) + 1)
    return [...values.entries()].sort((a, b) => b[1] - a[1])
  }, [docs])

  const visibleDocs = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = docs.filter(doc =>
      (kindFilter === 'all' || doc.kind === kindFilter)
      && (sessionFilter === '' || doc.sessionId === sessionFilter)
      && (needle === '' || doc.title.toLowerCase().includes(needle)))
    return rows.sort((a, b) => sort === 'title'
      ? a.title.localeCompare(b.title)
      : sort === 'creator'
        ? a.creator.localeCompare(b.creator) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
        : (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }, [docs, kindFilter, query, sessionFilter, sort])

  const active = activeId === null ? undefined : docs.find(doc => doc.id === activeId)

  function openDoc(doc: SessionDoc): void {
    if (activeId !== null && activeId !== doc.id) revokeEmbed(activeId)
    setActiveId(doc.id)
    setMobileView('reader')
    if (embeds[doc.id]?.status === 'live' || embeds[doc.id]?.status === 'loading') return
    setEmbeds(current => ({ ...current, [doc.id]: { status: 'loading' } }))
    void embedSession(doc.id, 'system', connection?.capabilities?.embedOrigin || undefined)
      .then(data => setEmbeds(current => ({ ...current, [doc.id]: { status: 'live', url: data.embed_url, sessionId: data.session_id } })))
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

  const docMeta = (doc: SessionDoc) =>
    [doc.creator, relativeTime(doc.updatedAt === null ? undefined : new Date(doc.updatedAt).toISOString())]
      .filter(Boolean).join(' · ')

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

      <div className='rs-toolbar' role='toolbar' aria-label={t('global.title')}>
        <label className='rs-search-wrap'>
          <SearchIcon />
          <input className='rs-input' value={query} onChange={event => setQuery(event.target.value)} placeholder={t('global.search')} type='search' />
        </label>
        <select className='rs-select' value={kindFilter} onChange={event => setKindFilter(event.target.value as KindFilter)} aria-label={t('global.allTypes')}>
          <option value='all'>{t('global.allTypes')}</option>
          <option value='document'>{t('global.documents')}</option>
          <option value='html_deck'>{t('global.presentations')}</option>
        </select>
        <select className='rs-select' value={sessionFilter} onChange={event => setSessionFilter(event.target.value)} aria-label={t('global.allSessions')}>
          <option value=''>{t('global.allSessions')}</option>
          {sessions.map(([id, count]) => <option key={id} value={id}>{shortSession(id)} ({count})</option>)}
        </select>
        <label className='rs-sort-wrap'>
          <SortIcon />
          <select className='rs-select' value={sort} onChange={event => setSort(event.target.value as SortMode)} aria-label={t('global.sortRecent')}>
            <option value='recent'>{t('global.sortRecent')}</option>
            <option value='title'>{t('global.sortTitle')}</option>
            <option value='creator'>{t('global.sortCreator')}</option>
          </select>
        </label>
        <div className='rs-view-toggle' role='group' aria-label={t('global.viewMode')}>
          <button type='button' aria-pressed={view === 'list'} aria-label={t('global.listView')} onClick={() => changeView('list')}><ListIcon /></button>
          <button type='button' aria-pressed={view === 'card'} aria-label={t('global.cardView')} onClick={() => changeView('card')}><GridIcon /></button>
        </div>
        <button type='button' className='rs-text-btn' onClick={refresh}>{t('action.retry')}</button>
        {connection?.server && <a className='rs-text-btn' href={globalRevisoUrl(connection.server)} target='_blank' rel='noreferrer'>{t('global.openWeb')}</a>}
      </div>

      {status === 'error' && <div className='rs-global-error'><span>{t('global.listError')}: {message}</span><button type='button' className='rs-text-btn' onClick={refresh}>{t('action.retry')}</button></div>}
      {revokeMessage !== '' && <div className='rs-global-error' data-state='error'><span>{revokeMessage}</span></div>}

      <div className='rs-global-body'>
        <div className='rs-global-list' data-mode={view} role='list'>
          {status === 'unconfigured' && <div className='rs-global-empty'><strong>{t('empty.unconfigured.title')}</strong><p>{t('empty.unconfigured.body')}</p><button type='button' className='rs-primary' onClick={startRevisoOAuth}>{t('action.connect')}</button></div>}
          {status === 'loading' && <div className='rs-global-empty'>{t('global.loading')}</div>}
          {status === 'live' && visibleDocs.length === 0 && <div className='rs-global-empty'>{docs.length === 0 ? t('global.empty') : t('global.noMatches')}</div>}
          {status === 'live' && visibleDocs.length > 0 && hasMore && <div className='rs-global-row-meta rs-loaded'>{t('global.showingLoaded')} {docs.length}</div>}
          {status === 'live' && visibleDocs.map(doc => view === 'card'
            ? <button type='button' className='rs-global-card' data-active={activeId === doc.id} role='listitem' key={doc.id} onClick={() => openDoc(doc)}>
              <Thumbnail doc={doc} />
              <span className='rs-global-card-info'>
                <FileIcon kind={doc.kind} />
                <span className='rs-global-card-copy'>
                  <span className='rs-global-card-title'>{doc.title}</span>
                  <span className='rs-global-card-meta'>{docMeta(doc)}</span>
                  {doc.sessionId && <span className='rs-session-chip'>{t('global.session')} {shortSession(doc.sessionId)}</span>}
                </span>
              </span>
            </button>
            : <button type='button' className='rs-global-row' data-active={activeId === doc.id} role='listitem' key={doc.id} onClick={() => openDoc(doc)}>
              <FileIcon kind={doc.kind} />
              <span className='rs-global-row-main'>
                <span className='rs-global-row-title'>{doc.title}</span>
                <span className='rs-global-row-meta'>{docMeta(doc)}{doc.unresolved > 0 ? ` · ${doc.unresolved} ${t('doc.pending')}` : ''}</span>
                {doc.sessionId && <span className='rs-global-row-session'>{t('global.session')} {shortSession(doc.sessionId)}</span>}
              </span>
            </button>)}
          {loadMoreError !== '' && <div className='rs-global-error'><span>{t('global.loadMoreError')}: {loadMoreError}</span><button type='button' className='rs-text-btn' onClick={() => { void loadMore() }}>{t('action.retry')}</button></div>}
          {status === 'live' && hasMore && <button type='button' className='rs-text-btn rs-load-more' disabled={loadingMore} onClick={() => { void loadMore() }}>{loadingMore ? t('status.loading') : t('global.loadMore')}</button>}
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
                ? <iframe ref={node => { if (node === null) iframeRefs.current.delete(active.id); else iframeRefs.current.set(active.id, node) }} className='rs-embed-frame' title={active.title} src={embeds[active.id].url} sandbox='allow-scripts' allow='fullscreen' referrerPolicy='no-referrer' loading='eager' />
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