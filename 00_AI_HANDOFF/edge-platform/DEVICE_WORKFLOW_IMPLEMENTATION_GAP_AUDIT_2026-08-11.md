# Device workflow implementation gap audit — 2026-08-11

**Mission:** READ-ONLY implementation audit against KLSRC-0162 / SOT-028.
**Authority audited:** `docs/source/owner-decisions/kitluy-device-factory-enrollment-store-provisioning-and-pi-terminal-workflow-v1.0.0.md`
**Nothing was modified.** No code, schema, migration, test, configuration or
source-authority document was changed. No commit, no push, no deployment, no
database reset.

---

> ## CORRECTIONS — issued same day by the owner continuation mission
>
> Three facts in this report were verified directly afterwards and were wrong.
> Full record: `KLREC-2026-08-11-EDGE-004`.
>
> 1. **Cloud ledger is 88/88, not 87/88.** `0189` IS deployed. Verified by a
>    read-only `--dry-run` against `gjgbnkhuwlwhngbtrgts`. §0 below is stale.
> 2. **BLK-005 does NOT block development activation.** Migration `0122` §5
>    (`:875-905`) inserts an active development `pki_trust_configuration` row
>    under KLD-2026-07-28-002. §7 and §13 below overstate this: BLK-005 blocks
>    **pilot and production** activation and release signing, not development.
> 3. **The real development activation gate is trusted time.** Executing
>    `attempt_activate_device_v1` returns `KLUY-DEVICE-TIME-RESTRICTED`
>    (`restricted_forward_jump`) — and that is **stale local test-database
>    state**, not a product defect: the restriction only applies when a floor
>    already exists (`0123:395`), so a genuinely fresh device establishes trust
>    on its first authenticated source.
>
> Net effect on the numbers: the three percentages stand (they were computed
> from implementation evidence, which has not changed), but the **critical path
> in §11 is wrong at step 2** — development device trust is largely built, not
> pending. Pilot readiness in §13 is unchanged, because DEC-2 and the missing
> human-facing surfaces still gate it.

## 0. Repository baseline (recorded, not altered)

| Field                    | Value                                                                       |
| ------------------------ | --------------------------------------------------------------------------- |
| Branch                   | `claude/fix-firstboot-esm-and-ssh-hostkeys`                                 |
| HEAD                     | `209afc2d8dcc9391e57b11e9aa7d5f53bf56fd2a`                                  |
| HEAD subject             | `fix(os-image): first boot dies before it starts — ESM marker, host keys, a way in` (2026-08-11) |
| Tracked modified         | 50                                                                          |
| Untracked                | 53                                                                          |
| Staged                   | 0                                                                           |
| Migration files (local)  | **88** — `0000_extensions_and_migration_controls` … `0189_factory_qa_definer_ownership_repair` |
| Migrations on cloud      | **87** — `0189` is authored and locally green, **NOT deployed** (`32_DEC4_SELF_ESCALATION_PROBE_AND_0189.md` §4) |
| Canonical cloud project  | `kitluy-project-pos` / `gjgbnkhuwlwhngbtrgts` / PG 17.6 (KLD-2026-08-10-CLOUD-TARGET-001) |
| Built image artifact     | `infra/kitluy-os-image/build/previous-images/image-kitluy-pos-terminal-wayland-arm64-0.1.0/kitluy-pos-terminal-wayland-arm64.img` (terminal only; no Store Hub image artifact found) |
| Test files (repo-wide)   | 180 `*.test.ts`                                                             |

---

## 1. Executive score

```text
DEVICE WORKFLOW AUDIT

Implementation Completion .... 77%
Verified Readiness ........... 68%
Workflow Conformance ......... 92%

Atomic Requirements ........... 56
VERIFIED_E2E ..................  2
IMPLEMENTED_AND_TESTED ........ 36
IMPLEMENTED_NOT_FULLY_TESTED ..  3
PARTIAL .......................  6
SCAFFOLDED ....................  1
ABSENT ........................  5
BLOCKED .......................  3
Conflicts .....................  0
```

Reproduction: Implementation Completion = 4315 earned points / 56 requirements
= 77.05%. Verified Readiness = 38 (VERIFIED_E2E + IMPLEMENTED_AND_TESTED) / 56
= 67.9%. Workflow Conformance = 46.0 conformance score / 50 implemented
requirements = 92.0%. ABSENT requirements are excluded from conformance.

**The three numbers disagree on purpose, and the disagreement is the finding.**
Conformance is high because what has been built follows the owner workflow
closely. Completion is materially lower because whole surfaces are missing.
And neither number reflects pilot readiness, which is near zero — see §13.

---

## 2. Stage scorecard

