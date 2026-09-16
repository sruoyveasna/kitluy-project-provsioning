-- kitluy:hub:group:0028
-- Hub migration 0028: revocation_reader_least_privilege.
--
-- Authority: KLD-2026-07-31-HUB-SNAPSHOT-SIGNING-001; WS-11-T003 Step 4 §10.
--
-- ===========================================================================
-- WHY THIS EXISTS
-- ===========================================================================
-- Group 0027 created `is_certificate_revoked_offline_v1` and `revocation_state_v1`
-- and never revoked EXECUTE from PUBLIC, which Postgres grants by default on a
-- new function. `hub:db:test` caught it and refused:
--
--   ASSERT FAIL: 2 Hub procedure(s) are EXECUTE-able by PUBLIC:
--     edge_config.is_certificate_revoked_offline_v1, edge_config.revocation_state_v1
--
-- That gate is the Hub's standing least-privilege rule, and 0027 broke it. The
-- two readers are not secret -- they answer "is this serial revoked" -- but PUBLIC
-- includes every role the Hub database will ever have, including ones added later
-- for unrelated reasons, and a default grant is not a decision.
--
-- ADDITIVE. Group 0027 is COMMITTED, its checksum is recorded in the applied
-- ledger, and it is NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).

revoke all on function edge_config.is_certificate_revoked_offline_v1(uuid, uuid, uuid, text, text)
  from public;
revoke all on function edge_config.revocation_state_v1(uuid, uuid, uuid, text) from public;

-- Restated explicitly, to exactly the roles group 0027 already granted them to --
-- `kitluy_hub_runtime` is the gate that decides whether a terminal may act, and
-- `kitluy_sync_worker` needs the state read to know what it holds. Naming them
-- here is what makes the grant a DECISION rather than a Postgres default; neither
-- role gains any privilege it did not already have, and neither gains any WRITE.
grant execute on function edge_config.is_certificate_revoked_offline_v1(uuid, uuid, uuid, text, text)
  to kitluy_hub_runtime;
grant execute on function edge_config.revocation_state_v1(uuid, uuid, uuid, text)
  to kitluy_hub_runtime, kitluy_sync_worker;

-- ---------------------------------------------------------------------------
-- PROVE PUBLIC IS OUT
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_public text;
begin
  select string_agg(n.nspname || '.' || p.proname, ', ' order by p.proname)
    into v_public
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'edge_config'
     and p.proname in ('is_certificate_revoked_offline_v1', 'revocation_state_v1')
     and has_function_privilege('public', p.oid, 'execute');

  if v_public is not null then
    raise exception
      'KLUY-HUB-MIGRATION-0028: still EXECUTE-able by PUBLIC: %', v_public
      using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-HUB-MIGRATION-0028: the two offline revocation readers are no longer reachable by PUBLIC';
end
$guard$;
