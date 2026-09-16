-- kitluy:hub:migration:0024
-- ===========================================================================
-- KitLuy Store Hub local database — corrections for independent review findings
-- RV-001 and RV-002 (review 2026-07-28__WS-10-SYNC__REVIEW.md).
--
-- Both findings were REPRODUCED before this file was written. Neither is
-- theoretical.
--
-- ---------------------------------------------------------------------------
-- RV-001 — the governed marker was FORGEABLE, so the amendment §5 rule was not
--          enforced at all.
--
-- 0015 gated conflict-dimension writes on
-- `current_setting('kitluy.reconciliation_governed')`. That is a custom GUC in
-- an unregistered namespace, and PostgreSQL lets ANY role set one with
-- `set_config()`. `kitluy_sync_worker` holds UPDATE on `edge_sync.outbox`, so
-- the exact attack the amendment forbids was one statement long:
--
--     set local role kitluy_sync_worker;
--     select set_config('kitluy.reconciliation_governed','on',true);
--     update edge_sync.outbox set reconciliation_state = 'cleared', ...;
--
-- Reproduced: the row moved to `cleared` with a forged authority string, an
-- unrelated correlation event and ZERO audit rows — the audit is written by the
-- TypeScript caller, never by the procedure. 0015's own comment claimed "This
-- trigger makes it structural." It did not. 0020 closed a DIFFERENT hole
-- (PUBLIC EXECUTE); it did not make the trigger unforgeable.
--
-- THE FIX. The marker becomes something the caller CANNOT set: the identity of
-- the executing role. `edge_sync.raise_reconciliation` and
-- `edge_sync.clear_reconciliation` become SECURITY DEFINER owned by a dedicated
-- NOLOGIN role, so `current_user` inside them is that role and nothing else in
-- the cluster can produce it. The trigger checks `current_user` instead of a
-- GUC. A bare UPDATE now fails for EVERY role, including the Hub runtime and
-- the database owner — the functions are the only door.
--
-- ---------------------------------------------------------------------------
-- RV-002 — a narrow ALLOW defeated a broad DENY.
--
-- `edge_config.resolve_permission_grant` filtered on an EXACT
-- `(scope_type, scope_id)` tuple, so a `deny` recorded at `digital_store` scope
-- was invisible when resolving at `store_location` scope. Reproduced: with a
-- live deny at the Digital Store and an allow at the Location, the resolver
-- returned `allow`. The column comment claimed "DENY OVERRIDES ALLOW at every
-- scope, so a narrow allow can never defeat a broad deny" — which was false.
--
-- THE FIX. The resolver walks the whole scope CHAIN
-- (platform -> tenant -> digital_store -> store_location) plus the exact
-- requested tuple for scope types outside the hierarchy, and a deny anywhere in
-- it wins. The old signature is DROPPED rather than left beside the new one:
-- leaving a callable function with this defect would be leaving a loaded
-- footgun for the next caller.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. RV-001 — an unforgeable marker.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_reconciliation_governor') then
    create role kitluy_reconciliation_governor nologin;
  end if;
end $$;

comment on role kitluy_reconciliation_governor is
  'Owns the governed conflict-dimension procedures. NOLOGIN and granted to nobody, so `current_user` can only equal this role INSIDE edge_sync.raise_reconciliation / clear_reconciliation. That identity is the marker the 0024 trigger checks — unlike the 0015 GUC, a caller cannot produce it.';

-- CREATE is required by PostgreSQL for a role to OWN an object in the schema;
-- USAGE alone is not enough for `ALTER FUNCTION ... OWNER TO`. The privilege is
-- harmless here because the role is NOLOGIN and its membership is granted to
-- nobody — it can only ever act as the definer inside the two procedures below.
grant usage, create on schema edge_sync to kitluy_reconciliation_governor;
grant select, update on edge_sync.outbox to kitluy_reconciliation_governor;
grant select on edge_sync.sync_conflict to kitluy_reconciliation_governor;

create or replace function edge_sync.enforce_state_dimension_independence()
returns trigger
language plpgsql
as $$
declare
  v_conflict_changed boolean;
  v_delivery_changed boolean;
