interface FooterActionProps {
  /** Sidebar column state passed by the owner (wide row vs 56px rail). */
  wide: boolean
  actions: { togglePanel: () => void }
}

/** Sidebar foot entry beside Settings; opens the Reviso panel. */
export function RevisoFooterAction(props: FooterActionProps) {
  return (
    <button
      type='button'
      onClick={() => props.actions.togglePanel()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: props.wide ? 6 : 0,
        width: '100%',
        padding: props.wide ? '6px 10px' : '6px',
        border: 'none',
        borderRadius: 6,
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontSize: 12,
        cursor: 'pointer',
        justifyContent: props.wide ? 'flex-start' : 'center',
      }}
      title='Reviso'
    >
      <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>📋</span>
      {props.wide ? <span>Reviso</span> : null}
    </button>
  )
}
