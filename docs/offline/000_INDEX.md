# Offline and Store Hub documentation family

| Required document                  | Status                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------- |
| Store Hub local database schema    | REQUIRED VALUE (KLREQ-004: naming conflict; entities listed in Hub spec §8) |
| Store Hub LAN API                  | Agreed subset BUILT+TESTED; business routes BLOCKED (KLREC-2026-07-26-001)  |
| Edge sync protocol                 | BUILT+TESTED (`@kitluy/sync-protocol` + hub harness)                        |
| Sync conflict-resolution policy    | BUILT+TESTED (per-data-class CONFLICT_POLICIES; no generic LWW)             |
| Offline idempotency and sequencing | BUILT+TESTED (canonical key format, batch ordering)                         |
| Configuration snapshot contract    | SCAFFOLDED (`@kitluy/configuration-snapshots`)                              |
| Device discovery and pairing       | SPECIFIED (Hub §3.1/§7.5); protocol details REQUIRED                        |
| Store Hub file cache and transfer  | SPECIFIED (Hub §12.3); SCAFFOLDED (`@kitluy/file-contracts`)                |
| Store Hub recovery and replacement | SPECIFIED (replacement-first, Hub Part 17); runbook PLANNED                 |
| Hardware compatibility matrix      | REQUIRED VALUE (certified models pending)                                   |
| T1–T4 terminal profile contract    | BUILT+TESTED (`@kitluy-verticals/phase1-laundry`)                           |