| Stage                           | Completion | Verified | Conformance | Main status                                                              |
| ------------------------------- | ---------: | -------: | ----------: | ------------------------------------------------------------------------ |
| A. Golden OS / Firstboot        |        77% |      57% |         93% | Strong. Identity + baked bootstrap real; no hardware boot proof           |
| B. Factory Enrollment           |        68% |      50% |         83% | **Split**: cloud schema complete, device→cloud path absent               |
| C. Admin Fleet                  |        86% |      86% |        100% | **Strongest stage.** Only image/agent version missing                     |
| D. Partner Provisioning         |        68% |      67% |         90% | Cloud complete, **Partner surface absent**                               |
| E. Store Hub Pairing            |        78% |      63% |         93% | DB chain proven; **no Hub CLI**; LAN API read-only                       |
| F. Pi Terminal Pairing          |        87% |      78% |        100% | **Highest completion.** Cloud excellent; **no Pi pairing GUI**           |
| G. POS Vertical/Profile Runtime |        72% |      80% |         90% | Resolver real and tested; T1–T4 workflows are selection only             |
| H. Hub-Mediated Operation       |        75% |      67% |         83% | Transport/sync real; **Hub owns no business mutations yet**              |

---

## 3. Atomic requirement audit

Scoring dimensions per requirement: executable/schema 40, automated test 25,
integration 20, deployment/hardware 15. Non-applicable dimensions are removed
from the denominator rather than awarded free points.

### Stage A — Golden OS / Firstboot

| ID | Requirement | Evidence | Status | Match | % |
| --- | --- | --- | --- | --- | ---: |
| DEVWF-A01 | Pi Terminal golden image builds | `infra/kitluy-os-image/rpi-image-gen/config/kitluy-pi-terminal.yaml`, `layer/kitluy-pi-terminal.yaml`, `scripts/build-rpi-image.sh`; tests `test/rpi-image-gen.test.sh`, `test/build-gates.test.sh`; artifact `build/previous-images/image-kitluy-pos-terminal-wayland-arm64-0.1.0/*.img`. No physical Pi boot (`22_ARM64…md` §13) | IMPLEMENTED_AND_TESTED | MATCH | 85 |
| DEVWF-A02 | Store Hub golden image builds | `config/kitluy-store-hub.yaml`, `layer/kitluy-store-hub.yaml`, `scripts/profiles/store-hub.sh`; no Store Hub image artifact found on disk | IMPLEMENTED_NOT_FULLY_TESTED | MATCH | 65 |
| DEVWF-A03 | Fresh device generates unique identity at first boot (§5, §34) | `src/identity.ts` `bootstrapIdentity`; `src/bin/firstboot-identity.ts`; `adapters/device-identity-store.ts`, `device-key-provider.ts`; test `firstboot-executable.test.ts` incl. *"two devices flashed from one image do not share an identity"* | IMPLEMENTED_AND_TESTED | MATCH | 85 |
| DEVWF-A04 | Identity persists across reboot; bootstrap is idempotent (§37 M1) | `bin/firstboot-identity.ts` created/reused/recreated contract; `kitluy-firstboot.service` `Type=oneshot RemainAfterExit=yes`; tests *"is idempotent — a second and third run reuse the same identity"* | IMPLEMENTED_AND_TESTED | MATCH | 85 |
| DEVWF-A05 | Golden image contains no baked identity/secret (§34) | `scripts/scan-image-secrets.sh`; identity is device-generated. **BUT `22_ARM64…md` §13 records a `snakeoil` private key present in both images** | PARTIAL | PARTIAL_MATCH | 75 |
| DEVWF-A06 | Bootstrap runtime present at first boot | Baked overlay `usr/lib/kitluy/{firstboot-identity,enrollment-agent,health-reporter,update-agent}` + `lib/firstboot-agent/**/*.js`; 4 systemd units; `test/systemd-runtime.test.sh` | IMPLEMENTED_AND_TESTED | MATCH | 85 |
| DEVWF-A07 | Unassigned-terminal bootstrap surface renders true device state (§19, §36) | `src/bin/bootstrap-ui.ts` — renders identity/network/enrolment/store/device/image version, absent values as "Unknown". **No test covers this binary** | IMPLEMENTED_NOT_FULLY_TESTED | MATCH | 60 |

### Stage B — Factory Enrollment

