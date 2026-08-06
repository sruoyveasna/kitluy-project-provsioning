# KitLuy Active Phase and Scope Fence

**Active phase:** Phase 1 — Laundry  
**Status:** owner-locked roadmap position  
**Effective record date:** 2026-07-26

## 1. Phase objective

Deliver a usable, deployable, commercially viable Laundry Digital Store operating system with a stable shared foundation that later verticals can reuse without Laundry hardcoding.

The phase is not complete merely when screens or services exist. Exit requires approved scope, schema, workflows, APIs, permissions, interfaces, offline behavior, hardware, finance rules, reports, integrations, migrations, seeds, QA, security, monitoring, recovery, pilot, go-live checklist, and updated Rebuild/Business Bibles.

## 2. Permitted Phase 1 scope

### Shared Core and platform foundation

- Tenant, Partner account, Digital Store, Store Location, user, membership, role, permission, device, and environment isolation.
- Neutral catalog/service definitions, pricing, customers, transactions, payments, inventory/consumables, purchasing foundation, finance subledger, reporting, files, notifications, jobs, webhooks, audit, integrations, and AI controls to the level required by Laundry.
- Four governed API surfaces: Management, Commerce Store, Edge Operations, and Connector.
- Versioning, idempotency, retries, error contracts, freshness labels, append-only ledgers, event delivery, and compatibility controls.
- Supabase/DigitalOcean responsibility split and Kubernetes-ready, non-Kubernetes-first deployment design.

### Laundry vertical delta

- services and per-piece/per-weight pricing;
- customer pre-intake, virtual queue, T1 verification, and Laundry Booking creation;
- garments, tags, bags, evidence, stains, damage and special handling;
- deposits, payments, KHQR, receipts and pickup references;
- production statuses, pressing, quality checks, issues, rewash and damage handling;
- pickup/delivery where approved for Phase 1;
- consumables, capacity and Laundry reporting;
- custody, ready storage, pickup release and completion;
- offline operations and reconciliation.

### Phase 1 client/product surfaces

- public B2B website and account entry;
- Admin Portal control plane;
- Chain Portal Laundry governance;
- Partner Portal one-Digital-Store back office;
- Partner App owner/manager cockpit;
- POS Desktop and approved POS Mobile operations;
- Storefront QR/Telegram pre-intake and queue;
- Store Hub and managed devices;
- T1, T2, T3, and T4 profiles.

### Laundry terminal rules

| Profile | Canonical purpose        | Hard boundary                                                                                          |
| ------- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| T1      | POS Cashier / Intake     | intake, authoritative Booking creation, price, deposit/payment, receipt/tag                            |
| T2      | Customer Display Screen  | customer-facing mirror, totals, KHQR/payment state, receipt/pickup information; no production workflow |
| T3      | Clean & Ready Scan-In    | quality/count, packaging, storage assignment, ready custody event; no customer release                 |
| T4      | Customer Pickup Scan-Out | collector verification, balance control, custody release, Booking completion                           |

## 3. Allowed shared forward preparation

An agent may add a neutral seam for a later vertical only when all are true:

- Phase 1 requires the shared abstraction now or confirmed near-term reuse is documented;
- no later-vertical workflow is activated;
- the change is additive and backward-compatible;
- no Laundry term enters Core;
- feature flags/entitlements keep later functionality disabled;
- the task explicitly lists the forward-compatibility requirement and tests.

## 4. Prohibited active scope

Without a new owner-approved task and phase decision, do not implement:

- Café/Restaurant menus, tables, checks, KDS, course firing, recipes, tips, or service-charge workflows;
- full Phase 3 eCommerce carts, checkout, subscriptions, international commerce, public extension marketplace, or theme marketplace beyond the exact Laundry Storefront need;
- Convenience, Pharmacy, Department Store, Grocery, or Supermarket vertical workflows;
- speculative enterprise scale, multi-region, self-checkout, warehouse distribution, or regulated pharmacy behavior;
- a generic all-industry UI or schema that destabilizes Laundry;
- competitor clone architecture as product truth;
- pricing, legal, tax, processor-risk, or compliance choices not approved for Cambodia.

## 5. Phase 1 source-of-truth constraints

