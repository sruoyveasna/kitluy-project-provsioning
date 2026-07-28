# Cycle 8 / 8B — WS-09 Store Hub local runtime and persistence — AI Handoff

| Field           | Value                                                                |
| --------------- | -------------------------------------------------------------------- |
| Task IDs        | WS-09-T001 … WS-09-T007                                              |
| Date / timezone | 2026-07-27 · Asia/Phnom_Penh                                         |
| Repository root | /c/Dev/HET-KITLUY-PROJECT (Windows root `C:\Dev\HET-KITLUY-PROJECT`) |
| Base commit     | 3cda2c4                                                              |
| Status          | WS-09 **IMPLEMENTED-IN-DEV**; WS-10 unchanged **SCAFFOLDED**         |

## What was built

A Store Hub local database as a **genuinely separate database**
(`kitluy_hub_local`), its own checksum-registered migration toolchain, the full
command layer binding the canonical engines to that schema, journals
(idempotency, command result, outbox, sync, audit), safety modes, and the
recovery/offline/backup suites.

## Executed results

Hub: 15 migrations from zero, 54 `edge_*` base tables, **29** assertions, double
seed idempotent, backup/restore fingerprint-verified. Service: **147 tests
passed, 2 skipped** (destructive backup/restore is opt-in and was run separately,
2/2). Cloud unchanged: `db:test` 121, `test:rls` 95. Repo: `verify` 11/11,
`docs:verify` 8/8, lint clean, `git diff --check` clean.

Independent review `00_AI_HANDOFF/reviews/2026-07-27__WS-09-STOREHUB__REVIEW.md`
— **APPROVED-WITH-CONDITIONS**, 44 independent probes, all held, no blocking
trigger fired.

## Read this before touching WS-10

1. **WS-09 records local state only.** It writes `delivery_state = 'pending'` at
   runtime and reports `sync_state = 'pending_cloud_sync'`. Transmission, cloud
   acknowledgement and reconciliation are WS-10's. Fabricated acknowledgement is
   refused four ways, including against a superuser.
2. **The shipped fixtures deliberately contain** one `acknowledged` outbox row,
   one `retry_wait` row and a cursor with `last_acked_hub_sequence = 1`, so
   WS-10 has realistic prior state. Those are FIXTURES, not runtime writes — do
   not read them as evidence that WS-09 acknowledges anything.
3. **No `edge_finance` schema exists** and none may be created without an owner
   ruling on KLREQ-022. A Hub journal would be a second authoritative ledger,
   which KLD-FIN-002 forbids.
4. **Engine authority is a COMMAND-LAYER guarantee, not a database constraint**
   (KLRISK-HUB-003). A probe advanced bookings via raw SQL. Terminals hold no
   database credentials, but never describe this as impossible.

## Material limitation

Plant production stages (`washing`/`drying`/`pressing`/`qa_packaging`) have no
approved Edge route and no canonical RBAC key. A Booking created purely through
Hub commands **cannot reach READY**, so **no end-to-end T1→T4 lifecycle exists
through the Hub command surface alone**. Correctly fenced (inventing a key would
violate CLAUDE.md rules 7 and 9) but materially limiting. Registered KLREQ-028,
ruled together with KLREQ-024.

## Open owner decisions

KLREQ-020 idempotency key format · KLREQ-021 sync-state vocabularies ·
KLREQ-022 finance boundary (confirmed cloud-authoritative this cycle) ·
KLREQ-023 canonical-document amendments · **KLREQ-024 Booking status vs the
production chain** (seed unmodified, strict guard NOT relaxed) · KLREQ-025
Hub-local grant projection · KLREQ-026 Hub-issued event-key namespace ·
KLREQ-027 provider-callback path · **KLREQ-028 plant production stages**.
Carried forward: KLREQ-015 permission gaps, KLREQ-017 grammar ruling.

## Residual risks (authority register)

KLRISK-HUB-001 `GRANT ... TO current_user` server crash — **not fixed, only
avoided**; KLRISK-HUB-002 `security_event` mutable by the runtime role;
KLRISK-HUB-003 engine authority is command-layer only; KLRISK-HUB-004 two
refusals emit no security event; KLRISK-HUB-005 backup fingerprint is
row-counts only in the runner.

## Counting hazard

`pnpm hub:db:test` — count with `grep -c "NOTICE:  PASS"` (**29**). A naive
`grep -c PASS` returns 30 by also matching the runner's summary line.

## Next authorized work

WS-10 — synchronization and configuration publication. Not started.