begin
  v_conflict_changed := (
      new.reconciliation_state, new.reconciliation_conflict_id, new.reconciliation_raised_at,
      new.reconciliation_raised_reason, new.reconciliation_cleared_at,
      new.reconciliation_cleared_by, new.reconciliation_cleared_authority,
      new.reconciliation_clearing_reason, new.reconciliation_clearing_event_id
    ) is distinct from (
      old.reconciliation_state, old.reconciliation_conflict_id, old.reconciliation_raised_at,
      old.reconciliation_raised_reason, old.reconciliation_cleared_at,
      old.reconciliation_cleared_by, old.reconciliation_cleared_authority,
      old.reconciliation_clearing_reason, old.reconciliation_clearing_event_id
    );

  if not v_conflict_changed then
    return new;
  end if;

  -- RV-001: the marker is the EXECUTING IDENTITY, not a settable GUC. Only a
  -- SECURITY DEFINER procedure owned by the governor role can produce it.
  if current_user <> 'kitluy_reconciliation_governor' then
    raise exception
      'KLUY-EDGE-RECONCILIATION-GOVERNED: the conflict dimension moves only through edge_sync.raise_reconciliation / edge_sync.clear_reconciliation (KLD-2026-07-28-001-A01 §5); a delivery worker may not clear reconciliation_required. Current identity: %',
      current_user using errcode = 'P0001';
  end if;

  v_delivery_changed := (
      new.delivery_state, new.attempt_count, new.next_attempt_at, new.last_attempt_at,
      new.last_error_code, new.cloud_ack_id, new.acknowledged_at, new.rejected_at,
      new.dead_letter_reason, new.lease_id, new.lease_owner, new.leased_at,
      new.lease_expires_at
    ) is distinct from (
      old.delivery_state, old.attempt_count, old.next_attempt_at, old.last_attempt_at,
      old.last_error_code, old.cloud_ack_id, old.acknowledged_at, old.rejected_at,
      old.dead_letter_reason, old.lease_id, old.lease_owner, old.leased_at,
      old.lease_expires_at
    );

  if v_delivery_changed then
    raise exception
      'KLUY-EDGE-STATE-DIMENSIONS-INDEPENDENT: delivery state and conflict state transition independently (KLD-2026-07-28-001-A01 §3); move them in separate statements'
      using errcode = 'P0001';
  end if;

  if old.reconciliation_state = 'required' and new.reconciliation_state = 'none' then
    raise exception
      'KLUY-EDGE-RECONCILIATION-NOT-DISCARDABLE: a raised reconciliation is closed by clearing it with evidence, never by resetting it to none'
      using errcode = 'P0001';
  end if;

  if old.reconciliation_state = 'cleared' and new.reconciliation_state = 'required'
     and new.reconciliation_conflict_id is not distinct from old.reconciliation_conflict_id then
    raise exception
      'KLUY-EDGE-RECONCILIATION-STALE-CONFLICT: re-raising after clearance requires a NEW sync_conflict record, not the already-resolved one'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function edge_sync.enforce_state_dimension_independence() is
  'Structural enforcement of amendment KLD-2026-07-28-001-A01 §3 and §5. RV-001 correction: the gate is the EXECUTING IDENTITY (current_user = kitluy_reconciliation_governor), not a settable GUC. The 0015 form gated on a custom GUC that any role could set with set_config(), which made the rule unenforced.';

-- The two governed procedures become SECURITY DEFINER owned by the governor.
-- The bodies are unchanged apart from dropping the now-meaningless GUC writes.
create or replace function edge_sync.raise_reconciliation(
  p_event_id    uuid,
  p_conflict_id uuid,
  p_reason      text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, edge_sync, public
as $$
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'KLUY-EDGE-RECONCILIATION-REASON-REQUIRED: a raised reconciliation always states why'
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from edge_sync.sync_conflict c where c.id = p_conflict_id) then
    raise exception
      'KLUY-EDGE-RECONCILIATION-CONFLICT-UNKNOWN: sync_conflict % does not exist; a flag without a named divergence is not evidence',
      p_conflict_id using errcode = 'P0001';
  end if;

  update edge_sync.outbox
     set reconciliation_state             = 'required',
         reconciliation_conflict_id       = p_conflict_id,
         reconciliation_raised_at         = now(),
         reconciliation_raised_reason     = p_reason,
         reconciliation_cleared_at        = null,
         reconciliation_cleared_by        = null,
         reconciliation_cleared_authority = null,
         reconciliation_clearing_reason   = null,
         reconciliation_clearing_event_id = null
   where event_id = p_event_id;
  if not found then
    raise exception 'KLUY-EDGE-OUTBOX-UNKNOWN: no outbox row for event %', p_event_id
      using errcode = 'P0001';
  end if;
