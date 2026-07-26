# KitLuy Offline Idempotency and Sequencing

**Filename:** `kitluy-offline-idempotency-and-sequencing-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical target contract; not implementation evidence

> **Purpose:** Guarantee exactly-once business effect across terminal retries, Hub restarts, WAN outages, cloud retries, backup restore and replacement-Hub reconciliation.

## 1. Identity layers

KitLuy uses several identifiers because one sequence cannot safely serve every layer.

| Identifier          | Issuer                 | Scope                       | Purpose                                      |
| ------------------- | ---------------------- | --------------------------- | -------------------------------------------- |
| `request_id`        | Client                 | One transport attempt       | Correlation and logs                         |
| `idempotency_key`   | Originating client     | One business intent         | Duplicate suppression                        |
| `origin_sequence`   | Terminal installation  | Monotonic command order     | Detect replay/gap from terminal              |
| `event_id`          | Hub application        | Global                      | Immutable business event identity            |
| `hub_sequence`      | Active Hub assignment  | Monotonic local event order | Sync ordering                                |
| `aggregate_version` | Hub aggregate          | One Booking/payment/etc.    | Optimistic concurrency                       |
| `cloud_sequence`    | Cloud control stream   | Location                    | Ordered cloud-to-Hub messages                |
| Display number      | Hub sequence allocator | Location and business date  | Human-readable Booking/receipt/tag reference |

## 2. Terminal idempotency key

Format:

```text
kl1.{terminal_device_uuid}.{client_sequence}
```

Example:

```text
kl1.0198d4f0-6f4a-7e6e-bd3d-9f3c9153e1c1.8821
```

Rules:

1. `client_sequence` is an unsigned 64-bit integer stored in the terminal secure application store.
2. It increments before a mutation is sent.
3. It never resets during ordinary reboot, application update or actor change.
4. A terminal reimage creates a new installation identity and starts a new sequence namespace.
5. The Hub stores the key and canonical request hash before reporting success.
6. One key represents one business intent only.

## 3. Canonical request hash

```text
request_hash = SHA-256(
  HTTP method + "\n" +
  normalized route template + "\n" +
  RFC8785-canonical JSON body + "\n" +
  terminal_device_id + "\n" +
  session_id + "\n" +
  profile_code
)
```

Volatile transport fields such as `request_id`, retry count and local network address are excluded.

If a reused key has a different hash, the Hub returns `EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH` and emits an audit/security event.

## 4. Hub acceptance algorithm

```text
begin serializable transaction
  lock terminal sequence record
  verify origin_sequence is:
    - already recorded: return stored result if same request hash
    - next expected: continue
    - lower unknown: reject replay
    - higher with gap: reject and request terminal recovery
  reserve idempotency key
  validate actor/profile/config/aggregate version
  execute business mutation
  allocate event_id(s) and hub_sequence range
  insert event(s), audit event(s), outbox row(s)
  store immutable command result
  advance terminal last_client_sequence
