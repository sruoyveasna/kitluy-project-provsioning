# Business rules documentation family

| Required document                      | Status                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Core business rules                    | SPECIFIED in bibles; consolidated doc PLANNED                                                                   |
| Laundry state machines                 | T2 display BUILT+TESTED; Booking/production REQUIRED VALUE (KLREQ-003)                                          |
| Transaction and Booking lifecycle      | REQUIRED VALUE (KLREQ-003)                                                                                      |
| Payment, refund and void rules         | SPECIFIED (POS spec §5.10; append-only; no false confirmed state); package SCAFFOLDED                           |
| Inventory movement and cost rules      | SPECIFIED (ledger-based, no LWW); package SCAFFOLDED                                                            |
| Finance subledger and reconciliation   | SPECIFIED (KLMF-FIN-005=B); package SCAFFOLDED                                                                  |
| Customer identity, consent and privacy | OPEN (KLMF-CUS-006)                                                                                             |
| Pricing, discount, tax and rounding    | Pricing lines BUILT+TESTED (Laundry); tax OPEN (KLMF-TAX-001)                                                   |
| Business date, shift and close         | Business date BUILT (`@kitluy/localization`); rollover policy REQUIRED (Partner OD-005); shift/close is Phase 2 |
| Configuration publication and rollback | SPECIFIED (RB v4 §3.4); service SCAFFOLDED                                                                      |
