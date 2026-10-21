import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('client manifest declares every runtime external and no retired runtime seed', () => {
  assert.deepEqual(pkg.dsh.client.inject, [])
  assert.deepEqual(pkg.dsh.client.external, ['@deepseek-ai/dsh-client-store'])
  assert.equal(bundle.includes('@deepseek-ai/dsh-client-runtime'), false)
  assert.equal(bundle.includes('@deepseek-ai/dsh-client-store'), true)
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
    ['@deepseek-ai/dsh-client-store', {}],
  ])
  const client = registration.factory(specifier => {
    assert.ok(seeds.has(specifier), `Unregistered DSH shell seed: ${specifier}`)
    imports.push(specifier)
    return seeds.get(specifier)
  })
  assert.ok(imports.includes('@deepseek-ai/dsh-client-store'))
  assert.equal(typeof client.apply, 'function')
  assert.deepEqual(Array.from(client.inject), ['slots', 'locale'])
})
