# WS-11-T003 Step 4 — snapshot signing and scope isolation (group 0156)

| Field     | Value |
| --------- | ----- |
| Task ID   | WS-11-T003 Step 4 — final offline completion §2/§3 |
| Date      | 2026-07-31 · Asia/Phnom_Penh |
| Start SHA | `d0a5d66` (44 ahead, clean) |
| End SHA   | `d79a279` + this note |
| Toolchain | Node **v22.23.0**, pnpm **9.15.9** (project-external; pin unchanged) |
| Status    | **PARTIAL — Step 4 NOT promoted.** §2 and §3 done; §4, §5, §6, §7, §8 NOT done |

## Applied: KLD-2026-07-31-HUB-SNAPSHOT-SIGNING-001

| Requirement | State |
| ----------- | ----- |
| Ed25519 detached signature | DONE |
| Canonical snapshot bytes | DONE — fixed field order, sorted+terminated lists, no clock read |
| Cloud-side signer | DONE |
| Private key via environment secret only | DONE — reference carries an env-var NAME, never material |
| No key in Git, database, docs, logs, Hub | DONE — proved by test, including the failure path |
| key_id and key version in each snapshot | DONE — and version is part of the trust match |
| Exactly one Tenant/Store/Location/environment | DONE — enforced in the DATABASE (group 0156) |
| No cross-Tenant or cross-Store data | DONE — null scope returns EMPTY, proved on apply |
| Unknown key / invalid signature / malformed / scope mismatch / rollback fail closed | DONE for signature+scope+key; sequence rollback is checked Hub-side, which is NOT built |
| No unsigned production fallback | DONE — default signer refuses |
| PostgreSQL does not verify Ed25519 | Stated in code; nothing asks it to |
| KLRISK-DEVICE-003 | REMAINS OPEN |
| Public keys provisioned to Hub | **NOT DONE** — no Hub trust registry exists |
| Failed replacement preserves last-known-good | **NOT DONE** — no Hub persistence exists |

## The finding that blocks end-to-end production

`hub_revocation_scope_v1` is owned by `kitluy_activation_governor`, following group
0152's `emergency_device_tenancy_v1` exactly. Called as `kitluy_issuance_service`
it fails:

```
permission denied for table device_assignments
```

**Group 0152's own function fails identically**, verified directly:

```
set role kitluy_issuance_service;
select kitluy_devices.emergency_device_tenancy_v1(<device>);
ERROR:  permission denied for table device_assignments
```

So the tenancy bridge the governed EMERGENCY path already depends on is unusable by
the role that calls it. This is the RC-028 class — group 0154 shipped a real EXECUTE
grant that was unusable for want of schema USAGE. The grant exists; the capability
does not.

It was NOT worked around. Widening `kitluy_activation_governor` to make one test
pass would paper over a defect that also affects emergency revocation. The affected
test is skipped with the reproduction written into it.

A second, smaller finding, fixed here: `revoked_devices_for_scope_v1` is owned by
`kitluy_credential_issuer` and delegates to a bridge owned by
`kitluy_activation_governor`. Inside a definer the caller is the OWNER, not the
session role, so granting EXECUTE only to `kitluy_issuance_service` left the
delegation refused.

## Assignment-state semantics

Scope follows `pending_trust` OR `active`, not `active` alone. Activation is
BLK-005-gated so **no device is `active`**; scoping to `active` only would mean no
Hub could ever receive a snapshot until the PKI ballot is implemented, making
offline containment wait on an unrelated decision. `superseded` and `revoked` are
history and are excluded.

## Verification (Node 22.23.0)

| Step | Result |
| ---- | ------ |
| device-registry-service vitest | **113 passed, 1 skipped (8 files)** |
| typecheck | exit 0 |
| eslint | 0 errors |
| secret:scan | clean, 1218 files |
| migrations:validate | 55 files |
| migration 0156 apply | both assertions fired: issuance-only reach; absent scope 0, null scope 0 against 67 revoked credentials |

## NOT done

§4 Hub trust registry, persistence, atomic apply, last-known-good, restart;
§5 offline verification wiring; §6 three concurrency cases; §7 production
lifecycle; §8 fresh independent re-review.

## FINAL STATUS

```text
WS-11-T003 Step 4 — NOT PROMOTED
```

## Recommended next

1. **Fix the 0152-class privilege defect first** — it blocks both this producer and
   the emergency tenancy path. Establish whether `kitluy_activation_governor` needs
   an RLS policy, a SELECT grant, or a different owner.
2. Hub trust registry + persistence + offline wiring (§4/§5).
3. §6 concurrency, §7 lifecycle, §8 re-review.