| ID | Requirement | Evidence | Status | Match | % |
| --- | --- | --- | --- | --- | ---: |
| DEVWF-B01 | Canonical device fleet record exists | `0120_device_enrollment_and_identity.sql`; `kitluy_devices.devices`; tests `factory-enrollment.db.test.ts`; deployed (87/87) | IMPLEMENTED_AND_TESTED | MATCH | 100 |
| DEVWF-B02 | `device_class` distinguishes Hub from terminal (§3) | `0120:85` enum `store_hub, terminal, manufacturing_station, peripheral` — **identical to the document's vocabulary** | IMPLEMENTED_AND_TESTED | MATCH | 100 |
| DEVWF-B03 | Governed enrollment function exists | `kitluy_devices.enroll_device_v1` (`0122_device_trust_decision_alignment.sql:752`); `factory-gateway.ts` `enrollDeviceAtFactory`; tests `factory-enrollment.db.test.ts`, `factory-gateway.test.ts` | IMPLEMENTED_AND_TESTED | MATCH | 100 |
| DEVWF-B04 | Device-side enrollment state machine | `src/enrollment.ts` `runEnrollmentStep` (+ `AssignmentPollResult`, `HeartbeatResult`); `bin/enrollment-bootstrap.ts`; test `enrollment.test.ts`. **`EnrollmentClient` port is deliberately uninjected — no transport** | PARTIAL | PARTIAL_MATCH | 65 |
| DEVWF-B05 | Cloud fresh-device enrollment endpoint (§4, §5, §6) | **NONE.** `bin/enrollment-bootstrap.ts` header states verbatim: *"The cloud factory-enrollment endpoint DOES NOT EXIST YET. There is no `/v1/device-enrollment` route"* | ABSENT | NOT_IMPLEMENTED | 0 |
| DEVWF-B06 | Fresh-device authentication mechanism (DEC-2) | **NONE.** `enroll_device_v1` requires `p_enrollment_station_id` + `p_enrollment_operator_ref`; a field Pi has neither. Owner decision required | BLOCKED | NOT_IMPLEMENTED | 0 |
| DEVWF-B07 | `ENROLLED + UNASSIGNED` is representable (§30) | `device_lifecycle_state` `enrolled` + absent `device_assignments` row; Admin renders `assignmentState: null`. **No new enum needed, exactly as §30 permits** | IMPLEMENTED_AND_TESTED | MATCH | 100 |
| DEVWF-B08 | Heartbeat / liveness (§5, §38) | `bin/health-reporter.ts`; `device-registry-service/src/health-report-ingestion.ts`, `online-verifier.ts`; tests `health-report-ingestion.integration.test.ts`, `terminal-health.integration.test.ts`. Device→cloud leg inherits B05/B06; `health-reporter` binary untested | IMPLEMENTED_NOT_FULLY_TESTED | PARTIAL_MATCH | 80 |

### Stage C — Admin Fleet Visibility

| ID | Requirement | Evidence | Status | Match | % |
| --- | --- | --- | --- | --- | ---: |
| DEVWF-C01 | Management API exposes fleet reads (§7) | `services/kitluy-management-api/src/http.ts:158` `/me`, `:172` `/devices`, `:200` `/devices/:id`; `listFleet`. Proven against the REAL dev cloud project 2026-08-10 (401/403/200/404, 3 devices) | VERIFIED_E2E | MATCH | 100 |
| DEVWF-C02 | Admin Portal renders the fleet | `apps/kitluy-admin-pwa-portal/src/{views.tsx,device-presentation.ts,management-client.ts,access.ts,sign-in.ts}`; tests `views.test.tsx`, `portal-logic.test.ts`, `smoke.test.tsx` | VERIFIED_E2E | MATCH | 100 |
| DEVWF-C03 | Admin shows device class | `management-client.ts:31` `deviceClass` | IMPLEMENTED_AND_TESTED | MATCH | 100 |
| DEVWF-C04 | Admin shows assignment state, incl. unassigned (§7) | `management-client.ts:36` `assignmentState: string \| null`; `:37-39` tenant/store/location references nullable | IMPLEMENTED_AND_TESTED | MATCH | 100 |
| DEVWF-C05 | Admin shows online / last seen / health (§7) | `management-client.ts:42-44` `lastSeenAt`, `fleetStatus`, `freshness`; `:41` `openIncidentCount`; `device-presentation.ts` `deviceCondition`, `freshnessLabel` | IMPLEMENTED_AND_TESTED | MATCH | 100 |
| DEVWF-C06 | Admin shows image version and agent version (§7) | **ABSENT from `FleetDeviceView` (`management-client.ts:28-44`).** The document's §7 example lists both | ABSENT | NOT_IMPLEMENTED | 0 |
| DEVWF-C07 | `kitluy_devices` stays closed to browsers | `http.ts:58` OD-ADMIN-FLEET-001; reads only via governed API | IMPLEMENTED_AND_TESTED | MATCH | 100 |

### Stage D — Partner Provisioning Framework

