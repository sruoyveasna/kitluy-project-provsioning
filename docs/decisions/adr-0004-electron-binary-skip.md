# ADR-0004 — Electron binary download skipped repository-wide

Date: 2026-07-26 · Status: Accepted (engineering default)

## Decision

`pnpm.neverBuiltDependencies: ["electron"]` in the root package.json skips
electron's postinstall (≈100 MB platform binary) for every install. Types and
compilation are unaffected; `pnpm build` compiles the Electron main process.

## To run the POS shell with a real window

Remove the entry and `pnpm install` (or `pnpm rebuild electron`), then
`pnpm --filter @kitluy-apps/kitluy-pos-desktop-app exec electron .` after a
build. Production POS packages are signed Linux ARM64 artifacts distributed
through the Store Hub (POS spec Part 19) — never ad-hoc developer binaries.
