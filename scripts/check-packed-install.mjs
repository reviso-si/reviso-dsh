import { execFileSync } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseNpmPackOutput } from './npm-pack-output.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const temp = await mkdtemp(join(tmpdir(), 'reviso-dsh-install-'))
const install = join(temp, 'install')

try {
  const output = execFileSync('npm', [
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    temp,
  ], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_dry_run: 'false',
      npm_config_loglevel: 'error',
    },
  })
  const filename = parseNpmPackOutput(output)?.[0]?.filename
  if (typeof filename !== 'string' || filename === '') {
    throw new Error('npm pack returned no filename')
  }
  execFileSync('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--prefix',
    install,
    join(temp, filename),
  ], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, npm_config_loglevel: 'error' },
  })

  const packageRoot = join(install, 'node_modules', 'dsh-reviso')
  const mod = await import(pathToFileURL(join(packageRoot, 'index.js')).href)
  if (mod.name !== 'reviso-dsh') throw new Error('installed package has the wrong host name')
  if (!Array.isArray(mod.inject) || !mod.inject.includes('tools')) {
    throw new Error('installed package does not inject the DSH tools service')
  }
  const clientPath = join(packageRoot, 'lib', 'client.js')
  await access(clientPath)
  const client = await readFile(clientPath, 'utf8')
  if (!client.includes('exports.apply') || !client.includes('exports.inject')) {
    throw new Error('installed client bundle is not a DSH client module')
  }
  await access(join(packageRoot, 'docs', 'client-face-contract.md'))
  await access(join(packageRoot, 'SECURITY.md'))
  console.log('[reviso-dsh] packed tarball installs and imports successfully')
} finally {
  await rm(temp, { recursive: true, force: true })
}
