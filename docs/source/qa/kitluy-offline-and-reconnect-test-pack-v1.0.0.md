# KitLuy Offline and Reconnect Test Pack

| Field      | Value                                                                |
| ---------- | -------------------------------------------------------------------- |
| Filename   | `kitluy-offline-and-reconnect-test-pack-v1.0.0.md`                   |
| Version    | `v1.0.0`                                                             |
| Date       | `2026-07-26`                                                         |
| Owner      | HET / KitLuy Suite Project Owner                                     |
| Phase      | Phase 1 - Laundry                                                    |
| Status     | Canonical testing and evidence specification; not execution evidence |
| Timezone   | `Asia/Phnom_Penh`                                                    |
| Languages  | Khmer and English                                                    |
| Currencies | KHR and USD                                                          |

> Evidence discipline: this document defines required verification. It is not proof that any capability is implemented, tested, deployed, pilot-proven, or production-ready.

## 1. Objective

After provisioning, internet failure must not stop safe Store operations. The Store Hub is the local operational authority; T1-T4 use it over LAN; cloud sync is asynchronous. Offline testing must prove both continuity and later convergence without duplicate business effects.

## 2. Invariants

- Accepted local operations are durable before success is shown.
- Finalized transaction, payment, inventory, finance, custody and audit records are append-only.
- Generic last-write-wins is forbidden for money, inventory quantity, custody and finalized workflow states.
- Every retry is idempotent and scoped.
- Reconnect does not starve foreground LAN operations.
- Cloud portals expose stale, partial, pending and unavailable truth explicitly.
- A cloud outage never causes a terminal to bypass the Hub.

## 3. Network and failure profiles

Clean offline, abrupt disconnect, high latency, packet loss, DNS failure, TLS failure, intermittent flapping, low bandwidth, clock skew, Hub restart, process crash, power loss, storage pressure, queue corruption, cloud dependency outage and provider callback delay.

## 4. Mandatory cases

| ID      | Scenario                                                                              | Pass condition                                                                                          |
| ------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| OFF-001 | WAN lost before T1 Booking begins                                                     | Hub accepts operation over LAN; cloud state is pending                                                  |
| OFF-002 | WAN lost after local commit before cloud ack                                          | Outbox retries; one cloud effect                                                                        |
| OFF-003 | WAN lost during KHQR request                                                          | Attempt remains explicit unknown/pending; no false paid state                                           |
| OFF-004 | WAN lost during T3 Ready scan                                                         | Custody persists locally; notification waits                                                            |
| OFF-005 | WAN lost during T4 pickup                                                             | Approved local completion is atomic; later sync is idempotent                                           |
| OFF-006 | Hub process crash after domain commit before outbox publish                           | Transactional outbox record exists and publishes after restart                                          |
| OFF-007 | Hub process crash before commit                                                       | No partial business effect                                                                              |
| OFF-008 | Hub reboot with queued print/file/sync jobs                                           | Queues resume with stable identifiers                                                                   |
| OFF-009 | Terminal disconnects from Hub during draft entry                                      | No authoritative partial Booking; safe recovery/resume                                                  |
| OFF-010 | T1 and T4 concurrently modify same Booking                                            | State-machine and locking rules prevent invalid double completion                                       |
| OFF-011 | Duplicate push batch                                                                  | Server returns prior result; no duplicate ledger/custody effect                                         |
| OFF-012 | Out-of-order event delivery                                                           | Consumer buffers/rejects/reconciles according to stream policy                                          |
| OFF-013 | Corrupt sync payload                                                                  | Batch item quarantined; healthy items and foreground operations continue safely                         |
| OFF-014 | Expired device certificate during outage                                              | Existing approved local session follows offline policy; cloud reconnect requires renewal/reprovisioning |
| OFF-015 | Configuration snapshot partially downloaded                                           | Current snapshot remains active                                                                         |
| OFF-016 | New snapshot incompatible with installed client                                       | Activation blocked; old compatible version retained                                                     |
| OFF-017 | Cloud has newer non-finalized configuration while Hub has local finalized transaction | Transaction remains immutable; config applies prospectively only                                        |
| OFF-018 | Seven-day backlog with mixed files/events/payments                                    | Priority and bounded batches protect operations; reconciliation exposes exceptions                      |
| OFF-019 | Clock skew on terminal                                                                | Hub sequence/received time prevents invalid ordering and alerts skew                                    |
| OFF-020 | DNS failure but WAN otherwise available                                               | Hub continues local operation; reconnect uses cached endpoints/fallback policy                          |
| OFF-021 | Cloud read model unavailable while Hub healthy                                        | Portals show unavailable/stale; Store is not falsely marked stopped                                     |
| OFF-022 | Hub unavailable while cloud healthy                                                   | T1-T4 cannot bypass Hub for daily operations; outage procedure starts                                   |
| OFF-023 | LAN partition isolates T3/T4 terminal                                                 | Other terminals continue; isolated terminal shows explicit state and cannot invent cloud success        |
| OFF-024 | File upload interrupted at 80 percent                                                 | Resume or restart safely; one committed checksum-valid object                                           |
| OFF-025 | Notification provider down throughout outage                                          | Notification state remains queued/failed; Booking truth unaffected                                      |
| OFF-026 | Reconnect receives provider callback already handled locally/manually                 | Reconciliation prevents duplicate tender and flags mismatch if needed                                   |
| OFF-027 | Remote Admin action queued while Location offline                                     | Executes once after reconnect only if still authorized/unexpired                                        |
| OFF-028 | Release downloaded but power lost before activation                                   | Current slot boots; candidate is retried or discarded safely                                            |
| OFF-029 | Power loss during database write                                                      | Database recovers; committed operation survives; uncommitted operation is absent                        |
| OFF-030 | Repeated connect/disconnect flapping                                                  | Backoff prevents storm; progress and health remain observable                                           |

## 5. Reconnect validators

- Compare local and cloud aggregate counts by stream and sequence range.
- Confirm every accepted local operation has exactly one authoritative cloud business effect.
- Confirm rejected/quarantined records are explicit and replayable only through approved procedure.
- Reconcile tender totals, Booking balances, custody state, storage occupancy, file checksums and audit events.
- Verify config/software compatibility and snapshot acknowledgement.
- Verify portals and apps update freshness only after authoritative acknowledgement.

## 6. Evidence

Packet/network profile, device clocks, Hub/database version, outbox before/after, sync cursors, queue depth, request/event IDs, ledger/custody validator output, UI truth labels, performance during drain, defects and recovery time.

## 7. Pass policy

Any lost accepted operation, duplicate financial/custody effect, unauthorized offline action, silent conflict resolution, or false live/paid/complete state is Critical and blocks G3-G5.
