// Wrap the CJS body into the loader's closure-factory shape:
//   window.__ModuleLoader__.load({ id, factory: (require) => { ...; return module.exports } })
// Mirrors packages/client/tsdown.client.ts output (verified against an installed lib/client.js).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const body = readFileSync(join(root, 'lib', 'client.cjs'), 'utf8').replace(/^'use strict';\n?/, '')
const out = [
  `window.__ModuleLoader__.load({`,
  `\tid: ${JSON.stringify(pkg.name)},`,
  `\tfactory: (require) => {`,
  `\t\tvar module = { exports: {} };`,
  `\t\tvar exports = module.exports;`,
  `\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });`,
  body.trimEnd(),
  `\t\treturn module.exports;`,
  `\t}`,
  `});`,
  ``,
].join('\n')
writeFileSync(join(root, 'lib', 'client.js'), out)
console.log(`[reviso-dsh] wrote lib/client.js (${out.length} bytes)`)
