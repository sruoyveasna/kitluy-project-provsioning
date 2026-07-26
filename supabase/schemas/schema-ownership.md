# Schema ownership registry (SCAFFOLDED)

| Schema domain                                            | Owning boundary                                                       | Status                               |
| -------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------ |
| Core identity, tenants, digital stores, locations        | Supabase (authoritative) + Management API                             | REQUIRED VALUE — schema pack missing |
| Device registry, installations, credentials, assignments | kitluy-device-registry-service (cloud tables per Hub spec Appendix A) | SPECIFIED (names only)               |
| Sync event records, outbox acknowledgements              | kitluy-sync-service                                                   | SPECIFIED (protocol only)            |
| Laundry vertical tables                                  | Phase 1 Laundry pack                                                  | REQUIRED VALUE — schema pack missing |
| Store Hub LOCAL PostgreSQL (on-device)                   | kitluy-hub-agent — never cloud-owned                                  | SPECIFIED (Hub spec §8)              |

Rule: one writer boundary per schema domain; no service writes another
service's authoritative tables.
