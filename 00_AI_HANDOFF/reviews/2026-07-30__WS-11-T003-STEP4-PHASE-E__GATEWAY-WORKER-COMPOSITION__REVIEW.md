# Independent Review #2 — WS-11-T003 Step 4 Phase E, Gateway / Worker / Production Composition

**Date:** 2026-07-30 · Asia/Phnom_Penh
**Reviewed commit (HEAD):** `6eda48fb4e732795ff366eb98d04ff02a9864f13`
**Base:** `acfce30` through `6eda48f`
**Branch / worktree:** `main`
**Lens:** Gateway / worker / production composition — is `RevocationGateway` production-wired?
**Review role:** independent review agent (READ-ONLY on the task branch; no application/migration/test code changed).

> **Verdict is at the end. Do not infer production readiness from green package tests** — every composition claim below was produced by executing a census or a live probe, not by reading a handoff and forming an opinion. The promotion-gate attack succeeded: the gateway is library-available and uncalled.

---

## 0. Independence check

| Check                                              | Result |
| -------------------------------------------------- | ------ |
| Reviewer is not the primary writer                 | PASS — Phase A–D commits authored by `Soenghak Choeurn <131768927+Soenghak3301@users.noreply.github.com>`; this reviewer authored nothing in that range. |
| Reviewer did not modify the task branch            | PASS — the only file written by this review is this file under `00_AI_HANDOFF/reviews/`. |
| Reviewed commit matches the named SHA              | PASS — HEAD is `6eda48f`. |
| Status / evidence register not promoted            | PASS — no status advance. |

---

## 1. Method

Composition was attacked FIRST, on the reasoning that a correctly-built adapter that no production caller constructs is not a production control.

Probes ran in four layers:

1. **Import / dependency census** across `apps/`, `services/`, and every `package.json`.
2. **Source-shape probes** on `pg-revocation-gateway.ts` and `pg-revocation-lookup.ts` (comment-stripped SQL targets; fail-closed throws).
3. **Live PostgreSQL probes** against the local Supabase stack (`127.0.0.1:54322`) for 0154 USAGE / worker callability.
4. **Vitest re-run** of the two named integration suites.

`KL-INF-P1-037` honoured: no production connection of any kind.

---

## 2. Promotion-gate attack — **Is RevocationGateway production-wired?**

| Field                | Value |
| -------------------- | ----- |
| **Finding ID**       | RV-GW-001 |
| **Severity**         | HIGH (blocks any claim of production-wired revocation write composition) |
| **Attack performed** | Census: `createPgRevocationGateway` / `createPgRevocationGatewayFromPoolClient` / `pg-revocation-gateway` across the monorepo; `@kitluy/device-identity` in every `package.json`; imports under `apps/`, `services/` (including `kitluy-hub-agent`, `kitluy-device-registry-service`, `kitluy-api-gateway`). |
| **Actual result**    | **Library-available-but-uncalled.** Sole non-definition call sites are `packages/device-identity/test/pg-revocation-gateway.integration.test.ts`. Zero `apps/` / `services/` hits. Zero other package.json depends on `@kitluy/device-identity`. `credentialRevocationExecuteHandler` takes a `RevocationGateway` by DI, but nothing outside tests constructs `createPgRevocationGateway` into it. |
| **Expected (for "wired")** | At least one production runtime (issuance worker / device-registry / Hub path) imports and constructs the adapter under `kitluy_issuance_service`. |
| **Root cause**       | Phase C shipped the adapter and package export; Phase D recorded "no production caller"; composition never landed. |
| **Blocking**         | **YES** for any Step 4 promotion that claims production-wired `RevocationGateway` or end-to-end write-side composition. **NO** as a defect inside the library module itself — the adapter is sound. |
| **Remediation**      | Follow-on task: wire `createPgRevocationGateway` into the durable-job / issuance runtime that already holds EXECUTE on `revoke_device_credential_bound_v1`, with evidence that a non-test process constructs it. Until then, evidence must say **library-available-but-uncalled**. |

**Explicit answer:** **No. `RevocationGateway` is not production-wired.** It is exported from `@kitluy/device-identity` and proven only under Vitest.

---

## 3. Attacks executed — results

### 3.1 `pg-revocation-gateway.ts` — bound door only?

