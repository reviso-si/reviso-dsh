const generations = new Map()
const listeners = new Set()

function key(server, workspaceId) {
  return `${String(server || '')}|${String(workspaceId || '')}`
}

export function markPublished(server, workspaceId) {
  const value = key(server, workspaceId)
  const generation = (generations.get(value) || 0) + 1
  generations.set(value, generation)
  for (const listener of listeners) {
    try { listener({ server: String(server || ''), workspaceId: String(workspaceId || ''), generation }) } catch {}
  }
  return generation
}

export function publishedGeneration(server, workspaceId) {
  return generations.get(key(server, workspaceId)) || 0
}

export function subscribePublished(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function resetPublishedGenerations() {
  generations.clear()
  listeners.clear()
}
