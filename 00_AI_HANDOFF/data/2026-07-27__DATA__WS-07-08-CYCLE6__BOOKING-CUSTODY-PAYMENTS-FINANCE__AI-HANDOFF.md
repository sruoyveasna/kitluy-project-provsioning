# Cycle 6 — WS-07/WS-08 database-backed Booking, custody, payments and finance — AI Handoff

| Field           | Value                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task IDs        | WS-07-T002/T003/T004, WS-08-T002/T003/T004/T005                                                                                                                  |
| Date / timezone | 2026-07-27 · Asia/Phnom_Penh                                                                                                                                     |
| Repository root | /c/dev/HET-KITLUY-PROJECT (moved out of OneDrive mid-cycle by the operator; execution before the move ran at /c/Users/zaqws/OneDrive/Desktop/HET-KITLUY-PROJECT) |
| Base commit     | b802bcb1d091c8d84e1012cb601cd576f4120937                                                                                                                         |

## Sources inspected

PROJECT_HOME.md; authority pack (source-of-truth index, precedence, decision +
open-decisions registers, implementation register); KBR-TXN/KBR-LND/KBR-PAY/
KBR-FIN business rules; DD v1.0.0 (kitluy_orders/kitluy_payments/
kitluy_laundry sections) + Amendment-001 (CONTRACT-APPROVED); enum registry;
RBAC 107-key registry; RLS spec patterns (0035/0070); WS-07-T001/WS-08-T001
task records + reviews + evidence; payment vectors JSON; migration plan +
`supabase/migrations/README.md` conventions; Cycle-5 execution review.

## Authority applied

KLD-2026-07-26-003 §6/§7 (evidence gate; WS-07/08 held at SCAFFOLDED until
DB-backed integration evidence — satisfied this cycle); KLD-2026-07-25-001
(pre-intake draft ≠ authoritative Booking); KLD-FIN-001/002; KLD-PAY-001;
KLV4-DEC-005 (T1–T4); KL-INF-P1-037 (OWNER-LOCKED, honored — local only);
KL-DEC-001 fence honored (no route shapes, public event names, public error
vocabulary or terminal renames finalized; outbox unimplemented).

## Files created / changed

- Migrations 0075/0080/0085/0090/0095 (30 new relations across kitluy_orders 5,
  kitluy_laundry 9, kitluy_payments 10, kitluy_finance 6 + guards + RLS train).
- `supabase/seed/dev-fixtures.sql` Cycle-6 block (idempotent, fictional).
- `supabase/tests/assertions.sql` (+10 sections, 26 PASS) and
  `supabase/tests/rls-tests.sql` (+38 named Cycle-6 cases, 95 PASS).
- New packages `packages/payments-persistence` and
  `verticals/phase1-laundry-persistence` (canonical-engine command services +
  DB-backed integration suites 12/12 and 11/11).
- `packages/kitluy-supabase-types` regenerated (9 schemas; deterministic;
  sha256 f49570e33d6545ee4a97e9901b3f126150a4943d812a78a61713f0def56f2c85).
- `scripts/database/db-exec.mjs` (Windows shell spawn fix + schema list),
  `scripts/database/db-validate.mjs` (DD amendments recognized),
  `pnpm-workspace.yaml` (+pg catalog pins).
- Task records WS-07-T002..T004 / WS-08-T002..T005; DD Amendment-002
  (decision-ready, NOT owner-approved); registers updated (KLREQ-012..014;
  reconciliation C11/C12/C13; BLK-002 stale cell corrected).
- Evidence packages under `docs/evidence/phase1/ws-07/` and `ws-08/`.

## Commands executed (actual results)

Full ledger in the evidence packages. Headlines: reset-from-zero 16
migrations PASS; double seed idempotent (2nd run zero row changes; finance
posting replayed=true); db:test 121 PASS notices exit 0; test:rls 95 PASS
exit 0; engine regressions 65/65 + 40/40 + 9/9 + 4/4 unchanged; DB-backed
integration 11/11 + 12/12; `pnpm db:types` twice byte-identical; TURBO_FORCE
`pnpm verify` 11/11 PASS; `pnpm docs:verify` 8/8 PASS; `git diff --check`
clean.

## Environment / OneDrive incident (CRITICAL for the operator)

1. Machine moved to Windows 11; Node 22.23.0 provisioned from nodejs.org
   (SHA-256 verified) at `C:\Users\zaqws\AppData\Local\kitluy-toolchain`
   (outside OneDrive) because the machine had only Node 24 (engine-strict).
