# KitLuy Suite Supabase Storage Metadata Contract

**Filename:** `kitluy-suite-supabase-storage-metadata-contract-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical target metadata contract; not implementation evidence

> **Mission:** Keep authoritative file identity, permissions, checksums, retention and business links in Supabase while DigitalOcean Spaces remains the byte-storage system.

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

## Locked boundary

- **DigitalOcean Spaces:** file bytes, multipart upload, object versioning/lifecycle where configured, CDN only for approved public assets.
- **Supabase/PostgreSQL:** metadata, ownership, scope, classification, checksum, status, retention, business links, grants and access events.
- **Store Hub:** local operational repository/cache for required Store files and offline continuity.
- **POS clients:** temporary display/print cache only.
- Supabase Storage is not the primary heavy-file layer. Any limited exception requires a versioned owner decision and migration/document update.

## Metadata relations

Canonical relations are `kitluy_files.file_objects`, `file_links`, `upload_sessions`, `download_grants`, `file_processing_jobs`, `retention_policies`, and `file_access_events` as defined in the data dictionary.

Minimum `file_objects` fields:

- `id`, Tenant/Digital Store/Location scopes;
- bucket alias and opaque object key;
- Spaces region and object version/ETag where available;
- MIME, extension, size, SHA-256 checksum;
- classification, asset type, visibility and encryption state;
- status (`PENDING_UPLOAD`, `UPLOADED_UNVERIFIED`, `SCANNING`, `ACTIVE`, `QUARANTINED`, `ARCHIVED`, `DELETION_PENDING`, `DELETED`);
- retention policy, legal hold and deletion eligibility;
- creator/service identity and timestamps.

Never store a permanent public URL as authority. URLs are derived and short-lived unless the asset classification is explicitly public.

## File classes

| Class                   | Examples                                         | Default visibility                          |
| ----------------------- | ------------------------------------------------ | ------------------------------------------- |
| Public marketing        | approved logos, public catalog images            | public/CDN after publication approval       |
| Customer operational    | garment/stain/damage photos, confirmations       | Tenant/Store private                        |
| Financial/document      | receipts, invoices, reconciliation exports       | Tenant private; stricter retention          |
| Compliance/support      | audit evidence, support attachments, device logs | restricted/Admin or scoped support          |
| Release/device          | signed artifacts, manifests, diagnostics         | service/device scoped                       |
| AI/RAG source           | approved SOPs/manuals/reports                    | permission-scoped; not automatically global |
| Backup/restore evidence | dumps/manifests/checksums                        | platform restricted                         |

## Upload flow

1. Client requests `create_upload_session` with scope, class, MIME, size and expected checksum.
2. API/RPC authorizes and creates `PENDING_UPLOAD` metadata plus short-lived upload session.
3. Service returns presigned Spaces upload instructions; raw secret credentials are never exposed.
4. Client uploads bytes directly to Spaces.
5. Completion call verifies object existence, size, checksum/ETag and session expiry.
6. Metadata becomes `UPLOADED_UNVERIFIED`; virus/content processing job is enqueued.
7. Successful processing marks `ACTIVE`; failure/quarantine blocks download and business use.
8. Business object link is created only after required validation.

## Download flow

1. Client requests file by metadata ID and purpose.
2. Authorization checks relation link, actor scope, classification, retention/hold and support consent.
3. Create short-lived grant and access audit.
4. Return presigned Spaces URL or proxy token with minimum expiry.
5. Revocation blocks future grants; already issued URLs use short TTL.

## Object key contract

Opaque, non-guessable and versioned, for example:

```text
{environment}/{tenant_id}/{classification}/{yyyy}/{mm}/{uuidv7}/{sanitized-filename}
```

The filename is display metadata, not the authorization boundary. Bucket names and raw object keys are never exposed in public APIs unless required for signed provider operation.

## Integrity and lifecycle

- SHA-256 required for finalized operational/evidence files.
- Multipart uploads store part/checksum evidence where supported.
- Metadata activation requires checksum verification.
- Retention and legal hold are relational policies; lifecycle jobs apply them to Spaces.
- Deletion is two-stage: mark eligible/pending, execute object deletion, record result/tombstone. Audit remains.
- Orphan scanner compares Spaces inventory with `file_objects`; discrepancies create incidents/jobs, never silent deletion.

## RLS and service access

Clients do not directly query unrestricted object metadata. RLS permits only authorized linked resources. Upload/download signing is performed by narrow service identities. Support access requires valid consent session. AI retrieval uses the same file/resource scope and records retrieval events.

## Store Hub synchronization

File metadata and required operational objects are projected to the Hub with version/checksum. Hub verifies checksum before activation, tracks local cache state, and does not claim a file is current without version evidence. Uploads created offline remain local pending sync and use immutable local IDs.

## Acceptance criteria

1. No application path depends on Supabase Storage for primary heavy-file bytes.
2. Every active Spaces object has metadata, checksum, owner/scope and retention policy.
3. Every metadata row with active object status resolves to an existing matching Spaces object.
4. Unauthorized or expired grants fail; access events are recorded.
5. Quarantined files cannot be linked into authoritative workflows.
6. Orphan and checksum reconciliation runs are tested and evidenced.
