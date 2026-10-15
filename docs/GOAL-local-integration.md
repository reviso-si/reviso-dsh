# Goal Prompt — reviso-dsh 本地集成（做完即可在本地 DSH 看到效果）

> 用法：把本文件全文（或下方正文）作为 goal objective 粘贴给 goal 命令。

---

## 目标（一句话）

让 `reviso-dsh` 插件在**本地 DSH Web 界面**里可见、可点、可验证：用户执行 `dsh web` 后，界面出现 Reviso 入口，点进去能看到文档列表（有真实凭证接真实 API，无凭证自动落入演示数据模式），全程有真实浏览器证据。

## 背景与现状（已核实，直接用，不要重新调研）

- 四仓格局：`/Users/touchskyer/Code/reviso-projects/` 下：
  - `reviso` — 产品主仓（后端 `apps/backend/reviso/` + 前端 `apps/web/`；生产 reviso.work）
  - `reviso-agent` — 通用 agent SKILL 仓
  - `reviso-cli` — Python CLI
  - `reviso-dsh` — **本目标的工作对象**（DSH 宿主集成），已推送 github.com/reviso-si/reviso-dsh
- `reviso-dsh` Phase 0 脚手架已完成（commit 973d973，npm 包名 `dsh-reviso`）：`package.json` 声明 `dsh.bundle` → `cordis.patch.yml` 按包名插入插件行；`index.js` 仅 host 侧 `apply()` 打印 `[reviso-dsh] bundle loaded`。**不要重建脚手架。**
- 已验证事实（勿重复验证）：本机 `dsh` CLI 0.1.0-rc.8；`dsh plugin --profile <p> add <repo路径>` 安装成功；`dsh --profile <p> --dump-config` 出现 `# == dsh-reviso` 层；裸 profile 启动日志第一行即 `[reviso-dsh] bundle loaded`。
- DSH 源码参考（**只读 + 构建，不 fork**）：`/Users/touchskyer/Code/references/deepseek-harness`（未装依赖）。插件教程：`docs/user/develop/basic/{index,tool,config,publish}.md`；框架：`docs/user/develop/framework/{index,service,events}.md`；还有 `docs/user/develop/practice/` 未探明。
- Node v26.10.0；harness 钉 pnpm@11.7.0（packageManager 字段）。
- **红线：127.0.0.1:3080 是用户正在使用的 DSH Web GUI —— 绝不许杀掉、占用或改其 profile 之外的东西。** 测试启动必须换端口（先查 `dsh web --help` 的端口 flag，不行再试 PORT 环境变量）。

## 阶段 A — client-face spike（timebox ≤ 2 小时）

搞清「第三方 bundle 能否向 DSH Web 界面注册 UI」。按序查：

1. `packages/bundle/web-app/cordis.patch.yml` 的注释：*“dsh.client rows are the browser roster the modules node half scans into `window.__DSH_BOOT__`”* —— 浏览器模块以行（id + name）注册；弄清 out-of-tree 包的 browser bundle 如何被解析进 roster。
2. `docs/user/develop/practice/`、`framework/`（service/event 注入）、`packages/client/`、`packages/sdk/client`、`packages/extensions/cordis-client-runner`。
3. 在 client/web 包源码里 grep：`tab | pane | navigation | surface | extension | slot` 的注册点（`apps/web/tests/navigation-panes.e2e.ts` 可作行为参照）。
4. 结论二选一：
   - **A1 存在公开扩展点** → 阶段 B1（真 tab / 面板）；
   - **A2 不存在或仅 in-box 可用** → 阶段 B2（可见降级：注册一个 tool + 一个 skill —— 两者在 DSH UI 都可见；工具返回 Reviso 深链），并把「需要宿主提供什么 API」写成 upstream PR 草稿存 `docs/upstream-request.md`。
5. 把 spike 结论（含 file:line 证据）写进 `docs/client-face-contract.md` —— 这是后续所有人的关键文档。

## 阶段 B — 实现可见面

- **B1（tab 路线）**：插件增加 browser bundle（按 `docs/development.md` 的 Client build phase：`DSH_BUILD_FACE` host/client 双产物；repo 补 tsdown/tsc 构建），patch 增加 browser roster 行；实现 Reviso 面板：文档列表（标题 / 更新时间 / 来源）、「在 reviso 打开」深链、空态（未配置 token → 演示模式开关，演示数据必须标注「演示」）。
- **B2（tool/skill 降级路线）**：按 `basic/tool.md` 注册 `reviso_inbox` 工具（列出文档 + 返回 browser_url）与一个 skill；以 tool 行 / 技能列表在 UI 可见为证。
- **数据层**：`REVISO_SERVER`（默认 `https://reviso.work`）+ 凭证（automation key 或 local token，从 env/配置读取；**不得硬编码、不得进 git**）。REST 认证方式先读 `reviso` 主仓 `docs/API.md` 与 `apps/web/src/api/client` 的请求头约定。fetch 失败 → 演示模式，不许白屏卡死。**绝不直连 Supabase。**

## 阶段 C — 本地集成 + 验证（全绿才算完）

1. 开发期：`dsh web --patch ./dev.patch.yml`，端口换非 3080（如 3099），后台启动；Playwright 打开页面截图：Reviso 入口可见、点开见列表/演示数据；结束后**只杀自己启动的进程**。
2. 正式集成：`dsh plugin --profile web add /Users/touchskyer/Code/reviso-projects/reviso-dsh`（这就是「集成进本地 dsh」的落点），alt-port 再验证一次；`--dump-config` 层证明留存。
3. 回归：用户原 GUI（3080）全程 200 存活；README 写明回滚命令 `dsh plugin --profile web remove dsh-reviso`。
4. 插件 `apply()` 必须 fail-soft（try/catch，任何异常不得拖垮宿主启动）。

## 约束（红线）

- 不 fork harness；需要宿主改动 → upstream PR 草稿进 repo，不强改源码。
- 凭证/密钥不进代码与 git；演示数据明确标注，不得伪装真实用户数据。
- patch row id 用 `reviso-dsh` 前缀，避免与 in-box 行冲突；patch 替换整行 config 时必须复述全部键（教程规则）。
- 工作区外路径（`/Users/touchskyer/Code/...`、`~/.dsh`）如被沙箱拦截，按当前会话授权流程处理。
- 每阶段完成即 commit + push（gh 已登录 iamtouchskyer，仓库 PUBLIC）。

## 汇报格式（结束前必须输出）

1. Spike 结论：A1 还是 A2 + file:line 证据
2. 实现面：B1 还是 B2 + 关键文件清单
3. 验证证据：命令清单 + 截图路径 + `--dump-config` 层行号 + 3080 存活证明
4. 用户下一步：怎么打开看效果（一条命令）、怎么卸载（一条命令）
5. 未尽事项与 upstream 候选清单
