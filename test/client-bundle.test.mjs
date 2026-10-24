import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('client manifest declares every runtime external and no retired runtime seed', () => {
  assert.deepEqual(pkg.dsh.client.inject, [])
  assert.deepEqual(pkg.dsh.client.external, [])
  assert.equal(bundle.includes('@deepseek-ai/dsh-client-runtime'), false)
  assert.equal(bundle.includes('@deepseek-ai/dsh-client-store'), false)
})

test('global browser ships cache, source-session, view-mode, and security contracts', () => {
  for (const marker of [
    'clearDashboardDocumentsCache',
    'setDashboardCacheScope',
    'reviso-dsh-global-view',
    'All sessions',
    'Card view',
    'rs-global-card',
    'rs-session-chip',
    'sortCreator',
    'allow-scripts',
    'request_id',
    'retryable',
    'doc.revokeError',
  ]) assert.ok(bundle.includes(marker) || bundle.includes('global.sortCreator'), marker)
  assert.equal(bundle.includes('allow-same-origin'), false)
  assert.equal(bundle.includes('allow-popups-to-escape-sandbox'), false)
})

test('embed revoke failures stay visible in both client surfaces', () => {
  const sessionView = readFileSync(new URL('../src/client/SessionView.tsx', import.meta.url), 'utf8')
  const globalPanel = readFileSync(new URL('../src/client/GlobalPanel.tsx', import.meta.url), 'utf8')
  for (const source of [sessionView, globalPanel]) {
    assert.equal(source.includes('.catch(() => {})'), false)
    assert.match(source, /doc\.revokeError/)
  }
  assert.match(sessionView, /setRevokeMessage/)
  assert.match(globalPanel, /setRevokeMessage/)
})

test('client factory materializes with only the declared DSH shell seeds', () => {
  let registration
  vm.runInNewContext(bundle, {
    window: { __ModuleLoader__: { load(value) { registration = value } } },
  })
  assert.equal(registration.id, 'dsh-reviso')
  const imports = []
  const seeds = new Map([
    ['react', {}],
    ['react/jsx-runtime', {}],
  ])
  const client = registration.factory(specifier => {
    assert.ok(seeds.has(specifier), `Unregistered DSH shell seed: ${specifier}`)
    imports.push(specifier)
    return seeds.get(specifier)
  })
  assert.equal(typeof client.apply, 'function')
  assert.deepEqual(Array.from(client.inject), ['slots', 'locale'])
})
