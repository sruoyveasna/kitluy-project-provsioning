# WS-12-T003 — Service, Garment, Evidence and Custody Intake — Readiness

**Filename:** `2026-08-07__SHARED__WS-12-T003__SERVICE-GARMENT-EVIDENCE-AND-CUSTODY-INTAKE__READINESS.md`
**Version:** v1.0.0 · **Date:** 2026-08-07 · **Owner:** HET / KitLuy Suite Project Owner
**Status:** **T003 NOT STARTED — BLOCKED ON MISSING OWNER PACKAGE**
**Authority:** IMPLEMENTATION-EVIDENCE (register read; donor analysed read-only)
**Evidence status:** OBSERVED — no T003 implementation was written

## 1. Authoritative T003 scope — read, not invented

From `KLD-2026-08-06-WS12-TASKS-001`
(`docs/decisions/kitluy-ws12-t1-intake-cashier-task-register-owner-decision-v1.0.0.md`):

| Field                   | Value                                             |
| ----------------------- | ------------------------------------------------- |
| Task ID                 | `WS-12-T003`                                      |
| **Authoritative title** | **Service, Garment, Evidence and Custody Intake** |
| Position                | 3rd of 8, order and count LOCKED                  |
| Status in register      | NOT STARTED                                       |

Plus the register's **§2 composition rule (LOCKED)** and **§3 boundaries**:

- Booking truth stays with the **WS-07 Booking aggregate**; T1 composes it through the governed Store Hub command surface, never direct database access.
- Pricing truth stays with **WS-05** catalog/pricing authorities and signed configuration snapshots.
- Customer identity and consent truth stays with **WS-06**.
- Audit truth stays append-only under **WS-04**; T1 emits events, it does not own an audit store.
- Payment/deposit truth stays with **WS-08** and `@kitluy/money`.
- The Store Hub is never bypassed; T1 terminals do not write to Supabase.
- Installer and user can never select or override Tenant, Digital Store, Location, Hub, environment, terminal profile or assignment generation.
- BLK-005 / BLK-006 remain fail-closed.

Confirmed by T002's own package, whose **"Explicitly out"** reads: _"Services,
garments, evidence, pricing, due time, payment, receipt, tag issuance
(**T003–T005**); draft→Booking conversion; …"_

## 2. Why T003 could not be executed

> **No `WS-12-T003` owner package exists.**

| Task     | Per-task LOCKED owner decision                                                                           | Task file                           |
| -------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| T001     | `kitluy-t1-hub-bootstrap-route-and-session-owner-decision-v1.0.0.md`                                     | —                                   |
| T002     | `KLD-2026-08-06-WS12-T002-001` — `kitluy-t1-customer-consent-and-booking-draft-owner-decision-v1.0.0.md` | `00_AI_HANDOFF/tasks/WS-12-T002.md` |
| **T003** | **NONE**                                                                                                 | **NONE**                            |

`docs/decisions/` contains exactly one WS-12 document — the task register
itself. `00_AI_HANDOFF/tasks/` contains `WS-12-T002.md` and no T003 equivalent.

The register supplies T003's **title** and the shared composition rule and
boundaries. It does **not** supply what T001 and T002 each received:

- **Objective** — the specific behaviours in scope
- **Owned files** — which Hub and cloud migrations this task may author
- **Explicitly out** — the boundary against T004/T005
- **Truth model** — what is cloud-authoritative vs Hub-authoritative for services, garments, evidence and custody, and the freshness labels
- **Status gate** — the acceptance condition
- **Rollback** — the revert and replay procedure
- **Status ceiling**

Owner decision 2026-08-07 §8 is explicit: _"Do not invent the T003 title or
acceptance criteria. Read them from the authoritative task register."_ The title
is there; the acceptance criteria are not.

**Inventing them would decide business-critical semantics** — what custody
means, what evidence is immutable, which store holds garment truth, and which
migrations may be authored. Those are exactly the choices the composition rule
reserves to owner authority.

## 3. What T003 will need — read-only donor analysis (§9 permits)

Donor: `kitluy-laundry-pos-desk-app@d5d1a26`. **Read-only. Nothing wired in.**

### 3.1 Coverage of the four named subjects

