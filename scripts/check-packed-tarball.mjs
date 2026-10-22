import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const temp = await mkdtemp(join(tmpdir(), 'reviso-dsh-pack-'))

try {
  // prepack invokes this checker; disable lifecycle scripts for the inner
  // pack so the gate inspects the freshly built artifact without recursion.
  const output = execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, npm_config_loglevel: 'error' },
  })
  const packed = JSON.parse(output)
  const filename = packed?.[0]?.filename
  if (typeof filename !== 'string' || filename === '') throw new Error('npm pack returned no filename')
  const tarball = join(temp, filename)
  const entries = readTar(gunzipSync(await readFile(tarball)))
  const client = entries.get('package/lib/client.js')
  if (client === undefined || client.length === 0) {
    throw new Error('packed tarball is missing package/lib/client.js')
  }
  const text = client.toString('utf8')
  for (const requiredExport of ['exports.apply', 'exports.inject']) {
    if (!text.includes(requiredExport)) throw new Error(`packed lib/client.js lacks ${requiredExport}`)
  }
  const declaredName = packageJson.name
  if (!text.includes(JSON.stringify(declaredName))) {
    throw new Error('packed lib/client.js does not identify package ' + declaredName)
  }
  if (text.includes('@deepseek-ai/dsh-client-runtime')) {
    throw new Error('packed lib/client.js contains the retired runtime seed')
  }
  console.log('[reviso-dsh] packed tarball includes fresh lib/client.js')
} finally {
  await rm(temp, { recursive: true, force: true })
}

function readTar(buffer) {
  const entries = new Map()
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const name = readString(header, 0, 100)
    const prefix = readString(header, 345, 155)
    const fullName = prefix === '' ? name : `${prefix}/${name}`
    const size = Number.parseInt(readString(header, 124, 12).trim() || '0', 8)
    const type = String.fromCharCode(header[156] || 48)
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    if (dataEnd > buffer.length) throw new Error('truncated npm tarball')
    if (type === '0' || type === '\0') entries.set(fullName, buffer.subarray(dataStart, dataEnd))
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  return entries
}

function readString(buffer, offset, length) {
  return buffer.subarray(offset, offset + length).toString('utf8').replace(/\0.*$/su, '')
}
