# ADR-0002 — Application framework choices for Phase 1 shells

Date: 2026-07-26 · Status: Accepted (engineering defaults)

## Decision

- Public SEO sites (`kitluy-b2b-website`, `kitluy-storefront`): **Next.js
  14.2 + React 18.3** (React 18 keeps one React version across the monorepo
  including React Native 0.76; Next 15/React 19 migration is a contained
  later upgrade).
- Internal portals + POS renderer: **React 18 + Vite 6 + TypeScript** PWA-ready shells.
- POS Desktop: **Electron 33 + Vite renderer**, Linux ARM64 target (spec-pinned).
- Mobile (`kitluy-partner-app`, `kitluy-pos-mobile-app`): **React Native
  0.76 shells, typecheck-only at bootstrap.** The approved target is React
  Native + Expo + Expo Router; generating full Expo apps (native projects, EAS
  channels) is deliberately deferred to the app milestone so Expo/EAS versions
  are pinned once, against real build needs. The shells pin boundaries,
  localization and fail-closed rules now.

## Consequences

`pnpm build` for RN apps equals typecheck (recorded in turbo warnings — no
output artifacts). The Expo generation task must reuse `src/` contracts.