| Probe | Attack | Result |
| ----- | ------ | ------ |
| RV-G2 | Strip block/line comments; extract template-literal SQL; list `revoke_device_credential*` | **ONLY** `revoke_device_credential_bound_v1` |
| RV-G3 | After comment strip, search for `SET ROLE` | **Absent** — adapter does not elevate |
| RV-G1 (live) | `has_function_privilege` for `kitluy_issuance_service` / `kitluy_worker_service` on bound / legacy / governed doors | issuance EXECUTE on **bound only**; worker EXECUTE **false** on all three; legacy + governed issuance EXECUTE **false** |

**Gateway door selection: HOLDS.** No finding against the module. The finding is composition (RV-GW-001), not the SQL target.

---

### 3.2 `pg-revocation-lookup.ts` — RC-027 join; fail-closed?

| Probe | Attack | Result |
| ----- | ------ | ------ |
| RV-L3 | `loadRevocations` against an executor that throws `57P01` | **Throws** — does not return empty/"not revoked" |
| RV-L4 | `createLiveRevocationLookup(...).isCertificateRevoked` against same | **Throws** |
| RV-L1 (live) | Read `device_credentials_revoked_chk` | `CHECK (((state = 'revoked') = (revoked_at IS NOT NULL)))` — while CHECK holds, OR and AND are equivalent; OR remains defence-in-depth if CHECK is ever broken |
| RV-L5 | Census: `loadRevocations` / `createLiveRevocationLookup` outside package tests | **Tests only** — same composition gap as the gateway for the ONLINE join |

Half-written policy in source is `state = 'revoked' OR revoked_at IS NOT NULL` (fail toward revoked). Query errors propagate; callers that swallowed the throw as "not revoked" would fail open — the module itself does not.

**Lookup module: HOLDS** as an ONLINE library join. Production wiring of the lookup into a verifier path is **absent** (same class as RV-GW-001; recorded as condition C1, not a second HIGH ID).

---

### 3.3 Worker lapse path + migration 0154 USAGE

| Probe | Attack | Result |
| ----- | ------ | ------ |
| RV-W1 (live) | `has_schema_privilege(worker, kitluy_devices, usage)` + EXECUTE on `lapse_governed_emergency_post_approvals_v1` | **usage=true, exec=true**; migration `20260730180154` applied |
| RV-W2 (live) | `BEGIN; SET LOCAL ROLE kitluy_worker_service;` call sweeper; `ROLLBACK` | **Succeeded** — `outcome=LAPSED`, `lapsed_count=0` (empty env probe) |
| RV-W3 (live) | ACL explode for worker table privileges in `kitluy_devices` | **leaked=null** — USAGE did not grant table rights |
| RV-W4 | `rg lapse_governed_emergency_post_approvals` outside tests/migrations | **NONE** in production TypeScript |

**0154 reachability: HOLDS** (DB role can call the sweeper).

**Application worker composition: ABSENT.** `discoverLapsedEmergencyPostApprovals` is a pure escalation proposer; it never calls the SQL sweeper. No non-test TS invokes `lapse_governed_emergency_post_approvals_v1`. So the sweeper is **DB-reachable for the intended role, but not scheduled by a shipped worker process**.

| Field | Value |
| ----- | ----- |
| **Finding ID** | RV-GW-002 |
| **Severity** | MEDIUM |
| **Blocking for Step 4 promotion as "lapse worker live"?** | **YES** if evidence claims a production worker runs the sweeper. **NO** if evidence claims only "0154 made the grant usable" (which probes confirm). |
| **Remediation** | Wire a durable-job / sweeper caller under `kitluy_worker_service` that invokes the lapse RPC on schedule; keep table grants empty. |

---

### 3.4 Offline snapshot gap

| Probe | Attack | Result |
| ----- | ------ | ------ |
| RV-S1 | Files mentioning both `revokedCertificateSerials` and `loadRevocations` | **None that populate a signed snapshot** — `loadRevocations` exposes the list; `revocationLookupFrom` / snapshot tests still use caller-supplied / empty / fixture lists |
| RV-S2 | Hub agent / apps imports of snapshot + lookup | **Zero** |

**Confirmed:** nothing populates `revokedCertificateSerials` from `loadRevocations`. Offline Store Hub path remains caller-supplied. Matches Phase D recorded limitation / RC-027 "ONLINE only".

| Field | Value |
| ----- | ----- |
| **Finding ID** | RV-GW-003 |
| **Severity** | MEDIUM (offline containment gap) |
| **Blocking** | **YES** for claiming offline / Hub snapshot containment. **NO** for ONLINE library join claims that stay scoped to `loadRevocations` under connectivity. |

