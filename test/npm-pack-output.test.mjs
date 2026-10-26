import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseNpmPackOutput } from '../scripts/npm-pack-output.mjs'

test('npm pack JSON survives ANSI and lifecycle log prefixes', () => {
  const output = '\u001b[34mℹ build noise\u001b[0m\nwarning text\n[{"filename":"dsh-reviso-0.1.0.tgz"}]'
  assert.deepEqual(parseNpmPackOutput(output), [
    { filename: 'dsh-reviso-0.1.0.tgz' },
  ])
})

test('npm pack parser rejects output without a JSON array', () => {
  assert.throws(() => parseNpmPackOutput('not json'), /did not return a JSON array/)
})
