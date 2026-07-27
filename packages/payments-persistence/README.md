# @kitluy/payments-persistence

WS-08 persistence adapters (Cycle-6): wire the canonical `@kitluy/payments`
engine to the authoritative local Supabase schema.

- Command path per Cycle-6 §6: load aggregate + version → run the canonical
  engine → authorization/approval → persist projection → append history →
  audit → commit atomically.
- LOCAL ONLY (KL-INF-P1-037): the connection refuses non-local URLs. Commands
  run as `service_role` inside the transaction so the real grant/trigger
  surface is exercised (no DELETE, no direct journal writes, append-only).
- KHQR is the `DEV_KHQR_SIM` simulator identity only — the provider contract
  and credentials remain open owner values (PAY-OD-001, BLK-006).
- Finance postings go exclusively through
  `kitluy_finance.post_journal_entry_v1` with the fictional `DEV-*` dev chart
  (canonical chart of accounts is FIN-OD-001, open).

Integration tests (`pnpm --filter @kitluy/payments-persistence test`) require
the local Supabase stack (`pnpm supabase:start`, migrations + seeds applied);
they skip with a visible warning when the database is unreachable.
