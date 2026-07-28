# KitLuy WS-10 Prerequisite Decisions — Owner Review Ballot

**Filename:** `kitluy-ws10-prerequisite-decisions-owner-review-v1.0.0.md`
**Version:** v1.0.0
**Date:** 2026-07-27
**Status:** Every group is **OWNER-APPROVAL-REQUIRED**. Nothing below is decided.
**Blocks:** Cycle 9 (WS-10 synchronization and configuration publication)
**Evidence discipline:** approving this ballot resolves a DECISION blockage only. It is not implementation evidence (KLD-EVIDENCE-001).

> Each item states the recommendation, what it would bind, and the alternative,
> so a strike-and-choose is possible without reopening the analysis. The
> implemented development behavior is already in place and reversible; approval
> makes it canonical, rejection triggers a governed correction task.

---

## ☐ Group 1 — KLREQ-020 · Canonical terminal idempotency key

**Recommendation:** confirm `kl1.{terminal_device_uuid}.{client_sequence}` as canonical.

Binds: the key is **terminal-issued**, one key = one business intent, unsigned 64-bit client sequence held in the terminal secure store, surviving reboot and actor change; a terminal reimage starts a new namespace.

Consequence of approval: `@kitluy/sync-protocol` must be corrected under a governed task — it currently emits `location:{location_id}:hub:{hub_id}:seq:{n}` and its comment mis-cites the Hub spec as the source. The Hub already enforces the canonical form by CHECK on five relations.

Alternative: adopt the Hub-issued form instead, which would require amending the offline idempotency contract §2 and re-deriving the Hub CHECKs.

---

## ☐ Group 2 — KLREQ-021 · Persisted-state ↔ wire-state mapping

**Recommendation:** approve the mapping in `kitluy-storehub-local-schema-amendment-001-v1.0.0.md` §2.

Binds: persisted delivery state uses `edge_sync.delivery_state`; the wire value stays `pending_cloud_sync`; the Phase-1 spec's Hub-level `sync_state` describes the HUB, not a row; `OutboxItemState` in code is non-canonical and retired.

Also binds the WS-09/WS-10 split: WS-09 writes only `pending`; `sending`, `acknowledged`, `blocked`, `dead_letter`, `retry_wait` and conflict states are **WS-10's to write**.

Alternative: collapse persisted and wire vocabularies into one set, which would require changing either the canonical enum or the LAN API envelope.

---

## ☐ Group 3 — KLREQ-022 · Finance boundary

**Recommendation:** confirm **NO** authoritative `edge_finance` ledger. The Hub emits finance-**source** events only; the cloud subledger produces the authoritative posting.

Binds: KLD-FIN-002's single-ledger rule at the edge. The Hub persists payment, cash-movement, settlement-source and posting-intent events plus deduplication references, and carries them in the outbox.

Alternative: authorize a Hub-local finance journal — which would create a second authoritative ledger and require an explicit exception to KLD-FIN-002.

---

## ☐ Group 4 — KLREQ-023 · Additive local mechanics

**Recommendation:** approve the four additions and ratify them into the canonical Hub schema document.

Binds: `edge_sync.sequence_gap` (sequencing contract §5 requires a gap ledger); `edge_sync.command_result` (offline §4 requires an immutable stored command result); `assignment_generation` on `local_event` and `outbox` (§5.1's ordering namespace is otherwise unrepresentable); `edge_laundry.booking.refunded_minor` (referenced by the document's own balance CHECK but absent from its column list).

Each satisfies an already-approved invariant and introduces no business semantics.

---

## ☐ Group 5 — KLREQ-025 · Local permission-grant projection

**Owner definition required.** There is currently no Hub-local grant projection. Permission keys without a `terminal_role:` constraint are satisfied only by a presented, exactly-scoped grant; an absent grant denies.

Needs a ruling on: what a Hub-local grant projection contains, how it is refreshed offline, its maximum offline validity, and how revocation propagates. The current fail-closed behavior is safe but cannot support offline staff authorization at scale.

---

## ☐ Group 6 — KLREQ-026 · Hub-issued key namespace for multi-event commands

**Owner definition required.** The canonical offline contract §2 defines only the terminal-issued form, which cannot distinguish several events emitted by one command.

Needs a ruling on the Hub-issued event-key namespace and an amendment to offline contract §2. WS-10 needs this to deduplicate multi-event commands during transmission.

---

## ☐ Group 7 — KLREQ-027 · Service-originated provider callbacks

**Owner definition required.** Provider callbacks cannot enter the terminal command ledger: `edge_sync.command_result.terminal_device_id` is NOT NULL and no RBAC key exists for a service-originated callback.

Needs a ruling on callback identity and deduplication outside the terminal ledger — either a nullable-terminal command-result variant, or a service-actor RBAC key, or a separate service ledger.

---

## Deferrable under an explicit exclusion

| Decision  | Treatment                                                                                 |
| --------- | ----------------------------------------------------------------------------------------- |
| KLREQ-024 | Deferrable **only if WS-10 explicitly excludes Laundry production-stage synchronization** |
| KLREQ-028 | Deferrable under the same exclusion                                                       |

**Standing constraint regardless of WS-10 status:** no complete T1→T4 lifecycle may be claimed until KLREQ-024 and KLREQ-028 are resolved.

---

## On approval

Record the decision in `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md`, move the approved KLREQ rows to the ruled state in the open-decisions register, and only then begin Cycle 9. Groups 5–7 require owner DEFINITIONS, not merely confirmations, so they cannot be approved by checkmark alone.