- Digital Store first; optional physical Location second.
- One Digital Store, one primary vertical.
- Store Hub active before terminal provisioning.
- T1–T4 roles remain separate even when hardware is shared.
- Cloud sync is asynchronous; internet failure does not stop local operation.
- External channels are governed projections and connectors.
- Reporting cannot be commercially paywalled.
- No capability is marked implemented without evidence.

## 6. Scope-change procedure

A task that needs to cross this fence must stop and file a conflict/decision record stating:

- requested capability;
- reason Phase 1 cannot succeed without it;
- whether it is Core or vertical-specific;
- impact on schema, APIs, offline behavior, products, migration, security, operations, and roadmap;
- options and recommendation;
- owner decision required.

## 11. Cycle-11 scope fence — WS-12 T1 Intake/Cashier (2026-08-06)

**WS-12 task register RULED (KLD-2026-08-06-WS12-TASKS-001,
`docs/decisions/kitluy-ws12-t1-intake-cashier-task-register-owner-decision-v1.0.0.md`).**
Eight tasks, order and count locked: **T001 T1 Runtime, Device Session and
Store Hub Bootstrap** · T002 Customer Identity, Consent and Booking Draft ·
T003 Service, Garment, Evidence and Custody Intake · T004 Pricing, Capacity,
Due-Time and Booking Confirmation · T005 Deposit, Payment, KHQR, Receipt and
Tag Issuance · T006 Offline Queue, Synchronization, Printing and Peripheral
Recovery · T007 T1 Workflow Integration, Localization and End-to-End
Verification · T008 Independent Review, Rebuild Evidence and Closeout.

**Composition rule (LOCKED):** every WS-12 task REUSES existing shared
authorities. T1 is an operational client and composition surface, NOT a new
source of Booking, payment, pricing, customer or audit truth. The Store Hub
is never bypassed; terminals never write to Supabase; the installer and
user can never select or override Tenant, Digital Store, Location, Hub,
environment, terminal profile or assignment generation. BLK-005/BLK-006
stay fail-closed; the T1–T4 model of §2 is unchanged.

> **2026-08-06 (P02 close) — WS-12-T002 COMPLETE — IMPLEMENTED-IN-DEV.**
> The successor package delivered the T1 interface (adapters, narrow IPC,
> 15-state machine, bilingual strings), the complete outbox census with
> three governed cloud consumers, Hub 0041 + cloud 0187, and the
> acknowledgment loop — §12 proven end to end; a draft REMAINS a draft;
> duplicate delivery has one effect; conflicts stay explicit. The fence
> held: no services, garments, pricing, payments, conversion or printing.
> NEXT: WS-12-T003, NOT STARTED.

> **2026-08-06 (T002 close) — WS-12-T002 PARTIAL — SUCCESSOR PACKAGE
> REQUIRED.** Stage A first: the resolver PUBLIC-execute report was REFUTED
> and retracted (0025 already held the discipline; §28b pins it). T002
> delivered the customer/consent/draft AUTHORITY end to end in dev — Hub
> 0040, cloud 0186 (the first governed doors over WS-06), eight served
> intake routes under the full §6 stack, Amendment 003, durable outbox
> facts — all live-proven (Hub 45 PASS, cloud 243 PASS incl. RLS, routes
> 20/20, hub-agent 388). The fence held: no pricing, payment, custody or
> conversion; a draft is not a Booking; no auto-merge anywhere; consent is
> never a preselected boolean. PARTIAL: the §7 T1 interface and the
> cloud-consumer wiring are the successor package. T003 NOT STARTED.

> **2026-08-06 (P02 close) — WS-12-T001 COMPLETE — IMPLEMENTED-IN-DEV.**
> The successor package delivered the real Hub bootstrap contract
> (KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001): the three `/edge/v1`
> bootstrap reads served over the P04B mTLS transport (authority-time from
> the Hub DATABASE transaction, override-free eligibility with the full
> fail-closed matrix, the Hub-attested signed configuration envelope),
> staff sessions under the five canonical permission keys (registry
> amendment 002, 109→114; census of permission-less Edge routes 9→5), the
> real mDNS `_kitluy-edge._tcp.local` listener with the locked six-source
> endpoint order proven order-exact, and the atomic protected-identity
> writer. A real terminal runtime reaches **`ready`** through the public
> routes and **`offline_ready`** with the delivery unavailable (§7 e2e,
> real Hub DB + real TLS + real Ed25519, terminal touching only public
> adapters). NO cloud/Hub migration — no relational route or permission
> registry exists; keys resolve from cloud-authored grant rows and zero
> rows fail closed. Four security defects in the pre-existing P02 commit
> were fixed and test-pinned (recorded: KLREC-2026-08-06-WS12-T001-P02-001).
> The fence, BLK-005/BLK-006 and the T1-composition rule are unchanged —
> T1 still creates no Booking, pricing, payment, receipt or printing
> truth. NEXT: WS-12-T002 (Customer Identity, Consent and Booking Draft)
> NOT STARTED.

