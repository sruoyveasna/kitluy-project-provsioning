# WS-11-T005 — Device Fleet Health, Support Access and Incident Containment

| Field    | Value                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------- |
| Date     | 2026-08-06 · Asia/Phnom_Penh                                                                             |
| Base SHA | `d17ea9d` (owner ruling KLD-2026-08-06-WS11-REMAINING-TASKS-001, committed same day on top of `01e3c7a`) |
| Package  | WS-11-T005 per the ruled task register; canonical card `00_AI_HANDOFF/tasks/WS-11-T005.md`               |
| Status   | **WS-11-T005 PARTIAL — SUCCESSOR PACKAGE REQUIRED**                                                      |
| Push     | NOT PUSHED (origin push URL remains `disabled://push-requires-owner-approval`)                           |

## 1. Authority split (the load-bearing model)

- **The Store Hub is authoritative for CURRENT LAN-observed terminal health**
  (Hub spec §12.5). Hub group 0035 gives that authority a table
  (`edge_hardware.terminal_health_status`, runtime-maintained, no delete) and
  keeps `unknown` distinct from `offline_local` by CHECK.
- **The cloud stores a PROJECTION, never live Store truth.** Cloud group 0177:
  `device_health_reports` (append-only, every report ever received — accepted,
  stale or anomalous) and `device_health_projections` (one row per device).
  The ordering key is the HUB'S report sequence: `projection_version` only
  advances, enforced by the door AND by trigger, so a delayed report cannot
  overwrite a newer observation and a clock anomaly (observed-at beyond the
  governed skew) is recorded + flagged without ever becoming the newest
  authoritative observation.
- **Freshness is classified at read time and fails closed.**
  `classify_fleet_freshness_v1`: NULL receipt → `UNKNOWN_NO_OBSERVATION`;
  within the governed threshold → `CURRENT_CLOUD_PROJECTION`; otherwise —
  including when NO policy row exists for the environment —
  `STALE_CLOUD_PROJECTION`. Thresholds live in `fleet_health_policy`
  (CONFIGURABLE; development row seeded: heartbeat 60 s, stale 300 s, skew
  300 s, support cap 60 min; all `[REQUIRED: approved monitoring thresholds]`
  — owner: fleet security). Pilot/production policy rows are REFUSED unsigned
  (`KLUY-FLEET-POLICY-UNSIGNED`, the 0123 discipline; producer BLK-006).
- **Truth labels never collapse.** `fleet_health_read` (the data dictionary's
  read-model name) exposes lifecycle state, containment state, the Hub's
  reported LOCAL status and the CLOUD freshness as four separate columns.
  Offline ≠ stale ≠ revoked ≠ quarantined ≠ unknown ≠ cloud-unreachable —
  asserted, not assumed (section 55a).

## 2. Schema and migrations

- **Cloud `0177_fleet_health_support_and_containment`** (applied, reset from
  zero 0000→0177): 7 tables (`fleet_health_policy`, `device_health_reports`,
  `device_health_projections`, `device_containment_states`,
  `device_containment_events`, `support_access_sessions`,
  `support_access_events`), 11 governed doors, the `fleet_health_read` view,
  enum value `trust_incident_type.'manual_restriction'` (additive), roles
  `kitluy_fleet_governor` (NOLOGIN owner) / `kitluy_fleet_service` (NOLOGIN
  executor) / `kitluy_fleet_gateway` (NOLOGIN **NOINHERIT** hinge, 0173
  pattern). All tables ENABLE+FORCE RLS, deny-by-absence + governor policy;
  every runtime identity holds ZERO direct table privilege; the on-apply
  guard proves definer/ownership/search_path/grants/RLS and probes the
  unsigned-policy refusal live.
- **Hub `0035_terminal_health_and_containment`** (applied, reset from zero
  0000→0035, journalled sha `2ae34fe…`): `edge_hardware.terminal_health_status`
  (+§8 scope index), `edge_identity.containment_directive` (append-only,
  dedupe-unique on `(device_uuid, directive_sequence)`, effectiveness =
  HIGHEST sequence via `effective_containment` view) and TWO enforcement
  triggers gating `pairing_session` and `terminal_session` inserts —
  containment holds locally with the WAN down, and only an explicit received
  `cleared` directive with a higher sequence lifts it. `kitluy_support_ro`
  keeps redacted-views-only (§3) — the base-table grant the first draft gave
  it was caught by the existing role-privileges assertion and removed.
  Registered in `HUB_MIGRATION_ORDER` (hub-database test 28/28).

