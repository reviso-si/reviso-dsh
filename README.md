# reviso-dsh

Reviso for DeepSeek Harness (DSH) — the DSH surface of the Reviso family.

| repo | surface |
|---|---|
| `reviso` | product (backend + web) |
| `reviso-agent` | agent skill (any agent, platform-agnostic) |
| `reviso-cli` | CLI |
| **`reviso-dsh`** | DSH host integration (this repo) |

## Status: Phase 1 — visible client face (verified in a live browser)

Implemented, two views:
- Sidebar entry (`sidebar.footer.action`, beside Settings) + `shell.overlay` panel — ALL Reviso documents for the user.
- Session view tab (`conversation.view`, id `reviso-dsh.view`, beside chat | trajectory) — documents produced by THIS session (binding key `session_key = dsh:<sessionId>`, served once the reviso L0 contract lands).
Demo mode (labeled 演示) is the default; fill Server + Token in the panel's
连接设置 to hit a real deployment (auth: `Authorization: Bearer <automation
key or account-agent token>`; the deployment must allow this origin via
`REVISO_CORS_ALLOWLIST`).

Slot/build contract: see docs/client-face-contract.md.

## Host-owned publish tool (spike)

`index.js` registers `reviso_publish` on the DSH Host. The agent passes title
and content; the tool resolves three DSH credential refs, reads the calling
session id from `exec.agent.session.header.id`, and posts to Reviso with
`source_kind=dsh` plus `source_session_id`. The token never enters the browser
or an agent child process.

Installed DSH credentials are a flat mapping of POSIX refs to strings
(`$DSH_HOME/.credentials.yaml`):

```yaml
REVISO_DSH_TOKEN: rak_...
REVISO_DSH_WORKSPACE_ID: wsp_...
REVISO_DSH_SERVER: https://reviso.work
```

Contract test: `npm test`.


Minimal DSH bundle that loads under the harness. Roadmap:

1. **Phase 0 (here)** — bundle skeleton, load-verified locally.
2. **Phase 1** — Reviso HTTP client: publish/read with `source_kind` +
   `source_session_id` (normalized to `session_key`); requires the L0 contract
   in the `reviso` main repo (`document_sources` sidecar + read APIs).
3. **Phase 2** — Agent Inbox tab + per-session "back to session" openers
   (client-face spike against DSH's browser extension contract).

## Concepts (per DSH docs/user/develop/basic/publish.md)

- A **bundle** is an npm package shipping a config layer: `package.json`
  declares `dsh.bundle` → its `cordis.patch.yml` inserts plugin rows that
  reference the package **by name**.
- A **profile** is what a user boots (`dsh --profile <name>`); `dsh plugin`
  maintains it. Layer order: profile bundles → profile patch → home patch →
  `--patch` overlays.

## Install

```sh
dsh plugin --profile <name> add /path/to/reviso-dsh
dsh --profile <name> --dump-config   # expect a "# == dsh-reviso" layer
```

## Local dev

Scratch form uses an absolute source path (paths must be absolute):

```yaml
# dev.patch.yml
- insert:
    - id: reviso-dsh
      name: '/absolute/path/to/reviso-dsh/index.js'
```

```sh
pnpm dsh web --patch ./dev.patch.yml
```

## Contract

The cross-repo contract (Reviso HTTP API + `source_kind` enum
`dsh|claude|codex|cursor|mcp` + `session_key = kind:normalized_id`) is owned by
the `reviso` main repo (L0). This package never talks to Supabase directly.

Tested with dsh `0.1.0-rc.8`.

## See it locally

`sh
pnpm install && pnpm run build:client   # produce lib/client.js
dsh plugin --profile web add /Users/touchskyer/Code/reviso-projects/reviso-dsh
dsh web                                  # Reviso entry sits beside Settings in the sidebar
`

Rollback: `dsh plugin --profile web remove dsh-reviso`.

## License

MIT — same as `reviso-agent` / `reviso-cli`.
