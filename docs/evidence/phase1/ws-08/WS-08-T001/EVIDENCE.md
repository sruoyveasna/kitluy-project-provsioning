# WS-08-T001 evidence package

| Field       | Value                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Task        | WS-08-T001 — payment/tender engine (26 canonical vectors)                                                                                    |
| Date        | 2026-07-26 · env: local dev (Node 22.23.0, pnpm 9.15.9)                                                                                      |
| Authority   | kitluy-payment-and-reconciliation-test-vectors-v1.0.0.json (acceptance contract); kitluy-payment-refund-and-void-rules-v1.0.0.md (KBR-PAY-*) |
| Feature IDs | KLMF-PAY-006..008/012/015/017..021; KLMF-FIN-001/002/005                                                                                     |

## Changed paths

packages/payments/src/{errors,ledger,khqr,refunds,settlement,cash-session,index}.ts,
test/{vectors,engine}.test.ts, package.json, README.md (+ mechanical
pnpm-lock.yaml update).

## Test evidence (executed locally 2026-07-26)

`pnpm --filter @kitluy/payments test` → **2 files, 40/40 pass**: data-driven
harness executes ALL 26 vectors PAY-VEC-001..026 individually (unknown
expected_* keys fail the harness), + engine unit tests (append-only mutation
rejection, float rejection, currency isolation, unverified-event quarantine,
UI-never-payment-authority, void-of-finalized refused) + RV-001 replay
regression. typecheck/build clean; repo lint clean.

## Independent review (four-eyes MANDATORY: payments)

00_AI_HANDOFF/reviews/2026-07-26__WS-08-T001__REVIEW.md — verdict
**PASS-WITH-CONDITIONS**; blocking finding **RV-001 (refund replay hit the
balance check before the idempotency lookup) FIXED post-review**: check moved
inside the idempotent execution; regression test added (40th test) proving an
identical replay returns the original result with exactly one REFUND record
and zero REFUND_REJECTED records. Open non-blocking: RV-002 (dedup payload
variance, fails closed), RV-004..009 (notes; incl. PAY-OD-003 overpayment
policy open). RV-003 (process): WS-07 commit swept four WS-08 files —
recorded; boundary hygiene tightened for future tasks.

## Recorded contract ambiguities (strictest reading; unresolved)

deposit_minor derivation; settlement SLA (24h default carries [REQUIRED]);
PAY-VEC-010 mismatch baseline; sticky requires_status_refresh; mandatory
refund approval (thresholds PAY-OD-002 open); callback-without-attempt;
business_effect_count = PAYMENT postings only.

## Status claim

Code: **SCAFFOLDED** under the owner model (tested pure-domain engine; no DB,
no providers — KHQR provider is [REQUIRED]; IMPLEMENTED-IN-DEV blocked by
BLK-002). No higher status claimed.
