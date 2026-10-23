import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { embedSession, RevisoHttpError, sessionDocuments } from '../src/client/host.ts'

const savedFetch = globalThis.fetch
const savedNavigator = globalThis.navigator

afterEach(() => {
  globalThis.fetch = savedFetch
  if (savedNavigator === undefined) delete globalThis.navigator
  else Object.defineProperty(globalThis, 'navigator', { value: savedNavigator, configurable: true })
})

function setNavigatorLanguage() {
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true })
}

test('empty and legacy error bodies normalize by HTTP status', async () => {
  const cases = [
    [401, 'auth_expired', false],
    [403, 'forbidden', false],
    [404, 'not_found', false],
    [409, 'conflict', false],
    [400, 'unsupported', false],
    [429, 'unavailable', true],
    [500, 'unavailable', true],
    [501, 'unsupported', false],
  ]
  for (const [status, expectedCode, expectedRetryable] of cases) {
    globalThis.fetch = async () => new Response('', { status })
    await assert.rejects(
      () => sessionDocuments('sess_empty'),
      error => {
        assert.ok(error instanceof RevisoHttpError)
        assert.equal(error.status, status)
        assert.equal(error.code, expectedCode)
        assert.equal(error.retryable, expectedRetryable)
        assert.equal(error.diagnosticCode, undefined)
        return true
      },
    )
  }

  globalThis.fetch = async () => new Response('tag: upstream diagnostic', { status: 409 })
  await assert.rejects(
    () => sessionDocuments('sess_legacy'),
    error => {
      assert.equal(error.code, 'conflict')
      assert.equal(error.diagnosticCode, undefined)
      return true
    },
  )
})

test('valid host taxonomy codes survive conflicting HTTP status', () => {
  for (const [status, code] of [[502, 'not_connected'], [403, 'conflict'], [400, 'not_connected']]) {
    const error = new RevisoHttpError(status, 'host normalized', code)
    assert.equal(error.code, code)
  }
})

test('legacy request_failed on a non-2xx status cannot bypass the taxonomy', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: 'legacy failure',
    code: 'request_failed',
  }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  await assert.rejects(
    () => sessionDocuments('sess_legacy_body'),
    error => {
      assert.equal(error.code, 'forbidden')
      assert.equal(error.status, 403)
      return true
    },
  )
})

test('embedSession rejects a valid-looking URL on the wrong HTTPS origin', async () => {
  setNavigatorLanguage()
  globalThis.fetch = async () => new Response(JSON.stringify({
    session_id: 'ems_abcdef123456',
    document_id: 'doc_abcdef123456',
    embed_url: 'https://wrong.example/embed/v1/documents/doc_abcdef123456?session=ems_abcdef123456#code=rem_code_secret',
    code_expires_at: '2026-01-01T00:01:00+00:00',
    code_expires_in: 60,
    token_expires_in: 900,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })

  await assert.rejects(
    () => embedSession('doc_abcdef123456', 'system', 'https://reviso-api.fly.dev'),
    /invalid Reviso embed origin/,
  )
})

test('embedSession accepts the expected HTTPS origin', async () => {
  setNavigatorLanguage()
  globalThis.fetch = async () => new Response(JSON.stringify({
    session_id: 'ems_abcdef123456',
    document_id: 'doc_abcdef123456',
    embed_url: 'https://reviso-api.fly.dev/embed/v1/documents/doc_abcdef123456?session=ems_abcdef123456#code=rem_code_secret',
    code_expires_at: '2026-01-01T00:01:00+00:00',
    code_expires_in: 60,
    token_expires_in: 900,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })

  const result = await embedSession('doc_abcdef123456', 'system', 'https://reviso-api.fly.dev')
  assert.equal(result.session_id, 'ems_abcdef123456')
})
