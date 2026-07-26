# HET-KITLUY-PROJECT

KitLuy Suite — a Cambodia-first Digital Store operating system.
**Create digitally. Operate physically. Sell everywhere.**

> **Start here → [PROJECT_HOME.md](PROJECT_HOME.md)** (canonical entry point
> for humans and AI agents). AI agents must also read [CLAUDE.md](CLAUDE.md).

## Quick start

```bash
corepack enable pnpm   # pnpm 9.15.9 (pinned in package.json)
pnpm install
pnpm verify            # full safe local validation suite
```

## What is here (bootstrap state, 2026-07-26)

- **Phase 1 — Laundry** is the active vertical; phases 2–8 are registered and
  inactive. The owner-locked T1–T4 terminal model, T2 display state machine,
  custody events and pricing-line arithmetic are implemented and tested in
  `verticals/phase1-laundry`.
- 8 buildable Phase 1 application shells, 19 service boundaries (4 governed
  APIs + Store Hub agent with a tested offline/reconnect harness), 40 shared
  packages (12 with tested implementations).
- **No product is implemented.** Statuses and evidence live in
  [docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md](docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md).

## License

Proprietary — see [LICENSE](LICENSE).