2. The OneDrive-synced `node_modules` from macOS was broken (no Windows .cmd
   shims); fixed with `pnpm install --force`.
3. MID-SESSION DATA-LOSS EVENT: 239 tracked files under `docs/source/` were
   deleted from the working tree by an external actor (OneDrive sync — a
   shadow copy of the corpus appeared at `docs/services/source/` with a macOS
   .DS_Store, consistent with an accidental folder move propagated by sync).
   All 239 files were verified byte-identical (after line-ending
   normalization) to the git blobs and restored from HEAD; `pnpm docs:verify`
   8/8 PASS re-confirmed corpus hash integrity. The residue copy is archived
   in the session scratchpad, NOT deleted. RECOMMENDATION: exclude this
   repository from active OneDrive sync (or pause sync while working) and
   keep git as the sole source of truth.
4. Line endings: the repo has NO `.gitattributes`; the machine-global
   `core.autocrlf=true` corrupted restored files against the hash-governed
   corpus (157 mismatches). Repo-LOCAL `core.autocrlf=false` was set to make
   checkouts byte-stable — recorded for owner ratification; an owner-approved
   `.gitattributes` is the durable fix (open item).
5. `git status` intermittently reports phantom modifications on doc files
   (OneDrive touching mtimes); content diffs are empty.
6. RESOLUTION (operator action, 2026-07-27): the repository was MOVED out of
   OneDrive to `C:\dev\HET-KITLUY-PROJECT` before commit. Verified after the
   move: same base commit, working tree intact, `pnpm docs:verify` 8/8 PASS.
   Historical evidence paths (OneDrive and the earlier macOS path) are
   preserved unmodified in their records; the ACTIVE repository path is now
   `C:\dev\HET-KITLUY-PROJECT`. The empty OneDrive folder shell and the
   OneDrive cloud copy remain for the operator to delete once satisfied.

## Conflicts discovered (recorded, not silently resolved)

C11 (enum-registry `laundry_booking_status` vs canonical §4 vocabularies),
C12 (Cycle-6 DD omissions/differences → Amendment-003 required, KLREQ-013),
C13 (missing neutral transaction-read + finance-read RBAC keys → KLREQ-014).
See the decision register Cycle-6 section.

## Required values discovered / kept open

TXN-OD-001..003, LND-OD-001..003, PRC-OD-001/004/005, PAY-OD-001..004,
FIN-OD-001..005, CUS-OD-001..004, KLREQ-012 (Amendment-002 pending owner),
KLREQ-013/014 (new). No value guessed anywhere.

## Security findings

None introduced; secret scan PASS (892+ files). Local Supabase default keys
appear only in local stack output, never committed. KLSEC-mapped cases
executed are labeled inside `supabase/tests/rls-tests.sql` case names.

## Known limitations

- IMPLEMENTED-IN-DEV only: local stack, internal services/test adapters; NO
  Edge/Hub T1–T4 routes (BLK-003/KL-DEC-001), NO live KHQR (BLK-006), NO
  production application (KL-INF-P1-037).
- Generated types still exclude Cycle-5's kitluy_config/kitluy_storefront/
  kitluy_notifications (recorded gap).
- `tsconfig.tsbuildinfo` files are tracked and churn on build (out-of-scope
  finding; should be gitignored in a governed change).
- Refund over-ceiling is enforced by the canonical engine + command service
  (per engine design RV-003 lineage), not by a DB constraint — DB stores
  compensating evidence; probed in integration tests.

## Current implementation status (evidence register delta)

WS-07 and WS-08 → IMPLEMENTED-IN-DEV (2026-07-27) upon independent execution
review approval (00_AI_HANDOFF/reviews/2026-07-27__WS-07-08-EXECUTION__REVIEW.md).
WS-09/WS-10 remain SCAFFOLDED; T1–T4 interfaces SCAFFOLDED; Edge/Hub
mutations BLOCKED (BLK-003).

## Recommended next task

Resolve KL-DEC-001 (five-checkmark ballot — decision package ready), then
WS-09 Store Hub local persistence, WS-10 config publication/sync, WS-11
device provisioning, then T1..T4 authoritative integrations. Owner reviews
owed: DD Amendment-002 (KLREQ-012), Amendment-003 scope (KLREQ-013), RBAC key
additions (KLREQ-014), `.gitattributes`/OneDrive hosting decision.
