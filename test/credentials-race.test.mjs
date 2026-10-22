import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  EXPIRES_REF, REFRESH_REF, SERVER_REF, TOKEN_REF, WORKSPACE_REF,
  clearCredential, readCredential,
} from '../host/credentials.js'

test('logout generation fences an in-flight refresh from resurrecting credentials', async () => {
  const values = new Map([
    [TOKEN_REF, 'rak_old'],
    [WORKSPACE_REF, 'wsp_1'],
    [SERVER_REF, 'https://reviso.work'],
    [REFRESH_REF, 'rft_old'],
    [EXPIRES_REF, '1'],
  ])
  const ctx = {
    credentials: {
      async describe(ref) { return { configured: values.has(ref), writable: true } },
      async resolve(ref) {
        return values.has(ref) ? { value: values.get(ref), source: 'test' } : undefined
      },
      async set(ref, value) { values.set(ref, value) },
      async unset(ref) { values.delete(ref) },
    },
  }
  const savedFetch = globalThis.fetch
  let release
  globalThis.fetch = async url => {
    if (String(url).endsWith('/oauth/token')) {
      await new Promise(resolve => { release = resolve })
      return new Response(JSON.stringify({
        access_token: 'rak_refreshed',
        refresh_token: 'rft_refreshed',
        expires_in: 3600,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ connection: { id: 'con_1' } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    const pending = readCredential(ctx).catch(error => error)
    while (typeof release !== 'function') await new Promise(resolve => setTimeout(resolve, 0))
    await clearCredential(ctx)
    release()
    const result = await pending
    assert.ok(result instanceof Error)
    assert.equal(values.has(TOKEN_REF), false)
    assert.equal(values.has(REFRESH_REF), false)
  } finally {
    globalThis.fetch = savedFetch
  }
})