> **2026-08-06 (close) — WS-12-T001 PARTIAL — SUCCESSOR PACKAGE REQUIRED.**
> Delivered in dev with executed evidence: the §5 thirteen-state bootstrap
> machine and ten-step startup sequence, verified signed-discovery endpoint
> resolution, pairing-receipt + eligibility composition (protocol §11),
> signed-configuration verification with the NEW `@kitluy/terminal-local-store`
> `ConfigurationSnapshotStore` offline cache (explicit `current` vs
> `cached_offline` freshness), staff T1-profile authorization, the pinned
> TLS 1.3 LAN client, the safeStorage-protected identity file and the
> read-only renderer bridge — 16 acceptance tests covering all 14 required
> scenarios, zero skips; terminal-local-store 20/20; affected
> device-identity/hub-agent suites green; secret:scan 1412 clean. PARTIAL
> because no APPROVED `/edge/v1` route serves terminal eligibility, Hub
> time, configuration delivery or staff sessions (and the sessions
> permission keys are `[REQUIRED:]` gaps) — owner additive route/permission
> decisions are the successor's prerequisite; transport credentials and
> trusted-time providers stay BLK-005 fail-closed. NO migration created.
> T1 remains a composition surface: no Booking, pricing, payment, receipt
> or printing code exists in it. NEXT: WS-12-T002 (Customer Identity,
> Consent and Booking Draft) NOT STARTED.

## 10. Cycle-10 scope fence — WS-11 only (2026-07-28)

> **2026-08-05 — WS-11-T004 CLOSED as IMPLEMENTED-IN-DEV.** The fence is unchanged: all work stayed inside WS-11 (`kitluy_devices` cloud groups 0162–0176, Hub groups 0031–0034, `@kitluy/device-identity`, `@kitluy/terminal-local-store`, the device-registry service and the Hub agent). No Laundry business surface, no production migration and no pilot/production claim was made; BLK-005 fail-closed behaviour was re-proven on a reset from zero. The next WS-11 task is read from the authoritative task register, not invented here.

