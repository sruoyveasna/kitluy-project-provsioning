# ADR-0005 — No Supabase DDL authored at bootstrap

Date: 2026-07-26 · Status: Accepted

## Context

RB v4 §13.3: "Agents must not invent exact table names or production RLS from
planning prose." The canonical schema/RLS/migration pack does not exist
(KLREQ-001), and Hub vs POS specs disagree on local entity names
(KLREC-2026-07-26-002).

## Decision

`supabase/migrations/` ships conventions and a validating linter
(`pnpm migrations:validate`) but zero DDL — not even placeholders, since a
plausible-looking placeholder schema is the primary vector for invented truth.
Seeds and RLS tests stay blocked and say so honestly.

## Consequences

All real data behavior waits for the schema pack. The first schema PR must
add: migrations, data dictionary entries, enum registry entries, RLS tests.
