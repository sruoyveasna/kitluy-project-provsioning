# PROJECT_HOME — KitLuy Suite

**The first entry point for every human and AI agent working in this
repository. Read this before anything else.**

| Field                             | Value                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Project                           | KitLuy Suite — Cambodia-first Digital Store operating system                                              |
| Owner                             | HET / KitLuy Suite Project Owner                                                                          |
| Active phase                      | **Phase 1 — Laundry Stores and Shops** (Phases 2–8 registered, inactive)                                  |
| Repository                        | `/Users/vongvichetpa/Documents/HET-KITLUY-PROJECT` (this monorepo)                                        |
| Languages / currencies / timezone | Khmer + English · KHR + USD · Asia/Phnom_Penh                                                             |
| Cloud                             | Supabase (data/auth/RLS) + DigitalOcean (compute/Spaces), Singapore/SGP1                                  |
| Repository status                 | Bootstrapped 2026-07-26 (KL-BOOTSTRAP-001). Scaffolds + tested foundations; **no product is implemented** |

## What KitLuy is

> "KitLuy Suite is a Cambodia-first Digital Store operating system that lets a
> Partner create digitally, operate physical Locations through offline-capable
> edge systems, and sell through governed channels while KitLuy remains the
> authoritative customer, transaction, payment, inventory, finance, audit and
> reporting platform." — Rebuild Bible v4.0.0 §1.1

Operating model (locked): Partner Account → Digital Store (one primary
vertical) → optional physical Store Location → Store Hub + T1–T4 terminals.
The Digital Store is the control plane; the Store Hub is the local operational
authority; external channels never own KitLuy truth.

## Authority order (summary — full text in docs/authority/)

1. Current project-owner decisions and active KitLuy Project Instructions
2. Applied migrations, verified repository code, executable tests, production evidence
3. Current source-of-truth / Rebuild / Business Bibles (RB v4.0.0, BB v2.0.0)
4. Current approved product/API/data/security/offline/service specifications
5. Approved handoffs
6. Master Feature Registry and traceability artifacts
7. Evidence-based competitor analyses
8. Competitor clone/rebuild documents — design references ONLY
9. Superseded planning

No conflict may be silently reconciled — record it in
[docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md](docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md).

## Where canonical documents live

- **Imported source documents (read-only copies):** [docs/source/imported/](docs/source/imported/) —
  manifest in [docs/source/manifest.md](docs/source/manifest.md). Newest canonical per family is
  listed there; superseded versions are registered in
  [docs/authority/kitluy-superseded-document-register-v1.0.0.md](docs/authority/kitluy-superseded-document-register-v1.0.0.md).
- **Authority control pack:** [docs/authority/](docs/authority/) (source-of-truth index, precedence,
  decision register, open decisions/required values, implementation status,
  superseded register, glossary).
- **ADRs:** [docs/decisions/](docs/decisions/).

## Repository map

| Path              | Contents                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `apps/`           | 8 Phase 1 product shells (B2B website, Admin/Chain/Partner portals, Partner App, POS desktop/mobile, Storefront) |
| `future-clients/` | Registered-inactive Phase 2+ clients (KDS, guest display, kiosk)                                                 |
| `services/`       | 19 service boundaries: 4 governed APIs, shared services, `kitluy-hub-agent` (Store Hub)                          |
| `packages/`       | 40 shared packages (neutral Core — no vertical terminology)                                                      |
| `verticals/`      | `phase1-laundry` (ACTIVE, tested contracts) + phases 2–8 (registered, inactive)                                  |
| `supabase/`       | Local config, migration conventions (no DDL yet — schema pack missing)                                           |
| `infra/`          | Terraform skeletons, DO App Platform template, disabled Kubernetes, monitoring/policies                          |
| `docs/`           | Authority pack, architecture, per-family documentation indexes                                                   |
| `scripts/`        | bootstrap/verification/database/contract/testing scripts                                                         |
| `tests/`          | Cross-cutting harness locations (status documented per directory)                                                |
| `00_AI_HANDOFF/`  | Session handoffs — read the latest before working                                                                |

## How to run

```bash
corepack enable pnpm      # or: npm i -g pnpm@9.15.9
pnpm install
pnpm dev                  # turbo dev across apps (each app also runs standalone)
bash scripts/bootstrap/check-toolchain.sh   # see what's missing locally
```

Simulated Store Hub: `HUB_LAN_PORT=8787 KITLUY_ENV=local node services/kitluy-hub-agent/dist/main.js` (after `pnpm build`).

## How to test

```bash
pnpm verify        # full safe local suite (format, lint, typecheck, tests,
                   # contract tests, offline harness, build, OpenAPI checks,
                   # migration validation, secret scan, docs links)
pnpm test          # unit tests only
pnpm test:contract # governed API contract tests
pnpm test:offline  # Store Hub offline/reconnect harness
pnpm test:rls      # BLOCKED (Supabase CLI + RLS pack missing) — exits non-zero honestly
pnpm test:e2e      # BLOCKED (journey spec + browsers) — exits non-zero honestly
```

## How to create migrations

See [supabase/migrations/README.md](supabase/migrations/README.md). Naming
`<YYYYMMDDHHMMSS>_<snake_case>.sql`, additive by default, validated by
`pnpm migrations:validate`. **Never auto-apply production migrations**
(OWNER-LOCKED KL-INF-P1-037) — production application is a human, four-eyes
operation. The canonical schema pack does not exist yet; do not invent DDL.

## How to create a handoff

Copy the template in [00_AI_HANDOFF/000_INDEX.md](00_AI_HANDOFF/000_INDEX.md), name it
`YYYY-MM-DD__<AREA>__<TASK-ID>__<SLUG>__AI-HANDOFF.md` under the matching
subfolder, and add it to the index. Every significant session ends with one.

## How implementation status is proven

Statuses (`OWNER-LOCKED … REQUIRED VALUE`) and the evidence chain
(specification → code → migrations → tests → integration → deployment →
monitoring → pilot → production) are defined in
[docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md](docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md).
**Scaffolded code is not implemented functionality.** Never claim a status
without its evidence.

## Current blockers and required values

The full register is
[docs/authority/kitluy-open-decisions-and-required-values-v1.0.0.md](docs/authority/kitluy-open-decisions-and-required-values-v1.0.0.md).
Highest-impact blockers right now:

1. **Supabase schema / RLS / migration pack (RB v4 §13.3)** — blocks all real
   data behavior, RLS tests, seeds.
2. **`/edge/v1` route-shape conflict** between Hub spec §9.2 and POS spec
   §14.2 (KLREC-2026-07-26-001) — blocks Edge Operations business routes.
3. **Missing governance source files** (feature registry .md/.json,
   owner-decision-lock file, store-hub security lock spec) — cited by canonical
   docs but absent from this machine; imported CSV is the only registry form.
4. **Production values**: legal entity, domains, Supabase/DO project names,
   PKI/CA design, KHQR provider, notification providers, pricing (RB v4
   Appendix E; BB v2 Appendix A).
