# KitLuy Store Hub File Cache and Transfer Protocol

**Filename:** `kitluy-storehub-file-cache-and-transfer-protocol-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical target contract; not implementation evidence

> **Purpose:** Keep operational files available at the Store during WAN outages while synchronizing verified bytes to DigitalOcean Spaces through KitLuy File Service and keeping Supabase metadata truthful.

## 1. Authority split

| Concern                                    | Authority                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| File bytes during offline operation        | Store Hub local repository                                                 |
| Long-term file bytes                       | DigitalOcean Spaces through KitLuy File Service                            |
| Metadata, permissions, retention and audit | KitLuy cloud relational records                                            |
| Terminal cache                             | Temporary, non-authoritative                                               |
| Upload truth                               | Cloud metadata becomes `available` only after object checksum verification |

Terminals do not receive master Spaces credentials and normally do not upload directly to Spaces.

## 2. File classes

| Class                  | Example                                 | Default retention/priority                           |
| ---------------------- | --------------------------------------- | ---------------------------------------------------- |
| `operational_evidence` | Stain/damage/garment photo              | High; retain until cloud verified plus policy window |
| `receipt_render`       | PDF/image receipt artifact              | Medium-high                                          |
| `tag_render`           | Print-ready tag                         | Medium; reproducible when template/data retained     |
| `booking_attachment`   | Customer instruction document           | High                                                 |
| `support_evidence`     | Consent-bound diagnostic screenshot/log | Time-limited                                         |
| `configuration_asset`  | Localization/template/font asset        | Pin while snapshot active                            |
| `release_bundle`       | Signed Hub/terminal package             | Pin active + rollback version                        |
| `export`               | Approved report/export                  | Time-limited                                         |
| `thumbnail`            | Local derivative                        | Rebuildable and evictable                            |

## 3. Local directory contract

```text
/var/lib/kitluy/files/
├── objects/aa/bb/{sha256}
├── incoming/{asset_id}/
├── outgoing/{asset_id}/
├── quarantine/{asset_id}/
├── pinned/
├── derivatives/
└── trash-staging/
```

Database metadata, not path naming, is authoritative. Relative paths never contain customer names, phone numbers or unsanitized filenames.

## 4. Encryption

- The writable data partition is encrypted.
- Sensitive file classes are additionally envelope-encrypted per asset or retention class.
- Data key is wrapped to the Hub installation key and, when uploaded, to File Service key management.
- Private keys are non-exportable.
- Backups contain encrypted bytes and metadata needed for re-wrapping during authorized recovery.

## 5. Terminal-to-Hub upload

### 5.1 Initiate

`POST /edge/v1/files/initiate`

```json
{
  "asset_class": "operational_evidence",
  "owner_type": "laundry_booking",
  "owner_id": "0198...",
  "mime_type": "image/jpeg",
  "size_bytes": 2478123,
  "sha256": "64-hex",
  "original_filename": "optional-sanitized-name.jpg",
  "capture_metadata": {
    "captured_at": "timestamptz",
    "camera_device_id": "0198..."
  }
}
```

Hub validates permission, class, owner, size, MIME allowlist, quota and idempotency key. Response returns `asset_id`, chunk size and missing chunks.

### 5.2 Chunk upload

```text
PUT /edge/v1/files/{asset_id}/chunks/{chunk_number}
Content-Range: bytes {start}-{end}/{total}
X-Chunk-SHA256: {hash}
```

Default chunk size: 4 MiB; final chunk may be smaller. Maximum active terminal uploads per terminal: 2. Maximum Hub-wide incoming uploads: 8.

### 5.3 Complete

`POST /edge/v1/files/{asset_id}/complete`

Hub verifies:

- all chunks present;
- chunk offsets and hashes;
- final size;
- final SHA-256;
- MIME signature/content consistency;
- no prohibited executable/archive behavior for the class.

Only then does state become `local_only` or `queued` and the owning business record may reference the asset as locally available.

## 6. Phase 1 size limits

| Class                         |                                Max file | Notes                                          |
| ----------------------------- | --------------------------------------: | ---------------------------------------------- |
| JPEG/PNG operational evidence |                                  15 MiB | Client should resize long edge to policy limit |
| PDF booking attachment        |                                  25 MiB | Active content rejected/quarantined            |
| Receipt/tag render            |                                  10 MiB | Usually much smaller                           |
| Support diagnostic bundle     |                                 100 MiB | Requires consent and expiration                |
| Configuration asset           | Defined by package; package max 100 MiB | Signed only                                    |
| Release bundle                |                                   2 GiB | Separate signed release flow                   |
| Export                        |                                 500 MiB | Approved workflow only                         |

Limits are signed configuration values; lowering a limit does not delete existing files.

## 7. Hub-to-cloud upload

```text
asset queued
→ request upload session from File Service
→ File Service validates metadata and returns multipart signed URLs
→ upload missing parts
→ submit part checksums and completion request
→ File Service completes Spaces object
→ File Service verifies object size/checksum
→ cloud metadata state becomes available
→ Hub receives signed availability acknowledgement
→ Hub marks asset uploaded/verified
```

The Hub may use direct S3-compatible multipart requests only with short-lived, object-scoped credentials issued by File Service.

## 8. Cloud upload session

Metadata request includes:

```json
{
  "asset_id": "0198...",
  "tenant_id": "0198...",
  "digital_store_id": "0198...",
  "location_id": "0198...",
  "asset_class": "operational_evidence",
  "owner_type": "laundry_booking",
  "owner_id": "0198...",
  "size_bytes": 2478123,
  "sha256": "64-hex",
  "encryption": {
    "algorithm": "AES-256-GCM",
    "key_generation": 3
  }
}
```

Cloud response returns upload session ID, object key, part size, expiry, URLs and required headers. Default cloud part size is 8 MiB; File Service may raise it for large bundles.

## 9. Truth states

```text
incoming
→ local_only
→ queued
→ uploading
→ uploaded
→ verifying
→ available
```

Failure branches:

```text
failed → retrying
quarantined
local_missing
cloud_missing
checksum_conflict
```

Cloud UI must not show a download action before state `available`. Local UI may show “available at Store only” with sync freshness.

## 10. Download and cache

When the Hub needs a cloud file:

1. request authorization from File Service;
2. receive short-lived object-scoped URL and expected hash;
3. download to temporary path;
4. verify size and SHA-256;
5. decrypt/validate as needed;
6. atomically move to content-addressed object path;
7. update access time and pin status.

Terminals fetch through the Hub LAN API. The Hub checks terminal profile and resource permission before streaming.

## 11. Content-addressed storage

Object path is derived from SHA-256. Metadata supports multiple authorized references to the same immutable bytes when policy permits deduplication. Deleting one reference does not remove bytes while another active reference or legal hold exists.

## 12. Cache pinning

Pinned content cannot be evicted:

- unuploaded operational evidence;
- files referenced by open/active Bookings;
- active and rollback configuration assets;
- active and rollback release bundles;
- files under retention/legal/support hold;
- recovery checkpoints;
- current receipt/tag templates.

## 13. Disk watermarks

Watermarks apply to the KitLuy data partition:

|     Used | State                 | Action                                                          |
| -------: | --------------------- | --------------------------------------------------------------- |
|   `<70%` | Normal                | Standard caching                                                |
| `70–80%` | Watch                 | Stop speculative prefetch; upload priority increases            |
| `80–90%` | Degraded              | Evict unpinned derivatives and verified old cache               |
| `90–95%` | Critical              | Block nonessential captures/exports; preserve business evidence |
|  `>=95%` | Safety read-only risk | Block new large files and unsafe mutations; alert HET           |

The Hub must reserve sufficient space for PostgreSQL WAL, outbox and critical logs; file cache cannot consume the database safety reserve.

## 14. Eviction order

1. Rebuildable thumbnails/derivatives.
2. Completed support bundles past expiry.
3. Old release bundles outside active + rollback set.
4. Cloud-verified exports past retention.
5. Cloud-verified closed-Booking renders.
6. Cloud-verified operational evidence only when retention permits.

Unuploaded files are never automatically evicted.

## 15. Retention classes

| Code                    | Default                                                |
| ----------------------- | ------------------------------------------------------ |
| `PIN_ACTIVE`            | While owning Booking/config/release is active          |
| `SYNC_PLUS_30D`         | Keep locally 30 days after verified cloud availability |
| `SYNC_PLUS_7D`          | Keep locally 7 days after verification                 |
| `CLOUD_ONLY_AFTER_SYNC` | Evict as soon as safe after verification               |
| `SUPPORT_14D`           | Delete/evict after 14 days unless extended consent     |
| `LEGAL_HOLD`            | No deletion or eviction until authorized release       |

These are defaults, not a legal retention decision. Owner-approved privacy/retention policy may override them through configuration.

## 16. Quarantine and content safety

Files enter quarantine when:

- MIME signature conflicts with declared type;
- executable or script content is prohibited;
- decompression bomb or malformed archive detected;
- checksum mismatch persists;
- cloud malware scanner flags the object;
- owner/resource scope is invalid.

Quarantined bytes are not delivered to ordinary terminals and do not become cloud `available`. Resolution is audited.

## 17. Receipt/tag render artifacts

Authoritative document facts are relational. Render files are immutable derivatives tied to:

- document ID and version;
- template version;
- printer/render profile;
- locale;
- content hash.

A missing render may be regenerated if the exact template and data snapshot remain available. Reprint still creates an explicit reprint event.

## 18. Recovery and replacement

- File metadata and unuploaded bytes are included in encrypted Hub checkpoints where capacity allows.
- Replacement Hub downloads cloud-available pinned files on demand or by recovery priority.
- Unuploaded files from a failed Hub are recoverable only from an intact NVMe or secondary encrypted checkpoint.
- Recovered uploads reuse original asset ID and checksum.
- Cloud duplicate completion returns the existing object mapping.

## 19. Metrics

```text
storehub_files_local_bytes{class}
storehub_files_unuploaded_total
storehub_files_oldest_unuploaded_seconds
storehub_files_upload_bytes_total
storehub_files_upload_failures_total{code}
storehub_files_cache_used_ratio
storehub_files_quarantined_total
storehub_files_integrity_failures_total
```

## 20. Error codes

| Code                         | Meaning                                |
| ---------------------------- | -------------------------------------- |
| `FILE_CLASS_FORBIDDEN`       | Profile cannot create class            |
| `FILE_SIZE_EXCEEDED`         | Class limit exceeded                   |
| `FILE_QUOTA_EXCEEDED`        | Safety quota/watermark blocks upload   |
| `FILE_CHUNK_HASH_MISMATCH`   | Chunk corrupt                          |
| `FILE_CHUNK_RANGE_INVALID`   | Offset/length invalid                  |
| `FILE_FINAL_HASH_MISMATCH`   | Reassembled file corrupt               |
| `FILE_MIME_REJECTED`         | MIME/content prohibited                |
| `FILE_QUARANTINED`           | Content not deliverable                |
| `FILE_CLOUD_SESSION_EXPIRED` | Request a new scoped upload session    |
| `FILE_CLOUD_VERIFY_FAILED`   | Object not yet authoritative           |
| `FILE_LOCAL_MISSING`         | Metadata exists but local bytes absent |

## 21. Acceptance tests

1. Upload interrupted at every chunk resumes without duplicate asset.
2. Changed chunk under same number is rejected.
3. Cloud metadata remains unavailable until Spaces checksum verifies.
4. WAN outage retains files locally and queues upload.
5. Disk watermark evicts only permitted cache classes.
6. Unuploaded evidence is never evicted automatically.
7. Terminal cannot access another Booking's file.
8. Quarantined executable content is not delivered.
9. Replacement Hub reuses asset IDs and avoids duplicate cloud objects.
10. Missing render can be regenerated without altering document truth.
