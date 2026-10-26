import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

if (!existsSync('.git')) process.exit(0)

const result = spawnSync('npm', ['run', 'build:client'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (result.status !== 0) process.exit(result.status ?? 1)
