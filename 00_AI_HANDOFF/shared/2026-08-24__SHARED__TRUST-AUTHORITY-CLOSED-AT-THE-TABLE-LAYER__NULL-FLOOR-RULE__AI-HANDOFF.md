# KitLuy Task Handoff — the trust tables stopped being writable by the application role, and a floor-less device stopped accepting anyone's word for the time

## 0. Identity

| Field | Value |
| ----- | ----- |
| Task ID | `KL-DEV-TRUST-0200-C` |
| Task title | Owner Decisions 1, 1A, 2, 2A, 2B — table-layer trust authority and NULL-floor initialization |
| Status | **`PENDING INDEPENDENT REVIEW`** — Steps 1–6 done, Step 7 gate not yet returned |
| Branch | `claude/fix-firstboot-esm-and-ssh-hostkeys` · Final commit `UNCOMMITTED` |
| Handoff date | 2026-08-24 · Asia/Phnom_Penh |
| Authority | Owner decisions 2026-08-24 (third package) — Decisions 1, 1A, 2, 2A, 2B; execution order 1–7 |

## 1. Step 1 — the inventory that had to come first

Nine relations, every one owned by `postgres`, every one writable by the
application connection role:

| relation | service_role, before | after |
| -------- | -------------------- | ----- |
| `kitluy_devices.device_trusted_time` | SELECT, INSERT, UPDATE | **SELECT** |
| `kitluy_devices.device_trusted_time_events` | SELECT, INSERT, UPDATE | **SELECT** |
| `kitluy_devices.trust_policy` | SELECT, INSERT, UPDATE | **SELECT** |
| `kitluy_devices.pki_trust_configuration` | SELECT, INSERT, UPDATE | **SELECT** |
| `kitluy_devices.time_correction_approvals` | SELECT, INSERT | **SELECT** |
| `kitluy_auth.approval_policies` | SELECT, INSERT, UPDATE | **SELECT** |
| `kitluy_auth.approval_requests` | SELECT, INSERT, UPDATE | **SELECT** |
| `kitluy_auth.approval_decisions` | SELECT, INSERT, UPDATE | **SELECT** |
| `kitluy_audit.sensitive_action_approvals` | SELECT, INSERT, UPDATE | **SELECT** |

No DELETE, TRUNCATE, REFERENCES or TRIGGER anywhere. `service_role` attributes:
`rolsuper=false`, **`rolbypassrls=true`**, **`rolinherit=true`**, memberships
including `kitluy_activation_service` and `kitluy_device_certificate_issuer`
(both inherited, so reached with no `SET ROLE`). No `kitluy_%governor` is
`SET ROLE`-reachable from it.

## 2. Step 2 — who would break: nobody

This is the question that decided whether a revoke was even permissible.

- **Zero non-test application writers** of any of the nine relations.
- **Zero application callers** of `emergency_time_correction_v1` or
  `evaluate_time_correction_approval_v1`.
- The only writers are test fixtures, and they take
  `set local role kitluy_credential_issuer` — not `service_role`.

So nothing had to be replaced with a governed door first. `SELECT` is retained
throughout: only the authority to MUTATE trust was withdrawn.

## 3. Steps 3–4 — revoked, and the emergency door with it

`emergency_time_correction_v1` and its evaluator are **not** SECURITY DEFINERs
(`prosecdef=false`, owner `postgres`), so they run as their caller and need the
table access just revoked. Leaving EXECUTE would have handed `service_role` a
door that could only fail halfway through with an opaque permission error, so
EXECUTE went too. **Emergency time correction is now a governor-only operation**
— an operator acting deliberately, which is what a four-eyes emergency path
should require — until a proper composition door exists for it. No application
capability was removed; the door had no caller.

The governed path is untouched and was proven still to work:
`establish_device_trusted_time_v1` is a SECURITY DEFINER owned by `postgres`,
which owns these tables, so it writes as the OWNER and never as its caller. An
apply-time guard now asserts that ownership relationship, because a revoke that
also broke the legitimate writer would be a fail-closed outage, not a fix.

