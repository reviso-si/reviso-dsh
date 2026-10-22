const generations = new Map()

function key(server, workspaceId) {
  return `${String(server || '')}|${String(workspaceId || '')}`
}

export function markPublished(server, workspaceId) {
  const value = key(server, workspaceId)
  generations.set(value, (generations.get(value) || 0) + 1)
  return generations.get(value)
}

export function publishedGeneration(server, workspaceId) {
  return generations.get(key(server, workspaceId)) || 0
}

export function resetPublishedGenerations() {
  generations.clear()
}
