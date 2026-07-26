# KitLuy Suite Supabase Backup, Restore and PITR

**Filename:** `kitluy-suite-supabase-backup-restore-and-pitr-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical target backup/restore contract; not implementation evidence

> **Mission:** Define recoverable backup classes, point-in-time recovery, logical export, restore rehearsal and evidence so KitLuy can prove—not assume—that cloud data can be restored safely.

## Authority and implementation-truth rule

This artifact is a **canonical target implementation contract**. It is not evidence that a database object, policy, function, seed, deployment, backup, or test exists.

Authority order:

1. Current KitLuy project-owner decisions and the active KitLuy Project Instructions.
2. Applied SQL migrations, verified repository code/tests, deployed environment evidence, and production evidence.
3. `kitluy-suite-supabase-schema-v1.0.0.md`, `kitluy-suite-supabase-rls-and-authorization-v1.0.0.md`, and `kitluy-suite-supabase-migration-plan-v1.0.0.md`.
4. This artifact and the other documents in the Supabase implementation pack.
5. Current Suite, Business, product, Store Hub, infrastructure, and API specifications.
6. Approved handoffs and evidence-based comparison/classification documents.
7. Competitor clone documents and superseded planning.

**Applied SQL migrations are the final deployed schema truth.** Documentation may generate, review, explain, or validate migrations, but it must never become a parallel database definition. A documentation-to-migration mismatch must fail CI or be recorded in the reconciliation register before release.

No capability may be labeled `IMPLEMENTED` without repository, applied-migration, executable-test, deployment, and applicable pilot/production evidence.

## Data classes

| Class                       | Examples                                                                | Recovery treatment                                                                            |
| --------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| A — Identity/security       | Tenant, Digital Store, membership, RBAC, approvals, device certificates | Highest protection; restore requires security review and credential/certificate consequences. |
| B — Financial/transactional | Bookings, payments, refunds, inventory movements, audit/events          | Append-only integrity checks and reconciliation mandatory.                                    |
| C — Configuration/catalog   | services, prices, settings, publications, release/config state          | Version integrity and compatibility checks.                                                   |
| D — Projections/cache       | reporting views, snapshots, derived balances                            | Rebuildable after authoritative restore; do not treat as sole backup.                         |
| E — File metadata           | Spaces object metadata/links/checksums                                  | Restore coordinated with Spaces inventory/versioning.                                         |
| F — Secrets                 | provider/database secrets                                               | Not stored in database backup; backed up/rotated through approved secret manager procedure.   |

## Backup layers

1. Supabase managed physical backup/PITR for production `[REQUIRED: approved plan and retention]`.
2. Encrypted scheduled logical backups (`pg_dump` custom format) to restricted DigitalOcean Spaces backup bucket.
3. Migration repository and generated schema manifest at every release.
4. Separate Spaces object versioning/lifecycle and inventory manifests for file bytes.
5. Evidence package containing checksums, timestamps, project ref, Postgres version, migration head and restore test result.

## Required owner values

- Production PITR retention window.
- Logical backup frequency/retention.
- RPO and RTO by data class/environment.
- Backup encryption/KMS ownership and key-recovery procedure.
- Restore approver roles and emergency authority.
- Cross-region/cross-account copy policy.

Until approved, documents use `[REQUIRED: ...]`; engineers must not invent commercial recovery promises.

## Backup procedure

1. Validate monitoring and current migration head.
2. Start managed backup/PITR checkpoint as supported.
3. Run logical backup with consistent snapshot and required schemas/extensions metadata.
4. Export roles/grants/policies/functions separately where tooling requires.
5. Generate SHA-256 checksums and manifest.
6. Upload encrypted files to restricted Spaces path.
7. Record backup row/evidence package and verify object readability.
8. Run automated restore verification in an isolated project/database according to schedule.

## Restore classes

| Restore type                 | Use                                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Point-in-time recovery       | Operator error, destructive migration, corruption within retention window.                                                         |
| Full logical restore         | New isolated environment, managed backup unavailable, portability test.                                                            |
| Selective logical recovery   | Rare, owner-approved repair using temporary restore database and audited compensating migration; never ad-hoc production row copy. |
| Projection rebuild           | Recompute balances/views/snapshots after authoritative restore.                                                                    |
| File metadata reconciliation | Compare restored metadata with Spaces inventory/version manifests.                                                                 |

## Standard full restore procedure

1. Declare incident/change and freeze writes or isolate target.
2. Select restore point and evidence manifest.
3. Provision isolated target with compatible Postgres/extensions/Supabase settings.
4. Restore roles/schema/data in approved order.
5. Apply no new migration until restored migration head is verified.
6. Run schema, constraint, RLS, function, sequence, event, finance, inventory and checksum validators.
7. Rebuild derived projections/materialized views.
8. Reconcile file metadata with Spaces and quarantine mismatches.
9. Rotate affected secrets/certificates where restore could replay old credentials or tokens.
10. Execute application smoke tests, Store Hub sync compatibility and idempotency replay tests.
11. Obtain authorized go/no-go approval before cutover.
12. Record actual RPO/RTO, gaps and follow-up actions.

## PITR procedure

- Confirm target timestamp in UTC and business impact window.
- Restore to a new isolated project/instance where possible; never overwrite first.
- Compare row counts/hashes and critical ledgers before/after target time.
- Identify events accepted by Store Hubs after the target and plan idempotent replay/reconciliation.
- Confirm provider webhooks, payment events and sync outbox can replay without duplicates.
- Cut over only after security, finance and operations sign-off.

## Validation evidence

Every drill archives:

- backup/restore IDs and checksums;
- source/target project refs and Postgres versions;
- migration head and schema diff;
- start/end timestamps and measured RPO/RTO;
- validator outputs;
- sample RLS isolation results;
- finance/payment/inventory reconciliation results;
- Spaces metadata/object reconciliation;
- Store Hub reconnect/replay results;
- approvers and incident/change references.

## Drill cadence

- Development: automated restore smoke after material migration changes.
- Staging: at least monthly full logical restore and before Pilot/go-live.
- Production: scheduled PITR/full restore rehearsal at `[REQUIRED: owner-approved cadence]`; one drill must include Hub replay and file reconciliation.

## Acceptance criteria

1. A backup is not “successful” until checksum and restore verification pass.
2. One qualified engineer can execute the documented restore in an isolated environment.
3. RLS, append-only ledgers, idempotency and file reconciliation pass after restore.
4. Actual RPO/RTO are measured and never represented by untested estimates.
5. Restore evidence is immutable, permission-restricted and reviewable.
