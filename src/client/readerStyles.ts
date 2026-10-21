export const STYLE_ID = 'reviso-dsh-session-styles'

const CSS = `
.rs-session{--rs-accent:#6366f1;--rs-accent-strong:#4f46e5;--rs-accent-tint:rgba(99,102,241,.1);container-type:inline-size;height:100%;overflow:auto;padding:22px 24px 28px;font:var(--dsw-font-body,13px/1.6 -apple-system,"Segoe UI",system-ui,sans-serif);color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-base,transparent)}
@media (prefers-color-scheme: dark){.rs-session{--rs-accent:#818cf8;--rs-accent-strong:#6366f1;--rs-accent-tint:rgba(99,102,241,.2)}}
.rs-session-inner{max-width:860px;margin:0 auto}
.rs-session-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.rs-session-title{font:var(--dsw-font-title,600 14px/1.4 -apple-system,system-ui,sans-serif);letter-spacing:0;color:var(--dsw-alias-label-primary,inherit)}
.rs-session-subtitle{margin-top:2px;font:var(--dsw-font-caption,12px/1.5 -apple-system,system-ui,sans-serif);color:var(--dsw-alias-label-tertiary,#8b949e)}
.rs-session-status{display:flex;align-items:center;gap:8px;font:var(--dsw-font-caption,12px/1.5 -apple-system,system-ui,sans-serif);color:var(--dsw-alias-label-tertiary,#8b949e);white-space:nowrap}
.rs-session-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#2da44e);flex:0 0 auto}
.rs-session-status[data-state="error"] .rs-session-dot{background:var(--dsw-alias-state-error-primary,#cf222e)}
.rs-session-status[data-state="unconfigured"] .rs-session-dot{background:var(--dsw-alias-label-tertiary,#8b949e)}
.rs-session-connect{border:1px solid var(--dsw-alias-border-l2,#d0d7de);background:var(--dsw-alias-button-elevated-fill,transparent);color:var(--dsw-alias-label-primary,inherit);border-radius:6px;padding:3px 10px;font:inherit;cursor:pointer}
.rs-session-connect:hover{background:var(--dsw-alias-interactive-bg-hover,#f6f8fa)}
.rs-primary{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 16px;border:1px solid var(--rs-accent-strong);border-radius:6px;background:var(--rs-accent-strong);color:#fff;font:inherit;font-weight:500;cursor:pointer;box-shadow:0 1px 2px rgba(79,70,229,.18)}
.rs-primary:hover{background:var(--rs-accent);border-color:var(--rs-accent)}
.rs-secondary{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#57606a);font:inherit;cursor:pointer}
.rs-secondary:hover{background:var(--dsw-alias-interactive-bg-hover,#f6f8fa)}
.rs-session-message{margin-top:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,#d8dee4);border-radius:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#57606a);background:var(--dsw-alias-bg-module-platform,transparent)}
.rs-session-message[data-state="error"]{border-color:var(--dsw-alias-state-error-secondary,#cf222e);color:var(--dsw-alias-state-error-primary,#cf222e)}
.rs-session-empty{display:grid;justify-items:center;align-content:center;gap:10px;min-height:360px;padding:42px 20px;text-align:center;color:var(--dsw-alias-label-secondary,#57606a)}
.rs-empty-illustration{width:132px;height:112px;margin-bottom:2px}
.rs-session-empty strong{color:var(--dsw-alias-label-primary,inherit);font-size:15px;line-height:1.4;font-weight:600}
.rs-session-empty p{max-width:440px;margin:0;color:var(--dsw-alias-label-secondary,#57606a);font-size:13px;line-height:1.6}
.rs-session-empty .rs-primary{margin-top:4px}
.rs-doc-list{margin-top:16px;display:flex;flex-direction:column;gap:2px}
.rs-doc{display:flex;align-items:flex-start;gap:12px;padding:10px 10px;border:0;border-radius:8px;background:transparent;text-align:left;text-decoration:none;color:inherit;min-width:0;width:100%;font:inherit;cursor:pointer}
.rs-doc:hover{background:var(--dsw-alias-interactive-bg-hover,#f6f8fa)}
.rs-doc-icon{display:grid;place-items:center;flex:0 0 26px;width:26px;height:26px;margin-top:1px;border-radius:6px;background:var(--rs-accent-tint);color:var(--rs-accent)}
.rs-doc-icon[data-kind="html_deck"]{color:#d97706;background:rgba(217,119,6,.12)}
.rs-doc-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.rs-doc-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,inherit);font-weight:500}
.rs-doc:hover .rs-doc-title{color:var(--rs-accent)}
.rs-doc-meta{font:var(--dsw-font-caption,12px/1.5 -apple-system,system-ui,sans-serif);color:var(--dsw-alias-label-tertiary,#8b949e);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rs-doc-badge{flex:0 0 auto;margin-top:1px;padding:1px 7px;border-radius:999px;background:var(--rs-accent-tint);color:var(--rs-accent);font:var(--dsw-font-caption,11px/1.6 -apple-system,system-ui,sans-serif);font-weight:500}
.rs-tabstrip{display:flex;align-items:center;gap:4px;overflow-x:auto;margin:14px -4px 0;padding:0 4px;border-bottom:1px solid var(--dsw-alias-border-l1,#d8dee4);scrollbar-width:none}
.rs-tab{display:flex;align-items:center;gap:6px;max-width:220px;min-height:32px;padding:0 9px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-tertiary,#8b949e);font:inherit;cursor:pointer;white-space:nowrap}
.rs-tab:hover{color:var(--dsw-alias-label-primary,inherit)}
.rs-tab[data-active="true"]{border-bottom-color:var(--rs-accent);color:var(--rs-accent)}
.rs-tab-title{overflow:hidden;text-overflow:ellipsis}
.rs-tab-home{justify-content:center;width:34px;padding:0}
.rs-tab-close{display:grid;place-items:center;width:16px;height:16px;border:0;border-radius:4px;background:transparent;color:inherit;font-size:14px;line-height:1;cursor:pointer}
.rs-tab-close:hover{background:var(--dsw-alias-interactive-bg-hover,#f6f8fa)}
.rs-reader-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 4px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#d8dee4)}
.rs-reader-title{font-weight:600;color:var(--dsw-alias-label-primary,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rs-reader-meta{font:var(--dsw-font-caption,12px/1.5 -apple-system,system-ui,sans-serif);color:var(--dsw-alias-label-tertiary,#8b949e)}
.rs-reader-link{flex:0 0 auto;color:var(--rs-accent);text-decoration:none;font-size:12px}
.rs-reader-link:hover{text-decoration:underline}
.rs-reader{max-width:780px;margin:0 auto;padding:28px 12px 64px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary,inherit);font:var(--dsw-font-reader,15px/1.85 -apple-system,"Segoe UI",system-ui,sans-serif)}
.rs-html-frame{width:100%;min-height:620px;margin-top:14px;border:1px solid var(--dsw-alias-border-l1,#d8dee4);border-radius:8px;background:#fff}
.rs-reader-state{display:grid;gap:10px;place-items:center;min-height:320px;color:var(--dsw-alias-label-tertiary,#8b949e);font-size:12px;text-align:center}
.rs-reader-state[data-state="error"]{color:var(--dsw-alias-state-error-primary,#cf222e)}
.rs-reader-actions{display:flex;align-items:center;gap:10px}
.rs-embed-frame{display:block;width:100%;height:calc(100dvh - 176px);min-height:560px;margin-top:12px;border:0;border-radius:8px;background:var(--dsw-alias-bg-base,#fff)}
@container (max-width: 520px){
  .rs-session{padding:18px 16px 24px}
  .rs-doc{padding:10px 6px}
  .rs-doc-meta{white-space:normal}
  .rs-session-status{white-space:normal;text-align:right}
}
.rs-global{--rs-accent:#6366f1;--rs-accent-strong:#4f46e5;--rs-accent-tint:rgba(99,102,241,.1);height:100%;min-height:0;display:grid;grid-template-rows:auto auto minmax(0,1fr);color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-base,transparent);font:var(--dsw-font-body,13px/1.6 -apple-system,"Segoe UI",system-ui,sans-serif)}
.rs-global-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 20px;border-bottom:1px solid var(--dsw-alias-border-l1,#d8dee4)}
.rs-global-title{font:var(--dsw-font-title,600 15px/1.35 -apple-system,system-ui,sans-serif);letter-spacing:0}
.rs-global-sub{font:var(--dsw-font-caption,12px/1.5 -apple-system,system-ui,sans-serif);color:var(--dsw-alias-label-tertiary,#8b949e)}
.rs-toolbar{display:flex;align-items:center;gap:8px;padding:8px 20px;border-bottom:1px solid var(--dsw-alias-border-l1,#d8dee4);min-width:0}
.rs-input,.rs-select{height:30px;border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:6px;background:var(--dsw-alias-bg-base,transparent);color:inherit;padding:0 9px;font:inherit;min-width:0}
.rs-input{flex:1;max-width:320px}.rs-select{max-width:220px}
.rs-icon-btn{display:grid;place-items:center;width:30px;height:30px;border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:6px;background:transparent;color:inherit;cursor:pointer;padding:0}
.rs-icon-btn:hover,.rs-text-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#f6f8fa)}
.rs-text-btn{border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:6px;min-height:30px;padding:0 9px;background:transparent;color:inherit;font:inherit;cursor:pointer;white-space:nowrap}
.rs-global-body{display:grid;grid-template-columns:minmax(300px,390px) minmax(0,1fr);min-height:0}
.rs-global-list{min-height:0;overflow:auto;border-right:1px solid var(--dsw-alias-border-l1,#d8dee4);padding:6px}
.rs-global-row{display:grid;grid-template-columns:26px minmax(0,1fr) auto;gap:10px;width:100%;padding:10px 9px;border:0;border-radius:6px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}
.rs-global-row:hover{background:var(--dsw-alias-interactive-bg-hover,#f6f8fa)}
.rs-global-row[data-active="true"]{background:var(--rs-accent-tint)}
.rs-global-row-main{display:grid;gap:3px;min-width:0}
.rs-global-row-title{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rs-global-row-meta,.rs-global-row-session{font:var(--dsw-font-caption,11px/1.45 -apple-system,system-ui,sans-serif);color:var(--dsw-alias-label-tertiary,#8b949e);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rs-global-row-session{display:inline-flex;width:max-content;max-width:100%;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-module-platform,#f6f8fa)}
.rs-global-reader{min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden}
.rs-global-reader-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 20px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#d8dee4)}
.rs-global-reader-head-main{min-width:0}.rs-global-reader-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rs-global-reader-body{min-height:0;padding:0 20px 20px;overflow:auto}
.rs-global-empty{display:grid;place-items:center;align-content:center;gap:8px;min-height:260px;text-align:center;color:var(--dsw-alias-label-secondary,#57606a);padding:30px}
.rs-global-error{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 20px 0;padding:8px 10px;border:1px solid var(--dsw-alias-state-error-secondary,#cf222e);border-radius:6px;color:var(--dsw-alias-state-error-primary,#cf222e);font-size:12px}
@media (max-width: 900px){
  .rs-global-body{grid-template-columns:1fr}
  .rs-global-list{border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1,#d8dee4);max-height:42vh}
  .rs-global[data-view="reader"] .rs-global-list{display:none}
  .rs-global[data-view="list"] .rs-global-reader{display:none}
  .rs-toolbar{flex-wrap:wrap;padding:8px 14px}.rs-input{max-width:none;flex-basis:100%}
}
`
export { CSS }

export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}
