const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/gu

export function parseNpmPackOutput(output) {
  const clean = String(output).replace(ANSI, '').trim()
  for (let start = clean.lastIndexOf('['); start >= 0;
       start = clean.lastIndexOf('[', start - 1)) {
    try {
      const parsed = JSON.parse(clean.slice(start))
      if (Array.isArray(parsed)) return parsed
    } catch {}
  }
  throw new Error('npm pack did not return a JSON array')
}