| ID | Requirement | Evidence | Status | Match | % |
| --- | --- | --- | --- | --- | ---: |
| DEVWF-D01 | Provisioning code / session data model (§11, §32) | `0162_terminal_provisioning_codes.sql:76+`; `device_provisioning_codes`; append-only events `0162:312` | IMPLEMENTED_AND_TESTED | MATCH | 100 |
| DEVWF-D02 | Issuance function exists | `kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)` (`0167:221`); test `terminal-activation.integration.test.ts` | IMPLEMENTED_AND_TESTED | MATCH | 100 |
| DEVWF-D03 | Code is single-use and expiring (§18, §33) | `0166_canonical_terminal_code_expiration.sql`; claim pattern + immutability `0162:225` (`KLUY-PROVCODE-IMMUTABLE`); `0164` presentation-attempt lockout | IMPLEMENTED_AND_TESTED | MATCH | 100 |
| DEVWF-D04 | Partner Portal "Provision Device" UI with device-type selection (§2.2, §11, §16) | **ABSENT.** `apps/kitluy-partner-pwa-portal/src/` contains exactly `App.tsx` and `main.tsx`; zero references to device / provisioning / pairing | ABSENT | NOT_IMPLEMENTED | 0 |
| DEVWF-D05 | Partner can open a provisioning session (end-user capability) | DB door granted to `authenticated` (`0172:288`), but no Partner HTTP surface and no UI composes it | SCAFFOLDED | PARTIAL_MATCH | 10 |
| DEVWF-D06 | Permissions + audit on issuance (§33) | `0172_provisioning_composition_identity.sql`, `0173_provisioning_composer_noinherit_gateway.sql`; `0167:563` asserts `public`/`anon` hold no execute | IMPLEMENTED_AND_TESTED | MATCH | 100 |

### Stage E — Store Hub Pairing

| ID | Requirement | Evidence | Status | Match | % |
| --- | --- | --- | --- | --- | ---: |
| DEVWF-E01 | Hub claim → assignment model (§13) | `0121_device_claim_and_assignment.sql`; `device_claims`, `device_assignments`; `hub-provisioning-e2e.db.test.ts` drives identity→enrollment→QA→eligibility→code→claim→assignment→liveness with no hand-inserted rows | IMPLEMENTED_AND_TESTED | MATCH | 100 |
| DEVWF-E02 | Atomic redemption (§12, §33) | `0169_atomic_terminal_code_recovery.sql`, `0171_atomic_pop_bound_redemption.sql`; `0168_ambiguous_issuance_replay_reconciliation.sql` | IMPLEMENTED_AND_TESTED | MATCH | 100 |
| DEVWF-E03 | Store Hub CLI accepts a pairing code (§2.3, §12) | **ABSENT.** `firstboot-agent/src/bin/` has no pairing binary; `hub-agent/package.json` declares no `bin`; no `readline`/`prompt`/`stdin` in either service | ABSENT | NOT_IMPLEMENTED | 0 |
| DEVWF-E04 | Hub activation moves it to assigned + active (§13) | `0121:1086-1102` and `0123:704-716` set `lifecycle_state='active'` and write the projection. **Gated by `KLUY-DEVICE-NO-CERTIFICATE` → BLK-005; no device can activate today** | BLOCKED | MATCH | 85 |
| DEVWF-E05 | Hub local runtime starts / local DB (§14, §27) | `hub-agent/src/{main.ts,local-db.ts,hub-database.ts}`, `hub/edge/runtime-bootstrap.ts`; tests `hub-database.test.ts`, `hub-crash-recovery.test.ts`, `hub-restart-recovery.test.ts`, `t1-startup.e2e.integration.test.ts` | IMPLEMENTED_AND_TESTED | MATCH | 85 |
| DEVWF-E06 | Hub exposes approved LAN endpoint (§14, §15) | `hub-agent/src/lan-api.ts` — **serves only health, identity, sync-status; every mutating verb fails closed with 405**, Hub mutation persistence is WS-09 work (stated in the file header). Tests `lan-api.test.ts`, `edge-lan.integration.test.ts` | PARTIAL | PARTIAL_MATCH | 70 |
| DEVWF-E07 | Hub endpoint publication / discovery (§15) | `hub/edge/discovery.ts` — signed discovery record, 30 s refresh / 90 s validity, `_kitluy-edge._tcp.local`, `GET /.well-known/kitluy-edge-discovery/v1`; tests `edge-discovery.test.ts`, `mdns.test.ts`, `t1-endpoint-order.test.ts` (locked six-source order) | IMPLEMENTED_AND_TESTED | MATCH | 85 |
| DEVWF-E08 | Cloud knows which Hub serves a Location (§15) | `kitluy_devices.device_assignment_projections` (`0121:357`) | IMPLEMENTED_AND_TESTED | MATCH | 100 |

### Stage F — Pi Terminal Pairing