## 3. Composing, not duplicating, the lifecycle authority

Containment is a DECISION record (`device_containment_states` +
append-only events); enforcement rides the EXISTING 0120/0122 state machine:

- `apply_device_containment_v1` — `investigation_flagged` (decision only,
  lifecycle deliberately untouched), `operations_restricted` (→
  `restricted_investigation` with `restricted_from_state` preserved),
  `suspended` / `quarantined` (four-eyes mandatory, composing
  `quarantine_device_v1`). Wrong-Store, stale-generation and
  conflicting-replay commands refused; identical replay and duplicate
  containment idempotent (one business effect).
- `approve_incumbent_quarantine_v1` — the KLD-2026-07-28-002 §10
  **condition-4** door: VERIFIES requester ≠ approver before delegating to
  0122's `escalate_incumbent_containment_v1`.
- `clear_device_containment_v1` — recovery is four-eyes ALWAYS, disposition
  restricted to the SEVEN runbook classifications (+`operator_recovery`),
  restoration only along legal transitions (cleared quarantine lands in
  `enrolled` and re-earns trust through the normal chain), clears exactly the
  incident this containment opened, deletes nothing.
- `assert_device_not_contained_v1` — the fail-closed gate for future
  compositions. Deliberately NOT granted to the issuance/provisioning
  services yet: their capability censuses are exact (WS11-N18/N19 caught the
  first draft's speculative grant — the 0155 lesson), so the wiring lands
  with the composition that calls it.
- Legacy composition reach (0120 functions are plain and FORCE-RLS'd with
  zero policies): the fleet governor received exactly the named grants +
  policies it needs on `devices`, `device_trust_incidents`,
  `device_lifecycle_events`, `device_assignments`, `device_fleet_status` —
  minimal, recorded, guard-proven.

## 4. Support access (policy §3, enforced not displayed)

`open_support_access_session_v1`: authenticated operator ref + reason +
ticket ALWAYS; consent evidence for C2+; independent approver for C3+ with
self-approval refused structurally (CHECK + door); Tenant/Store scope
mandatory and device scope verified against the live assignment
(cross-Tenant fails with `KLUY-SUPPORT-SCOPE-MISMATCH`); duration CLAMPED to
the governed cap. Sessions carry **no token, key, password or database
credential — no secret-shaped column exists (asserted)**; a support session
is structurally distinct from device credentials and staff sessions.
`revoke_support_access_session_v1` is immediate and idempotent;
`assert_support_session_active_v1` fails closed on the CLOCK (an
expired-but-unswept session is already dead); `expire_support_access_sessions_v1`
is the worker's bookkeeping sweeper (0135 posture recorded: worker membership
is service_role-inherited, unlike the fleet/edge NOINHERIT hinges).

## 5. KLRISK-DEVICE-002 — RESOLVED-IN-DEV

Register staleness corrected (the "NOT implemented" control rows predated
0122). T005 added the missing implementation half (condition-4 door, general
containment/recovery, Hub offline enforcement) and the required runbook —
`docs/runbooks/kitluy-device-investigation-and-containment-runbook-v1.0.0.md`
— with the seven owner classifications (cloning, refurbished, board
replacement, NVMe replacement, data-entry error, malicious enrollment,
station compromise), the four escalation conditions, required inputs and
clearance semantics. **NOT closed:** the closure sentence demands
independent testing (T007/T008), and the signed disposition stays
`[REQUIRED: BLK-005 signing infrastructure]`.

## 6. Interfaces

The governed doors and `fleet_health_read` ARE the partner/admin service
contracts (store-scoped containment projection via
`read_fleet_containment_projection_v1` — scope as ARGUMENTS, NULL scope →
EMPTY set, the 0156 rule). Partner/Admin PWA screens remain fail-closed
shells (WS-16..19 are not started; frontend visibility would not be
authorization anyway — rule 7). No new application was created.

## 7. Focused test totals (fast gate §12 — actual results, 2026-08-06)