## 4. Step 5 — the NULL-floor rule (Decision 2)

**Before:** `elsif v_floor is not null and v_best > v_floor + v_jump` — the
forward-jump branch was simply skipped when there was no floor, so a floor-less
device accepted **any** offered timestamp as its permanent monotonic floor.

**After:** a new branch ahead of it. When `v_floor is null` and the winning
source is not `cloud_authoritative`, the evaluation is refused as
`restricted_no_trusted_source` with an anomaly naming the rule, and the floor
stays absent.

`signed_cloud_token` is refused **deliberately**: this database does not verify
its signature — the caller asserts it — so it is not authoritative enough to fix
a device's clock permanently. When the boundary can verify it, that is a governed
change to one branch and nowhere else.

Everything else is unchanged: rollback detection for every source class, the
3600 s forward-jump rule for the three device sources, the monotonic floor, and
the absence of any reset path.

## 5. Step 6 — the attack matrix, all in rolled-back transactions

| Attack | Result |
| ------ | ------ |
| `UPDATE device_trusted_time` floor → 2036 | **permission denied** |
| `INSERT device_trusted_time` with future floor | **permission denied** |
| `UPDATE device_trusted_time` status → `trusted` | **permission denied** |
| `UPDATE trust_policy` jump → 10 years | **permission denied** |
| `UPDATE trust_policy is_active = false` (fleet-wide DoS) | **permission denied** |
| `INSERT` forged `production` trust policy | **permission denied** |
| `UPDATE device_trusted_time_events` (rewrite audit) | **permission denied** |
| `UPDATE pki_trust_configuration` | **permission denied** |
| `INSERT approval_policies` / `requests` / `decisions` | **permission denied** |
| `INSERT time_correction_approvals` | **permission denied** |
| `EXECUTE emergency_time_correction_v1` | **no EXECUTE** (catalog-asserted) |
| NULL floor + caller RTC | `restricted_no_trusted_source`, floor still NULL |
| NULL floor + authenticated_network | `restricted_no_trusted_source`, floor still NULL |
| NULL floor + signed_cloud_token | `restricted_no_trusted_source`, floor still NULL |
| NULL floor + rtc = `now()+3650d` (the R-1 primitive) | `restricted_no_trusted_source`, floor still NULL |
| NULL floor + `cloud_authoritative` | `trusted`, floor = the authority's own clock (age 0 s) |

The `EXECUTE` probe is asserted from the catalog rather than by calling it: on
this instance a permission-denied FUNCTION call SIGSEGVs the backend. That fault
is pre-existing (first occurrence **2026-08-07**) and reproduces on functions
this work never touched.

## 6. Decision 2B — the corrupted devices, classified from evidence

20 devices now carry a future floor, not 17: the count rose through this
session's own attack probes and the reviewers'.

| Count | Classification | State |
| ----: | -------------- | ----- |
| **19** | synthetic test fixtures (`TT-STALE-`, `REVIEW-B-`, `ADV-PROBE-`) | all `retired`, 0 assignments |
| **1** | virtual/dev identity — `WS11-T001-REPLACE-8489ee03…` | `awaiting_trust`, **1 assignment**, floor 2036-08-21 |
| **0** | **physical hardware identities** | — |

All 15 board-registered `KL-*` identities are unaffected (`enrolled`,
`quarantined`, `manufactured`, `restricted_investigation`).

**The one non-retired identity was NOT modified.** Changing the lifecycle of a
device that holds an assignment by direct `UPDATE` is precisely the ungoverned
write this group exists to eliminate. It needs an owner disposition.

**No reset backdoor was created and no floor was lowered.** A side effect of
Decision 2 is that these twenty are the last of their kind: no caller can produce
the state any more.

## 7. What this cost the test suite, stated plainly