| ID | Requirement | Evidence | Status | Match | % |
| --- | --- | --- | --- | --- | ---: |
| DEVWF-F01 | Terminal provisioning code issuance (§17) | `issue_terminal_provisioning_code_v1` (`0167:221`) | IMPLEMENTED_AND_TESTED | MATCH | 100 |
| DEVWF-F02 | Proof-of-possession challenge protocol (§18, §20) | `0170_terminal_provisioning_pop_challenges.sql`; `device-registry-service/src/provisioning-routes.ts` — `POST /v1/terminal-provisioning/challenges`, `/redemptions`, `/verify/:challengeId`; protocol `kitluy.provisioning-pop.v1`; rate limiter + idempotency | IMPLEMENTED_AND_TESTED | MATCH | 100 |
| DEVWF-F03 | Atomic PoP-bound redemption (§20, §33) | `0171_atomic_pop_bound_redemption.sql`; `redeem_terminal_provisioning_code_v1` (`0172:163`) | IMPLEMENTED_AND_TESTED | MATCH | 100 |
| DEVWF-F04 | Code revocation (§20, §33) | `0165_governed_terminal_provisioning_code_revocation.sql` | IMPLEMENTED_AND_TESTED | MATCH | 100 |
| DEVWF-F05 | Expiration + governed replacement issuance (§20) | `0166_canonical_terminal_code_expiration.sql`, `0167_expired_terminal_code_replacement_issuance.sql` | IMPLEMENTED_AND_TESTED | MATCH | 100 |
| DEVWF-F06 | Replay reconciliation (§18, §33) | `0168_ambiguous_issuance_replay_reconciliation.sql` | IMPLEMENTED_AND_TESTED | MATCH | 100 |
| DEVWF-F07 | **Hub-first ordering enforced** (§10, §31) | `0162:76` `store_hub_device_id uuid not null`; trigger `enforce_provisioning_code_integrity` (`0162:210`) requires a Hub assignment at the SAME tenant/store/location; `0167:357-376` refuses `KLUY-PROVCODE-HUB-INACTIVE` when no activated-Hub projection exists at scope | IMPLEMENTED_AND_TESTED | MATCH | 100 |
| DEVWF-F08 | Pi GUI accepts a pairing code (§2.3, §19) | **ABSENT.** `bin/bootstrap-ui.ts` header: *"No Store pairing, no vertical, no Laundry workflow — those belong to the next milestone"* | ABSENT | NOT_IMPLEMENTED | 0 |
| DEVWF-F09 | Terminal activation completion (§21) | `0174_terminal_activation_completion.sql` — `prepare_terminal_provisioning_activation_v1`, `read_terminal_activation_challenge_context_v1`, `complete_terminal_provisioning_activation_v1`; test `terminal-activation.integration.test.ts`. Gated by BLK-005 | BLOCKED | MATCH | 85 |

### Stage G — POS Vertical / Profile Runtime

| ID | Requirement | Evidence | Status | Match | % |
| --- | --- | --- | --- | --- | ---: |
| DEVWF-G01 | ONE POS app with a vertical registry (§24) | `apps/kitluy-pos-desktop-app/src/vertical/{registry.ts,modules.ts,contract.ts,index.ts}`; `VerticalRegistry` — modules compiled in, not runtime-discovered; test `vertical-host.test.ts` "registry composition" | IMPLEMENTED_AND_TESTED | MATCH | 85 |
| DEVWF-G02 | Vertical resolved from Hub-signed config, never chosen locally (§22) | `@kitluy/digital-store-context` `resolveStoreContext`; registry header: *"The local user can never turn a terminal into another business vertical"*; tests `vertical-resolution.test.ts` (authorised path + fail-closed refusals) | IMPLEMENTED_AND_TESTED | MATCH | 85 |
| DEVWF-G03 | LAUNDRY loads in Phase 1 (§22) | `LAUNDRY_MODULE` (`modules.ts:31`); test `vertical-host.test.ts` "Phase 2 can never load as Phase 1" | IMPLEMENTED_AND_TESTED | MATCH | 85 |
| DEVWF-G04 | T1–T4 profiles map to experiences (§16, §23) | `verticals/phase1-laundry/src/terminal-profiles.ts:23-26` — `laundry.t1.intake_cashier`, `laundry.t2.customer_display`, `laundry.t3.ready_scan_in`, `laundry.t4.pickup_scan_out` (**exact match to the document**); `modules.ts:42-64` t1–t4 segments; test "the same shell becomes the correct terminal" | IMPLEMENTED_AND_TESTED | MATCH | 85 |
| DEVWF-G05 | T1–T4 actually run Store workflows (§38 POS Runtime) | `intake/machine.ts` (T1 intake partial) only. `registry.ts` header: *"Creates no Booking, pricing, payment, receipt or printing behaviour — it selects an experience, nothing more"*; status MIGRATED-NOT-YET-ACCEPTED | PARTIAL | PARTIAL_MATCH | 20 |

### Stage H — Hub-Mediated Store Operation

