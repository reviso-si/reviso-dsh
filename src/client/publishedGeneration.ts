export type PublishedGenerationEvent = {
  server?: string
  workspaceId?: string
  generation?: number
}

/** Subscribe to host publish completion events; EventSource reconnects natively. */
export function startPublishedEventStream(
  onPublished: (event: PublishedGenerationEvent) => void,
): () => void {
  if (typeof EventSource === 'undefined') return () => {}
  const source = new EventSource('/plugins/reviso/events')
  const listener = (event: MessageEvent) => {
    let payload: PublishedGenerationEvent = {}
    try { payload = JSON.parse(String(event.data || '{}')) as PublishedGenerationEvent } catch {}
    onPublished(payload)
  }
  source.addEventListener('published', listener)
  return () => {
    source.removeEventListener('published', listener)
    source.close()
  }
}
