-- ============================================================================
-- 0231  Terminal Seat: Partner-configurable allowed surfaces, and pairing
--       context v2
-- ============================================================================
-- kitluy:destructive-approved:TERMINAL-APPLICATION-ASSIGNMENT-001 -- the only
--   DROP is `alter table ... drop constraint` on a CHECK, immediately
--   re-added one value wider (SURFACES_SET). No table, column or row is
--   dropped, truncated or deleted; the change is additive in effect.
-- Authority: TERMINAL-APPLICATION-ASSIGNMENT-001 (owner mission, 2026-09-18)
--   requirements 7 (explicit Allowed Surfaces contract, separate from
--   applications and terminal profiles), 9 (the Partner Portal shows Location,
--   Terminal Profiles, derived Application and Allowed Surfaces BEFORE
--   pairing), 10 (pairing only binds the Pi to the already-defined seat) and
--   12 (fail closed on unknown identifiers). Group 0213 owns the seat and the
--   doors; this group adds one dimension to the seat and restates the evaluate
--   door's body from 0220 with one addition.
--
-- WHAT A SURFACE IS, AND IS NOT
-- ----------------------------------------------------------------------------
-- A surface is a capability area the terminal's shell may expose to whoever
-- stands at it. It is Partner-configurable per seat. It grants no role and no
-- application: allowing a surface authorises nothing the terminal's profiles
-- do not already authorise, and refusing one revokes nothing. The three
-- dimensions stay separate:
--
--   terminal profile keys  -> physical_terminal_roles         (Partner-selected)
--   desired applications   -> DERIVED in the service layer from the Store's
--                             primary vertical and the roles; NEVER stored,
--                             never chosen                    (server-derived)
--   allowed surfaces       -> physical_terminal_allowed_surfaces  (this group)
--
-- Neutral Fleet learns no surface VOCABULARY here: the shape rule is enforced
-- (`<area>.<surface>`, lowercase, dotted) and the registered vocabulary is the
-- owner's decision, validated in `@kitluy/terminal-seat-contracts`.
--
-- HOW A CHANGE REACHES A PAIRED TERMINAL
-- ----------------------------------------------------------------------------
-- Roles are frozen while a board holds the assignment (0213: KLUY-PHYSTERM-
-- BOUND). Surfaces are NOT an assignment property; they are CONFIGURATION, and
-- are expected to travel in the signed configuration payload versioned by
-- `configuration_versions`. Changing them after pairing therefore does not
-- rewrite the assignment; it must publish a newer configuration version that
-- the terminal accepts only if newer (mission requirement 11). That
-- publication step is the configuration projection's job and is NOT wired
-- here — recorded in the task handoff as the integration boundary.
--
-- WHAT THIS DOES NOT DO (mission requirements 14, 15)
-- ----------------------------------------------------------------------------
-- No café or retail profile, application or surface is defined. No release
-- repository. The evaluate door still returns `required_app_family: null`;
-- the application list is derived by the registry service from `vertical` +
-- `terminal_profile_keys`, both of which this context already carries.
-- ============================================================================