| ID | Requirement | Evidence | Status | Match | % |
| --- | --- | --- | --- | --- | ---: |
| DEVWF-H01 | No direct-cloud POS business path (§26) | **Zero `supabase` / `createClient` references in `apps/kitluy-pos-desktop-app/src/`.** All Hub-mediated via `bootstrap/ports.ts` | IMPLEMENTED_AND_TESTED | MATCH | 85 |
| DEVWF-H02 | Terminal→Hub authenticated LAN transport (§27) | `bootstrap/ports.ts` `ProtectedTerminalIdentity`, `hubOperationalPublicKeyPem`, `hubEndpointHint`; mTLS transport; tests `t1-bootstrap-routes.integration.test.ts`, `t1-bootstrap.acceptance.test.ts`, `t1-startup.e2e.integration.test.ts`, `terminal-identity.test.ts` | IMPLEMENTED_AND_TESTED | MATCH | 85 |
| DEVWF-H03 | Hub is local operational authority for business transactions (§14, §26, §27) | **Only reads.** `lan-api.ts` serves health/identity/sync-status; mutating verbs 405 with no handler; Hub mutation persistence deferred to WS-09 | PARTIAL | PARTIAL_MATCH | 35 |
| DEVWF-H04 | Approved local operation survives WAN outage (§28) | `hub-offline-operation.test.ts`, `hub-live-gate-offline-revocation.test.ts`, `hub-safety-modes.test.ts`, `hub-revocation-offline.test.ts`; offline machinery real, **but there are no business mutations to run offline yet** | PARTIAL | PARTIAL_MATCH | 75 |
| DEVWF-H05 | Hub→cloud async sync (§26, §27) | `hub-agent/src/sync-engine.ts`, `hub/sync/*`; `@kitluy/sync-protocol`; tests `sync-outbox-lease`, `sync-reconciliation`, `sync-transmission`, `hub-outbox-atomicity`, `sync-inbox` | IMPLEMENTED_AND_TESTED | MATCH | 85 |
| DEVWF-H06 | Terminal consumes Hub configuration / assignment (§21) | `services/kitluy-configuration-projection-service`; `terminal-configuration-delivery.test.ts`; `0050_configuration.sql` scope precedence | IMPLEMENTED_AND_TESTED | MATCH | 85 |

---

## 4. Already strong / largely complete (evidence-backed)

1. **Terminal provisioning cloud machinery (Stage F, 87%).** Migrations
   `0165`–`0174` each verified individually and each does what its name claims.
   Revocation, canonical expiration, replacement issuance, replay
   reconciliation, atomic recovery, PoP challenges, atomic PoP-bound
   redemption, composer identity/gateway, activation completion. Backed by real
   HTTP routes in `provisioning-routes.ts` with rate limiting and idempotency.
2. **Admin fleet visibility (Stage C, 86% / 86% verified).** The only stage
   with genuine cross-component E2E evidence against the real cloud project.
3. **Hub-first ordering (DEVWF-F07).** Enforced in three independent layers.
4. **Device identity and clone hygiene (A03–A04).** Directly tested, including
   the exact clone scenario the workflow's §34 cares about.
5. **Vertical/profile resolver (G01–G04).** Canonical `laundry.t{1..4}.*` codes
   match the owner document exactly, with fail-closed refusals tested.
6. **Baked bootstrap runtime (A06).** Four binaries and four systemd units in
   the image; the chicken-and-egg problem is solved.

---

## 5. Partially implemented — exact gaps

| Area | What exists | What is missing |
| --- | --- | --- |
| Device-side enrollment (B04) | `runEnrollmentStep` state machine, tested | The `EnrollmentClient` transport port is uninjected — deliberately, because there is no endpoint |
| Heartbeat (B08) | Hub→cloud ingestion + online verifier | Device→cloud leg; `health-reporter` binary has no test |
| Hub LAN API (E06, H03) | health / identity / sync-status reads | Every business mutation — 405 with no handler (WS-09) |
| Offline operation (H04) | Safety modes, offline revocation, crash/restart recovery | There are no business mutations to perform offline |
| POS T1–T4 (G05) | Experience selection + T1 intake machine | Booking, pricing, payment, receipt, printing |
| Image hygiene (A05) | Secret scanner, device-generated identity | A `snakeoil` private key ships in both images |
| Bootstrap UI (A07) | Renders true state, never guesses | No test coverage |

---

## 6. Absent

| ID | Missing | Consequence |
| --- | --- | --- |
| DEVWF-B05 | Cloud fresh-device enrollment endpoint (`/v1/device-enrollment`) | A field Pi cannot enroll. Milestone 2 cannot start |
| DEVWF-C06 | Image version + agent version in the Admin fleet view | §7's example cannot be rendered in full |
| DEVWF-D04 | Partner Portal device-provisioning UI | A Shop owner cannot generate a pairing code |
| DEVWF-E03 | Store Hub pairing CLI | A Hub cannot be paired by an operator |
| DEVWF-F08 | Pi Terminal pairing GUI | A terminal cannot be paired by an operator |

**The three absent user-facing surfaces (D04, E03, F08) are the entire human
half of the workflow.** Every code path that consumes a pairing code exists and
is tested; nothing exists that lets a human produce or enter one.

---

## 7. Blockers and open decisions

### Owner decisions (not engineering work)

| ID | Item | Effect |
| --- | --- | --- |
| **BLK-005** | PKI root/CA, HSM/secure-element model, certificate windows. Values ruled 2026-07-28 (KLD-2026-07-28-002); **implementation pending**; hardware SKU selection not agent-closable | **The single largest dependency.** Activation is certificate-backed (`KLUY-DEVICE-NO-CERTIFICATE`). No activation → no `device_assignment_projections` row → `issue_terminal_provisioning_code_v1` refuses `KLUY-PROVCODE-HUB-INACTIVE`. **No terminal can be provisioned at all today** |
| **DEC-2** | What authenticates a factory-fresh Pi (options B / C / D; A eliminated by §4) | Blocks B05, B06, and the device→cloud heartbeat leg |
| `KITLUY_SECURE_ELEMENT_MODEL` | Production BOM | Hardware certification |
| Debian snapshot pin | Reproducible apt state | Image reproducibility |

