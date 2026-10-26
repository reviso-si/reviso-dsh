# Contributing

1. Open an issue describing the DSH host behavior being changed.
2. Keep host-neutral Reviso protocol changes separate from DSH adapter changes.
3. Run the complete local checks:

```sh
pnpm install --frozen-lockfile
pnpm run build:client
npm test
pnpm run check:packed
```

4. Include tests for security-sensitive changes: iframe origin/source checks,
   canonical URL validation, revoke lifecycle, OAuth refresh serialization, and
   stale response handling.
5. Do not broaden iframe sandbox permissions to make a UI control work. Route
   privileged actions through the DSH host instead.

By contributing, you agree that your contribution is licensed under the MIT
License.
