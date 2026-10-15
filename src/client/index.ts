import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createRevisoStore, loadDocs } from './state.ts'
import { RevisoFooterAction } from './FooterAction.tsx'
import { RevisoPanel } from './Panel.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Register the Reviso sidebar entry and the frame-wide panel. Fail-soft: a
 * registration problem must never take down the host boot.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  try {
    const store = createRevisoStore()
    const engine = store.create()

    ctx.slots.inject('sidebar.footer.action', () =>
      ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'reviso-dsh.action',
        order: 50,
        label: 'Reviso',
        store,
        inject: () => ({ onToggle: () => engine.actions.togglePanel() }),
      }, RevisoFooterAction))

    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register({
        name: 'shell.overlay',
        id: 'reviso-dsh.panel',
        order: 10,
        store,
        inject: () => ({
          onReload: (server: string, token: string) => { void loadDocs(engine, server, token) },
        }),
      }, RevisoPanel))
  } catch (err) {
    console.warn('[reviso-dsh] client registration failed:', err)
  }
}