-- -----------------------------------------------------------------------------
-- 1. The surfaces a seat allows. Soft-removed, never deleted (0213 pattern).
-- -----------------------------------------------------------------------------
create table if not exists kitluy_devices.physical_terminal_allowed_surfaces (
  id                      uuid primary key default gen_random_uuid(),
  physical_terminal_id    uuid not null references kitluy_devices.physical_terminals (id),
  surface_key             text not null,
  ordinal                 integer not null check (ordinal >= 0),
  added_by_operator_ref   text not null,
  added_at                timestamptz not null default now(),
  removed_at              timestamptz,
  removed_by_operator_ref text,
  -- <area>.<surface>, lowercase, dotted, two or more segments. Shape only.
  constraint physical_terminal_allowed_surfaces_shape_chk
    check (surface_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint physical_terminal_allowed_surfaces_removed_coherent_chk
    check ((removed_at is null) = (removed_by_operator_ref is null))
);

comment on table kitluy_devices.physical_terminal_allowed_surfaces is
  'Group 0231. The ordered surface keys a Partner allows a physical terminal to expose. A surface grants no role and no application. Rows are soft-removed, never deleted. Owner: Fleet. MC: A/O.';

create unique index if not exists physical_terminal_allowed_surfaces_live_uidx
  on kitluy_devices.physical_terminal_allowed_surfaces (physical_terminal_id, surface_key)
  where removed_at is null;

alter table kitluy_devices.physical_terminal_allowed_surfaces enable row level security;
alter table kitluy_devices.physical_terminal_allowed_surfaces force row level security;

-- -----------------------------------------------------------------------------
-- 1b. The seat event log admits the new change kind. 0213 fixed the event
--     vocabulary with a CHECK; a surfaces change is recorded as SURFACES_SET
--     with before/after, exactly as ROLES_SET is.
-- -----------------------------------------------------------------------------
alter table kitluy_devices.physical_terminal_events
  drop constraint if exists physical_terminal_events_type_chk;
alter table kitluy_devices.physical_terminal_events
  add constraint physical_terminal_events_type_chk check (event_type in (
    'DEFINED', 'ROLES_SET', 'SURFACES_SET',
    'SESSION_OPENED', 'SESSION_SUPERSEDED', 'SESSION_CANCELLED', 'SESSION_FAILED_ATTEMPT',
    'SESSION_LOCKED', 'SESSION_EXPIRED', 'SESSION_CONSUMED', 'DEVICE_BOUND'));

-- -----------------------------------------------------------------------------
-- 2. Reader: the live surface set, in order.
-- -----------------------------------------------------------------------------
create or replace function kitluy_devices.physical_terminal_live_surfaces_v1(p_physical_terminal_id uuid)
returns text[]
language sql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $live$
  select coalesce(array_agg(s.surface_key order by s.ordinal, s.added_at), '{}'::text[])
    from kitluy_devices.physical_terminal_allowed_surfaces s
   where s.physical_terminal_id = p_physical_terminal_id
     and s.removed_at is null;
$live$;

-- -----------------------------------------------------------------------------
-- 3. Partner door: replace the live surface set.
--    Allowed while a board holds the assignment (surfaces are configuration,
--    not assignment); refused while a pairing session is open, so a code never
--    means something the operator did not see.
-- -----------------------------------------------------------------------------
create or replace function kitluy_devices.set_physical_terminal_allowed_surfaces_v1(
  p_physical_terminal_id uuid,
  p_surface_keys text[],
  p_operator_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_core, extensions
as $surfaces$
declare
  v_pt kitluy_devices.physical_terminals;
  v_keys text[];
  v_before text[];
  v_key text;
  v_ordinal integer;
begin
  if p_operator_ref is null or btrim(p_operator_ref) = '' then
    return jsonb_build_object('outcome', 'SURFACES_REFUSED',
      'refusal_code', 'KLUY-PHYSTERM-NO-ACTOR', 'detail', 'a change names who made it');
  end if;

  select * into v_pt from kitluy_devices.physical_terminals
   where id = p_physical_terminal_id for update;
  if not found then
    return jsonb_build_object('outcome', 'SURFACES_REFUSED',
      'refusal_code', 'KLUY-PHYSTERM-NOT-FOUND', 'detail', 'no such physical terminal');
  end if;

  if exists (
    select 1 from kitluy_devices.terminal_pairing_sessions s
     where s.physical_terminal_id = p_physical_terminal_id and s.state = 'open') then
    return jsonb_build_object('outcome', 'SURFACES_REFUSED',
      'refusal_code', 'KLUY-PHYSTERM-SESSION-OPEN',
      'detail', 'a pairing session is open for this terminal; cancel it before changing its surfaces');
  end if;

  select array_agg(k order by ord) into v_keys
    from unnest(coalesce(p_surface_keys, '{}'::text[])) with ordinality as u(k, ord);
  v_keys := coalesce(v_keys, '{}'::text[]);

  foreach v_key in array v_keys loop
    if v_key !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' then
      return jsonb_build_object('outcome', 'SURFACES_REFUSED',
        'refusal_code', 'KLUY-PHYSTERM-SURFACE-SHAPE',
        'detail', 'a surface key has the shape <area>.<surface>, lowercase and dotted');
    end if;
  end loop;
  if (select count(*) from unnest(v_keys) k) <> (select count(distinct k) from unnest(v_keys) k) then
    return jsonb_build_object('outcome', 'SURFACES_REFUSED',
      'refusal_code', 'KLUY-PHYSTERM-SURFACE-DUPLICATE',
      'detail', 'a surface key appears more than once');
  end if;

  v_before := kitluy_devices.physical_terminal_live_surfaces_v1(p_physical_terminal_id);

  update kitluy_devices.physical_terminal_allowed_surfaces
     set removed_at = now(), removed_by_operator_ref = p_operator_ref
   where physical_terminal_id = p_physical_terminal_id
     and removed_at is null
     and not (surface_key = any (v_keys));

  select coalesce(max(ordinal), -1) + 1 into v_ordinal
    from kitluy_devices.physical_terminal_allowed_surfaces
   where physical_terminal_id = p_physical_terminal_id;
  foreach v_key in array v_keys loop
    if not exists (
      select 1 from kitluy_devices.physical_terminal_allowed_surfaces s
       where s.physical_terminal_id = p_physical_terminal_id
         and s.surface_key = v_key and s.removed_at is null) then
      insert into kitluy_devices.physical_terminal_allowed_surfaces
        (physical_terminal_id, surface_key, ordinal, added_by_operator_ref)
      values (p_physical_terminal_id, v_key, v_ordinal, p_operator_ref);
      v_ordinal := v_ordinal + 1;
    end if;
  end loop;

  update kitluy_devices.physical_terminals set updated_at = now()
   where id = p_physical_terminal_id;

  perform kitluy_devices.record_physical_terminal_event_v1(
    p_physical_terminal_id, null, 'SURFACES_SET', p_operator_ref,
    jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_keys)));

  return jsonb_build_object(
    'outcome', 'SURFACES_SET',
    'physical_terminal_id', p_physical_terminal_id,
    'allowed_surfaces', to_jsonb(kitluy_devices.physical_terminal_live_surfaces_v1(p_physical_terminal_id)));
