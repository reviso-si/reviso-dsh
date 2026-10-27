import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { startPublishedEventStream } from '../src/client/publishedGeneration.ts'

const savedEventSource = globalThis.EventSource
afterEach(() => {
  if (savedEventSource === undefined) delete globalThis.EventSource
  else globalThis.EventSource = savedEventSource
})

test('published event stream reloads on host publish completion', () => {
  const listeners = new Map()
  let closed = false
  globalThis.EventSource = class {
    constructor(url) { assert.equal(url, '/plugins/reviso/events') }
    addEventListener(name, listener) { listeners.set(name, listener) }
    removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name) }
    close() { closed = true }
  }
  const events = []
  const stop = startPublishedEventStream(event => events.push(event))
  listeners.get('published')?.({ data: JSON.stringify({ server: 'https://reviso.work', workspaceId: 'wsp_1', generation: 2 }) })
  stop()
  assert.deepEqual(events, [{ server: 'https://reviso.work', workspaceId: 'wsp_1', generation: 2 }])
  assert.equal(closed, true)
  assert.equal(listeners.has('published'), false)
})
