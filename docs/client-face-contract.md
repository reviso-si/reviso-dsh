# DSH client-face contract

This document records the DSH slot and browser-module contract used by this
plugin. It is intentionally implementation-facing and should be reviewed when
upgrading the DSH host.

## 1. 组合模型：slot 系统（一个 API）

权威文档：`.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md`（"Status: implemented"）。

- 唯一 API：`ctx.slots.register({ name, children?, store?, inject? }, Component)`（client/AGENTS.md 规则 1；shell 只渲染 `'root'`）。
- `children` 同时是「声明 + 授权」：声明了才能渲染，渲染未声明的槽 → load 时 fail-loud。
- slot 名即组合路径：`<domain>.<entry>.<hole>`（例 `'tool.call.toolview'`）。
- 跨 entry 贡献用 `ctx.slots.inject(key, () => ctx.slots.register(...))`（声明者未挂载时也安全，重挂载自动重放）。
- 组件四份 props share（runtime/renderSlots/store/inject），组件内禁止碰 ctx；共享可变状态 → 声明 store，一个 handle 可在同一 apply 里传给多个 register。

## 2. 权威槽位目录（generated，勿手编）

`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`（由 `scripts/gen-client-catalog.ts` 生成，`pnpm run gen-client-catalog` 再生；`cordis_inspect what:"client"` 同源服务）。每个条目含 key/kind/scope/契约/registerOptions/occupants/replaceRisk/最小示例。

本插件用到的两个槽：

| key | kind/scope | 契约要点 | 证据 |
|---|---|---|---|
| `sidebar.footer.action` | list, root | "Optional actions beside Settings at the sidebar foot"，每个 action 收到列状态（wide row vs 56px rail） | catalog:1670；声明者 `ui-sidebar` 的 `'sidebar'` entry（`packages/client/ui-sidebar/src/client/index.ts:47-53`） |
| `conversation.view` | list, session | "one list entry per view tab (chat here; trajectory/waterfall from ui-trajectory)"，owner 以 `only: <active id>` 逐个渲染；标准 props 直接给 `sessionId`（会话级数据绑定的关键）；occupants=chat/trajectory，replaceRisk none | catalog:1095；声明者 client-ui-conversation（`ui-conversation/src/client/contract/slots.ts:113`） |
| `shell.overlay` | list, root | 全壳浮层，"click-through —— entries opt back into pointer events"；**"the additive seat for a frame-wide surface of your own: a fresh `id` is added beside the shipped entries"**；`replaceRisk: 'none'`，occupants 目前为空 | catalog:1551；声明者 client-ui-layout root entry（`ui-layout/src/client/index.ts:83`） |

⚠ `sidebar.settings`（catalog:1715）是 `single` 且 `replaceRisk: 'shadows-shipped-ui'` —— 不要去占。

## 3. 浏览器插件的包形状（参考实现 = `packages/client/ui-brand-official`）

- `package.json`：
  - `"dsh": { "client": { "inject": ["@deepseek-ai/dsh-client-runtime", ...], "platform": "web" } }` —— 声明这是浏览器模块；
  - `exports["./client"]` 指向构建产物（`<id>/client` 与裸 id 同一导出）；
  - peerDependencies：`@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/cordis`、`react` 等。
- `src/client/index.ts`：`export const inject = ['slots']`；`apply(ctx)` 内 `ctx.slots.inject(slot, () => ctx.slots.register({ name, ...options }, Component))`（generator 多槽一次注册，见其 index.ts）。
- 宿主接线：web-app bundle patch 里每个 UI 包一行 roster（`packages/bundle/web-app/cordis.patch.yml:182-212`）；我们仓的 cordis.patch.yml 已有等价行。

## 4. 加载链与浏览器模块解析（最后一个风险点，已解除）

`packages/client/modules/README.md`：

- Node 半区扫描启用 entries 里的 web `dsh.client` 包，解析 `exports["./client"]`，把构建产物 hash 进 boot graph（`window.__DSH_BOOT__`），**产物由宿主在 `/plugins` 路径下服务**。
- 浏览器解析顺序：graph row → 注册 classic-script factory → materialize；factory 拿到的 `require` 走同一顺序。
- **隐式基线 externals**：shell 预置的 React、Cordis、静态 UI 库 + parser 预载 runtime —— 直接 `require` 可得；超出基线用 `dsh.client.external` 声明。

## 5. 构建产物形状（已从已安装包验证）

The installed DSH client bundle uses this package shape:

```js
window.__ModuleLoader__.load({
  id: "<package-name>",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react_jsx_runtime = require("react/jsx-runtime");
    /* ... 打包体；bare import 全部走 require() ... */
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
```

官方共享 preset：`packages/client/tsdown.client.ts` 的 `clientBundle(id, libEntry, options)`（closure-factory 工件 + lightningcss CSS 管道）。**我们仓不 import 该 preset**The repository uses a small local tsdown configuration that mirrors the same artifact shape (CJS factory, banner/footer, and bare externals) without depending on a harness checkout.

## 6. 本插件的决定（B1）

- `sidebar.footer.action` 注册入口按钮（`id: 'reviso-dsh.action'`）；
- `shell.overlay` 注册面板（`id: 'reviso-dsh.panel'`，自管 pointer-events）；
- 两者共享一个声明 store（开/关面板）——同一 apply 内一个 handle 传两个 register；
- `apply()` fail-soft：slot 注册失败只记 console.warn，不抛；
- Data comes from the authenticated Reviso host bridge. Missing credentials or failed requests are shown as connection/error states; the plugin does not invent mock documents. The deployment must allow the DSH origin through its Reviso embed allowlist.

## 7. 风险与 upstream 候选

- DSH client runtime versions can differ from the installed host. The plugin keeps runtime shells as host-provided externals and should be revalidated when the DSH contract changes.
- The local build is intentionally small and package-local; a future DSH shared client bundle preset can replace it.
- Treat slot catalogs as generated host contracts. Recheck slot names and registration shapes when upgrading DSH.
