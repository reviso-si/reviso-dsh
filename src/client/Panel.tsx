import { useEffect } from 'react'
import type { RevisoState, RevisoStatus } from './state.ts'
import { onRevisoConnected, startRevisoOAuth } from './host.ts'

/** Four-shares composition: runtime(owner) + store(useStore/actions) + inject(onReload). */
interface PanelProps {
  state: RevisoState
  useStore: (sel: (s: RevisoState) => RevisoState) => RevisoState
  actions: {
    closePanel: () => void
  }
  onReload: () => void
}

const statusLabel: Record<RevisoStatus, string> = {
  unconfigured: '未连接 Reviso',
  loading: '加载中…',
  live: '已连接 Reviso',
  error: '出错',
}

/** Frame-wide overlay panel (shell.overlay entry; opts into pointer events). */
export function RevisoPanel(props: PanelProps) {
  const state = props.useStore((s) => s)

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
        background: 'var(--dsw-surface, #ffffff)',
        color: 'var(--dsw-text, #1f2328)',
        border: '1px solid var(--dsw-border, #d0d7de)',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,.18)',
        font: '12px/1.5 -apple-system, system-ui, sans-serif',
        zIndex: 60,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--dsw-border, #d0d7de)' }}>
        <strong style={{ fontSize: 12 }}>Reviso</strong>
        <button type='button' onClick={() => props.actions.closePanel()} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'inherit' }} title='关闭'>✕</button>
      </div>
      <div style={{ padding: '8px 12px', fontSize: 11, color: state.status === 'error' ? '#b35900' : 'inherit', background: state.status === 'error' ? 'rgba(255,241,229,.5)' : 'transparent', borderBottom: '1px solid var(--dsw-border, #d0d7de)' }}>
        {statusLabel[state.status]}{state.message === '' ? '' : ` — ${state.message}`}
        {state.status !== 'live' && (
          <button type='button' onClick={startRevisoOAuth}
            style={{ marginLeft: 8, padding: '2px 8px', fontSize: 11, border: '1px solid var(--dsw-border, #d0d7de)', borderRadius: 4, background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
            连接 Reviso
          </button>
        )}
      </div>
      {state.status === 'live' && state.docs.length === 0 && (
        <div style={{ padding: '18px 12px', textAlign: 'center', opacity: .7 }}>
          还没有文档。让 agent 调用 reviso_publish 发布后，这里会出现。
        </div>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: '4px 0' }}>
        {state.docs.map(doc => (
          <li key={doc.id} style={{ padding: '5px 12px', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            {doc.url === ''
              ? <span style={{ overflowWrap: 'anywhere' }}>{doc.title}</span>
              : <a href={doc.url} target='_blank' rel='noreferrer' style={{ color: 'var(--dsw-accent, #0969da)', overflowWrap: 'anywhere' }}>{doc.title}</a>}
            <span style={{ opacity: .6, whiteSpace: 'nowrap', fontSize: 11 }}>
              {doc.unresolved > 0 ? `${doc.unresolved} 条待处理` : doc.updated}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
