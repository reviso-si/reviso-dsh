import { useEffect } from 'react'
import type { RevisoState } from './state.ts'
import { zh, type RevisoLocaleKey } from './locales.ts'
import { onRevisoConnected, startRevisoOAuth } from './host.ts'

/** Four-shares composition: runtime(owner) + store(useStore/actions) + inject(onReload). */
interface PanelProps {
  state: RevisoState
  useStore: (sel: (s: RevisoState) => RevisoState) => RevisoState
  actions: {
    closePanel: () => void
  }
  onReload: () => void
  t?: (key: RevisoLocaleKey) => string
}

/** Frame-wide overlay panel (shell.overlay entry; opts into pointer events). */
export function RevisoPanel(props: PanelProps) {
  const state = props.useStore((s) => s)
  const t = (key: RevisoLocaleKey): string => props.t?.(key) ?? zh[key]

  useEffect(() => {
    if (!state.open) return
    props.onReload()
    return onRevisoConnected(() => props.onReload())
    // Reload once per open transition; the store identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open])

  if (!state.open) return null
  return (
    <div
      style={{
        pointerEvents: 'auto',
        position: 'fixed',
        top: 52,
        left: 248,
        width: 340,
        maxHeight: 'calc(100vh - 100px)',
        overflow: 'auto',
        background: 'var(--dsw-alias-bg-base, #ffffff)',
        color: 'var(--dsw-alias-label-primary, #1f2328)',
        border: '1px solid var(--dsw-alias-border-l1, #d0d7de)',
        borderRadius: 8,
        boxShadow: 'var(--dsw-shadow-lv3, 0 8px 24px rgba(0,0,0,.18))',
        font: 'var(--dsw-font-body, 12px/1.5 -apple-system, system-ui, sans-serif)',
        zIndex: 60,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--dsw-alias-border-l1, #d0d7de)' }}>
        <strong style={{ fontSize: 12 }}>Reviso</strong>
        <button type='button' onClick={() => props.actions.closePanel()} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'inherit' }} title={t('action.close')}>✕</button>
      </div>
      <div style={{ padding: '8px 12px', fontSize: 11, color: state.status === 'error' ? 'var(--dsw-alias-state-error-primary, #cf222e)' : 'inherit', background: state.status === 'error' ? 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #cf222e) 8%, transparent)' : 'transparent', borderBottom: '1px solid var(--dsw-alias-border-l1, #d0d7de)' }}>
        {t(`status.${state.status}` as RevisoLocaleKey)}{state.message === '' ? '' : ` — ${state.message}`}
        {state.status !== 'live' && (
          <button type='button' onClick={startRevisoOAuth}
            style={{ marginLeft: 8, padding: '2px 8px', fontSize: 11, border: '1px solid #4f46e5', borderRadius: 4, background: '#4f46e5', color: '#fff', cursor: 'pointer' }}>
            {t('action.connect')}
          </button>
        )}
      </div>
      {state.status === 'live' && state.docs.length === 0 && (
        <div style={{ padding: '18px 12px', textAlign: 'center', opacity: .7 }}>
          {t('panel.empty')}
        </div>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: '4px 0' }}>
        {state.docs.map(doc => (
          <li key={doc.id} style={{ padding: '5px 12px', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            {doc.url === ''
              ? <span style={{ overflowWrap: 'anywhere' }}>{doc.title}</span>
              : <a href={doc.url} target='_blank' rel='noreferrer' style={{ color: '#4f46e5', overflowWrap: 'anywhere' }}>{doc.title}</a>}
            <span style={{ opacity: .6, whiteSpace: 'nowrap', fontSize: 11 }}>
              {doc.unresolved > 0 ? `${doc.unresolved} ${t('doc.pending')}` : doc.updated}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
