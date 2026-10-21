import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { en, zh } from './locales.ts'
import { RevisoGlobalPanel } from './GlobalPanel.tsx'
import { RevisoPanelIcon } from './PanelIcon.tsx'
import { RevisoSessionView } from './SessionView.tsx'
import { RevisoConnectionSection } from './ConnectionSection.tsx'

/** Required services: UI slots and the host language dictionaries. */
export const inject = ['slots', 'locale']

const PANEL_ID = 'reviso'

/**
 * Register the global Reviso workspace and the per-session Reviso view.
 * Fail-soft: a registration problem must never take down host boot.
 */
export function apply(ctx: ClientContext): void {
  try {
    ctx.effect(() => ctx.locale.register('reviso-dsh', { zh, en }), 'reviso-dsh dictionaries')

    ctx.slots.inject('main', () =>
      ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: 'reviso-dsh',
      }, RevisoGlobalPanel))

    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 20,
        label: 'Reviso',
        locale: 'reviso-dsh',
      }, RevisoPanelIcon))

    ctx.slots.inject('settings.section', () =>
      ctx.slots.register({
        name: 'settings.section',
        id: 'reviso-connection',
        order: 50,
        label: 'Reviso connection',
        locale: 'reviso-dsh',
      }, RevisoConnectionSection))

    ctx.slots.inject('conversation.view', () =>
      ctx.slots.register({
        name: 'conversation.view',
        id: 'reviso-dsh.view',
        order: 100,
        label: 'Reviso',
        locale: 'reviso-dsh',
      }, RevisoSessionView))
  } catch (err) {
    console.warn('[reviso-dsh] client registration failed:', err)
  }
}
