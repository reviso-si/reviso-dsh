import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertPublishBodySize, publishBodyLimit } from '../index.js'

const MIB = 1024 * 1024

test('publish limit defaults to 36 MiB and accepts positive integer overrides', () => {
  assert.equal(publishBodyLimit({}), 36 * MIB)
  assert.equal(publishBodyLimit({ REVISO_MAX_PUBLISH_JSON_BYTES: '1048576' }), MIB)
  assert.equal(publishBodyLimit({ REVISO_MAX_PUBLISH_JSON_BYTES: '37748736' }), 36 * MIB)
})

test('invalid overrides fall back to the default limit', () => {
  for (const invalid of ['', 'nope', '0', '-1048576', '1.5']) {
    assert.equal(publishBodyLimit({ REVISO_MAX_PUBLISH_JSON_BYTES: invalid }), 36 * MIB)
  }
})

test('guard rejects a payload over the limit with sizes and one suggestion', () => {
  const body = { content: 'x'.repeat(37 * MIB) }
  assert.throws(
    () => assertPublishBodySize(body),
    error => {
      assert.equal(
        error.message,
        'payload 37.0MB exceeds publish limit 36.0MB'
        + ' - reduce embedded images (reference uploaded assets instead of base64 data URIs) or split the content',
      )
      return true
    },
  )
})

test('a body under the limit passes through with its serialized size', () => {
  const body = { title: 'Session plan', content: '# Plan\n\nShip the spike.' }
  const expected = Buffer.byteLength(JSON.stringify(body), 'utf8')
  assert.equal(assertPublishBodySize(body), expected)
})
