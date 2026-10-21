import type { ReactNode } from 'react'

/** Compact document glyph used by both the global and session Reviso lists. */
export function RevisoPanelIcon({ size }: { size: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor'
      strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
      <path d='M6 3.5h7l4 4v13H6z' />
      <path d='M13 3.5v4h4M9 12h5M9 15.5h5' />
    </svg>
  )
}
