# KitLuy Canonical Corpus Summary — v1.0.0

Generated summary (task KL-DOCS-001, 2026-07-26). **Not a source document** —
never classify or cite this as authority; it points at the canonical files.

## What the corpus now contains (102 owner-supplied sources)

| Family                                  | Count | Highlights                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Master authority (canonical/)           | 10    | RB v4.0.0 + BB v2.0.0 (content-identical to bootstrap imports) + the 8-document control pack with its own SOT index (45 rows), 18 owner decisions, RC-001..012 reconciliations, 730-key open-value register, 11-status evidence model                                                                                                                                                                                  |
| Governed APIs + events (api-contracts/) | 15    | /management/v1, /commerce/v1, /edge/v1, /connector/v1 specs; error registry (~51 codes), scope registry, version/deprecation policy, contract-test registry; domain-event registry (16 events, unversioned names), durable jobs, webhooks, outbox pattern, compatibility policy, replay runbook                                                                                                                        |
| Supabase pack (data-contracts/)         | 11    | Data dictionary across 21 `kitluy_*` schemas with table definitions; enum registry; seeds; functions/RPC/triggers; Edge Functions; realtime; storage metadata; backup/PITR; DB QA; generated-types policy. **Missing: schema, RLS, migration plan**                                                                                                                                                                    |
| Business rules (business-rules/)        | 12    | Core rules; **Laundry state machines** (RECEIVED→WASHING→DRYING→PRESSING→QA_PACKAGING→READY→PICKED_UP; KBR-LND-003/-004/-005 forward-only, T3-only ready, T4-only release); Booking lifecycle (DRAFT→CONFIRMED→IN_PROGRESS→…); payments/refunds; inventory; finance subledger; consent/privacy; pricing (HALF_EVEN boundaries, per-weight increment rule open); business date/shift/close; config publication/rollback |
| Security (security/)                    | 13    | RBAC registry (107 dot-separated keys, A0–A4 risk classes); audit event registry (md+csv); four-eyes policy (A0_READ..A4_OWNER_SECURITY); device certificates; resource scopes; secrets policy; machine identity; support consent; Phase 1 threat model + security test plan                                                                                                                                           |
| Store Hub / offline (offline/)          | 11    | LAN API (port 7443) and local DB schema (10 `edge_*` schemas, singular tables); edge sync protocol; conflict policy; idempotency/sequencing; discovery/pairing; config snapshots; file cache; recovery runbook; T1–T4 terminal contract (T2 state machine verbatim matches the repo implementation); hardware matrix                                                                                                   |
| Shared services (shared-services/)      | 9     | file, notification, integration-hub, connector-runtime, ai-gateway, mcp-server, rag-indexer, reporting/export, device-release — all "Canonical target specification; not implementation evidence", DO container + Kubernetes-ready, Supabase RLS metadata                                                                                                                                                              |
| UI/UX (ui-ux/)                          | 21    | Design system + machine-readable token registry (provisional brand values), component inventory, accessibility, responsive, Khmer/English style guide, localization keys, date/time/money formatting, 11 route/screen inventories (8 Phase 1 + 3 phase-gated future clients)                                                                                                                                           |

## What is still missing

`Pasted text.txt` (owner documentation program) · Supabase schema/RLS/
migration-plan v1.0.0 · SQL migrations · feature registry .md/.json ·
owner-decision-lock file · store-hub security-lock spec.

## Where to look

- Manifest of record: `docs/source/manifests/kitluy-source-document-manifest-v1.0.0.*`
- Coverage: `../reconciliation/kitluy-required-document-coverage-matrix-v1.0.0.md`
- Conflicts: `../reconciliation/kitluy-source-conflict-report-v1.0.0.md`
- Authority map: `../reconciliation/kitluy-source-authority-map-v1.0.0.md`
- Validation: `pnpm docs:verify`