end;
$surfaces$;

comment on function kitluy_devices.set_physical_terminal_allowed_surfaces_v1 is
  'Group 0231. Replaces the live allowed-surface set of a physical terminal. Shape-validated only; the surface vocabulary is validated in the service layer against the owner registry. Refused while a pairing session is open. Allowed while a device holds the assignment: surfaces are configuration and reach the terminal through a newer configuration version, never by rewriting the assignment. Recorded as an event with before and after.';

revoke all on function kitluy_devices.physical_terminal_live_surfaces_v1(uuid) from public, anon, authenticated;
revoke all on function kitluy_devices.set_physical_terminal_allowed_surfaces_v1(uuid, text[], text) from public, anon, authenticated;
grant execute on function kitluy_devices.set_physical_terminal_allowed_surfaces_v1(uuid, text[], text)
  to kitluy_terminal_issuance_service;
grant execute on function kitluy_devices.physical_terminal_live_surfaces_v1(uuid)
  to kitluy_terminal_issuance_service, kitluy_terminal_pairing_service;

-- -----------------------------------------------------------------------------
-- 4. The evaluate door, restated from 0220 with the v2 context: the same body,
--    `context_version` v2, plus `allowed_surfaces`. `vertical` (the Store's
--    explicit primary vertical) and `required_app_family: null` are unchanged.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kitluy_devices.evaluate_terminal_pairing_session_v1(p_presented_code text, p_device_id uuid, p_actor_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'kitluy_devices', 'kitluy_core', 'kitluy_ops', 'extensions'
AS $function$
declare
  v_session kitluy_devices.terminal_pairing_sessions;
  v_pt kitluy_devices.physical_terminals;
  v_now timestamptz;
  v_normalized text;
  v_digest text;
  v_device kitluy_devices.devices;
  v_eligible boolean;
  v_reasons text[];
  v_ok boolean;
  v_hub record;
  v_tenant kitluy_core.tenants;
  v_store kitluy_core.digital_stores;
  v_location kitluy_core.store_locations;
  v_locked boolean;
begin
  if p_device_id is null then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-NO-DEVICE',
      'detail', 'a presentation names the terminal that is presenting');
  end if;

  v_normalized := kitluy_devices.normalize_hub_claim_code_v1(p_presented_code);
  if length(v_normalized) <> 8
     or v_normalized !~ ('^[' || kitluy_devices.hub_claim_code_alphabet_v1() || ']{8}$') then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-INVALID',
      'detail', 'that pairing code is not valid');
  end if;

  v_digest := encode(extensions.digest(v_normalized, 'sha256'), 'hex');

  select * into v_session
    from kitluy_devices.terminal_pairing_sessions
   where code_sha256 = v_digest
   for update;
  if not found then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-INVALID',
      'detail', 'that pairing code is not valid');
  end if;

  if v_session.locked_at is not null then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-LOCKED',
      'detail', 'too many failed attempts; ask for a new pairing code');
  end if;
  if v_session.state <> 'open' then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-' || upper(v_session.state),
      'detail', format('that pairing code is already %s', v_session.state));
  end if;

  -- Expiry BEFORE any attempt is counted, and it costs nothing (0191 ordering).
  v_now := kitluy_ops.authoritative_now_v1();
  if v_session.expires_at <= v_now then
    update kitluy_devices.terminal_pairing_sessions set state = 'expired' where id = v_session.id;
    perform kitluy_devices.record_physical_terminal_event_v1(
      v_session.physical_terminal_id, v_session.id, 'SESSION_EXPIRED', p_actor_ref, '{}'::jsonb);
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-EXPIRED',
      'detail', 'the pairing code expired; this is not a failed attempt');
  end if;

  -- The code is RIGHT. Everything from here is about the device presenting it.
  -- Factory Enrollment section 8: only an Admin-approved (enrolled) terminal
  -- that the single eligibility predicate admits may take a seat.
  select * into v_device from kitluy_devices.devices where id = p_device_id;
  -- `enrolled` OR `awaiting_trust`. Both are Admin-approved: a terminal reaches
  -- `awaiting_trust` only by having been approved and then paired, so refusing
  -- it here refuses a board that is RECOVERING its own seat -- which is exactly
  -- what a re-flash produces, since the seat file lives on the wiped SD card.
  --
  -- This door refused before `evaluate_provisioning_eligibility_v1` was even
  -- consulted, so relaxing that predicate in 0219 changed nothing on its own.
  -- The board burned its five attempts and the session locked, against a code
  -- the server had already confirmed was correct.
  --
  -- WHO OWNS THE SEAT IS STILL DECIDED, just not here:
  -- `consume_terminal_pairing_session_v1` (0218) compares the presenting device
  -- against the seat's bound assignment and refuses a DIFFERENT board with
  -- KLUY-TERMSESSION-TERMINAL-BOUND. This door decides whether the device is an
  -- approved terminal at all; that one decides whose seat it is.
  v_ok := found and v_device.device_class = 'terminal'
          and v_device.lifecycle_state in ('enrolled', 'awaiting_trust');
  v_reasons := '{}';
  if v_ok then
    select el.eligible, el.reasons into v_eligible, v_reasons
      from kitluy_devices.evaluate_provisioning_eligibility_v1(p_device_id) el;
    v_ok := coalesce(v_eligible, false);
  end if;
  if not v_ok then
    v_locked := v_session.failed_attempt_count + 1 >= 5;
    update kitluy_devices.terminal_pairing_sessions
       set failed_attempt_count = least(failed_attempt_count + 1, 5),
           locked_at = case when v_locked then v_now else locked_at end,
           locked_reason = case when v_locked then 'five failed presentations' else locked_reason end,
           state = case when v_locked then 'locked' else state end
     where id = v_session.id;
    perform kitluy_devices.record_physical_terminal_event_v1(
      v_session.physical_terminal_id, v_session.id,
      case when v_locked then 'SESSION_LOCKED' else 'SESSION_FAILED_ATTEMPT' end,
      p_actor_ref,
      jsonb_build_object('device_id', p_device_id, 'reasons', to_jsonb(coalesce(v_reasons, '{}'::text[]))));
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-DEVICE-INELIGIBLE',
      'detail', 'this device cannot pair: it must be an approved, provisioning-eligible Pi Terminal');
  end if;

  -- The Hub must still be active. Not an attempt: nothing about the device.
  select * into v_hub from kitluy_devices.active_store_hub_at_scope_v1(
    v_session.tenant_id, v_session.digital_store_id, v_session.store_location_id);
  if v_hub.device_id is null or v_hub.device_id <> v_session.store_hub_device_id then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-HUB-INACTIVE',
      'detail', 'the Store Hub this session was opened against is no longer active');
  end if;

  select * into v_pt from kitluy_devices.physical_terminals where id = v_session.physical_terminal_id;
  select * into v_tenant from kitluy_core.tenants where id = v_session.tenant_id;
  select * into v_store from kitluy_core.digital_stores where id = v_session.digital_store_id;
  select * into v_location from kitluy_core.store_locations where id = v_session.store_location_id;

  -- The section 7 context, every value a server row.
  return jsonb_build_object(
    'outcome', 'MATCH_READY',
    'context_version', 'kitluy.terminal-pairing-context.v2',
    'session_id', v_session.id,
    'physical_terminal_id', v_session.physical_terminal_id,
    'label', v_pt.label,
    'terminal_profile_keys', to_jsonb(v_session.terminal_profile_keys),
    'tenant_id', v_session.tenant_id,
    'tenant_reference', v_tenant.tenant_code || ' — ' || coalesce(v_tenant.display_name, v_tenant.legal_name),
    'digital_store_id', v_session.digital_store_id,
    'digital_store_reference', v_store.store_code || ' — ' || v_store.name,
    'store_location_id', v_session.store_location_id,
    'store_location_reference', v_location.location_code || ' — ' || v_location.name,
    'store_hub_device_id', v_session.store_hub_device_id,
    'store_hub_reference', v_hub.asset_tag,
    'vertical', v_store.primary_vertical_code,
    'required_app_family', null,
    -- v2 (0231): Partner-configured allowed surfaces. A separate dimension from
    -- roles and from the application; validated structurally here, against the
    -- owner's surface registry in the service layer.
    'allowed_surfaces', to_jsonb(kitluy_devices.physical_terminal_live_surfaces_v1(v_pt.id)),
    'release_channel', null,
    'environment', v_session.environment,
    'detail', 'the code matches an open, unexpired session; the caller must now consume it');
end;
$function$;
