# WS-11-T005-P02 — Hub Health Reporter, Heartbeat API and Fleet Projection Delivery

| Field    | Value                                                                          |
| -------- | ------------------------------------------------------------------------------ |
| Date     | 2026-08-06 · Asia/Phnom_Penh                                                   |
| Base SHA | `bd608a6` (WS-11-T005 first package)                                           |
| Status   | **WS-11-T005 COMPLETE — IMPLEMENTED-IN-DEV**                                   |
| Push     | NOT PUSHED (origin push URL remains `disabled://push-requires-owner-approval`) |

## 1. The completed runtime path

Terminal → `POST /edge/v1/terminal-health/heartbeats` (P04B mTLS, the existing
`authorizePeer` gate: unknown terminal, revoked/expired/superseded credential
and non-current lifecycle all refused BEFORE this package's code runs) →
`acceptTerminalHeartbeat` (SERIALIZABLE, runtime role) → hub groups 0035/0036
relational authority → `runHealthDerivationCycle` (owner timing 45 s/90 s
against DATABASE now()) → `emitHealthReport` → durable outbox
(`device_fleet.health_projection_reported` v1, `kh1.{health_report_id}.1`,
`delivery_state='pending'` — NO cloud client anywhere in the path) → WS-10
transport (producer authentication = BLK-006, unchanged) →
`HealthReportIngestion` (device-registry service, `SET LOCAL ROLE
kitluy_edge_sync_service`) → the 0177 door, idempotent/stale-safe/
anomaly-flagged.

## 2. Owner-locked values recorded (cloud group 0178 + module constants)

Heartbeat 15 s; healthy ≤45 s; degraded ≤90 s; offline beyond; unknown =
never observed. Report cadence 30 s (`last_projection_sent_at`). Cloud
freshness 120 s (`projection_stale_after_seconds`, dev row updated by 0178;
classification/fail-closed logic unchanged from 0177). Session caps C1/C2/C3
= 60/30/15 min as policy COLUMNS with the door clamping per class; C4/C5
clamp to the C3 value pending their own ruling (recorded, open-decisions).
Expiry is written once — no door extends it; retry opens a NEW session.
Permissions: `device.containment.apply`/`.clear` ADDED (registry amendment
001, 107→109, rbac seed + tests updated); `device.fleet.read` and
`device.support_session.manage` reconciled onto existing keys, no duplicates.
Audit events: 6 registered/reconciled (audit amendment 001), including the
two RBAC-referenced names the registry lacked.

## 3. Migrations

- **Cloud `0178_fleet_policy_owner_values`** — per-class cap columns +
  owner-value update of the development policy row + the replaced
  `open_support_access_session_v1` re-pinned to governor ownership and 0177
  grants (guard-proven).
- **Hub `0036_terminal_heartbeat_and_reporter_state`** — additive columns on
  `terminal_health_status` (heartbeat cursor, report counter, last-reported
  state, cadence marker; forward-only by trigger), append-only
  `terminal_health_report` (row id IS the outbox identity; unique per-terminal
  report_sequence), §8 scope index, and the **0035 defect fix**: the
  containment-gate trigger runs as the inserting identity and the pairing
  governor held no SELECT on the directive log, so every governed pairing had
  failed 42501 since 0035 — found by the pairing suites this closeout ran,
  fixed by two SELECT grants, regressed green (18/19; see §6).

## 4. Sequence and truth discipline

Heartbeat sequence is monotonic-GREATER (equal → `DUPLICATE_IGNORED`, lower →
409 `HEARTBEAT_REPLAY_REJECTED`, gap tolerated — a recorded divergence from
`accept_terminal_command`'s strict +1, with the 0036 trigger as schema
backstop). Report sequence = the cloud `projection_version`, per-terminal,
forward-only. Hub receipt time is liveness authority; the terminal's
`observedAt` is diagnostic only (proven: future claim accepted, authority
time stays db-now). Local connectivity, containment, credential eligibility,
lifecycle and cloud freshness stay separate truths; a contained terminal
still reports; unknown ≠ offline; body cannot name scope (unknown fields →
422). Restart recovery: all reporter state is relational; re-derivation
cannot double-emit (last_reported_state guard) and cadence cannot
double-send (last_projection_sent_at guard) — proven by restart-shaped
re-runs.

## 5. Focused and closeout totals (all executed 2026-08-06)

Cloud canonical order: reset 0000→**0178** + seed + **db:test exit 0 (369
PASS incl. 55a–d with the new per-class clamps)** + test:rls green in the
same run. Hub: reset 0000→**0036** + seed + **hub:db:test 40 PASS** (tally
66). New suites: hub-agent `terminal-health.integration` **8/8**;
device-registry `health-report-ingestion.integration` **2/2** (PROJECTED /
DUPLICATE_IGNORED / STALE_IGNORED / REJECTED_SCOPE / REJECTED_SCHEMA /
REJECTED_IDENTITY). Regression: pairing-receipt ingestion 9/9,
pairing-replication 5/5, hub-database 28/28, rbac 15/15 (109 keys),
hub-open-items 14/14 (PASS-count contract 37→40). **Full hub-agent census:
343 passed / 2 failed / 2 skipped** — the two: the recorded WS-10-T006
sync-inbox flake, and **race A in hub-terminal-pairing (§6)**. Typecheck
clean (hub-agent, device-registry); eslint clean; prettier clean;
`secret:scan` 1368 files clean. `hub:db:validate`: 0036 passes all checks;
only the pre-existing 0028–0030 marker debt fails, unchanged and reported.

## 6. Recorded, NOT silently fixed

**Pairing race A result-code regression** (`hub-terminal-pairing` "identical
completions"): the race LOSER now maps to `INTERNAL_ERROR` instead of
`ALREADY_PAIRED`. Verified NOT caused by this package: it fails identically
with the 0035/0036 triggers dropped, and the winner's receipt, single paired
timestamp and outbox atomicity all hold — the defect is the loser's ERROR
MAPPING under a true simultaneous completion (the door's
`KLUY-EDGE-PAIRING-CONSUMED` family maps to `PAIR_SESSION_CONSUMED`, not
`ALREADY_PAIRED`; the TS `ALREADY_PAIRED` branch only catches a LATE loser).
Pairing is T004 surface — out of this package's §1 scope — so it is recorded
here and in the decision register for the pairing owner/T007, not patched
incidentally. No state corruption; the losing caller retries `GET .../receipt`
and receives the receipt.

## 7. Security and privilege result

Terminal: no database access — the route is the only surface, scope
underivable from the body, 4 KiB route bound inside the 64 KiB transport cap.
Hub: no direct cloud database access (outbox only). Cloud consumer enters
`kitluy_edge_sync_service` per transaction; `service_role` effectively
excluded from the 0177/0178 doors (guards re-proven on reset). Payload guard
refuses secret-shaped keys/values; the outbox payload census in the suite
finds no key, code, token or credential; logs carry identifiers only.

## 8. Rollback

Revert the P02 commit; `pnpm db:reset`+seed (0000→0177) and
`pnpm hub:db:reset`+seed (0000→0035) — noting that reverting 0036 alone
re-exposes the 0035 pairing-governor grant defect it fixes.

## 9. Remaining blockers

BLK-005 (pilot/production posture, unchanged); BLK-006 (the authenticated
Hub→cloud transport that would drive `HealthReportIngestion` in production,
same posture as the pairing-receipt consumer); BLK-007 (T007 plans);
open owner values: C4/C5 session caps, clock-skew bound, monitoring
thresholds for pilot/production (signed configuration only).
