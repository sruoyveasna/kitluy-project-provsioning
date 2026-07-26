# Architecture

## System shape (locked direction)

```text
Partner Account → Digital Store (control plane, one primary vertical)
      → Digital Sales Channels (governed; never truth)
      → optional Store Location (edge execution environment)
            → Store Hub (LOCAL AUTHORITY: local PostgreSQL, outbox, LAN API)
                  → T1 intake/cashier ⇄ T2 customer display
                  → T3 ready scan-in → T4 pickup scan-out
            ⇅ async, idempotent sync (no generic LWW)
Cloud: Supabase (auth, PostgreSQL, RLS, audit, events, metadata)
     + DigitalOcean (App Platform services, workers, Spaces, registry, AI)
APIs: Management / Commerce Store / Edge Operations / Connector (never collapsed)
```

## Dependency rules (enforced by review; violations are defects)

apps → packages + verticals; services → packages + verticals; verticals →
neutral Core packages; packages → packages only. Never: app→app internals,
package→app, Core→vertical terminology, provider adapters leaking into domain.

## Product ownership map

See `apps/*/README.md`, `services/*/README.md` and RB v4 §4 (11 user-facing
applications; platform services). Phase/feature-flag map:
`@kitluy/feature-flags` (Phase 1 ACTIVE; 2–8 + future clients registered OFF).

## Diagrams

Rendered diagrams land in docs/architecture/ as they are authored; the ASCII
map above is the bootstrap baseline.
