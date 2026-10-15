# reviso-dsh

Reviso for DeepSeek Harness (DSH) — the DSH surface of the Reviso family.

| repo | surface |
|---|---|
| `reviso` | product (backend + web) |
| `reviso-agent` | agent skill (any agent, platform-agnostic) |
| `reviso-cli` | CLI |
| **`reviso-dsh`** | DSH host integration (this repo) |

## Status: Phase 0 scaffold

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

## License

MIT — same as `reviso-agent` / `reviso-cli`.
