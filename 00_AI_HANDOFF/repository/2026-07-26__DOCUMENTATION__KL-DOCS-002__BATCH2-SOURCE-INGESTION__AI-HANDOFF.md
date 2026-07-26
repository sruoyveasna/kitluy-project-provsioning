# Batch-2 owner source ingestion — AI Handoff

| Field           | Value                                                             |
| --------------- | ----------------------------------------------------------------- |
| Task ID         | KL-DOCS-002                                                       |
| Task title      | Ingest and digest batch-2 owner corpus (transient-inbox workflow) |
| Date / timezone | 2026-07-26 · Asia/Phnom_Penh                                      |
| Repository root | /Users/vongvichetpa/Documents/HET-KITLUY-PROJECT                  |
| Agent           | Claude Code (Claude Fable 5)                                      |

## Physical files discovered

**58 source files** (~1 MB) in `docs/source/inbox/`, including a subdirectory
(`kitluy-ai-swarm-operating-system-v1.0.0/`, 17 files). Four packs:
engineering standards (14), QA/testing (12, incl. 524-case registry CSV and
26 payment test vectors), infrastructure/operations (15), AI Swarm Operating
System (17). Frozen batch inventory:
`docs/source/manifests/kitluy-inbox-inventory-v1.1.0.{csv,json,md}` —
0 exact duplicates, 0 filename mismatches; the swarm pack's 16 self-declared
SHA-256 hashes all verified.

## Classification

All 58 classified with stable IDs **KLSRC-0103..0160** (manifest merge mode;
corpus total 160). Taxonomy: `engineering/` and `qa/` added as documented
extensions (KLBOOT-DEC-010); ops pack → `infrastructure/`; swarm pack →
`owner-instructions/` with subpaths preserved. Tooling extended: recursive
inbox lister, batch-versioned inventory generator, merge-mode classifier that
refuses reused ingested names.

## Digest highlights

- **Toolchain conflict (high):** the engineering pack's `selected_versions`
  conflicts with **every** repo pin (Node 24 vs 22, pnpm 11 vs 9, TS 6 vs
  5.7, React 19 vs 18, RN 0.86 vs 0.76, Electron 43 vs 33, + tsconfig flags).
  Recorded KLREC-2026-07-26-014/-019; coordinated upgrade task KL-ENG-001
  proposed (KLREQ-009). Nothing upgraded during ingestion.
- **Monorepo blueprint conflicts with the actual tree** in four load-bearing
  ways (tooling/ vs scripts/, vertical placement, future-clients rule,
  package vocabulary) — KLREC-2026-07-26-016.
- **AI Swarm OS pack** would replace repo-root governance and the handoff
  system; structurally incompatible with the current one; its state files
  honestly self-declare UNVERIFIED. Adoption = owner decision
  (KLREC-2026-07-26-015, KLREQ-010). Classified, not installed.
- **QA pack:** G0–G5 gate model; 524 test cases all `SPECIFIED_NOT_EXECUTED`
  (P0 162 / P1 178 / P2 184); 26 payment vectors, all integer minor units,
  KHR rounding correctly deferred to owner policy, USD HALF_EVEN; offline
  pack extends (never contradicts) the tested hub-agent harness.
- **Conflicts found:** two co-dated "canonical" security test plans
  (KLREC-2026-07-26-017, KLREQ-011); 41 registry cases cite the missing
  `kitluy-testing-and-evidence-system-v1.0.0` (KLREC-2026-07-26-018,
  KLREQ-008).
- **Verified non-findings:** secrets inventory is references-only (zero
  values); domain plan is all `[REQUIRED]` placeholders; environment matrix
  exactly matches `KITLUY_ENVIRONMENTS`; CI/CD + DB runbook + swarm pack all
  reinforce KL-INF-P1-037. **No batch-2 document contradicts any owner-locked
  invariant.**

## Incident during ingestion (resolved)

`pnpm format` reformatted the 58 fresh classified copies before
`.prettierignore` covered the new taxonomy dirs, breaking hash identity. All
58 were restored byte-identically from the pristine originals in git
(commit `d81f74f`), the four dirs are now prettier-ignored, and
`docs:classify` re-verifies clean. No data lost.

## Registers updated

Reconciliation register (KLREC-2026-07-26-014..020 + KLBOOT-DEC-010),
open-decisions working file (KLREQ-008..011), coverage matrix (families
11–14), conflict report (batch-2 addendum), corpus summary, evidence register
(four packs SPECIFIED; zero execution evidence claimed), docs/source index.

## Inbox lifecycle

All 58 originals deleted after hash-verified classification per
KLOI-2026-07-26-001 (preserved in git at `d81f74f` + as classified copies).
Inbox is empty; `pnpm docs:inbox-state` passes.

## Commands executed (actual results)

- `pnpm docs:verify` — **PASS (all 8 gates)**, 160 sources verified.
- `pnpm verify` — **PASS (all 11 gates)**.

## Remaining decisions (owner)

KLREQ-008 (missing testing-and-evidence-system doc) · KLREQ-009 (toolchain
target + KL-ENG-001) · KLREQ-010 (swarm-OS adoption) · KLREQ-011 (security
test plan selection) — plus the batch-1 carryovers (Supabase schema/RLS/
migration-plan trio, `/edge/v1` reconciliation, documentation-program file).
