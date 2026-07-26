# KitLuy Edge Sync Protocol

**Filename:** `kitluy-edge-sync-protocol-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical target contract; not implementation evidence  
**Participants:** Store Hub Sync Engine and KitLuy Cloud Edge Sync Gateway

> **Purpose:** Move locally committed Store events to KitLuy Cloud and deliver signed cloud projections, commands and acknowledgements back to the Store without making WAN connectivity part of the Store transaction critical path.

## 1. Authority model

```text
Cloud authors configuration and platform trust
        ↓ signed inbox messages and snapshots
Store Hub executes local operational truth
        ↓ immutable events, files and observations
Cloud ingests, deduplicates and builds unified truth
```

A Store operation is successful when the Store Hub commits it locally. Cloud acknowledgement changes sync state, not the historical fact that the local event occurred.

## 2. Protocol endpoints

Exact production hostname is `[REQUIRED: production Edge Sync Gateway domain]`. The route contract is fixed:

```text
POST /edge-sync/v1/handshake
POST /edge-sync/v1/events/push
POST /edge-sync/v1/inbox/pull
POST /edge-sync/v1/inbox/ack
POST /edge-sync/v1/reconcile
POST /edge-sync/v1/heartbeats
POST /edge-sync/v1/security-events
```

File bytes and configuration bundles use their companion protocols; their metadata and completion events still appear in this event stream.

## 3. Transport and identity

| Concern                    | Contract                                                                          |
| -------------------------- | --------------------------------------------------------------------------------- |
| Transport                  | HTTPS, HTTP/2, TLS 1.3 preferred                                                  |
| Client auth                | Hub operational certificate using mTLS                                            |
| Request signing            | Detached Ed25519 or ECDSA signature over canonical body hash and request metadata |
| Compression                | `zstd` preferred; `gzip` allowed                                                  |
| Clock                      | UTC timestamps; ordering never depends only on wall clock                         |
| Scope                      | Certificate and payload must match Tenant, Digital Store and Location assignment  |
| Public inbound Store ports | None; Hub initiates all cloud connections                                         |
| Maximum event batch        | 500 events or 5 MiB compressed, whichever occurs first                            |
| Maximum heartbeat batch    | 1,000 observations or 2 MiB compressed                                            |
| Request timeout            | 30 seconds                                                                        |

## 4. Handshake

### 4.1 Request

```json
{
  "protocol_version": "1.0",
  "hub_device_id": "0198...",
  "installation_id": "0198...",
  "assignment_generation": 7,
  "tenant_id": "0198...",
  "digital_store_id": "0198...",
  "location_id": "0198...",
  "hub_application_version": "1.0.0",
  "local_schema_version": 14,
  "active_config_version": 83,
  "last_acked_hub_sequence": 10422,
  "last_applied_cloud_sequence": 721,
  "capabilities": ["events-v1", "config-snapshot-v1", "file-transfer-v1"],
  "nonce": "base64"
}
```

### 4.2 Response

```json
{
  "session_id": "0198...",
  "accepted_protocol_version": "1.0",
  "server_time": "2026-07-26T08:20:00Z",
  "maximum_batch_events": 500,
  "maximum_batch_bytes": 5242880,
  "next_expected_hub_sequence": 10423,
  "next_available_cloud_sequence": 722,
  "trust_snapshot_version": 45,
  "required_actions": [],
  "session_expires_at": "2026-07-26T09:20:00Z",
  "signature": "base64"
}
```

The gateway rejects a stale assignment generation, revoked certificate, unknown installation, impossible sequence regression or unsupported schema compatibility.

## 5. Event envelope

```json
{
  "event_id": "0198...",
  "tenant_id": "0198...",
  "digital_store_id": "0198...",
  "location_id": "0198...",
  "hub_device_id": "0198...",
  "installation_id": "0198...",
  "origin_device_id": "0198...",
  "actor_id": "0198...",
  "profile_code": "laundry_t1",
  "aggregate_type": "laundry_booking",
  "aggregate_id": "0198...",
  "aggregate_version": 4,
  "event_type": "laundry.booking.intake_confirmed",
  "schema_version": 1,
  "business_date": "2026-07-26",
  "occurred_at": "2026-07-26T08:15:13.225Z",
  "hub_sequence": 10423,
  "origin_sequence": 8821,
  "idempotency_key": "kl1.0198terminal.8821",
  "correlation_id": "0198...",
  "causation_event_id": null,
  "payload_sha256": "64-lowercase-hex",
  "payload": {}
}
```

### 5.1 Envelope invariants

- `event_id` is globally unique and immutable.
- `hub_sequence` is strictly monotonic for one active Hub assignment generation.
- `origin_sequence` is monotonic for the originating terminal installation.
- `aggregate_version` is contiguous for accepted aggregate events unless the aggregate is imported through a signed recovery process.
- `payload_sha256` is computed over RFC 8785 JSON Canonicalization Scheme output.
- `occurred_at` is evidence, not the authoritative ordering key.
- An event cannot be modified after local commit. Corrections create new events.

## 6. Push protocol

### 6.1 Batch request

```json
{
  "session_id": "0198...",
  "batch_id": "0198...",
  "from_hub_sequence": 10423,
  "to_hub_sequence": 10480,
  "previous_batch_hash": "64-hex-or-null",
  "events": [],
  "batch_sha256": "64-hex"
}
```

Events are sorted by `hub_sequence`. Gaps are not allowed unless the gateway previously acknowledged the missing sequence or explicitly issued a reconciliation directive.

### 6.2 Per-event result

```json
{
  "event_id": "0198...",
  "hub_sequence": 10423,
  "result": "accepted",
  "cloud_ack_id": "ack_0198...",
  "cloud_recorded_at": "2026-07-26T08:21:00Z",
  "canonical_references": {
    "customer_id": "0198..."
  },
  "error": null
}
```

Allowed results:

| Result                  | Hub treatment                                                         |
| ----------------------- | --------------------------------------------------------------------- |
| `accepted`              | Mark acknowledged                                                     |
| `duplicate`             | Mark acknowledged using existing cloud acknowledgement                |
| `accepted_with_mapping` | Mark acknowledged and apply signed alias/reference mapping            |
| `conflict_review`       | Mark event delivered; create open conflict and do not rewrite history |
| `rejected_retryable`    | Keep pending and back off                                             |
| `rejected_terminal`     | Move to dead letter; operator action required                         |
| `assignment_revoked`    | Stop operational sync and enter security-degraded mode                |

A batch HTTP failure does not imply that no event was applied. The Hub re-sends the same batch/event IDs; cloud deduplication is mandatory.

## 7. Cloud ingestion transaction

For each event, cloud must:

```text
validate mTLS assignment
→ validate envelope and signature
→ deduplicate event_id and idempotency_key
→ validate aggregate version and business invariants
→ write event inbox/outbox record
→ apply authoritative cloud projection in one database transaction
→ create acknowledgement
→ commit
```

The gateway must never acknowledge before durable cloud commit.

## 8. Pull protocol

### 8.1 Pull request

```json
{
  "session_id": "0198...",
  "after_cloud_sequence": 721,
  "limit": 250,
  "accepted_message_types": [
    "configuration_snapshot_available",
    "device_revocation",
    "certificate_trust_update",
    "approved_command",
    "release_manifest",
    "canonical_reference_mapping",
    "reconciliation_response"
  ]
}
```

### 8.2 Inbox message envelope

```json
{
  "message_id": "0198...",
  "cloud_sequence": 722,
  "message_type": "configuration_snapshot_available",
  "schema_version": 1,
  "tenant_id": "0198...",
  "digital_store_id": "0198...",
  "location_id": "0198...",
  "issued_at": "2026-07-26T08:20:30Z",
  "not_before": "2026-07-26T08:20:30Z",
  "expires_at": null,
  "payload_sha256": "64-hex",
  "payload": {},
  "signing_key_id": "edge-control-2026-02",
  "signature": "base64"
}
```

### 8.3 Application order

- Cloud messages are applied in `cloud_sequence` order per Location control stream.
- A message is persisted before application.
- Signature, scope, expiry and schema are validated before side effects.
- Application and local acknowledgement are transactional.
- Unknown required message type blocks the control stream and raises an alert.
- Unknown optional message type is retained and reported but does not block unrelated operational events.

## 9. Inbox acknowledgement

```json
{
  "session_id": "0198...",
  "acks": [
    {
      "message_id": "0198...",
      "cloud_sequence": 722,
      "result": "applied",
      "applied_at": "2026-07-26T08:22:00Z",
      "local_reference": "0198...",
      "error_code": null
    }
  ]
}
```

Results: `applied`, `already_applied`, `rejected_incompatible`, `rejected_invalid_signature`, `blocked_dependency`, `failed_retryable`.

## 10. Sync cycle

```text
1. Open or refresh mTLS sync session
2. Verify next expected sequences
3. Push oldest contiguous local events
4. Persist per-event acknowledgements
5. Pull cloud inbox after last applied cloud sequence
6. Verify and apply inbox messages transactionally
7. Send inbox acknowledgements
8. Upload health/security observations
9. Update local cursors and metrics
10. Sleep or continue based on backlog and policy
```

Normal cycle interval: 5 seconds when backlog exists; 30 seconds when idle. These values are configurable through signed policy.

## 11. Retry and backoff

| Attempt |                                             Delay |
| ------: | ------------------------------------------------: |
|       1 |                                          1 second |
|       2 |                                         2 seconds |
|       3 |                                         5 seconds |
|       4 |                                        15 seconds |
|       5 |                                        30 seconds |
|      6+ | Exponential to 15-minute maximum with ±20% jitter |

Security failures, revoked assignment and invalid signatures do not use endless retry. They stop the affected stream and require controlled recovery.

## 12. Dead-letter rules

An item enters dead letter when:

- schema is permanently unsupported;
- payload hash is invalid after local integrity check;
- cloud rejects a prohibited state transition;
- scope or assignment is permanently invalid;
- maximum retry age exceeds 7 days for a non-security retryable failure;
- an operator explicitly quarantines the item.

Dead-lettering never deletes the original event. Resolution creates a signed replay, mapping or compensating event.

## 13. Reconciliation

### 13.1 Triggers

- Sequence gap detected.
- Hub restore or replacement.
- Cloud acknowledgement lost locally.
- Aggregate version mismatch.
- Payment/provider state disagreement.
- Custody/storage inconsistency.
- File metadata says uploaded but object verification fails.

### 13.2 Reconcile request

```json
{
  "session_id": "0198...",
  "reason": "post_restore",
  "hub_sequence_range": { "from": 10000, "to": 10480 },
  "aggregate_checks": [
    {
      "aggregate_type": "laundry_booking",
      "aggregate_id": "0198...",
      "local_version": 19,
      "local_event_chain_sha256": "64-hex"
    }
  ]
}
```

Cloud returns signed known-event ranges, canonical aggregate versions and specific replay/repair directives. The Hub never discards unacknowledged local events merely because cloud lacks them.

## 14. Canonical mappings

Cloud may identify that a locally created customer corresponds to an existing cloud customer. The response is a signed alias mapping:

```json
{
  "mapping_type": "customer_alias",
  "local_id": "0198...",
  "canonical_id": "0197...",
  "effective_from_cloud_sequence": 730
}
```

The Hub retains original event IDs and local references. New projections use the canonical reference; historical events are not rewritten.

## 15. Configuration and release coordination

- The sync inbox announces availability and provides a signed manifest reference.
- The Hub downloads packages through the configuration/release protocol.
- Activation result is emitted as a domain event.
- Failed activation does not block ordinary event push unless compatibility policy says the active version is unsafe.

## 16. Heartbeats and health

Heartbeat payload includes:

- Hub and terminal application versions;
- active configuration version;
- last local and acknowledged sequences;
- outbox count and oldest age;
- inbox blocked state;
- disk free and database health;
- WAN/LAN state;
- peripheral summary;
- backup checkpoint freshness;
- security/trust state.

Cloud views must display `observed_at` and not present a stale heartbeat as live.

## 17. Security-event fast path

Critical events such as unknown hardware, cloned storage, invalid signature, revoked terminal, secure-boot failure or unauthorized support access use `/security-events`. They are also persisted in the ordinary event ledger. Fast-path delivery does not bypass local evidence retention.

## 18. Compatibility

| Change                     | Rule                                  |
| -------------------------- | ------------------------------------- |
| Add optional payload field | Backward compatible                   |
| Add optional event type    | Compatible if capability-negotiated   |
| Add required field         | New schema version                    |
| Change meaning/type        | Breaking; new event/message version   |
| Remove field               | Breaking; deprecation period required |
| Change sequence semantics  | New protocol major version            |

The gateway supports at least the current and previous protocol minor version during staged rollout.

## 19. Observability metrics

```text
edge_sync_outbox_pending_total
edge_sync_oldest_pending_seconds
edge_sync_push_events_total{result}
edge_sync_push_duration_seconds
edge_sync_inbox_blocked_total
edge_sync_last_ack_sequence
edge_sync_sequence_gap_total
edge_sync_conflicts_open_total{severity}
edge_sync_dead_letter_total{source_kind}
edge_sync_clock_offset_seconds
```

## 20. Acceptance tests

1. 10,000 offline events replay in exact Hub-sequence order.
2. Re-sending every batch twice creates one cloud business effect.
3. Lost HTTP response after cloud commit is recovered as `duplicate`.
4. Sequence gap is rejected and reconciled rather than skipped.
5. Revoked Hub cannot continue cloud sync.
6. Signed inbox replay is deduplicated.
7. Invalid cloud signature causes no side effect.
8. Customer canonical mapping preserves local historical IDs.
9. Restore from backup does not duplicate payments, notifications or custody events.
10. WAN loss for seven days does not prevent local T1–T4 operation while storage limits remain safe.
