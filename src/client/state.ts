import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

export interface RevisoDoc {
  id: string
  title: string
  updated: string
  url: string
}

export type RevisoStatus = 'demo' | 'loading' | 'live' | 'error'

export interface RevisoState {
  open: boolean
  server: string
  token: string
  status: RevisoStatus
  message: string
  docs: RevisoDoc[]
}

type RevisoActions = {
  togglePanel: (d: RevisoState) => void
  closePanel: (d: RevisoState) => void
  setServer: (d: RevisoState, v: string) => void
  setToken: (d: RevisoState, v: string) => void
  setDocs: (d: RevisoState, status: RevisoStatus, docs: RevisoDoc[], message: string) => void
}

const LS_SERVER = 'reviso.dsh.server'
const LS_TOKEN = 'reviso.dsh.token'

function readLS(key: string): string {
  try { return localStorage.getItem(key) ?? '' } catch { return '' }
}

function writeLS(key: string, v: string): void {
  try {
    if (v === '') localStorage.removeItem(key)
    else localStorage.setItem(key, v)
  } catch { /* storage unavailable: settings stay session-only */ }
}

/** Demo rows, clearly labeled; shown when no credentials are configured or a fetch fails. */
export function demoDocs(): RevisoDoc[] {
  return [
    { id: 'demo-1', title: '（演示）产品需求草稿 v3', updated: '2026-10-20', url: 'https://reviso.work' },
    { id: 'demo-2', title: '（演示）发布评审清单', updated: '2026-10-21', url: 'https://reviso.work' },
    { id: 'demo-3', title: '（演示）agent 产出：周报草稿', updated: '2026-10-22', url: 'https://reviso.work' },
  ]
}

/**
 * Shared panel state for the footer entry and the overlay panel. One handle is
 * passed to both registers inside apply (root scope; framework caches one live
 * instance per handle x scope).
 */
export function createRevisoStore(): EngineStoreHandle<RevisoState, RevisoActions> {
  return defineStore({
    init: (): RevisoState => ({
      open: false,
      server: readLS(LS_SERVER),
      token: readLS(LS_TOKEN),
      status: 'demo',
      message: '',
      docs: demoDocs(),
    }),
    actions: {
      togglePanel: (d) => { d.open = !d.open },
      closePanel: (d) => { d.open = false },
      setServer: (d, v: string) => { d.server = v; writeLS(LS_SERVER, v) },
      setToken: (d, v: string) => { d.token = v; writeLS(LS_TOKEN, v) },
      setDocs: (d, status: RevisoStatus, docs: RevisoDoc[], message: string) => {
        d.status = status
        d.docs = docs
        d.message = message
      },
    },
  })
}

/** Fetch documents from the configured Reviso deployment; fall back to demo rows. */
export async function loadDocs(engine: { actions: RevisoActions }, server: string, token: string): Promise<void> {
  if (server === '' || token === '') {
    engine.actions.setDocs('demo', demoDocs(), '未配置 Reviso 凭证 —— 显示演示数据。在下方填入 server 与 token 后重试。')
    return
  }
  engine.actions.setDocs('loading', [], '')
  try {
    const res = await fetch(`${server.replace(/\/$/, '')}/api/dashboard/documents`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body: unknown = await res.json()
    const rows = extractDocs(body)
    if (rows.length === 0) throw new Error('响应中没有文档列表')
    engine.actions.setDocs('live', rows, '')
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    engine.actions.setDocs('demo', demoDocs(), `拉取失败（${reason}）—— 显示演示数据。检查 server/token 与部署端 REVISO_CORS_ALLOWLIST 是否放行本 origin。`)
  }
}

/** Defensive extraction: accept {documents|items|data: [...]}, pass through arrays. */
function extractDocs(body: unknown): RevisoDoc[] {
  const list = Array.isArray(body)
    ? body
    : typeof body === 'object' && body !== null
      ? ((body as Record<string, unknown>).documents
        ?? (body as Record<string, unknown>).items
        ?? (body as Record<string, unknown>).data)
      : undefined
  if (!Array.isArray(list)) return []
  return list.flatMap((row): RevisoDoc[] => {
    if (typeof row !== 'object' || row === null) return []
    const r = row as Record<string, unknown>
    const title = typeof r.title === 'string' ? r.title : ''
    if (title === '') return []
    return [{
      id: typeof r.id === 'string' ? r.id : title,
      title,
      updated: typeof r.updated_at === 'string' ? r.updated_at.slice(0, 10)
        : typeof r.updatedAt === 'string' ? r.updatedAt.slice(0, 10) : '',
      url: typeof r.url === 'string' ? r.url : '',
    }]
  })
}
