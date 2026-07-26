# KitLuy Source Conflict Report — v1.0.0

Task KL-DOCS-001, 2026-07-26. Every conflict found while ingesting the
owner-supplied corpus. Register of record: the KLREC series in the working
decision-and-reconciliation register
([docs/authority](../../../authority/kitluy-decision-and-reconciliation-register-v1.0.0.md)).
Nothing here was silently resolved.

## High severity

### 1. `/edge/v1` route fork persists inside the new corpus (KLREC-2026-07-26-001, updated)

`kitluy-storehub-lan-api-v1.0.0.md` (Store LAN surface, port 7443) and
`kitluy-edge-operations-api-v1.0.0.md` both claim canonical authority over
`/edge/v1` with incompatible shapes:

| Function        | LAN API doc                          | Edge Operations API doc                      |
| --------------- | ------------------------------------ | -------------------------------------------- |
| Staff session   | `POST /sessions/open`                | `POST /sessions/login`                       |
| Intake finalize | `POST /bookings/{id}/confirm-intake` | `POST /laundry/bookings/{id}/finalize`       |
| T3 sessions     | `POST /ready-scan/sessions`          | `POST /laundry/ready-sessions`               |
| T4 completion   | `POST /pickup-scan/{sid}/complete`   | `POST /laundry/pickup-sessions/{id}/release` |
| T2 display      | `POST /display-sessions`             | `POST /displays/sessions`                    |

Neither document references or supersedes the other; the owner reconciliation
register (RC-001..012) has no entry for it. This continues the Hub-spec vs
POS-spec fork found at bootstrap. **Consequence:** Hub LAN business routes
remain blocked in code (`services/kitluy-hub-agent/src/lan-api.ts`).
**Resolution required:** a versioned owner decision selecting or merging one
shape.

### 2. Supabase pack missing its three highest-authority members

All 10 shipped pack files rank `kitluy-suite-supabase-schema-v1.0.0.md`,
`kitluy-suite-supabase-rls-and-authorization-v1.0.0.md` and
`kitluy-suite-supabase-migration-plan-v1.0.0.md` above themselves; none of the
three was shipped, and no SQL migrations exist. The pack cannot be
CONTRACT-APPROVED without them (KLREQ-001 stays open).

## Medium severity

### 3. Custody-concept naming drift across four layers (KLREC-2026-07-26-002, updated)

Cloud (`kitluy_laundry.garments`, `garment_scan_events`,
`ready_storage_positions`, `pickup_handoffs`) vs Hub-local
(`edge_laundry.garment`, `custody_event`, `storage_position`,
`pickup_session`) vs the two `/edge/v1` API vocabularies. The glossary does
not resolve the API-level pair.

### 4. Terminal-profile identifier mismatch (KLREC-2026-07-26-009)

POS Desktop spec v4.0.0 §13.5: `t1_intake_cashier`, `t2_customer_display`,
`t3_ready_scan_in`, `t4_pickup_scan_out` (implemented + tested in
`verticals/phase1-laundry`). Terminal-profile contract v1.0.0: device-profile
codes `laundry_front_counter`, `laundry_ready_pickup`, `laundry_t1..t4`;
LAN API example uses `"requested_profile": "laundry_t1"`. The four-role
semantics are identical; only identifiers diverge. Code unchanged pending
owner reconciliation.

### 5. Error-code registry vs POS spec §14.3 (KLREC-2026-07-26-010)

Registry (~51 codes) replaces `BOOKING_VERSION_CONFLICT` with generic
`RESOURCE_VERSION_CONFLICT` and `DUPLICATE_IDEMPOTENCY_KEY` with
`IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST`. `@kitluy/api-errors`
currently implements the POS-spec names; alignment is a follow-up code task
once the owner confirms registry precedence.

### 6. Event-name format (KLREC-2026-07-26-011)

Domain-event registry canonicalizes unversioned `<context>.<fact>` names
(16 events, e.g. `garment.custody_scanned_in`) and demotes `.v1` forms to
compatibility aliases; `@kitluy/event-contracts` enforces the versioned
format from POS spec §15.2.