> **2026-08-06 (WS-11 CLOSE) — WS-11-T008 COMPLETE — INDEPENDENTLY APPROVED; WS-11 COMPLETE — IMPLEMENTED AND VERIFIED IN DEV.** Three independent reviewers in their own detached worktrees, five passes, none approving a correction it authored; the initial verdict was committed before any product change. Every WS-11 task approved. FIVE remediation groups fixed forward — cloud 0182 (assignment identity), 0183/0184/0185 (the pairing-receipt door's identity, scope, generation, NULL-permeability and presence gate), plus the Hub checksum-guard and verify-gate tooling fixes. The chain is worth noting: each gap was found by the NEXT reviewer, not by the author. pnpm verify **12/13** \u2014 Unit tests PASS (the first fully green unit gate in this workstream) and the NEW Hub migration validation gate passes; the ONLY failure is the pre-existing repository-wide format condition (865 files, T008 intersection measured EMPTY, every T008 file passing targeted formatting). BLK-005/BLK-006 unchanged and fail-closed; BLK-007 narrowed and named. NEXT WORKSTREAM: **WS-12 — T1 Intake/Cashier** (NOT STARTED; its task titles are not defined in the register and are not invented here).
>
> **2026-08-06 (close) — WS-11-T007 COMPLETE — VERIFIED-IN-DEV.** The independent WS-11 security, offline, recovery and concurrency verification executed under KLD-2026-08-06-WS11-T007-001: all seven census debts dispositioned, all 16 race families governed with genuinely separate sessions (20 controlled iterations each on the new suites), two real concurrency defects found and fixed forward as cloud 0181 (containment door deadlock; assignment idempotency race), Hub 0038 restored byte-for-byte (the T006 immutability breach reconciled), hub migration validation fully green for the first time. pnpm verify **11/12** — Unit tests PASS (the full monorepo suite green with race-A and sync-inbox fixed); the only failing gate is the PRE-EXISTING repository-wide CRLF Format condition (876 files, T007 intersection EMPTY). One earlier verify attempt showed an uncaptured intermittent unit failure; the immediately following standalone full pnpm test (exit 0) and this complete captured verify run were both green, and the intermittent is recorded honestly, not hidden. BLK-005/BLK-006 fail-closed and re-proven; the promotion ceiling unchanged. NEXT: WS-11-T008 (Independent WS-11 Review, Evidence Reconciliation and Closeout) NOT STARTED.
>
> **2026-08-06 — WS-11-T007 AUTHORIZED AND IN PROGRESS.** KLD-2026-08-06-WS11-T007-001 (OWNER-APPROVED — LOCKED, security test system §19) authorizes the independent WS-11 security, offline, recovery and concurrency verification. Stage 0 first reconciled the T006 migration-0038 immutability breach: 0038 restored byte-for-byte from 9310168 with a checksum-pinned scanner exception (b031cb8); T006 stays COMPLETE — IMPLEMENTED-IN-DEV. Debt census D1–D7 recorded before any product change.
>
> **2026-08-06 (close, S02) — WS-11-T006 COMPLETE — IMPLEMENTED-IN-DEV.** P03 (signed release authority, cloud 0180 + Hub 0038) and P04 (A/B installation with the locked offline health gate and one automatic rollback, Hub 0039 + release-agent) delivered with executed evidence; the single §18 closeout run re-proved P01/P02 alongside them (both databases reset from zero; every suite executed). The SlotAdapter runtime gap (physical Pi/Electron adapters) is RECORDED, not claimed — hardware work behind BLK-005's pilot gates. Fence, BLK-005/BLK-006 and the promotion ceiling unchanged. NEXT: WS-11-T007 (Security/Concurrency Verification) NOT STARTED.
>
> **2026-08-06 (close) — WS-11-T006 PARTIAL — SUCCESSOR PACKAGE REQUIRED.** P01 (governed replacement/cutover, cloud 0179 + Hub 0037) and P02 (encrypted verified backup/restore with restore quarantine, ownership replay and the pre-existing restore defect fixed forward) are IMPLEMENTED-IN-DEV with executed evidence. P03/P04 (signed release authority; A/B install/health/rollback) NOT STARTED and not claimed; successor runs §15–§27 of the T006 master prompt from slots 0180/0038 under the LOCKED owner decision. T007/T008 NOT STARTED. Fence, BLK-005/BLK-006 and the promotion ceiling unchanged.

> **2026-08-06 — WS-11-T006 AUTHORIZED AND RULED.** KLD-2026-08-06-WS11-T006-001 (OWNER-APPROVED — LOCKED) fixes replacement identity, recovery truth, backup defaults, release trust (manifest v1 / SHA-256 / Ed25519 / Internal→Pilot→Stable), the development health gate (5 min / 20 s / 3 probes / one rollback) and configuration publication. Pilot/Stable stay BLK-005 fail-closed. Intake observation: the origin push url was found restored and the disabled posture was re-established (recorded in the decision register); nothing pushed.

> **2026-08-06 (later) — WS-11-T005 COMPLETE — IMPLEMENTED-IN-DEV (P02).** The reporter runtime closed the PARTIAL condition below: a real terminal heartbeat reaches the Hub over mTLS, the Hub derives local health on the owner-locked timing, the outbox persists reports durably, and cloud ingestion reconciles them idempotently — all proven by executed suites (terminal-health 8/8, ingestion 2/2, cloud db:test 369, hub:db:test 40). Cloud 0178 / Hub 0036; RBAC amendment 001 (109 keys); audit amendment 001. The recorded pairing race-A result-code finding belongs to the pairing surface (T004/T007), registered not patched. The fence, BLK-005/BLK-006 and the IMPLEMENTED-IN-DEV ceiling are unchanged; T006–T008 NOT STARTED.

> **2026-08-06 — WS-11-T005 PARTIAL — SUCCESSOR PACKAGE REQUIRED.** Cloud group 0177 and Hub group 0035 deliver the fleet operational-control AUTHORITY end to end in development: Hub-authoritative local terminal health with offline containment enforcement; the cloud health projection ordered by the Hub's report sequence with explicit freshness that fails closed; policy-§3 support sessions (ticket always, consent C2+, verified four-eyes C3+, clamp, immediate revocation, clock-fail-closed expiry); governed containment/recovery composing the 0120/0122 lifecycle with four-eyes throughout; the `fleet_health_read` read model with four separate truth labels; and the KLRISK-DEVICE-002 runbook + §10 condition-4 door (**risk RESOLVED-IN-DEV**, independent verification with T007/T008). Focused gates: db:test exit 0 (235 PASS incl. 55a–d), test:rls 133, hub:db:test 39, hub-agent 28/28 + typecheck, secret:scan 1364 clean. **PARTIAL because the Hub-agent health REPORTER (heartbeat derivation, /edge/v1 heartbeat surface, outbox event kind) is not built** — the cloud door it would feed is; nothing scaffolded is claimed implemented. The fence, BLK-005/BLK-006 posture and the IMPLEMENTED-IN-DEV ceiling are unchanged. T006–T008 NOT STARTED.

> **2026-08-06 — WS-11 remaining task register RULED (KLD-2026-08-06-WS11-REMAINING-TASKS-001).** The title-resolution blocker recorded by the T004 closeout and the 2026-08-06 discovery record is CLOSED. The four remaining tasks, order and count unchanged: **T005 Device Fleet Health, Support Access and Incident Containment** (owns KLRISK-DEVICE-002 implementation); **T006 Store Hub Replacement, Recovery and Signed Release Lifecycle**; **T007 Device Security, Offline, Recovery and Concurrency Verification** (owns the recorded race debts); **T008 Independent WS-11 Review, Evidence Reconciliation and Closeout** (owns the T001/T002 review backfill). Step 8 (production signing-key custody) stays BLK-005-blocked and belongs to no agent task. Canonical cards: `00_AI_HANDOFF/tasks/WS-11-T005.md`..`WS-11-T008.md`. The Cycle-10 fence, the BLK-005 gate and the IMPLEMENTED-IN-DEV promotion ceiling are unchanged.

Cycle 10 is authorized for **WS-11 device provisioning and fleet management
only**.

### The locked provisioning model (KLD-2026-07-21-003, OWNER-LOCKED)

WS-11 must PRESERVE this chain. No step may be skipped, reordered or inferred:

    Digital Store
      -> registered Store Hub hardware
        -> certificate-backed activation
          -> Location assignment
            -> terminal assignment
              -> signed configuration
                -> offline local authority

### Dependency order

1. Hardware manufacturing and internal enrollment records.
2. Device identity and certificate trust chain.
3. Raspberry Pi Store Hub claim and activation.
4. Tenant, Digital Store and Location assignment.
5. Assignment-generation issuance and revocation.
6. Terminal T1-T4 assignment.
7. Certificate rotation, expiry and revocation.
8. Production signing-key custody for WS-10.
9. Signed configuration and release trust.
10. Device health, fleet status and support access.
11. Hub replacement, NVMe replacement and recovery.
12. Release-channel eligibility and rollback authorization.
13. Security, offline, recovery and adversarial tests.
14. Independent review and evidence.

**Explicitly OUT of scope:** T1-T4 APPLICATION INTEGRATION. It does not begin
until WS-11 proves real certificate identity, assignment enforcement,
revocation, replacement and production signing-key custody. Also out: new
business workflows, a second finance ledger, and silent conflict resolution of
any kind.

**Maximum justified promotion at the end of Cycle 10: WS-11
IMPLEMENTED-IN-DEV.** Not INTEGRATION-VERIFIED, not pilot-ready, not
production-ready.

**Blocked on owner values.** BLK-005 (PKI root/CA design, HSM/secure-element
model, certificate windows) is OPEN. Step 2 and step 8 cannot be completed
without it. Those parts stay `[REQUIRED: ...]` and fail closed rather than
being guessed — the same discipline that kept WS-10 from inventing a
production batch signer.

### The BLK-005 hard gate (owner-directed, 2026-07-28)

Work proceeds around BLK-005, not through it. The gate is a single point:

    kitluy_devices.pki_trust_configuration        -- created EMPTY, never seeded
    kitluy_devices.assert_pki_configuration_approved(environment)
      -> KLUY-DEVICE-PKI-UNCONFIGURED: [REQUIRED: ...] — BLK-005 is OPEN

**Allowed before BLK-005:** manufacturing and internal-enrollment records;
immutable KitLuy device identifiers; hardware-evidence inventory; enrollment,
quarantine, retirement and replacement state machines; Digital Store and
Location assignment models; assignment-generation issuance and revocation;
terminal assignment; device health and fleet-status models; audit events,
permissions and approval requirements; replacement and recovery workflows;
abstract PKI, attestation and signing-provider interfaces; fail-closed tests.

**Blocked by BLK-005 — not implemented, not claimed:** production root or
intermediate CA; production certificate issuance; final certificate lifetimes
and renewal windows; production revocation distribution; hardware-backed
private-key custody; production configuration or release signer; production key
rotation; production Store Hub activation; WS-10 production signer availability.

**Owner-fixed identity model.** Immutable `device_record_id` + manufacturing
enrollment record + device public-key fingerprint + hardware evidence +
storage-module evidence + assignment generation + certificate status. The
primary identity is **never** derived by hashing MAC address, storage serial and
board identifiers. Those are binding and tamper signals; a changed signal
quarantines the device and requires governed re-enrollment, and never silently
creates an unrelated device identity.

**Owner-fixed NVMe replacement order.** Old certificate revoked -> old
assignment generation invalidated -> replacement recorded by an authorized
internal operator -> new key pair generated -> new certificate issued -> new
evidence captured -> device reactivated through the normal approval flow.
Private keys are never copied from the damaged storage device.

### Status boundary while BLK-005 is open

    WS-11                 — SCAFFOLDED / IN PROGRESS
    BLK-005               — OPEN (ballot: docs/decisions/kitluy-blk-005-pki-and-device-trust-owner-ballot-v1.0.0.md)
    Production activation — BLOCKED
    Production signer     — BLOCKED

Individual tasks may be completed and committed with evidence. **WS-11 cannot
become `IMPLEMENTED-IN-DEV` until the approved cryptographic design is
implemented and independently tested.**

**T001 complete 2026-07-28** — cloud migration group 0120 (`kitluy_devices`, 11
relations), `@kitluy/device-identity`, 11 assertion sections, 5 RLS cases, 24
package tests, and the BLK-005 ballot. Evidence
`docs/evidence/phase1/ws-11/WS-11-T001-EXECUTION-EVIDENCE.md`.

**WS-11-T003 Step 2 — trusted time: IMPLEMENTED-IN-DEV (2026-07-28).** Independent
review APPROVED-WITH-CONDITIONS
(`00_AI_HANDOFF/reviews/2026-07-28__WS-11-T003-STEP2-TRUSTED-TIME__REVIEW.md`).
One HIGH blocking finding (RV-TT-001) was found by attack, fixed and regressed.
**This promotion covers Step 2 ONLY.** Steps 4-8 of T003 remain open, and
WS-11 overall stays SCAFFOLDED / IN PROGRESS.

**T002 complete 2026-07-28** — cloud migration group 0121 (claims, assignments,
terminal assignments, offline projection, claim audit), the `awaiting_trust`
lifecycle state, 5 assertion sections, 4 RLS cases, 29 package tests. The two
owner-required residual controls are closed STRUCTURALLY: KLRISK-DEVICE-001 by
`attempt_activate_device_v1` plus revocation of the raising form, and duplicate
hardware evidence by refusing activation, claim creation and claim redemption
while holding BOTH identities. Evidence
`docs/evidence/phase1/ws-11/WS-11-T002-EXECUTION-EVIDENCE.md`.

### The activation boundary is now a state machine, not a convention

    claim accepted -> identity and scope bound -> assignment created
      -> device remains awaiting_trust
        -> BLK-005 configuration required -> certificate issuance -> activation

`enrolled -> active` was REMOVED from the device lifecycle transition matrix in
group 0121. `active` is reachable only from `awaiting_trust`, which is reachable
only through an accepted claim and a bound assignment. A caller cannot route
around the chain, and the TypeScript matrix in `@kitluy/device-identity` carries
a test asserting the same thing so the two cannot drift apart silently.

**BLK-005 must be ruled before T003.** Certificate issuance, signer custody and
production activation do not begin until the twelve-item ballot is approved. The
owner's most urgent items: PKI hierarchy and environment separation; root and
intermediate CA custody; device key generation and secure storage; configuration
/ release / WS-10 transport signer separation; trusted-time behaviour on offline
Pi hardware; revocation during extended WAN outages; NVMe and complete-device
replacement policy; production signer four-eyes access.

**Trusted time (G12) is a hard security dependency, not an implementation
detail.** Until an RTC, an authenticated time bootstrap and a rollback-resistant
time floor are approved, an offline Hub cannot reliably prove that a certificate
is currently valid. The owner has specified the minimum as **all three sources,
not a choice between them**, with certificate validation taking the MAXIMUM of
RTC time, authenticated time and the persisted floor, and trusted time never
moving backwards. Ballot item 11 carries the six required behaviors.

### BLK-005 RULED 2026-07-28 — KLD-2026-07-28-002

Decision record:
`docs/decisions/kitluy-blk-005-pki-and-device-trust-owner-decision-v1.0.0.md`

    BLK-005 decision values                 RESOLVED
    BLK-005 implementation                  PENDING
    WS-11-T003                              AUTHORIZED TO BEGIN
    development certificate implementation  AUTHORIZED
    pilot activation                        BLOCKED (hardware + signer evidence)
    production activation                   BLOCKED (implementation + security evidence)
    WS-10 production signer                 BLOCKED (signer implementation + evidence)
    WS-11                                   SCAFFOLDED / IN PROGRESS

**T003 must not claim production readiness.** The approved values are an
architecture, not evidence that a CA exists, a key is in an HSM, a Hub has a TPM
or an RTC, or that anything has been issued or activated.

**Two sub-gates survive the ruling and no agent may close them:**

1. **§4 hardware SKU.** Pilot and production HARDWARE certification stay blocked
   until a specific TPM 2.0 or secure-element SKU is selected and certified in
   the production BOM. The ruling explicitly does NOT block the provider
   interface, lifecycle or test doubles — so T003 builds against the interface
   and `production_eligible` stays false with no path to true.
2. **§10 KLRISK-DEVICE-002.** Stays OPEN until the restricted-investigation
   state, station containment and the runbook are implemented and independently
   tested.

**The ruling CONTRADICTS behavior already shipped in T001 and T002** — in
incumbent containment, NVMe identity retention, board/TPM replacement identity,
the number of signing purposes, and the certificate windows. Those corrections
are owed by T003 and are itemized in the decision register. The shipped
duplicate-evidence behavior is MORE restrictive than the ruling, so it fails
safe in the interim, but it is not the approved policy and must not be described
as such.

### WS-11-T003 Step 4 position (2026-07-30) — the fence is unchanged

Step 4 (governed credential revocation) has completed Phases A–E. Migrations
0148–0154 are applied LOCALLY ONLY. Three independent reviewers returned
`APPROVED-WITH-CONDITIONS` with no CRITICAL code-blocking findings.

**Gate result: IMPLEMENTED-IN-DEV WITH RECORDED ENVIRONMENT CONDITION.**
The DB path, concurrency/containment evidence, and library adapters are
promoted as in-dev capability. **`RevocationGateway` is NOT production-wired**
(RV-GW-001 — library-available-but-uncalled). Offline Hub snapshot join and a
production TS lapse worker are also NOT claimed. WS-11 overall stays
SCAFFOLDED / IN PROGRESS. T004–T008 not started.

**Carried from Cycle 9.** KLREQ-029 and KLREQ-030 may remain open during core
WS-11 work, but they MUST be resolved before any synchronization-repair action
is exposed through Admin, Partner, Chain or support interfaces. KLREQ-024 and
KLREQ-028 remain open, so no complete T1-T4 lifecycle may be claimed.

## 9. Repository push control (2026-07-28, KLRISK-REPO-001)

The `origin` PUSH url is deliberately disabled:

    origin  https://github.com/Soenghak3301/HET-KITLUY-PROJECT.git (fetch)
    origin  disabled://push-requires-owner-approval               (push)

Cycle 9 observed commits reaching `origin/main` without an explicit push being
issued, and the mechanism was never identified. Until it is, **"committed but
not pushed" is not a containment boundary.**

An authorized push is a four-step operation, and every step is the owner's call:

1. restore the real push url,
2. push,
3. verify `git rev-parse HEAD` equals `git rev-parse origin/main`,
4. disable the push url again.

No agent restores the push url without an explicit owner instruction naming the
push it is for. Fetching is unaffected.

## 8. Cycle-9 scope fence — WS-10 only (2026-07-27)

Cycle 9 is authorized for **WS-10 synchronization and configuration publication
only**, and only after the seven WS-10-critical decisions are ruled (ballot:
`docs/decisions/kitluy-ws10-prerequisite-decisions-owner-review-v1.0.0.md`).

**Gate status 2026-07-28: SATISFIED.** All seven decisions were ruled by
KLD-2026-07-28-001, and the last remaining reconciliation (C26, the delivery-
and conflict-state model) was resolved by amendment KLD-2026-07-28-001-A01.
**WS-10 is authorized to begin.** Cycle 9 must additionally honor the amendment:
delivery state carries `pending`, `in_flight`, `retry_wait`, `acknowledged`,
`rejected`, `dead_letter`; `reconciliation_required` is an ORTHOGONAL conflict
state and is never folded into the delivery enum; enum alignment happens by
ADDITIVE forward migration; external status comes from ONE shared projection
with conflict override taking precedence; and a delivery worker may never
independently clear `reconciliation_required`.

**In scope:** Hub outbox selection → signed cloud transmission → idempotent
cloud ingestion → acknowledgement recording → retry and backoff → dead-letter
handling → rejection handling → reconciliation-required state → configuration
snapshot publication → snapshot activation and rollback → sync cursor recovery
→ observability and operator repair.

**Explicitly OUT of scope:** WS-11 device provisioning; T1–T4 application
clients; any new production-stage business semantics; a second finance ledger;
and silent conflict resolution of any kind.

**Maximum justified promotion at the end of Cycle 9: WS-10
IMPLEMENTED-IN-DEV.** That does not make the Store Hub system pilot-ready or
production-ready, and it does not by itself establish a complete T1→T4
lifecycle — which additionally requires KLREQ-024 and KLREQ-028.

**Carried trust boundary:** database credentials are a trust boundary
(KLRISK-HUB-003) — raw SQL bypasses command-layer engine authority. Any WS-10
component with direct database access is trusted infrastructure, not a client.

**Deferral condition:** KLREQ-024 and KLREQ-028 may remain open only if WS-10
explicitly excludes Laundry production-stage synchronization. If WS-10 syncs
production stages, both must be ruled first.

## 7. Cycle-6 execution boundary (2026-07-27)

Cloud-side authoritative persistence for the Laundry Booking aggregate,
garment identity and custody, payments/refunds/reconciliation and the finance
subledger is **IMPLEMENTED-IN-DEV** on the LOCAL development stack (WS-07,
WS-08; independent review APPROVED-WITH-CONDITIONS). This does **not** move
the phase fence and specifically does **not** imply:

- Store Hub local runtime or Hub-authoritative persistence (WS-09) — SCAFFOLDED;
- configuration publication or cloud/Hub synchronization (WS-10) — SCAFFOLDED;
- device provisioning or fleet management (WS-11) — BLOCKED (BLK-005);
- T1–T4 authoritative interfaces or Edge/Hub mutation routes — SCAFFOLDED and
  BLOCKED by BLK-003 (Cycle-7 update: the KL-DEC-001 ballot was
  OWNER-APPROVED 2026-07-27, so BLK-003 is APPROVED-PENDING-IMPLEMENTATION —
  the decision blockage is lifted, but Hub/Edge mutation routes stay
  fail-closed until the contract alignment is implemented, tested,
  independently reviewed and evidence-linked);
- offline operation, live KHQR provider integration (PAY-OD-001/BLK-006),
  cloud deployment, pilot operation or production application
  (KL-INF-P1-037 remains OWNER-LOCKED: production migrations are
  human-operated under four-eyes, never automatic).

The T1–T4 role boundaries in §2 are unchanged and were encoded as executable
database constraints this cycle (T2 can never emit custody; Ready scan-in is
T3-only; pickup release is T4-only and requires collector verification,
release completeness and settled balance or an approved exception).
