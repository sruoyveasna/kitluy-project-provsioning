# KitLuy Open Decisions and Required Values — v1.0.0 (working pointer)

**The canonical register is the owner original:**
[`docs/source/canonical/kitluy-open-decisions-and-required-values-v1.0.0.md`](../source/canonical/kitluy-open-decisions-and-required-values-v1.0.0.md)
(v1.0.0 · 2026-07-26 · HET / Project Owner · CANONICAL OPEN-VALUE REGISTER —
15 open decisions OD-001..015, 730 deduplicated REQ-#### keys, 827-occurrence
ledger, closure-state model OPEN → OPTIONS-PROPOSED → OWNER-APPROVED →
CONFIGURED-*). It is kept as a single immutable copy because of its size
(2.2 MB); this working file adds repository deltas without duplicating it.

## Repository addendum — KL-DOCS-001 (not part of the owner original)

### Staleness note (KLREC-2026-07-26-005)

The owner register's scan predates Rebuild Bible v4.0.0 / Business Bible
v2.0.0 (343 of 827 ledger occurrences cite the superseded ecosystem business
bible v1.0.0; 49 cite rebuild bible v3.0.0). OD-001/OD-002 (publish the v4/v2
bibles) are now satisfiable — both bibles are physically present. A rescan
against the current corpus is a registered follow-up owner task.

### Engineering-milestone blockers (bootstrap register, still open unless noted)

| ID | Required value / decision | State after KL-DOCS-001 |
| --- | --- | --- |
| KLREQ-001 | Supabase schema + RLS + migration plan v1.0.0 | STILL OPEN — pack of 10 ingested, but `kitluy-suite-supabase-schema-v1.0.0.md`, `-rls-and-authorization-`, `-migration-plan-` are missing (each pack member cites them as higher authority) |
| KLREQ-002 | Reconciled `/edge/v1` route contract | STILL OPEN — the fork now exists between two ingested docs (storehub-lan-api vs edge-operations-api); see KLREC-2026-07-26-001 (updated) |
| KLREQ-003 | Laundry Booking + production state machines | **SATISFIED (SPECIFIED)** by `kitluy-laundry-state-machines-v1.0.0.md` + `kitluy-transaction-and-booking-lifecycle-v1.0.0.md` |
| KLREQ-004 | Hub local-schema naming | PARTIALLY RESOLVED — `kitluy-storehub-local-database-schema-v1.0.0.md` defines schema-qualified singular names (edge_laundry.booking_line, custody_event…), a third style; cross-layer naming drift recorded in KLREC-2026-07-26-002 (updated) |
| KLREQ-005 | Feature registry .md/.json | STILL OPEN (CSV only) |
| KLREQ-006 | store-hub managed-device-security lock spec | STILL OPEN (not found) |
| KLREQ-007 (new) | Owner documentation-program instruction (`Pasted text.txt` → kitluy-ai-build-readiness-document-program-v1.0.0.md) | OPEN — file not physically present in the inbox at ingestion |

### Batch-2 additions (KL-DOCS-002)

| ID | Required value / decision | State |
| --- | --- | --- |
| KLREQ-008 | `kitluy-testing-and-evidence-system-v1.0.0` — cited as source_document by 41 of 524 test-registry cases; not physically present anywhere | OPEN — supply or re-source (KLREC-2026-07-26-018) |
| KLREQ-009 | Owner confirmation of the engineering-pack toolchain (`selected_versions`) as the target, and approval of the coordinated upgrade task KL-ENG-001 (Node 24 / pnpm 11 / TS 6 / React 19 / RN 0.86+Expo 57 / Electron 43 / tool-versions.json / tsconfig flags) | OPEN (KLREC-2026-07-26-014/-019) |
| KLREQ-010 | AI Swarm Operating System adoption decision: replace repo-root governance + handoff system with the pack, map handoff/evidence vocabularies onto the 11-status model, migrate existing handoff records | OPEN (KLREC-2026-07-26-015/-020) |
| KLREQ-011 | Canonical security test plan selection/merge (batch-1 phase1 plan vs batch-2 plan, incompatible ID namespaces) | OPEN (KLREC-2026-07-26-017) |

### Repository-level required values (bootstrap section F, unchanged)

Legal entity for LICENSE · security contact (SECURITY.md) · conduct contact ·
GitHub organization/handles · canonical ID format · minimum API deprecation
window · approved brand tokens / Khmer font strategy (provisional values now
exist in `kitluy-design-token-registry-v1.0.0.json`) · dependency-audit
triage policy.
