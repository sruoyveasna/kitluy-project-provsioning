# KitLuy Sync Conflict Resolution Policy

**Filename:** `kitluy-sync-conflict-resolution-policy-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical target policy; not implementation evidence

> **Policy:** Conflict handling is data-class specific. KitLuy never applies one generic last-write-wins rule to finance, payment, inventory, custody, authorization or audit truth.

## 1. Conflict principles

1. Preserve every accepted fact and event.
2. Prefer deterministic prevention over post-hoc repair.
3. Use immutable identifiers, versions and sequences rather than wall-clock ordering.
4. Configuration is cloud-authored and activated by signed version.
5. Store operational events remain valid evidence even when cloud review is required.
6. Corrections create compensating records or explicit mappings.
7. An unsafe conflict stops only the affected workflow, not unrelated Store operations.
8. Human resolution must be permissioned, reason-coded and audited.

## 2. Conflict classes

| Code           | Class                              | Example                                                          |
| -------------- | ---------------------------------- | ---------------------------------------------------------------- |
| `CF-VERSION`   | Optimistic version mismatch        | Two terminals edit one draft                                     |
| `CF-SEQUENCE`  | Event order or gap                 | Cloud receives Hub sequence 10425 before 10424                   |
| `CF-DUPLICATE` | Same intent delivered again        | Lost response triggers retry                                     |
| `CF-IDENTITY`  | Canonical identity overlap         | Local customer matches cloud customer                            |
| `CF-CONFIG`    | Snapshot/version disagreement      | Store running v82 while cloud publishes v84                      |
| `CF-PAYMENT`   | Provider/ledger disagreement       | Local KHQR pending, provider confirms later                      |
| `CF-CUSTODY`   | Physical sequence inconsistency    | Pickup event appears before Ready custody                        |
| `CF-INVENTORY` | Movement/reconciliation difference | Consumable count does not match movements                        |
| `CF-DEVICE`    | Assignment/trust disagreement      | Terminal certificate valid locally but revoked in cloud snapshot |
| `CF-FILE`      | Metadata/object disagreement       | Upload marked complete but object checksum differs               |

## 3. Resolution matrix

| Data class              | Prevention                                      | Automatic resolution                                                            | Operator resolution                                         |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Configuration           | Signed monotonic snapshot version               | Higher valid cloud version stages; active version changes only after validation | Approve rollback/waiver for sensitive config                |
| Booking draft           | Aggregate version                               | Reject stale edit; client refreshes and reapplies intent                        | Supervisor decides when two valid intents cannot merge      |
| Confirmed Booking lines | Immutable snapshots                             | No merge                                                                        | Adjustment/void workflow                                    |
| Cash payment            | Idempotency and append-only event               | Duplicate event maps to same payment                                            | Reconciliation/compensating entry                           |
| KHQR payment            | Provider reference + signed confirmation        | Later authoritative provider state advances pending record                      | Finance review for mismatch or reversal                     |
| Refund/void             | Approval and provider reference                 | Duplicate request returns original workflow                                     | Finance operator resolves provider failure                  |
| Custody                 | Scan identity, aggregate version, state machine | Duplicate scan ignored deterministically                                        | Supervisor investigates impossible order or missing item    |
| Storage assignment      | Serializable capacity lock                      | One assignment wins; loser receives occupied response                           | Authorized reassignment with reason                         |
| Inventory/consumables   | Movement IDs and count sessions                 | Duplicate movement suppressed                                                   | Count variance posts adjustment movement after approval     |
| Customer identity       | Stable IDs and normalized identifiers           | Create alias suggestion; never destructive auto-merge                           | Authorized merge establishes canonical alias                |
| Device status           | Signed observations                             | Latest signed observation updates current projection; history retained          | Security team resolves contradictory trust state            |
| Files                   | Chunk and full-file hashes                      | Resume missing chunks; duplicate content may dedupe                             | Quarantine and recapture if hash cannot validate            |
| Audit/security          | Append-only                                     | Duplicate event suppressed                                                      | Never merge or delete; add acknowledgement/resolution event |

## 4. Version conflict algorithm

For mutable drafts and safe profile metadata:

```text
client sends expected_version N
Hub reads current_version
if current_version = N:
    apply mutation
    increment version
else:
    return EDGE_*_VERSION_CONFLICT
    include current version and safe diff summary
```

The Hub does not automatically overwrite a newer draft. The client can refresh and submit a new intent with a new idempotency key.

## 5. Duplicate algorithm

```text
lookup idempotency_key
if absent:
    reserve key with request hash
    execute transaction
    store outcome
if present and request hash matches:
    return stored outcome
if present and request hash differs:
    reject as payload mismatch and emit security/audit event
