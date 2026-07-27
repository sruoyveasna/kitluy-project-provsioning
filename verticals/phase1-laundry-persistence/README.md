# @kitluy-verticals/phase1-laundry-persistence

WS-07 persistence adapters (Cycle-6): wire the canonical
`@kitluy-verticals/phase1-laundry` Booking lifecycle and production/custody
engines to the authoritative local Supabase schema.

- The engines remain the ONLY transition decision path (`transitionBooking`,
  `transitionProduction`, `markReady`, `completePickup`); the database stores
  engine-decided results behind corruption guards. An invalid engine decision
  throws before any write; the transaction guarantees no partial aggregate.
- Authoritative Bookings are created only through verified-intake commands
  (KLD-2026-07-25-001); price lines are engine-priced immutable snapshots.
- Custody history is append-only with Tenant-scoped idempotency keys —
  duplicate scans replay without a second event (KBR-LND-004 TV3, WS-07-T001
  review RV-003 service mapping).
- NO authoritative Edge/Hub T3/T4 mutation routes exist this cycle
  (KL-DEC-001 + BLK-003 fence) — these are internal services/test adapters.
- Local-only database access is shared from `@kitluy/payments-persistence`
  (KL-INF-P1-037 guard, `service_role` transactions).

Integration tests require the local Supabase stack; they skip with a visible
warning when the database is unreachable.
