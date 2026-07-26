# Initial monorepo bootstrap — AI Handoff

| Field           | Value                                                           |
| --------------- | --------------------------------------------------------------- |
| Task ID         | KL-BOOTSTRAP-001                                                |
| Task title      | Build the canonical KitLuy monorepo (bootstrap Milestones 0–11) |
| Date / timezone | 2026-07-26 · Asia/Phnom_Penh                                    |
| Repository root | /Users/vongvichetpa/Documents/HET-KITLUY-PROJECT                |
| Agent           | Claude Code (Claude Fable 5)                                    |

## Sources inspected

Machine-wide inventory (Downloads, Documents, Desktop, Synology Drive, Google
Drive mounts) — full result in [docs/source/manifest.md](../../docs/source/manifest.md). Read in
depth: rebuild bible v4.0.0, business bible v2.0.0, storehub v1.0.0,
ecosystem-infrastructure v1.0.0, pos-desktop v4.0.0 (full); the seven other
Phase 1 specs (structural read). 31 documents imported to
`docs/source/imported/`.

## Authority applied

RB v4 §0.2 order (restated in
[docs/authority/kitluy-authority-and-precedence-v1.0.0.md](../../docs/authority/kitluy-authority-and-precedence-v1.0.0.md)).
Newest canonical versions used; competitor material treated as design
reference only; superseded docs registered, never used as truth.

## Existing files preserved

The target directory was **empty** at start (verified). Nothing was deleted or
overwritten anywhere; source originals in `~/Downloads` etc. were copied, not
moved. The prior repo `KITLUY-SUITE-REPO (MAIN)` (Synology) was deliberately
NOT imported (KLBOOT-DEC-007 — predates the canonical spec wave).

## Files created

~660 tracked files: root workspace/config/policy files; 40 packages (12 with
tested implementations); 19 services (4 governed APIs with OpenAPI + contract
tests; hub-agent with offline harness); 8 app shells; verticals (phase 1
active + 2–8 registered inactive); future-clients (3, inactive);
supabase/infra/tests scaffolds; scripts; 3 CI workflows + 1 disabled deploy
workflow; docs (authority pack, manifest, 5 ADRs, family indexes);
PROJECT_HOME.md, CLAUDE.md, this handoff.

## Commands executed (actual results)

- `pnpm install` — PASS (pnpm 9.15.9 installed to `~/.local/bin` because
  corepack could not symlink into /usr/local without sudo).
- `pnpm verify` — **PASS (all 11 gates)**: format check, lint, typecheck (80
  turbo tasks), unit tests (48 tasks), contract tests (16), offline harness
  (13), build (68 tasks incl. 2 Next.js production builds, 4 Vite builds,
  Electron main compile), OpenAPI validation (4 files), migration validation
  (0 files, conventions enforced), secret scan (661 files), docs link check
  (207 files).

## Tests

- **Passed:** all unit/contract/offline suites listed in the evidence
  register ([docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md](../../docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md)).
- **Failed:** none at completion. (One transient failure during the session —
  RN app tests importing react-native's Flow entry — fixed by extracting pure
  message modules.)
- **Not run / blocked (honest, non-zero runners):** integration, e2e, RLS,
  load, recovery, chaos, hardware; terraform fmt/validate (terraform not
  installed); container builds (docker not installed); CI workflows (no
  GitHub remote — never executed).

## Decisions made

KLBOOT-DEC-001..007 (see reconciliation register §B) with ADR-0001..0005 in
`docs/decisions/`.

## Conflicts discovered

KLREC-2026-07-26-001 (`/edge/v1` route shapes, Hub vs POS — HIGH; business
routes blocked), -002 (Hub local schema naming), -003 (BB v1 register
inconsistency), -004 (feature registry only exists as CSV). None silently
resolved.

## Required values discovered

Registered in [docs/authority/kitluy-open-decisions-and-required-values-v1.0.0.md](../../docs/authority/kitluy-open-decisions-and-required-values-v1.0.0.md)
(KLREQ-001..006 engineering blockers; owner-depth decisions; production
values; per-product registers; 25 commercial unknowns; 8 repository-level
values).

## Security findings

- No secrets found or committed (secret scan clean; gitignore hardened).
- Corepack cannot write /usr/local (harmless; user-prefix pnpm documented).
- Four missing cited security documents (notably the store-hub
  managed-device-security lock spec) — KLREQ-006.
- Dependency audit not yet policy-gated (advisory in security.yml) —
  [REQUIRED: triage policy].

## Known limitations

- RN apps are typecheck-only shells (Expo generation deferred — ADR-0002).
- Electron binary skipped (ADR-0004) — POS shell needs a reinstall to run windowed.
- Service Dockerfiles unbuilt (no docker locally).
- CI workflows unexecuted (no remote configured; none was authorized).
- Git identity: commits use a bootstrap identity; set the team identity and
  remote when [REQUIRED: GitHub org] is decided.

## Current implementation status

See the evidence register. Summary: foundations BUILT + TESTED (money,
localization, errors, rbac, approvals, audit, sync-protocol, phase gates,
config, observability, T1–T4/T2/custody/pricing contracts, hub outbox +
offline harness); everything else SCAFFOLDED or blocked on REQUIRED values.
Nothing is deployed; no product is implemented.

## Recommended next task

**KL-DATA-001 — author the Supabase schema/RLS/migration pack v1.0.0**
(KLREQ-001): it unblocks the most work (seeds, RLS tests, real service
behavior, Hub local schema via KLREQ-004). Requires owner sign-off on the
data dictionary and enum/state registry; the Laundry state machines
(KLREQ-003) and the `/edge/v1` reconciliation (KLREQ-002) should be decided in
the same review cycle. Independent parallel candidate: regenerate the master
feature registry .md/.json from the CSV after owner confirmation (KLREQ-005).
