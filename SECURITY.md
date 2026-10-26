# Security

Please report vulnerabilities privately to the maintainers of
`reviso-si/reviso-dsh`. Do not open a public issue containing access tokens,
refresh tokens, embed codes, cookies, private document content, or customer data.

## Trust boundaries

- Reviso credentials are owned by the DSH host and must never enter the browser.
- The embed iframe is sandboxed with `allow-scripts` only. Do not add
  `allow-same-origin`, `allow-popups`, or `allow-popups-to-escape-sandbox`
  without a reviewed protocol and threat-model change.
- An opaque sandbox iframe emits `Origin: null`. Host message handlers must
  verify `event.source` against the current iframe and must derive navigation
  URLs from a canonical document URL, not from arbitrary iframe-provided text.
- Embed origins must be HTTPS and must match the configured allowlist or the
  authenticated API server origin.
- Embed codes and tokens are short-lived. Host surfaces must revoke abandoned,
  replaced, stale, and unmounted sessions.

## Sensitive data

Never commit:

- `rak_` access tokens
- `rar_` refresh tokens
- `rem_code_` embed codes
- OAuth authorization codes
- DSH credential files or cookies
- private document content or customer identifiers

## Supported versions

Security fixes are applied to the current `main` branch. Use a pinned commit or
release tag for reproducible deployments.
