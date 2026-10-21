import { useEffect, useState, type ReactNode } from 'react'
import { connectionStatus, startRevisoOAuth, type RevisoConnectionStatus } from './host.ts'
import { zh, type RevisoLocaleKey } from './locales.ts'

interface ConnectionSectionProps {
  close: () => void
  t?: (key: RevisoLocaleKey) => string
}

export function RevisoConnectionSection(props: ConnectionSectionProps): ReactNode {
  const t = (key: RevisoLocaleKey): string => props.t?.(key) ?? zh[key]
  const [status, setStatus] = useState<'loading' | 'connected' | 'unconfigured' | 'error'>('loading')
  const [state, setState] = useState<RevisoConnectionStatus | null>(null)
  const [message, setMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    connectionStatus()
      .then(value => {
        if (!alive) return
        setState(value)
        setStatus(value.connected ? 'connected' : 'unconfigured')
      })
      .catch(error => {
        if (!alive) return
        setStatus('error')
        setMessage(error instanceof Error ? error.message : String(error))
      })
    return () => { alive = false }
  }, [reloadKey])

  return (
    <section style={{ display: 'grid', gap: 14, maxWidth: 680 }}>
      <header>
        <h2 style={{ margin: 0, fontSize: 16 }}>Reviso connection</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--dsw-alias-label-tertiary,#8b949e)', fontSize: 12 }}>
          Manage the account and workspace used by the Reviso global panel and session tab.
        </p>
      </header>
      <div style={{ display: 'grid', gap: 6, padding: 12, border: '1px solid var(--dsw-alias-border-l1,#d8dee4)', borderRadius: 8 }}>
        <div><strong>Status:</strong> {status === 'connected' ? t('status.live') : status === 'unconfigured' ? t('status.unconfigured') : status === 'error' ? t('status.error') : t('status.loading')}</div>
        {state?.server && <div><strong>Server:</strong> {state.server}</div>}
        {state?.workspaceId && <div><strong>Workspace:</strong> {state.workspaceId}</div>}
        {message && <div style={{ color: 'var(--dsw-alias-state-error-primary,#cf222e)', fontSize: 12 }}>{message}</div>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {status !== 'connected' && <button type='button' className='rs-primary' onClick={startRevisoOAuth}>{t('action.connect')}</button>}
        <button type='button' className='rs-secondary' onClick={() => setReloadKey(v => v + 1)}>{t('action.retry')}</button>
        <button type='button' className='rs-secondary' onClick={props.close}>{t('action.close')}</button>
      </div>
    </section>
  )
}