| T003 subject | Donor evidence                                                                                                                                                                                              | Assessment                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Service**  | `service` 101 files / `Service` 64; `data/catalog/{catalog-read(+test),catalog-repository}`; `lib/serviceCatalog.ts`, `serviceCode.ts`; `laundry-savor/ServiceCategoryPicker.tsx`, `ItemCustomizeModal.tsx` | **Strong donor material**   |
| **Garment**  | `garment` 38 files / `Garment` 24; `laundry-savor/GarmentScanStepper.tsx`; `data/laundry/lifecycle-repository.ts`                                                                                           | **Strong donor material**   |
| **Evidence** | `evidence` **0 files**; `photo` 1; `condition` **0**                                                                                                                                                        | **NO donor implementation** |
| **Custody**  | `custody` **0 files**                                                                                                                                                                                       | **NO donor implementation** |

> **Half of T003 has no donor to migrate.** Evidence capture and custody intake
> must be built against canonical contracts. The canonical
> `verticals/phase1-laundry/src/custody-events.ts` is the starting authority,
> not the donor.

### 3.2 Donor assets most relevant to T003

```text
src/features/t1-pos/laundry-savor/
├── LaundryBookingWorkspace.tsx     Booking workspace shell
├── LaundryBookingCartLines.tsx     Booking lines
├── GarmentScanStepper.tsx          garment scan intake
├── ServiceCategoryPicker.tsx       catalog Service selection
├── ItemCustomizeModal.tsx          per-item options
├── WfKgWheelPicker.tsx             wash & fold weight entry
└── wfKgConstants.ts

src/features/t1-pos/new-order/
├── Step0Customer → Step1Items → Step2Pricing → Step3Review
└── orderWizardGate.ts (+ test)     step gating

src/features/storage/ (15 files)    slot board, scan, assign dialog
```

### 3.3 Vocabulary state in the donor

The donor **already mixes both models**: `laundry-savor/` uses
`LaundryBooking*`, `BookingLookup`, `BookingDetail`, while `new-order/` and
`OrderQueue`/`OrderDetail` use Order. Under
`KLD-2026-08-07-BOOKING-SEMANTICS-001` §4 each legacy `Order` use must be
classified before any port — it is **not** a blanket rename.

Applying §2 of that decision: `ServiceCategoryPicker` and `serviceCatalog` map
to the **catalog Service** layer; `LaundryBookingCartLines` maps to **Booking
lines with service snapshots**; `data/orders` requires §4 classification.

### 3.4 Data boundary

Every donor unit above reaches Supabase directly. Per owner decision §20 and
`CLAUDE.md` hard rule 6, T003 must extract UI, workflow, validation, domain
logic and calculations, then **replace legacy persistence with the Store Hub /
Edge boundary**. Marked `REWRITE-DATA-BOUNDARY`.

### 3.5 Suite donor

`kitluy-suite-pos-desk-app` offers nothing T003-specific — its `features/`
contains only `auth` and `terminals`. Shared UI primitives are T007 material.

## 4. What was completed this cycle instead

| Item                                   | Result                                                               |
| -------------------------------------- | -------------------------------------------------------------------- |
| `KLDRV-CONF-001` resolved and recorded | `KLD-2026-08-07-BOOKING-SEMANTICS-001`                               |
| Blocker register reconciled            | `000_BLOCKERS.md`                                                    |
| Vertical derivation reclassified       | `TEMPORARY-COMPATIBILITY-DERIVATION` + `KLREQ-VERTICAL-ENVELOPE-001` |
| Fail-closed disagreement protection    | Retained and additionally test-pinned                                |
| Resolver tests                         | 16 → **19 PASS**                                                     |
| T003 authoritative scope               | Read and recorded (§1)                                               |
| T003 donor analysis                    | Complete, read-only (§3)                                             |

## 5. What T003 needs to start

1. **An owner package for T003** — objective, owned files, explicitly-out, truth model, status gate, rollback, status ceiling, in the form T001 and T002 received.
2. Specifically, owner rulings on:
   - **Custody truth model** — Hub-authoritative, cloud-authoritative, or projected with freshness labels?
   - **Evidence immutability** — what is captured at intake, and what makes it immutable (there is no donor precedent).
   - **Service snapshot boundary** — T003 snapshots the Service, but pricing is T004; where exactly does the snapshot stop?
   - **Owned migrations** — which Hub and cloud migration numbers T003 may author.

## 6. Status

```text
WS-12-T003  NOT STARTED — blocked on the missing owner package
WS-12-T004  NOT STARTED — sequence-locked behind T003
```

No T003 implementation was written. No later task was started or marked
complete. The locked sequence is intact.