The staleness suite built stale floors by offering `now() - 14 days` to a
floor-less device — the §12 first-boot rule. Decision 2 closed exactly that, so
**no caller can construct a past floor any more**, which is the point.

A test that needs one must therefore do something a caller cannot: `INSERT` the
row **as the table owner**. The monotonic trigger is `before delete or update`,
so an initial insert is not a floor regression, and nothing lowers an existing
floor. This is fixture construction, not a governed path, and the distinction is
the security property: the suite asserts that no CALLER — not `service_role`, not
the composition identity, not the device — can do it.

**That argument is exactly what the independent reviewer was asked to attack**,
because it is the kind of reasoning that can quietly hide a reachable path.

## 8. Verification — executed

| Check | Result |
| ----- | ------ |
| `trusted-time-staleness.integration` | **29 / 29** (10 new: Decision 1 + 2A) |
| firstboot agent, full | **342 pass / 0 fail** / 9 skip |
| registry service | **182 pass** / 19 pre-existing fail / 267 skip |
| `systemd-runtime.test.sh` | **115 / 0** |
| `build-gates.test.sh` | 32 / 0 |
| `secret:scan` | PASS (1,882 files) |
| `migrations:validate` | PASS (99) |
| typecheck (registry, firstboot, device-identity) | PASS |
| eslint | **0 errors** (5 pre-existing warnings) |
| 0200 re-applied | idempotent; all guards pass |

## 9. Image — rebuilt, verified against the BUILT rootfs

```text
kitluy-storehub-os-arm64.img.zst   652,925,521 bytes   2026-08-24T12:16
sha256  d80478811a0d0715139d04d1ccae56994b2263d4d43ee2f7c0cfd190719367df
classification: DEVELOPMENT / UNSIGNED / NOT RELEASE-ELIGIBLE / NOT BOOT-TESTED
```

Confirmed present in the built filesystem, not inferred from the recipe:
the FIXED console (`assertStdinIsFree` ×3, `decodeScanSsid` ×2),
`wpa_supplicant` + `wpa_cli` + `iw`, **no** `/etc/NetworkManager`,
`/etc/localtime → Asia/Phnom_Penh` with `/etc/timezone` agreeing,
`RouteMetric=100/600` and `RequiredForOnline=yes/no`, and a zero-secret
`wpa_supplicant-wlan0.conf` at mode `0600`.

**Not a release candidate** — per owner instruction it is diagnostic evidence
only, and the credential work is still ahead. The 2026-08-20 artifact is
preserved and re-verified `OK` against its recorded SHA-256.

## 10. Truth statement

- Production / staging / hosted development: **NO writes.** No deploy.
- Local PG17: 0200 re-applied; fixtures created and retired; every destructive
  probe rolled back.
- Committed / pushed: **NO.** `0189`: untouched, and still unapplied locally.
- Secrets: `secret:scan` PASS.
- Hardware evidence: **NONE.**
- **R-1 remains `OPEN / BLOCKED`.** It is not reclassified, and will not be until
  an independent review returns APPROVED.
- Decision 3 (persistent DEV CA) and Steps 8–14: **NOT STARTED**, correctly
  gated behind that review.

## 11. Open for the owner

1. Disposition of `WS11-T001-REPLACE-8489ee03…` — the one corrupted identity that
   is not a retired fixture and holds an assignment.
2. Emergency time correction is now governor-only. If the backend must ever
   perform one, it needs a governed composition door (definer owned by a
   governor, EXECUTE to `service_role`, approval evidence written only by that
   door) — designed, not improvised.
3. The `service_role` inheritance of both `kitluy_activation_service` and
   `kitluy_device_certificate_issuer` still makes 0199's separation-of-duty claim
   false as deployed, and it still holds 0123's raw
   `issue_device_certificate_v1` with a caller-chosen fingerprint. Recorded by
   the previous review; not addressed by this group.
