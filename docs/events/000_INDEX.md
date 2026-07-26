# Events, jobs and webhooks documentation family

| Required document                 | Status                                                                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain-event registry             | Envelope BUILT (`@kitluy/event-contracts`); Laundry custody events BUILT + TESTED (`@kitluy-verticals/phase1-laundry`); full registry PLANNED |
| Durable-job registry              | SCAFFOLDED (`@kitluy/job-contracts`)                                                                                                          |
| Webhook contract registry         | SCAFFOLDED (`@kitluy/webhook-contracts`); rules per infra spec §12.5                                                                          |
| Transactional outbox pattern      | BUILT + TESTED (Hub agent, `pnpm test:offline`) — cloud side PLANNED                                                                          |
| Event-schema compatibility policy | SPECIFIED (RB v4 §10.3: immutable, versioned, retry-safe); doc PLANNED                                                                        |
| Replay and reconciliation runbook | PLANNED (docs/runbooks/)                                                                                                                      |
