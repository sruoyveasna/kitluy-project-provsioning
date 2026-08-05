# WS-11-T004-P04C3 — PAIRING-RECEIPT REPLICATION — AI HANDOFF

| Field      | Value                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------- |
| Date       | 2026-08-05                                                                                          |
| Package    | WS-11-T004-P04C3 (pairing-receipt outbox publication and cloud ingestion)                           |
| Status     | **IMPLEMENTED-IN-DEV**                                                                              |
| Start SHA  | `99684aa` (feat(ws-11): persist verified terminal pairing receipts)                                 |
| Toolchain  | Node v22.23.0 (kitluy-toolchain), pnpm 9.15.9, engine-strict=true                                   |
| Migrations | **Cloud 0176 CREATED** (fleet projection + idempotent ingestion door). **No Hub migration needed.** |

## 1. The local half — one event, one transaction

`recordPairingReceiptEvent` is called from inside
`produceHubProofAndComplete`'s existing transaction, so the paired state, the
immutable receipt, the `device.paired` audit fact and the
`terminal_pairing.receipt_issued` v1 outbox event commit together or not at
all. **There is no cloud client anywhere in that path** — which is not a
comment, it is the property the offline scenario measures: pairing commits and
the event waits in the outbox at `delivery_state = 'pending'` (the only state
WS-09 may write; a fabricated acknowledgement is refused by the 0009 CHECK).

- aggregate type `terminal_pairing`, aggregate id the pairing session;
- business deduplication identity: the pairing **receipt id**;
- payload: public receipt material only.

## 2. Two recorded divergences on the effect key (NOT silently resolved)

The package instruction fixes the key at `kh1.{command_result_uuid}.1`. Both
points below are recorded in the decision and reconciliation register.

**There is no command result, and inventing one would break a stated rule.**
`edge_sync.command_result` keeps the STRICT terminal check
(`kl1.{terminal_device_uuid}.{client_sequence}`, migration 0018) precisely
because "a command result always belongs to a terminal command". Pairing is a
Hub-originated identity fact with no client sequence, so minting a synthetic
`kl1.*` key to create a command-result row would be the Hub claiming to be a
terminal — which KLREQ-026 forbids in as many words. **The key's namespace UUID
is therefore the pairing RECEIPT id**, which is also the business dedupe
identity the same instruction specifies, and which is stable across replay
because the receipt is immutable and unique per session. That stability is the
property KLREQ-026 actually requires of the namespace.

**The ordinal is declared, not derived from the command stride.**
`effect-contract.ts` derives ordinals as `slot * 1000 + occurrence` for events
emitted by registered COMMANDS; under that formula the literal `1` is
unreachable for a first declared effect. This event has no command contract, so
its ordinal comes from a small declared registry in `pairing-replication.ts`:
registered, deterministic, independent of insertion order, and an unregistered
name FAILS rather than emits — which are KLREQ-026's stated requirements. The
instruction's literal `1` is used, so the shipped key is
`kh1.{pairing_receipt_id}.1`.

## 3. The cloud half (migration 0176)

`kitluy_devices.terminal_pairing_receipts` is fleet evidence and a read
projection. It refuses, structurally, the four things that would make the cloud
a second pairing authority: it never changes a received `paired_at`, never
alters the receipt or its signature, has no door that CREATES a pairing, and
talks to no Hub.

**Freshness is a separate fact from history.** `paired_at` is HUB time;
`first_received_at` / `last_received_at` / `delivery_count` are CLOUD time. The
read projection returns them as distinct fields, because a fleet view that
merges them reports a delayed delivery as a re-pairing.

`ingest_terminal_pairing_receipt_v1` is keyed on the receipt id: the first
delivery inserts, every later one bumps only the freshness pair and returns the
ORIGINAL row. A redelivery asserting **different** facts is a CONFLICT the
original survives (Hub spec §11.4 — no generic last-write-wins), and two
receipt ids claiming one pairing session are refused. An integrity trigger
freezes every Hub-asserted column and lets only freshness move forward.

**Identity.** New `kitluy_edge_sync_service`, entered with `set local role` for
one transaction, behind a NOINHERIT `kitluy_edge_sync_gateway` (the 0173 hinge
pattern) so `service_role` must ENTER the capability rather than carry it. The
ingestion identity holds EXECUTE and **no table reach at all** — asserted by the
migration guard and re-asserted by the suite.

**Scope is re-derived from the authenticated Hub, above the door.** The event
says which Store it belongs to; so does the Hub that delivered it. When they
disagree the event is refused — a Hub authenticated for one Store cannot ingest
another's receipt, and cannot ingest a receipt naming a different Hub. That
check lives in the composition because the door sees facts and cannot know who
delivered them.

## 4. Focused tests (16/16, zero skips)

**`services/kitluy-hub-agent/test/pairing-replication.integration.test.ts` —
7/7**, real Hub database, real composition, real crypto:

| Proven                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------ |
| pairing creates EXACTLY ONE outbox event, with the receipt and the audit fact alongside it, key `kh1.{receipt}.1`  |
| an injected event failure rolls back the pairing AND the receipt — and the Hub still completes afterwards          |
| a WAN outage leaves the event `pending`, pairing committed, and no acknowledgement fabricated                      |
| a Hub restart finds the same pending event; a completion replay returns the ORIGINAL receipt and emits nothing new |
| the event carries public receipt material only — no nonce, private key, proof signature, code or DSN               |
| the publishable-payload guard refuses six forbidden families and ALLOWS the Hub receipt signature                  |
| an unregistered Hub-originated effect fails rather than emits; the registered one is stable across calls           |

**`services/kitluy-device-registry-service/test/pairing-receipt-ingestion.integration.test.ts`
— 9/9**, real cloud database as the real machine identity:

| Proven                                                                                           |
| ------------------------------------------------------------------------------------------------ |
| one receipt ingests; HUB time is stored verbatim and CLOUD time is later and separate            |
| repeated, delayed and reordered delivery create ONE projection row; only `delivery_count` moves  |
| a redelivery with a different transcript, `paired_at`, signature or session is a CONFLICT        |
| two receipts cannot claim one pairing session                                                    |
| cross-Tenant, cross-Store, cross-Location and cross-Hub deliveries are refused with zero residue |
| eight malformed shapes are durably rejected before the door                                      |
| `service_role` cannot edit fleet evidence with direct SQL; `paired_at` survives                  |
| the capability must be ENTERED, and the ingestion identity holds no table reach                  |
| nothing logged carries a nonce, key, signature or any 64-hex material                            |

## 5. Verification (fast package gate)

| Command                                                 | Exit | Result                                        |
| ------------------------------------------------------- | ---- | --------------------------------------------- |
| `pnpm migrations:validate` + `pnpm db:apply` (0176)     | 0    | 75 files valid; applied with its guard NOTICE |
| new Hub replication suite / new cloud ingestion suite   | 0    | **7/7** and **9/9**, zero skips               |
| **full hub-agent suite**                                | 1    | **344 passed, 1 failed, 2 skipped** — see §6  |
| cloud: ingestion, activation, provisioning routes, http | 0    | **36/36**                                     |
| `typecheck` (hub-agent, registry service)               | 0    | clean                                         |
| `npx eslint` / `npx prettier`                           | 0    | clean                                         |
| `pnpm secret:scan`                                      | 0    | **1350 tracked files clean**                  |

## 6. Two defects found in already-committed work

**(a) Hub migration 0032 was never registered — FIXED FORWARD here.**
`HUB_MIGRATION_ORDER` in `hub-database.ts` stopped at 0031, so
`hub-database.test.ts` ("lists exactly the canonical §4 order and nothing
else") **has been failing since the P04B commit `5711466`** — that package ran
the pairing and LAN suites but not this one, and its handoff's "37 PASS" refers
to the SQL assertion suite, not this test. Both 0032 and 0033 are now
registered, with the omission recorded in the source comment. The hub-agent
suite went from 343 to 344 passing.

**(b) A PRE-EXISTING flake, recorded and NOT fixed (out of scope).**
`sync-inbox.test.ts` → "deduplicates a redelivery of the SAME facts"
intermittently fails with `expected 'duplicate' to be 'accepted'`. Cause:
the fixture derives `providerEventId` from `uuidv7().slice(0, 12)`, which is
~44 bits of the millisecond timestamp, so two tests in the same file landing
within roughly 16 ms mint the SAME dedupe triple and the first insert is
already a duplicate. It passes standalone and on a re-run; it belongs to
WS-10-T006 (`e2390b2`), predates every P04C package, and touches nothing this
task owns — so it is **recorded, not silently repaired** (repository rule 1).
Fix when that area is next opened: give the fixture a random suffix.

## 7. What this package does NOT claim

- **The WAN sender is not built here.** WS-10 owns transmission and
  acknowledgement; this package writes `pending` and nothing else. "Reconnect
  publishes successfully" is therefore proven as far as this package's boundary
  reaches — the event survives restart, stays leasable and carries a
  deterministic dedupe key — and the existing WS-10 transmission suites own the
  send itself.
- **No signed Hub→cloud channel is asserted.** The cloud ingestion is proven
  against the real database through the real identity; the authenticated
  transport that carries a Hub batch to it is BLK-006 service-identity material.
- **No pilot or production readiness.** BLK-005 is unchanged.

## 8. Rollback

Revert the one commit, then `pnpm db:reset` + seed to return the cloud database
to 0175. Reverting removes the fleet projection, the ingestion door, the three
new roles, the Hub's replication module and both suites; pairing itself is
unaffected because the event write is the only line added to its transaction.
Note that the 0032/0033 migration-order registration is in this commit too —
reverting it re-breaks `hub-database.test.ts`.
