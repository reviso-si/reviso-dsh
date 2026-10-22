const SECRET_PATTERNS = [
  /\bBearer\s+[^\s,;]+/giu,
  /\b(?:rak|rft|rem_code|rem_token)_[A-Za-z0-9._~-]+/gu,
  /(["']?(?:access_token|refresh_token|authorization|token|code)["']?\s*[:=]\s*["']?)[^"'\s,}]+/giu,
]

const ERROR_CLASSES = new Set([
  'not_connected', 'auth_expired', 'forbidden', 'not_found',
  'conflict', 'unavailable', 'unsupported',
])

export class RevisoApiError extends Error {
  constructor(status, message, options = {}) {
    super(redactSecrets(message))
    this.name = 'RevisoApiError'
    this.status = Number.isInteger(status) ? status : 502
    this.code = normalizeCode(options.code, this.status, message)
    this.retryable = typeof options.retryable === 'boolean'
      ? options.retryable
      : defaultRetryable(this.code, this.status)
    if (typeof options.requestId === 'string' && options.requestId !== '') {
      this.requestId = options.requestId
    }
    if (options.details !== undefined) this.details = redactValue(options.details)
  }
}

export function errorFromResponse(status, text) {
  let payload
  try { payload = JSON.parse(text) } catch { payload = undefined }
  const upstream = payload && typeof payload === 'object' ? payload : {}
  const error = upstream.error
  const nested = error && typeof error === 'object' && !Array.isArray(error) ? error : {}
  const message = typeof nested.message === 'string'
    ? nested.message
    : typeof error === 'string'
      ? error
      : typeof upstream.message === 'string'
        ? upstream.message
        : `Reviso request failed (HTTP ${status})`
  const code = stringValue(nested.code, upstream.code)
  return new RevisoApiError(status, `Reviso request failed (HTTP ${status}): ${code === undefined ? '' : `${code}: `}${message.slice(0, 300)}`, {
    code,
    retryable: booleanValue(nested.retryable, upstream.retryable),
    requestId: stringValue(nested.request_id, nested.requestId, upstream.request_id, upstream.requestId),
    details: nested.details ?? upstream.details,
  })
}

export function apiErrorPayload(error) {
  const value = error instanceof RevisoApiError ? error : new RevisoApiError(502, messageOf(error), {
    code: 'unavailable',
  })
  return {
    error: value.message,
    code: value.code,
    retryable: value.retryable,
    ...(value.requestId === undefined ? {} : { request_id: value.requestId }),
    ...(value.details === undefined ? {} : { details: value.details }),
    status: value.status,
  }
}

export function redactSecrets(value) {
  let text = String(value || '')
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, (_match, prefix) => (
    typeof prefix === 'string' && prefix !== '' ? `${prefix}[redacted]` : '[redacted]'
  ))
  return text
}

export function messageOf(error) {
  return redactSecrets(error instanceof Error ? error.message : String(error))
}

function normalizeCode(code, status, message) {
  if (ERROR_CLASSES.has(code)) return code
  if (typeof code === 'string') {
    if (/AUTH_REQUIRED|NOT_CONNECTED|credential/i.test(code)) return 'not_connected'
    if (/TOKEN_EXPIRED|AUTH_EXPIRED|unauthorized/i.test(code) || status === 401) return 'auth_expired'
    if (/FORBIDDEN|PERMISSION/i.test(code) || status === 403) return 'forbidden'
    if (/NOT_FOUND/i.test(code) || status === 404) return 'not_found'
    if (/CONFLICT|STALE|CAS_/i.test(code) || status === 409) return 'conflict'
    if (/UNSUPPORTED|NOT_IMPLEMENTED/i.test(code) || status === 405) return 'unsupported'
  }
  if (/not connected|credential/i.test(String(message))) return 'not_connected'
  if (status === 401) return 'auth_expired'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 405) return 'unsupported'
  return status >= 500 || status === 0 ? 'unavailable' : 'forbidden'
}

function redactValue(value) {
  if (typeof value === 'string') return redactSecrets(value)
  if (Array.isArray(value)) return value.map(redactValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      /token|authorization|secret|code/iu.test(key) ? '[redacted]' : redactValue(child),
    ]))
  }
  return value
}

function stringValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

function booleanValue(...values) {
  for (const value of values) {
    if (typeof value === 'boolean') return value
  }
  return undefined
}

function defaultRetryable(code, status) {
  return code === 'unavailable' && (status === 408 || status === 425 || status === 429 || status >= 500 || status === 0)
}
