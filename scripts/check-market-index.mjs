import { readFile } from 'node:fs/promises'
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'

const path = new URL('../market/index.json', import.meta.url)
const value = JSON.parse(await readFile(path, 'utf8'))
const publicUrl = process.env.REVISO_MARKET_INDEX_URL
  || 'https://raw.githubusercontent.com/reviso-si/reviso-dsh/main/market/index.json'
const index = parseMarketIndex(value, publicUrl)
if (index.plugins.length === 0) throw new Error('market index contains no plugins')
console.log(`[reviso-dsh] market index valid: ${index.plugins.length} plugin(s)`)
