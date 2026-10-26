import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allowedEmbedMessageOrigin, embedOpenTarget } from '../src/client/embedOpenTarget.ts'

const embedUrl = 'https://reviso-api.fly.dev/embed/v1/documents/doc_012345abcdef?session=ems_012345abcdef#code=rem_code_secret'
const openUrl = 'https://reviso.work/documents/012345abcdef'
const message = { type: 'reviso:open-external', version: 1, documentId: 'doc_012345abcdef', href: '/documents/012345abcdef' }

test('accepts the canonical host-mediated external document', () => {
  assert.equal(embedOpenTarget(embedUrl, openUrl, message), openUrl)
})

test('rejects wrong document, path, version, query, and insecure URL', () => {
  assert.equal(embedOpenTarget(embedUrl, 'https://reviso.work/documents/ffffffffffff', message), '')
  assert.equal(embedOpenTarget(embedUrl, openUrl, { ...message, documentId: 'doc_ffffffffffff' }), '')
  assert.equal(embedOpenTarget(embedUrl, openUrl, { ...message, href: '/documents/ffffffffffff' }), '')
  assert.equal(embedOpenTarget(embedUrl, openUrl, { ...message, version: 2 }), '')
  assert.equal(embedOpenTarget(embedUrl, `${openUrl}?x=1`, message), '')
  assert.equal(embedOpenTarget(embedUrl, 'http://reviso.work/documents/012345abcdef', message), '')
})

test('allows the opaque sandbox origin and exact embed origin only', () => {
  assert.equal(allowedEmbedMessageOrigin('null', embedUrl), true)
  assert.equal(allowedEmbedMessageOrigin('https://reviso-api.fly.dev', embedUrl), true)
  assert.equal(allowedEmbedMessageOrigin('https://wrong.example', embedUrl), false)
  assert.equal(allowedEmbedMessageOrigin('', embedUrl), false)
})