### Engineering work (no decision needed)

Partner Portal provisioning UI; Hub pairing CLI; Pi pairing GUI; Hub mutation
persistence (WS-09); image/agent version in the fleet DTO; snakeoil key removal;
verity block size 16384 vs Pi page size 4096; physical Pi boot validation.

### Documentation gap found during the audit

`src/bin/firstboot-identity.ts:5` and `src/adapters/device-identity-store.ts:5`
both cite **"DEC-1 bootstrap-hybrid owner decision (2026-08-10)"** as their
authority. **No such decision record exists** — not in `docs/decisions/`, not in
the decision register, not in any handoff. `28_PI_TERMINAL_MISSION_BLOCKERS.md`
still lists DEC-1 as open. The implementation matches what that document
recommended as option C, so the code is not wrong; the authority for it is
simply unrecorded. This supersedes part of KLREC-2026-08-11-EDGE-001, which
reported DEC-1 as open on documentary evidence — **in code, DEC-1 is decided and
built; only its record is missing.**

---

## 8. Workflow conflicts

**No material workflow conflicts found.**

Every behavioural check the document specifies is either implemented as
described or absent — nothing implemented behaves contrary to KLSRC-0162. The
seven conflicts the mission asked to look for were each tested and refuted:

| Candidate conflict (§9) | Verdict |
| --- | --- |
| Terminal assigned before Hub exists | **Refuted** — `store_hub_device_id NOT NULL` + scope trigger + `KLUY-PROVCODE-HUB-INACTIVE` |
| Pi chooses its own business vertical | **Refuted** — `resolveStoreContext` takes an authoritative assignment; test "Phase 2 can never load as Phase 1" |
| Normal Pi operations go direct to cloud Supabase | **Refuted** — zero `supabase` references in POS desktop source |
| Factory enrollment requires Store pairing first | **Refuted** — enrollment and assignment are separate tables and separate functions |
| Partner must type Store IDs into the Pi | **Refuted** — issuance takes `p_terminal_assignment_id`; the device supplies only a code + PoP signature |
| Hub and Pi use unrelated provisioning systems | **Refuted** — one `device_provisioning_codes` table, one claim/assignment model |
| A terminal code can target a Location with no Hub | **Refuted** — see §15 below |

The one deviation worth naming is **not** a workflow conflict but a security
one: the `snakeoil` private key in the shipped images sits against §34's
prohibition on baking key material into a shared image. It is a recorded
image-definition blocker, not a workflow design disagreement.

---

## 9. Device-specific view

| Device | Completion | Reading |
| --- | ---: | --- |
| **Pi Terminal** | **82%** | Cloud-side provisioning is the most complete part of the whole system; the device-side pairing GUI and the actual T1–T4 workflows are what is missing |
| **Store Hub** | **76%** | The DB chain is proven end-to-end, but the Hub has no operator CLI and its LAN API serves no business operations |

---

## 10. Platform-specific view

| Platform | Completion | Reading |
| --- | ---: | --- |
| Cloud / backend (schema, functions, routes) | **90%** | The strongest layer by a wide margin |
| Admin Portal | **86%** | Only image/agent version missing |
| Store Hub local runtime | **73%** | Runtime, DB, discovery real; LAN API read-only |
| POS runtime | **72%** | Resolver complete; workflows are selection only |
| Device runtime (firstboot / enrollment / bootstrap agents) | **59%** | Identity excellent; enrollment transport and pairing UI absent |
| **Partner Portal** | **5%** | `App.tsx` + `main.tsx`. Nothing else |

---

## 11. Critical path to 100%

Dependency-ordered. Steps 1–2 are owner decisions; nothing downstream can be
built without them.

1. **Rule DEC-2** — fresh-device authentication (B / C / D). Blocks everything
   in Stage B. Record the decision; also record the already-built DEC-1.
2. **Implement BLK-005 device trust** — PKI/CA + certificate issuance. Until
   this lands, *no device can activate*, so Stage E and Stage F cannot be
   demonstrated at all regardless of what else is built. **This is the gate.**
3. **Build the cloud enrollment endpoint** (`/v1/device-enrollment`) and inject
   the real `EnrollmentClient`. The state machine already exists and is tested —
   `enrollment-bootstrap.ts` says explicitly nothing in it needs rewriting.
4. **Prove Pi → cloud → Admin E2E** on real hardware. Closes Milestone 2 and
   converts Stage B/C from "tested" to "verified".
