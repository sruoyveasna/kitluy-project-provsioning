-- kitluy:hub:migration:0034
-- ===========================================================================
-- KitLuy Store Hub local database — the §8 scope index group 0033 owed.
--
-- WS-11-T004-P04C3 closeout. Authority: Hub schema contract §8 — "All scoped
-- tables: (tenant_id, digital_store_id, location_id)", enforced by the
-- hub/tests assertion that walks every base relation in an `edge_*` schema
-- carrying all three columns NOT NULL and requires an index named
-- `<schema>_<table>_scope_idx`.
--
-- WHY A NEW GROUP RATHER THAN AN EDIT. `edge_identity.credential_projection`
-- (group 0033, WS-11-T004-P04C1) is a scoped relation and shipped WITHOUT that
-- index — a real defect the closeout's reset-from-zero caught, and one the
-- package's own focused tests could not, because they exercised behaviour
-- rather than the schema-contract assertion set. 0033 is applied and
-- journalled with its sha256, so it keeps its bytes (repository rule: never
-- modify a previously applied migration) and the correction is additive.
--
-- The index earns its place beyond the assertion: every fleet-facing read of
-- delivery evidence is scoped to one Tenant/Store/Location, and without it
-- those reads are sequential scans over the whole ledger.
-- ===========================================================================

create index if not exists edge_identity_credential_projection_scope_idx
  on edge_identity.credential_projection (tenant_id, digital_store_id, location_id);

comment on index edge_identity.edge_identity_credential_projection_scope_idx is
  'Hub schema contract §8 scope index for the group-0033 credential projection ledger. Owed by 0033 and added here additively (WS-11-T004-P04C3 closeout); the assertion set requires the <schema>_<table>_scope_idx name exactly.';

do $guard$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'edge_identity'
       and tablename = 'credential_projection'
       and indexname = 'edge_identity_credential_projection_scope_idx') then
    raise exception 'KLUY-HUB-MIGRATION-0034: the §8 scope index is missing';
  end if;
  raise notice 'KLUY-HUB-MIGRATION-0034: credential_projection now carries its §8 scope index';
end
$guard$;