```

A duplicate event received by cloud returns the existing acknowledgement and canonical references.

## 6. Finance and payment conflicts

### 6.1 Cash

A locally committed cash payment is an operational fact. Cloud may reject an invalid account mapping or closed-period projection, but it cannot erase the event. Resolution posts an approved mapping or compensating finance event.

### 6.2 KHQR

Authoritative state order:

```text
requested → pending → confirmed | failed | expired
confirmed → reversed only through signed provider/reconciliation evidence
```

A QR image, customer claim or terminal timer never confirms payment. When offline, a request may remain pending; T4 cannot release against an unconfirmed KHQR payment unless a separate owner-approved risk policy exists.

### 6.3 Provider disagreement

If provider and local state disagree:

1. Freeze only the affected payment/refund workflow.
2. Preserve local and provider evidence.
3. Create `CF-PAYMENT` with severity based on amount and custody impact.
4. Run provider re-query/reconciliation.
5. Post confirmed state or compensating event.
6. Require finance approval where money would be released, refunded or written off.

## 7. Custody conflicts

Custody events are never reordered by timestamps. Valid order derives from aggregate version, Hub sequence and state-machine rules.

Examples:

- Repeated scan of the same garment in the same session: return the original accepted result.
- Same garment scanned into two Bookings: block second scan and create security/audit evidence.
- T4 attempts pickup before Ready: block.
- Partial physical handover with missing scan: standard completion blocked; exceptional partial release requires explicit policy and approval.
- Restore reveals a release event not acknowledged by cloud: replay same event ID; do not repeat physical handover.

## 8. Customer identity conflicts

Cloud may detect a likely duplicate through phone/email normalization. It returns a match candidate or alias mapping. The Store Hub:

- keeps the locally issued customer UUID;
- retains historical event references;
- stores the canonical cloud UUID as an alias;
- uses canonical ID for future cloud projections after mapping;
- never exposes another Store's customer data merely because identifiers match.

An operator merge is reversible only through another explicit identity decision; it is not a row deletion.

## 9. Configuration conflicts

- Cloud is authoritative for authored configuration.
- Hub is authoritative for whether a package safely activated locally.
- A higher version does not become active until signature, compatibility and validators pass.
- Local operational records created under an older valid snapshot remain valid and retain that snapshot ID.
- Rollback activates the previous known-good package and emits an audit event.
- A Hub may continue an older snapshot within compatibility policy; UI must show freshness and any deadline.

## 10. Device and trust conflicts

Security state uses the most restrictive valid rule:

```text
trusted locally + revoked by newer signed cloud trust snapshot = revoked
trusted locally + cloud unreachable = trust according to last signed snapshot and offline-validity window
identity mismatch = quarantine regardless of IP or assignment claim
```

Store staff cannot override a root hardware, secure-boot or certificate mismatch.

## 11. Conflict severity and workflow

| Severity | Meaning                                                                  | Response target                                    |
| -------- | ------------------------------------------------------------------------ | -------------------------------------------------- |
| `S1`     | Security compromise, duplicated payment effect or unsafe custody release | Immediate workflow block and HET alert             |
| `S2`     | Financial mismatch, unresolved custody sequence, blocked configuration   | Operator review before affected workflow continues |
| `S3`     | Customer alias, file retry, stale safe metadata                          | Queue for normal review                            |
| `S4`     | Informational duplicate or automatic resolution                          | Record only                                        |

Response targets are operating goals, not SLA evidence: S1 within 15 minutes during supported hours, S2 same business day, S3 within three business days.

## 12. Operator resolution record

Every manual resolution records:

- conflict ID and type;
- local and cloud evidence hashes;
- selected resolution code;
- requester and resolver;
- approval ID when required;
- reason and notes;
- compensating/mapping event ID;
- before/after projections;
- time and environment.

The original conflict and events remain immutable.

## 13. Prohibited resolution patterns

- Generic newest-timestamp wins for money, stock or custody.
- Deleting a local event because cloud already has a different projection.
- Editing a confirmed payment provider reference.
- Reassigning physical custody without a new custody event.
- Treating device IP or MAC alone as identity.
- Auto-merging customers across Tenants.
- Silently activating a partially valid configuration.
- Marking a conflict resolved without evidence and audit.

## 14. Acceptance tests

1. Two T1 edits of one draft produce one commit and one version conflict.
2. Duplicate cash payment request creates one payment and one cash movement.
3. Later KHQR provider confirmation advances the same payment, not a second payment.
4. T4 release before T3 Ready is blocked.
5. Concurrent storage assignment never double-books a capacity-one position.
6. Customer duplicate detection creates an alias candidate, not a destructive merge.
7. Older valid configuration continues with freshness warning when cloud is unavailable.
8. Device revocation in a newer signed trust snapshot takes precedence.
9. Manual resolution always creates an audit event and, where needed, a compensating event.