---

### 3.5 `DEVICE_REVOKING_LIFECYCLE_STATES` + KLREQ-034

- Constant is `["retired"]` only; omissions (`suspended`, `quarantined`, `restricted_investigation`, `replaced`) are deliberate and documented.
- Runtime guard `assertLifecycleStatesExist` refuses unknown enum labels (prevents silent no-match).
- KLREQ-034 remains **OPEN** in `kitluy-open-decisions-and-required-values-v1.0.0.md`.

| Field | Value |
| ----- | ----- |
| **Finding ID** | RV-GW-004 |
| **Severity** | NOTE / open owner decision |
| **Blocking** | **NO** for library merge. **YES** only if promotion claims device-level revocation covers quarantine/suspension. |

---

### 3.6 Grep: apps / services / hub vs tests

| Surface | `createPgRevocationGateway` / `loadRevocations` / `pg-revocation-*` / `@kitluy/device-identity` |
| ------- | --------------------------------------------------------------------------------------------- |
| `apps/**` | **0** |
| `services/kitluy-hub-agent/**` | **0** |
| `services/kitluy-device-registry-service/**` | **0** |
| `services/kitluy-api-gateway/**` | **0** |
| Other `package.json` depending on `@kitluy/device-identity` | **0** (only the package itself) |
| `packages/device-identity/test/**` | Present (gateway + containment + job fakes) |

---

### 3.7 Vitest (EXECUTED)

```text
PATH=/c/Users/Hello-Evo-PC/.kitluy-bin:$PATH:"/c/Program Files/nodejs"
npm_config_engine_strict=false
cd packages/device-identity && npx vitest run \
  test/pg-revocation-gateway.integration.test.ts \
  test/revocation-containment.integration.test.ts
```

**Result:** 2 files, **7 tests PASS** (gateway 2, containment 5). Duration ~2.2s. Local DB reachable. Toolchain note: Node v24.14.1 (not `.nvmrc` `>=22.12.0 <23`) — same deviation Phase D recorded; not re-run on baseline.

---

## 4. Stale comment (non-blocking)

`credential-revocation.ts` header still says *“no shipped code implements `RevocationGateway` at all — the only implementations are test fakes.”* That was true before Phase C; `createPgRevocationGateway` now ships as library code. Update on a docs/comment fix — does not change RV-GW-001.

---

## 5. Conditions (carry into Step 4 promotion gate)

| ID | Condition | Blocking? |
| -- | --------- | --------- |
| C1 | Do **not** claim `RevocationGateway` or `loadRevocations` is production-wired; say **library-available-but-uncalled** until a non-test caller exists (RV-GW-001). | **YES** for overstated promotion |
| C2 | Do **not** claim a production TypeScript worker runs the lapse sweeper; 0154 proves DB reachability only (RV-GW-002). | **YES** for "worker live" claims |
| C3 | Do **not** claim offline Hub snapshot containment; `revokedCertificateSerials` still caller-supplied (RV-GW-003). | **YES** for offline claims |
| C4 | KLREQ-034 remains OPEN; device-level set is `retired` only (RV-GW-004). | NO unless claim widens the set |
| C5 | Re-run named vitest suites on `.nvmrc` Node before any IMPLEMENTED-IN-DEV promotion that cites them. | NO for this composition verdict's library soundness |

---

## 6. What HOLDS (within stated scope)

- Bound-door-only gateway SQL (comment-stripped).
- Lookup fail-closed on executor errors; OR half-written policy + CHECK present.
- Migration 0154 USAGE + worker CALL capability (live).
- Package integration tests for gateway + containment (7/7 PASS).
- Primary writer correctly recorded the composition gaps; this review independently re-derived them.

---

## 7. Verdict

```text
APPROVED-WITH-CONDITIONS
```

**Blocking IDs for overstated promotion:** `RV-GW-001`, `RV-GW-002` (if worker-live claimed), `RV-GW-003` (if offline claimed).

**This verdict authorizes recording Phase E composition review as complete and nothing else.** It does **not** authorize promoting Step 4 to production-wired revocation composition, Hub offline containment, or a live lapse worker. Library adapters and 0154 reachability may be cited as **BUILT / proven in-dev (library + DB)**, with the explicit answer:

> **Is RevocationGateway production-wired? NO — library-available-but-uncalled.**

WS-11 overall stays not-promoted pending the parent's Step 4 gate and the other Phase E lenses.