| Gate                       | Result                                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm migrations:validate` | PASS (76 files)                                                                                                                                                                                               |
| `pnpm db:validate`         | all static checks PASS (76 files)                                                                                                                                                                             |
| `pnpm hub:db:validate`     | 0035 passes all 7 checks; the ONLY failures are the pre-existing 0028–0030 marker debt (recorded at T004 closeout, unchanged)                                                                                 |
| Cloud canonical order      | `db:reset` 0000→**0177** from zero → `db:seed` → **`db:test` exit 0, 235 `NOTICE: PASS`** incl. NEW sections 55a (health/freshness), 55b (support access), 55c (containment/recovery), 55d (privilege census) |
| `pnpm test:rls`            | **exit 0, 133 PASS** incl. NEW `WS11-N21a` (catalog: NOLOGIN roles, NOINHERIT gateway, 7×FORCE RLS, zero client grants) and `WS11-N21b` (authenticated blocked on 5/5 probes)                                 |
| Hub canonical order        | `hub:db:reset` 0000→**0035** from zero → `hub:db:seed` → **`hub:db:test` 39 PASS** (37 baseline + `terminal-health-authority` + `containment-enforcement`; tally raised 63→65 exactly)                        |
| hub-agent                  | `hub-database.test.ts` **28/28** (0035 registered); `typecheck` clean                                                                                                                                         |
| Changed-file lint/format   | eslint 0 errors on `hub-database.ts`; prettier clean on every file this task wrote                                                                                                                            |
| Secret inspection          | `pnpm secret:scan` **1364 tracked files, clean**                                                                                                                                                              |
| Zero skips                 | every new probe executes; refusal counts are EXACT (8 support, 10 containment, 3 health, 5 hub containment)                                                                                                   |

Not run, per §12: full `pnpm verify`, full provisioning/device-identity
suites, application suites, T007 adversarial matrix, T008 review.

## 8. Security and privilege result

`service_role` holds NO effective EXECUTE on any fleet/support/containment
door (guard-proven at apply; census re-proven in 55d and WS11-N21a) and no
direct table privilege on any 0177 table; `authenticated`/`anon` hold
nothing; the two NOINHERIT hinges (`kitluy_fleet_gateway`,
`kitluy_edge_sync_gateway`) gate entry via `SET LOCAL ROLE` only. Hub-side:
runtime cannot delete health rows (grant layer + trigger, both probed);
sync worker cannot rewrite directives (both layers probed); support_ro keeps
redacted views only. Logs and payloads carry no key, code, token or
credential; `secret:scan` clean.

## 9. What T005 does NOT claim (and why PARTIAL)

1. **The Hub-agent health REPORTER is not built** — the heartbeat derivation
   loop over `device_heartbeat`, a terminal heartbeat surface on `/edge/v1`,
   and the outbox event kind that would carry the versioned projection to the
   (built, proven) cloud ingestion door. This is executable-code scope from
   the package's §6, not an owner-value blockage, so the honest status is
   PARTIAL (rule 5). It is the named successor package in the open-decisions
   register.
2. The containment-directive cloud PRODUCER is BLK-006-gated (same posture as
   the credential-projection producer, T004 precedent): the Hub consumer
   table + enforcement exist; the signed transport that feeds
   `received_via = 'signed_configuration'` does not.
3. No Partner/Admin PWA screens (WS-16..19 shells unchanged).
4. No RBAC registry change (missing quarantine/clearance keys = A4 owner
   change, T005-RC-01); no audit-registry reconciliation (T005-RC-02).
5. Pilot/production: BLOCKED BY BLK-005, unchanged; the 0177 guard re-proves
   the unsigned-policy refusal on every reset.

## 10. Remaining T006 dependencies

T006 (Hub replacement, recovery, signed release lifecycle) consumes:
`device_containment_states` (a replaced Hub's containment must carry over or
clear explicitly), the freshness/health projection (release eligibility
"under approved policy AND device health", trust policy §9), and the
BLK-006 producer posture. The replacement drills must respect the
containment gate (`assert_device_not_contained_v1` is the seam, ungranted
until used).

## 11. Rollback

Revert the T005 implementation commit and the ruling commit `d17ea9d` if the
register itself is withdrawn; then `pnpm db:reset` + seed (replays 0000→0176)
and `pnpm hub:db:reset` + seed (0000→0034), and restore
`HUB_MIGRATION_ORDER` (the revert does). No production surface is affected;
nothing was pushed.
