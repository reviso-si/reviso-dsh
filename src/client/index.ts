import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createRevisoStore, loadDocs } from './state.ts'
import { RevisoFooterAction } from './FooterAction.tsx'
import { RevisoPanel } from './Panel.tsx'
import { RevisoSessionView } from './SessionView.tsx'
import { en, zh } from './locales.ts'

/** Required services: UI slots and the host language dictionaries. */
export const inject = ['slots', 'locale']

/**
 * Register the Reviso sidebar entry and the frame-wide panel. Fail-soft: a
 * registration problem must never take down the host boot.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  try {
    const store = createRevisoStore()
    const engine = store.create()
    ctx.effect(() => ctx.locale.register('reviso-dsh', { zh, en }), 'reviso-dsh dictionaries')

    ctx.slots.inject('sidebar.footer.action', () =>
      ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'reviso-dsh.action',
        order: 50,
        label: 'Reviso',
        locale: 'reviso-dsh',
        store,
        inject: () => ({ onToggle: () => engine.actions.togglePanel() }),
      }, RevisoFooterAction))

    ctx.slots.inject('conversation.view', () =>
      ctx.slots.register({
        name: 'conversation.view',
        id: 'reviso-dsh.view',
        order: 100,
        label: 'Reviso',
        locale: 'reviso-dsh',
      }, RevisoSessionView))

    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register({
        name: 'shell.overlay',
        id: 'reviso-dsh.panel',
        order: 10,
        locale: 'reviso-dsh',
        store,
        inject: () => ({
          onReload: () => { void loadDocs(engine) },
        }),
      }, RevisoPanel))
  } catch (err) {
    console.warn('[reviso-dsh] client registration failed:', err)
  }
}
