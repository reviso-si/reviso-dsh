import { createHash } from 'node:crypto'

const IMG_TAG = /<img\b[^>]*>/gis
const SRC_ATTR = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
const DATA_URI = /^data:(image\/(?:png|jpeg|gif|webp));base64,([^\s"']*)$/i
const ASSET_URL = /^\/api\/documents\/[^/\s]+\/assets\/[^/\s]+$/u
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
  for (const tag of content.matchAll(IMG_TAG)) {
    const tagText = String(tag[0])
    const src = SRC_ATTR.exec(tagText)
    if (!src) continue
    const value = String(src[1] ?? src[2] ?? src[3] ?? '')
    const match = DATA_URI.exec(value)
    if (!match) continue
    const mime = String(match[1]).toLowerCase()
    const encoded = String(match[2])
    const data = decodedBytes(encoded)
    if (!data) throw new Error(`embedded ${mime} is not valid base64`)
    if (data.length === 0) throw new Error(`embedded ${mime} is empty`)
    if (data.length > MAX_DECODED) {
      throw new Error(
        `embedded ${mime} is ${data.length} bytes; maximum upload image size is ${MAX_DECODED} bytes`,
      )
    }
    const tagStart = tag.index ?? 0
    const srcOffset = tagText.indexOf(src[0])
    const quotedOffset = src[0].indexOf(value)
    const start = tagStart + srcOffset + quotedOffset
    found.push({
      mime,
      encoded,
      decoded: data,
      start,
      end: start + value.length,
      rawUri: value,
    })
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
    if (image.rawUri !== content.slice(image.start, image.end)) {
      throw new Error('embedded image positions changed during upload')
    }
    if (!ASSET_URL.test(url)) throw new Error('upload returned an invalid asset URL')
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
