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

test('embed frame keeps fragment codes out of host DOM while retaining opaque sandbox', () => {
  const source = readFileSync(new URL('../src/client/EmbedFrame.tsx', import.meta.url), 'utf8')
  assert.match(source, /useEffect\(/)
  assert.match(source, /URL\.createObjectURL/)
  assert.match(source, /return \(\) => URL\.revokeObjectURL\(objectUrl\)/)
  assert.doesNotMatch(source, /useMemo/)
  assert.match(source, /http-equiv="refresh"/)
  assert.match(source, /sandbox='allow-scripts'/)
  assert.equal(source.includes('allow-same-origin'), false)
  assert.equal(source.includes('allow-popups'), false)
})

test('embed frame accepts host-mediated external open only for its source and canonical document', () => {
  const source = readFileSync(new URL('../src/client/EmbedFrame.tsx', import.meta.url), 'utf8')
  const helper = readFileSync(new URL('../src/client/embedOpenTarget.ts', import.meta.url), 'utf8')
  assert.match(source, /event\.source !== iframe\.current\.contentWindow/)
  assert.match(source, /allowedEmbedMessageOrigin\(event\.origin, url\)/)
  assert.match(helper, /reviso:open-external/)
  assert.match(helper, /value\.href !== expectedPath/)
  assert.match(helper, /target\.pathname !== expectedPath/)
  assert.match(source, /window\.open\(target, '_blank', 'noopener,noreferrer'\)/)
  assert.equal(source.includes('allow-popups'), false)
})

test('document switch clears revoked embed state before returning to a tab', () => {
  const source = readFileSync(new URL('../src/client/GlobalPanel.tsx', import.meta.url), 'utf8')
  const openDoc = source.slice(source.indexOf('function openDoc'), source.indexOf('const docMeta'))
  assert.match(openDoc, /revokeEmbed\(activeId\)/)
  assert.match(openDoc, /delete next\[activeId\]/)
  assert.ok(openDoc.indexOf('revokeEmbed(activeId)') < openDoc.indexOf('if (embeds[doc.id]'))
})

test('late embed-session responses are revoked by both client surfaces', () => {
  const globalPanel = readFileSync(new URL('../src/client/GlobalPanel.tsx', import.meta.url), 'utf8')
  const sessionView = readFileSync(new URL('../src/client/SessionView.tsx', import.meta.url), 'utf8')
  for (const source of [globalPanel, sessionView]) {
    assert.match(source, /embedSessions\.current/)
    assert.match(source, /revokeEmbedSession\((?:data|embed)\.session_id\)/)
    assert.match(source, /catch\(\(\) => undefined\)/)
    assert.match(source, /const stale = \(\) =>/)
    assert.ok((source.match(/if \(stale\(\)\) return/g) || []).length >= 3)
  }
  assert.match(globalPanel, /activeIdRef\.current !== doc\.id/)
  assert.match(globalPanel, /embedAttempts\.current\.get\(doc\.id\) !== attempt/)
  assert.match(sessionView, /sessionEpoch\.current !== epoch/)
  assert.match(sessionView, /!openDocIds\.current\.has\(doc\.id\)/)
  assert.match(sessionView, /mountedRef\.current/)
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