5. **Prove Store Hub → cloud → Admin E2E**, then Hub activation (needs 2).
6. **Build the Partner Portal provisioning UI** (Hub session first, then
   terminal session with T1–T4 selection). The cloud functions it must call are
   already built, tested and permission-gated.
7. **Build the Store Hub pairing CLI**, then prove Hub pairing → assignment →
   local runtime start → signed endpoint publication.
8. **Build the Pi pairing GUI**, then prove terminal pairing → assignment
   payload → profile + vertical resolution.
9. **Implement Hub mutation persistence (WS-09)** so the LAN API owns business
   operations rather than 405-ing them. This is what makes §26/§27 real.
10. **Prove offline operation** against actual business mutations, then physical
    hardware certification (secure element SKU, verity block size, snakeoil key
    removal).

---

## 12. Built vs usable

| Subsystem | Built | Tested | Deployed | E2E | Hardware | **Commercially usable** |
| --- | --- | --- | --- | --- | --- | --- |
| Device identity / firstboot | Yes | Yes | In image | No | No | No |
| Factory enrollment (cloud schema) | Yes | Yes | Yes (87/87) | No | No | No |
| Factory enrollment (device→cloud) | No | No | No | No | No | **No** |
| Admin fleet visibility | Yes | Yes | Yes | **Yes** | n/a | **Nearly** — missing image/agent version |
| Partner provisioning (cloud) | Yes | Yes | Yes | No | n/a | No — no caller |
| Partner provisioning (UI) | No | No | No | No | n/a | **No** |
| Store Hub pairing (DB chain) | Yes | Yes | Yes | DB-level only | No | No |
| Store Hub pairing (operator CLI) | No | No | No | No | No | **No** |
| Store Hub local runtime | Yes | Yes | No | Partial | No | No |
| Terminal pairing (cloud) | Yes | Yes | Yes | No | No | No — blocked by BLK-005 |
| Terminal pairing (device GUI) | No | No | No | No | No | **No** |
| Vertical / profile resolver | Yes | Yes | No | No | No | No — selects only |
| T1–T4 Store workflows | Partial | Partial | No | No | No | **No** |
| Hub-mediated operation | Partial | Yes | No | No | No | **No** |

---

## 13. Core audit question

> **If the owner handed the current repository to a pilot Store today, how much
> of this exact workflow would genuinely work end-to-end without manual
> engineering intervention?**

## **≈ 5%.**

What would actually happen: flash a Pi, boot it, and it generates a unique
persistent identity and displays a bootstrap screen reading
`Fleet enrolment ... Not enrolled` / `Store assignment .. Unassigned`. That is
Milestone 1 of §37, and it is genuinely working.

Everything after that stops. The chain fails at its first network step — there
is no enrollment endpoint and no mechanism to authenticate a fresh device — so
the device never reaches Admin. Even bypassing that by enrolling devices
manually at a station, the next stop is absolute: **activation is
certificate-backed and BLK-005 leaves the PKI configuration empty and
fail-closed, so no Hub can become active; with no active Hub there is no
assignment projection; with no projection `issue_terminal_provisioning_code_v1`
refuses every terminal code with `KLUY-PROVCODE-HUB-INACTIVE`.** And even if all
of that were resolved, there is no Partner UI to create a code, no Hub CLI to
enter one, and no Pi GUI to enter one.

**The largest missing dependency is BLK-005 device-trust implementation.** It is
larger than the enrollment gap because it sits in the middle of the chain and
gates both device classes: enrollment could be solved tomorrow and still nothing
would provision. DEC-2 is the *first* obstacle; BLK-005 is the *binding* one.

**Repository completeness (77%) and pilot readiness (~5%) are not the same
measurement and must not be reported interchangeably.** The 77% is real — the
cloud provisioning core is genuinely excellent, closely conformant (92%) and
well tested. What is missing is disproportionately the two ends of the chain:
the device's first network step, and every human-facing surface.

---

## 14. Confidence

**HIGH** for everything asserted from schema, source and test files: every
migration number, function name, route and file path in this report was opened
and read, not inferred from a name or a handoff claim.

**MEDIUM** on two axes, which limit precision:

1. **Test execution.** The inventory is 180 test files and their contents were
   read, but the full suite was not executed for this audit. A prior run in this
   session showed 3 of 139 firstboot-agent tests failing
   (`trusted-time-activation.db.test.ts`, `expected 'restricted_forward_jump' to
   be 'trusted'`) — a state-dependent DB condition. "Tested" here means
   meaningful tests exist and were read, not that all currently pass.
2. **Cloud and hardware state.** Cloud migration count (87) is taken from
   `32_DEC4…md`; no cloud query was performed, since the mission is read-only
   and the connector/CLI account split is a recorded hazard. No physical Pi
   exists to test, so every hardware dimension is scored 0 by absence of
   evidence rather than by observed failure.

Scoring weights are the mission's own (40/25/20/15) and the per-requirement
awards are stated in §3, so any individual score can be re-derived or disputed
line by line.
