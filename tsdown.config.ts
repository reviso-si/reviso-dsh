import { defineConfig } from 'tsdown'

/**
 * Closure-factory client artifact (mirrors packages/client/tsdown.client.ts
 * output shape without importing the harness tree):
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ... } })
 * All bare imports stay external — they resolve through the loader module
 * table at materialization (React/Cordis/runtime are shell baseline).
 */
const PKG_ID = 'dsh-reviso'

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  minify: false,
  dts: false,
  treeshake: true,
  external: (id: string) => !id.startsWith('.') && !id.startsWith('/'),
  banner: [
    `window.__ModuleLoader__.load({`,
    `\tid: ${JSON.stringify(PKG_ID)},`,
    `\tfactory: (require) => {`,
    `\t\tvar module = { exports: {} };`,
    `\t\tvar exports = module.exports;`,
  ].join('\n'),
  footer: [
    `\t\treturn module.exports;`,
    `\t}`,
    `});`,
  ].join('\n'),
})
