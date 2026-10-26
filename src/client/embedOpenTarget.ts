// Pure validation for the host-mediated iframe external-open request.
export function embedOpenTarget(
  embedUrl: string,
  openUrl: string,
  data: unknown,
): string {
  const value = data as {
    type?: string
    version?: number
    documentId?: string
    href?: string
  } | null
  if (value?.type !== 'reviso:open-external' || value.version !== 1) return ''
  let embedOrigin = ''
  let target: URL
  try {
    embedOrigin = new URL(embedUrl).origin
    target = new URL(openUrl)
  } catch {
    return ''
  }
  if (target.protocol !== 'https:'
      && !(target.protocol === 'http:'
        && (target.hostname === '127.0.0.1' || target.hostname === 'localhost'))) {
    return ''
  }
  if (!/^doc_[0-9a-f]{12}$/u.test(value.documentId || '')) return ''
  const expectedPath = `/documents/${value.documentId!.slice(4)}`
  if (value.href !== expectedPath || target.pathname !== expectedPath
      || target.search !== '' || target.hash !== '' || embedOrigin === '') return ''
  return target.toString()
}

export function allowedEmbedMessageOrigin(actual: string, embedUrl: string): boolean {
  if (actual === 'null') return true
  try {
    return actual === new URL(embedUrl).origin
  } catch {
    return false
  }
}