### 7. Control pack written against a pre-bible bundle (KLREC-2026-07-26-005)

PROJECT_HOME §2, SOT-010/011, SUP-001/002 and OD-001/002 all state the v4/v2
bibles are missing; both are physically present (content-identical to the
bootstrap imports). Working copies at `docs/authority/` carry the correction;
owner row updates proposed.

### 8. SOT-027 indexes a file that does not exist (KLREC-2026-07-26-006)

`kitluy-owner-decision-lock-12-capabilities-v1.0.md` is indexed as an active
owner-decision source; not found machine-wide. Content survives in RB v4
§11.2.

## Low severity

### 9. Pack-flattening damage (KLREC-2026-07-26-007)

61 declared-vs-physical size/hash discrepancies across the three in-corpus
pack manifests (files regenerated after their manifests were written), and
the security pack's declared `README.md` (890 B) was overwritten by the API
pack index (707 B). Inventory: `docs/source/manifests/kitluy-inbox-inventory-v1.0.0.md`.

### 10. Scope taxonomy and permission-key drift (KLREC-2026-07-26-012/-013)

`tenant`/`device` (+ `chain`, `file_object`, `support_session`,
`release_cohort`) vs RB v4 §8.5 `tenant_or_partner`/`individual_device`;
`releases.promote_stable` vs `releases.promote.stable`.

### 11. Same-name/different-hash bible copies (RESOLVED)

Verified content-identical (formatting-only); imported copies registered as
DUPLICATE-FORMATTING-VARIANT (KLBOOT-DEC-009).

## Invariant check

**No ingested document contradicts any owner-locked invariant** (T1–T4 with
T2 non-production, Store Hub local authority / no direct POS→Supabase writes,
DO Spaces as primary heavy-file store, eight-phase vertical order, Digital-
Store-first, append-only finance/custody/audit, no floating-point money,
KHQR provider evidence, no reporting paywall).

---

# Batch 2 addendum (KL-DOCS-002, 2026-07-26)

## High severity

**12. Wholesale toolchain divergence (KLREC-2026-07-26-014, -019).** The
engineering-standards pack pins a toolchain (Node 24 / pnpm 11 / TS 6 /
React 19 / RN 0.86 / Expo 57 / Electron 43 / Terraform =1.15.5 + required
`tool-versions.json`, `skipLibCheck:false`, `moduleResolution:Bundler`) that
conflicts with every current repo pin (ADR-0001/0002). The repo's ADRs
pre-declare that recorded higher-authority choices win — a coordinated
upgrade task (proposed KL-ENG-001) is required; nothing was changed during
ingestion.

**13. AI Swarm OS adoption undecided (KLREC-2026-07-26-015).** The pack would
replace repo-root governance (AGENTS/CLAUDE/PROJECT_HOME/handoff system) with
a heavier, structurally incompatible system; its own state files are honestly
UNVERIFIED against this repository. Adoption requires an owner decision plus
a migration task for the existing handoff records and evidence vocabulary
(swarm PLANNED..PRODUCTION_VERIFIED vs adopted 11-status model,
KLREC-2026-07-26-020).

## Medium severity

**14. Monorepo blueprint vs reality (KLREC-2026-07-26-016)** — four
load-bearing structural divergences (tooling/ vs scripts/, vertical placement,
future-clients rule, package vocabulary) plus dead CODEOWNERS paths.

**15. Duplicate canonical security test plans (KLREC-2026-07-26-017)** and
**missing `kitluy-testing-and-evidence-system-v1.0.0`
(KLREC-2026-07-26-018 / KLREQ-008)** — 41 of 524 registry cases trace to a
document that does not exist.

## Verified non-findings

Secrets inventory: references only, zero values. Domain/DNS plan: all
`[REQUIRED]` placeholders, no real domains. Environment matrix == repo
`KITLUY_ENVIRONMENTS` exactly. CI/CD + database runbook + swarm pack all
REINFORCE KL-INF-P1-037 (no auto-applied production migrations, "never by an
AI agent"). QA offline pack extends (never contradicts) the repo's tested
hub-agent harness. **No batch-2 document contradicts any owner-locked
invariant.**
