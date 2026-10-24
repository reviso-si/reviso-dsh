import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

type EmbedFrameProps = {
  title: string
  url: string
  className: string
  frameRef?: (node: HTMLIFrameElement | null) => void
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/** One-shot navigation page for an opaque-origin embed frame. */
export function embedBootstrapHtml(embedUrl: string): string {
  return '<!doctype html><meta charset="utf-8">'
    + `<meta http-equiv="refresh" content="0;url=${escapeHtmlAttribute(embedUrl)}">`
    + '<title>Reviso document</title>'
}

export function EmbedFrame({
  title,
  url,
  className,
  frameRef,
}: EmbedFrameProps): ReactNode {
  const [src, setSrc] = useState('about:blank')

  useEffect(() => {
    // Create and revoke in the same effect lifetime so discarded renders and
    // StrictMode's setup/cleanup pass cannot leak an object URL.
    const objectUrl = URL.createObjectURL(
      new Blob([embedBootstrapHtml(url)], { type: 'text/html' }),
    )
    setSrc(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [url])

  return (
    <iframe
      ref={frameRef}
      className={className}
      title={title}
      src={src}
      sandbox='allow-scripts'
      allow='fullscreen'
      referrerPolicy='no-referrer'
      loading='eager'
    />
  )
}