end;
$$;

create or replace function edge_sync.clear_reconciliation(
  p_event_id            uuid,
  p_cleared_by          uuid,
  p_authority           text,
  p_reason              text,
  p_resolution_event_id uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog, edge_sync, public
as $$
declare
  v_row edge_sync.outbox%rowtype;
begin
  if p_authority is null or btrim(p_authority) = '' then
    raise exception
      'KLUY-EDGE-RECONCILIATION-AUTHORITY-REQUIRED: name the authorized actor or the governed automated-reconciliation policy'
      using errcode = 'P0001';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'KLUY-EDGE-RECONCILIATION-REASON-REQUIRED: a cleared reconciliation always states why'
      using errcode = 'P0001';
  end if;
  if p_resolution_event_id is null then
    raise exception
      'KLUY-EDGE-RECONCILIATION-CORRELATION-REQUIRED: clearing correlates to the repair or compensating action (amendment §5)'
      using errcode = 'P0001';
  end if;

  select * into v_row from edge_sync.outbox where event_id = p_event_id for update;
  if not found then
    raise exception 'KLUY-EDGE-OUTBOX-UNKNOWN: no outbox row for event %', p_event_id
      using errcode = 'P0001';
  end if;
  if v_row.reconciliation_state <> 'required' then
    raise exception
      'KLUY-EDGE-RECONCILIATION-NOT-RAISED: outbox row % is in reconciliation_state %, so there is nothing to clear',
      p_event_id, v_row.reconciliation_state using errcode = 'P0001';
  end if;

  update edge_sync.outbox
     set reconciliation_state             = 'cleared',
         reconciliation_cleared_at        = now(),
         reconciliation_cleared_by        = p_cleared_by,
         reconciliation_cleared_authority = p_authority,
         reconciliation_clearing_reason   = p_reason,
         reconciliation_clearing_event_id = p_resolution_event_id
   where event_id = p_event_id;
end;
$$;

-- ALTER FUNCTION ... OWNER TO requires membership in the target role, so the
-- migrator takes it, transfers ownership, and GIVES IT BACK. The membership must
-- not survive: a migrator that stays a member could `SET ROLE` to the governor
-- and forge the very identity this correction makes unforgeable.
--
-- HAZARD KLRISK-HUB-001: the grantee is resolved and quoted explicitly.
-- `GRANT ... TO current_user` SEGFAULTS the PostgreSQL 15.8 development server
-- and restarts the whole cluster into crash recovery.
do $$
declare
  v_migrator text := current_user;
begin
  execute format('grant kitluy_reconciliation_governor to %I', v_migrator);
  alter function edge_sync.raise_reconciliation(uuid, uuid, text)
    owner to kitluy_reconciliation_governor;
  alter function edge_sync.clear_reconciliation(uuid, uuid, text, text, uuid)
    owner to kitluy_reconciliation_governor;
end $$;

comment on function edge_sync.raise_reconciliation(uuid, uuid, text) is
  'Raises the ORTHOGONAL conflict dimension (amendment §3). SECURITY DEFINER owned by kitluy_reconciliation_governor (RV-001): the trigger recognises that identity and nothing else, so a caller cannot forge its way past the guard.';
comment on function edge_sync.clear_reconciliation(uuid, uuid, text, text, uuid) is
  'Clears the conflict dimension (amendment §5). SECURITY DEFINER owned by kitluy_reconciliation_governor (RV-001). Requires an authority, a reason and correlation to the repair; the caller writes the immutable audit row in the SAME transaction.';

-- EXECUTE is re-granted after CREATE OR REPLACE, which resets it to PUBLIC.
revoke execute on function
  edge_sync.raise_reconciliation(uuid, uuid, text),
  edge_sync.clear_reconciliation(uuid, uuid, text, text, uuid)
  from public;

grant execute on function edge_sync.raise_reconciliation(uuid, uuid, text)
  to kitluy_hub_runtime, kitluy_sync_worker;
grant execute on function edge_sync.clear_reconciliation(uuid, uuid, text, text, uuid)
  to kitluy_hub_runtime;

-- The migrator hands the membership back now that every owner-requiring
-- statement above has run. It must not survive: a migrator that stayed a member
-- could `SET ROLE` to the governor and forge the identity this correction makes
-- unforgeable.
do $$
declare
  v_migrator text := current_user;
begin
  execute format('revoke kitluy_reconciliation_governor from %I', v_migrator);
end $$;

-- ---------------------------------------------------------------------------
-- 2. RV-002 — deny wins across the whole scope chain.
--
-- kitluy:destructive-approved:RV-002 — the old signature is DROPPED because it
-- resolves a narrow allow over a broad deny. Leaving it callable beside the
-- corrected one would preserve exactly the defect the review found.
-- ---------------------------------------------------------------------------
drop function edge_config.resolve_permission_grant(uuid, uuid, text, text, uuid, boolean, timestamptz);

create function edge_config.resolve_permission_grant(
  p_tenant_id        uuid,
  p_digital_store_id uuid,
  p_location_id      uuid,
  p_actor_id         uuid,
  p_permission_key   text,
  p_scope_type       text,
  p_scope_id         uuid,
  p_online           boolean default true,
  p_as_of            timestamptz default now()
) returns text
language plpgsql
stable
as $$
declare
  v_has_allow boolean := false;
  r record;
begin
  for r in
    select *
    from edge_config.permission_grant_projection g
    where g.location_id = p_location_id
      and g.actor_id = p_actor_id
      and g.permission_key = p_permission_key
      and g.revoked_at is null
      and g.not_before <= p_as_of
      and (g.expires_at is null or g.expires_at > p_as_of)
      -- RV-002: the whole scope CHAIN, not just the requested tuple. A grant
      -- recorded at a BROADER scope covers this request, which is the entire
      -- reason "deny overrides allow" is worth stating.
      and (
        (g.scope_type = 'platform')
        or (g.scope_type = 'tenant' and g.scope_id is not distinct from p_tenant_id)
        or (g.scope_type = 'digital_store' and g.scope_id is not distinct from p_digital_store_id)
        or (g.scope_type = 'store_location' and g.scope_id is not distinct from p_location_id)
        -- Scope types outside the hierarchy (terminal, device, …) match exactly.
        or (g.scope_type = p_scope_type and g.scope_id is not distinct from p_scope_id)
      )
    order by g.projection_version desc
  loop
    -- DENY ANYWHERE IN THE CHAIN WINS, and is checked before any allow can be
    -- accumulated, so no row ordering can let a narrow allow through.
    if r.effect = 'deny' then
      return 'deny';
    end if;

    if not p_online then
      -- Offline use needs a duration an APPROVED SIGNED POLICY granted. No
      -- duration means no offline validity; the Hub invents none (KLREQ-025).
      if r.offline_validity_seconds is null then
        continue;
      end if;
      if r.granted_at + make_interval(secs => r.offline_validity_seconds) <= p_as_of then
        continue;
      end if;
    end if;

    v_has_allow := true;
  end loop;

  if v_has_allow then
    return 'allow';
  end if;
  -- Missing, unknown or expired: fail closed.
  return 'unknown';
end;
$$;

comment on function edge_config.resolve_permission_grant(uuid, uuid, uuid, uuid, text, text, uuid, boolean, timestamptz) is
  'KLREQ-025 resolver, corrected for review finding RV-002. Considers the whole scope chain (platform -> tenant -> digital_store -> store_location) plus the exact requested tuple for scope types outside it, and a DENY anywhere in that chain wins. Missing/unknown/expired returns `unknown`, which callers treat as a refusal. Offline use requires an offline_validity_seconds that came from an approved signed policy.';

comment on column edge_config.permission_grant_projection.effect is
  'allow | deny. DENY OVERRIDES ALLOW ACROSS THE WHOLE SCOPE CHAIN — a grant at a broader scope covers a narrower request, so a narrow allow cannot defeat a broad deny (corrected in 0024 after review finding RV-002; the 0022 resolver compared only the exact scope tuple and did not hold this).';

revoke execute on function
  edge_config.resolve_permission_grant(uuid, uuid, uuid, uuid, text, text, uuid, boolean, timestamptz)
  from public;
grant execute on function
  edge_config.resolve_permission_grant(uuid, uuid, uuid, uuid, text, text, uuid, boolean, timestamptz)
  to kitluy_hub_runtime;
