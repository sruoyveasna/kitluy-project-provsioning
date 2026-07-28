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

## 10. Cycle-10 scope fence — WS-11 only (2026-07-28)

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
