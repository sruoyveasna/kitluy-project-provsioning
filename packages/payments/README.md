# @kitluy/payments

Payment contracts: authoritative pending/confirmed/failed/expired/reversed states; no false confirmed state

**Status:** BUILT + TESTED — pure, in-memory, append-only payment ledger engine
(WS-08-T001). All 26 canonical vectors (PAY-VEC-001..026) from
`docs/source/qa/kitluy-payment-and-reconciliation-test-vectors-v1.0.0.json` are
executed data-driven in `test/vectors.test.ts`; engine invariants (append-only,
float rejection, currency isolation, provider-evidence authority) in
`test/engine.test.ts`. No DB, no provider adapters (PAY-OD-001 [REQUIRED]),
no FX conversion.

## Modules

- `src/ledger.ts` — append-only booking ledger: cash/change (KBR-PAY-002),
  deposits/outstanding (KBR-PAY-004), idempotency, derived aggregates.
- `src/khqr.ts` — KHQR attempts and provider-event authority (KBR-PAY-003):
  verified-callback dedup, amount-mismatch quarantine, callback races.
- `src/refunds.ts` — refunds/voids as compensating records (KBR-PAY-005/006).
- `src/settlement.ts` — settlement matching and fee postings (KBR-PAY-009).
- `src/cash-session.ts` — cash close expected-vs-counted.

## Boundary

- Shared package: may be consumed by apps, services and verticals.
- Must NOT import application or service code.
- Neutral Core: must NOT contain Laundry-specific (or any vertical-specific) terminology.

## Authority

Implementation must follow the canonical specifications indexed in
`docs/authority/kitluy-source-of-truth-index-v1.0.0.md`. Unknown values remain
`[REQUIRED: ...]` — do not guess.
