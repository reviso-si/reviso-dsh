import type { RevisoState, RevisoStatus } from './state.ts'

/** Four-shares composition: runtime(owner) + store(useStore/actions) + inject(onReload). */
interface PanelProps {
  state: RevisoState
  useStore: (sel: (s: RevisoState) => RevisoState) => RevisoState
  actions: {
    closePanel: () => void
    setServer: (v: string) => void
    setToken: (v: string) => void
  }
  onReload: (server: string, token: string) => void
}

const statusLabel: Record<RevisoStatus, string> = {
  demo: '演示数据',
  loading: '加载中…',
  live: '已连接 Reviso',
  error: '出错',
}

/** Frame-wide overlay panel (shell.overlay entry; opts into pointer events). */
export function RevisoPanel(props: PanelProps) {
  const state = props.useStore((s) => s)
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
        background: '#ffffff',
        color: '#1f2328',
        border: '1px solid #d0d7de',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,.18)',
        font: '12px/1.5 -apple-system, system-ui, sans-serif',
        zIndex: 60,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #d0d7de' }}>
        <strong style={{ fontSize: 12 }}>Reviso</strong>
        <button type='button' onClick={() => props.actions.closePanel()} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#57606a' }} title='关闭'>✕</button>
      </div>
      <div style={{ padding: '6px 12px', fontSize: 11, color: state.status === 'demo' ? '#9a6700' : '#57606a', background: state.status === 'demo' ? '#fff8c5' : 'transparent', borderBottom: '1px solid #d0d7de' }}>
        {statusLabel[state.status]}{state.message === '' ? '' : ` — ${state.message}`}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: '4px 0' }}>
        {state.docs.map(doc => (
          <li key={doc.id} style={{ padding: '5px 12px', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            {doc.url === ''
              ? <span style={{ overflowWrap: 'anywhere' }}>{doc.title}</span>
              : <a href={doc.url} target='_blank' rel='noreferrer' style={{ color: '#0969da', overflowWrap: 'anywhere' }}>{doc.title}</a>}
            <span style={{ color: '#8c959f', whiteSpace: 'nowrap', fontSize: 11 }}>{doc.updated}</span>
          </li>
        ))}
      </ul>
      <details style={{ padding: '4px 12px 10px', color: '#57606a' }}>
        <summary style={{ cursor: 'pointer', fontSize: 11 }}>连接设置</summary>
        <label style={{ display: 'block', marginTop: 6, fontSize: 11 }}>
          Server
          <input value={state.server} onChange={e => props.actions.setServer(e.target.value)} placeholder='https://reviso.work'
            style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 2, padding: '4px 6px', fontSize: 12, border: '1px solid #d0d7de', borderRadius: 4 }} />
        </label>
        <label style={{ display: 'block', marginTop: 6, fontSize: 11 }}>
          Token
          <input value={state.token} onChange={e => props.actions.setToken(e.target.value)} type='password' placeholder='rak_…（仅存本机 localStorage）'
            style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 2, padding: '4px 6px', fontSize: 12, border: '1px solid #d0d7de', borderRadius: 4 }} />
        </label>
        <button type='button' onClick={() => props.onReload(state.server, state.token)}
          style={{ marginTop: 8, padding: '4px 10px', fontSize: 12, border: '1px solid #d0d7de', borderRadius: 4, background: '#f6f8fa', cursor: 'pointer' }}>
          重新拉取
        </button>
      </details>
    </div>
  )
}
