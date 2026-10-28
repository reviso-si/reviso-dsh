import { createHash } from 'node:crypto'

const DATA_URI = /data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)/gi
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_DECODED = 5 * 1024 * 1024

function decodedBytes(encoded) {
  try {
    const data = Buffer.from(encoded, 'base64')
    const normalized = data.toString('base64').replace(/=+$/, '')
    return normalized === encoded.replace(/=+$/, '') ? data : null
  } catch {
    return null
  }
}

export function findEmbeddedImages(content) {
  if (typeof content !== 'string') throw new TypeError('deck content must be a string')
  const found = []
  for (const match of content.matchAll(DATA_URI)) {
    const mime = String(match[1]).toLowerCase()
    const encoded = String(match[2])
    if (!ALLOWED.has(mime)) continue
    const data = decodedBytes(encoded)
    if (!data || data.length === 0 || data.length > MAX_DECODED) continue
    const start = match.index ?? 0
    found.push({ mime, encoded, decoded: data, start, end: start + match[0].length })
  }
  return found
}

export function rewriteEmbeddedImages(content, uploads) {
  const images = findEmbeddedImages(content)
  if (images.length !== uploads.length) {
    throw new Error('upload count does not match embedded image count')
  }
  const pieces = []
  let cursor = 0
  let previousEnd = -1
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index]
    const url = String(uploads[index] || '')
    if (image.start < previousEnd || image.end < image.start) {
      throw new Error('embedded image positions overlap')
    }
    if (!url) throw new Error('upload returned an empty asset URL')
    pieces.push(content.slice(cursor, image.start), url)
    cursor = image.end
    previousEnd = image.end
  }
  pieces.push(content.slice(cursor))
  return pieces.join('')
}

export function uploadOperationId(baseOperationId, index, image) {
  const digest = createHash('sha256').update(image.decoded).digest('hex').slice(0, 24)
  return `${baseOperationId}-asset-${index}-${digest}`.slice(0, 199)
}

export function draftDeckContent(title) {
  const escaped = String(title || 'Document')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return '<div class="hr-deck" data-aspect-ratio="16:9" '
    + 'data-contract-version="html-deck/1">'
    + '<section class="hr-slide" data-slide-id="s01">'
    + `<h1>${escaped}</h1><p>Uploading images...</p>`
    + '</section></div>'
}
