# Reviso for DeepSeek Harness

Reviso lets a coding agent publish its work for human review, then find the same
document again from the session that created it. This repository is the
DeepSeek Harness (DSH) integration.

## What it provides

- `reviso_publish` host tool: create or update a Reviso document from an agent
  session without exposing the Reviso access token to the browser.
- A Reviso sidebar entry and global document browser.
- A session-scoped Reviso panel with an embedded, read-only document view.
- A same-origin OAuth bridge. Tokens remain in DSH credentials; the browser
  receives only a short-lived embed URL.
- Host-mediated **Open in Reviso** and opaque-origin iframe handling.

The Reviso server, CLI, and cross-agent MCP integration live in their own
repositories. This package is only the DSH host adapter.

## Requirements

- DeepSeek Harness with plugin/profile support.
- A Reviso account or a compatible self-hosted Reviso server.
- Node.js 22 or newer for development.

## Install

Add the Reviso market index in **Plugins → Discover → Add index source**:

```text
https://raw.githubusercontent.com/reviso-si/reviso-dsh/main/market/index.json
```

Then install **Reviso** from Discover. Alternatively, install directly from
GitHub or a local checkout through the DSH plugin manager:

```sh
dsh plugin --profile web add github:reviso-si/reviso-dsh
# or, while developing locally:
dsh plugin --profile web add /absolute/path/to/reviso-dsh
```

Confirm that the profile composed the plugin:

```sh
dsh --profile web --dump-config | grep -A5 dsh-reviso
```

Then start DSH:

```sh
dsh web
```

Open **Reviso** from the sidebar and connect the account through the OAuth
button. The production embed origin can be pinned in the DSH profile:

```yaml
- id: reviso-dsh
  name: dsh-reviso
  config:
    embedOrigin: https://reviso-api.fly.dev
```

When `embedOrigin` is omitted, the adapter accepts only the authenticated
Reviso server origin. It does not trust an arbitrary origin discovered from API
JSON.

## Development

```sh
pnpm install --frozen-lockfile
pnpm run check
npm pack --dry-run
```

`pnpm run check` runs the unit/integration suite, rebuilds the client bundle,
inspects the packed tarball, and installs that tarball into a temporary prefix
to verify its ESM import. When a local `dsh` executable is unavailable, the
real Host ToolRuntime integration test reports `skip`; the public GitHub CI does
not claim to have executed a real Host smoke test in that environment.

The published npm tarball contains 12 files, including `index.js`, `host/`
(credentials, errors, generation, and OAuth modules), the rebuilt `lib/client.js`,
`cordis.patch.yml`, `README.md`, `SECURITY.md`, and `docs/client-face-contract.md`. Generated client code is validated by the
packed-tarball check.

## Security model

- The Reviso access and refresh tokens stay in DSH credentials.
- The browser never receives a `rak_` token.
- The embed iframe uses `sandbox="allow-scripts"` and intentionally runs as an
  opaque origin.
- Iframe messages are accepted only from the current iframe. Because the frame
  is intentionally sandboxed without `allow-same-origin`, its browser message
  origin is `null`; document identity and URL are still checked against the
  canonical host URL.
- External navigation is performed by the DSH parent after validation. The
  sandbox does not grant popup or same-origin privileges.
- Embed sessions are short-lived, document-scoped, one-time-code sessions and
  are revoked when their host surface is closed or replaced.

See [SECURITY.md](SECURITY.md) and [docs/client-face-contract.md](docs/client-face-contract.md).

## Real verification

A live publish check requires a connected Reviso credential and network access:

```sh
npm run verify:real
# optional:
npm run verify:real -- --credentials <path> --session-id <id> --title <title>
```

It uses the same tool runtime and credential provider as DSH, publishes one
document, and reads it back through the Reviso session query.

## License

MIT. See [LICENSE](LICENSE).