commit
return stored command result
```

The Hub does not hold an uncommitted idempotency reservation after transaction rollback.

## 5. Hub sequence

- `hub_sequence` is a signed 64-bit integer.
- Sequence starts at `1` for the first active assignment generation.
- It is allocated from a single PostgreSQL sequence owned by `kitluy_hub_runtime`.
- It is never reused, even when a transaction is rolled back; gaps caused by rolled-back sequence allocation are recorded in a local sequence-gap ledger and not sent as missing events.
- Sync batches contain only committed events and declare their first and last actual sequence.
- Replacement Hub reconciliation continues the Location stream using a cloud-authorized sequence lease; it never guesses the next value.

### 5.1 Assignment generation

The complete ordering namespace is:

```text
(location_id, assignment_generation, hub_sequence)
```

Cloud stores this tuple. A replaced Hub receives a new assignment generation, preventing sequence collision with the failed Hub.

## 6. Aggregate version

Each aggregate starts at version `1`. Every accepted domain event increments by one.

Client mutations that depend on current state send `expected_version`. The Hub rejects stale versions before business effects. Append-only independent observations may omit expected version only when the contract explicitly permits it.

## 7. Cloud idempotency

Cloud deduplicates on both:

1. `event_id`; and
2. `(location_id, idempotency_key, event_type)`.

A repeated event with the same ID and hash returns `duplicate`. Same ID with a different hash is a critical security/integrity incident.

Cloud acknowledgement identity is immutable and can be returned repeatedly after lost responses.

## 8. Inbox sequencing

Cloud assigns `cloud_sequence` per Location control stream.

- Hub persists a message before application.
- Messages apply in contiguous order.
- Duplicate message ID or sequence returns the original application result.
- A gap blocks only the control stream after the gap; local Store operation continues with the last valid configuration unless security policy requires otherwise.
- Expired commands are recorded as rejected, not silently skipped.

## 9. T1/T2 display sequencing

Each T1-created display session has `display_sequence` starting at `1`.

- Hub accepts only a strictly higher sequence for a new projection.
- T2 ignores repeated/lower sequence.
- Reconnect requests the current full projection, not a replay of obsolete customer data.
- Session close increments the session generation and invalidates all prior events.
- QR payload and payment result include display session ID and expiry.

## 10. T3/T4 scan idempotency

A physical scan command key remains the terminal idempotency key. The Hub also enforces semantic uniqueness:

```text
(session_id, item_id, scan_action)
```

Repeated scan in the same valid session returns the original accepted result and visible “already scanned” status. A scan of the same item into a conflicting Booking or custody state is not a duplicate; it is a blocked conflict.

## 11. Print idempotency

### 11.1 Retry

`duplicate_suppression_key`:

```text
print1.{document_id}.{document_version}.{printer_binding_id}.{copy_index}
```

Retrying a failed job uses the same print job ID and suppression key.

### 11.2 Reprint

An intentional reprint creates:

- new print job ID;
- new suppression key;
- `reprint_of_job_id`;
- actor, permission and reason;
- visible reprint marker in the rendered document where policy requires it.

## 12. Payment idempotency

| Payment action        | Key requirement                                                                |
| --------------------- | ------------------------------------------------------------------------------ |
| Cash accept           | Terminal key plus unique payment UUID                                          |
| KHQR create           | Terminal key plus payment UUID; provider request key derived from payment UUID |
| Provider confirmation | Provider event ID/reference plus signature                                     |
| Refund/void request   | New business-intent key; original payment reference required                   |
| Provider retry        | Same provider idempotency reference                                            |

A confirmed provider event cannot be applied to two KitLuy payments.

## 13. File idempotency

- Asset initialization key: terminal idempotency key.
- Chunk identity: `(asset_id, chunk_number, chunk_sha256)`.
- Re-sent matching chunk returns success.
- Re-sent chunk number with different hash is rejected.
- Complete call is idempotent on asset ID and final SHA-256.
- Cloud object completion deduplicates on asset ID and object version, not filename.

## 14. Human-readable business numbers

UUID remains the legal technical identity. Display numbers are allocated locally so WAN loss never blocks operation.

### 14.1 Default Phase 1 profiles

```text
Booking: KLB-{LOCATION_CODE}-{YYMMDD}-{SEQ6}
Receipt: KLR-{LOCATION_CODE}-{YYMMDD}-{SEQ6}
Tag:     KLT-{LOCATION_CODE}-{BASE32_UUID10}
```

Examples:

```text
KLB-PP001-260726-000143
KLR-PP001-260726-000087
KLT-PP001-7J5M2KD9QX
```

`LOCATION_CODE` is a cloud-assigned immutable 3–8 character code. Daily sequence allocation uses a serializable stored procedure. These are operational references and do not declare Cambodia fiscal requirements.

## 15. Business date

- Default boundary is local midnight in `Asia/Phnom_Penh` for Laundry Phase 1.
- A later vertical may define a business-day close rule.
- The event stores both `business_date` and `occurred_at`.
- Clock correction never changes an already issued display number or event sequence.

## 16. Clock handling

- NTP offset is monitored.
- If offset exceeds 5 minutes, the UI shows a warning and the Hub records a security/health event.
- If offset exceeds 30 minutes and trusted time cannot be restored, provider-dependent and certificate-sensitive actions may be blocked.
- Local ordering still uses sequences.
- Manual clock changes require authorized maintenance and audit.

## 17. Restore and replacement

### 17.1 Same Hub restore

- Restore preserves idempotency records, event IDs and sequences.
- Before push, Hub reconciles acknowledgement ranges with cloud.
- Events already in cloud are marked acknowledged by existing ack IDs.
- Unacknowledged events replay unchanged.

### 17.2 Replacement Hub

- New Hub receives a new assignment generation.
- Cloud returns the last known event chain and any unacknowledged event IDs.
- Restored local checkpoint retains original event IDs.
- New operational events use the new assignment generation and sequence namespace.
- The replacement does not regenerate historical events.

## 18. Dedupe retention

| Record                       | Minimum retention                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Terminal idempotency outcome | 180 days after final Booking state; never shorter than related financial retention |
| Cloud event dedupe           | Entire authoritative event retention                                               |
| Provider event dedupe        | Entire payment retention                                                           |
| Print suppression record     | 180 days                                                                           |
| File chunk record            | Until verified upload plus 30 days                                                 |
| Inbox message dedupe         | 180 days                                                                           |

## 19. Error behavior

| Condition                        | Result                                    |
| -------------------------------- | ----------------------------------------- |
| Same key, same hash, completed   | Return stored result                      |
| Same key, same hash, in progress | `202 accepted` with original operation ID |
| Same key, different hash         | `409 payload mismatch`                    |
| Lower unknown terminal sequence  | `409 replay rejected`                     |
| Higher sequence gap              | `409 sequence gap` with expected value    |
| Aggregate version mismatch       | `409 version conflict`                    |
| Cloud duplicate event            | Existing acknowledgement                  |
| Restored event hash mismatch     | Security halt and operator recovery       |

## 20. Acceptance tests

1. Kill power after local commit but before terminal receives response; retry returns original result.
2. Send 1,000 duplicate cash-payment requests; one payment and one cash movement exist.
3. Reuse a key with changed amount; request is rejected and audited.
4. Reboot terminal and Hub; sequences continue.
5. Reimage terminal; new installation namespace prevents collision.
6. Lose cloud responses after commit; replay receives duplicate acknowledgements.
7. Restore an older Hub backup; reconciliation prevents duplicate business effect.
8. Concurrent Booking/receipt number allocation produces no duplicate display number.
9. Duplicate T3 scan is harmless; wrong-Booking scan remains blocked.
10. Print retry does not become an intentional reprint.
