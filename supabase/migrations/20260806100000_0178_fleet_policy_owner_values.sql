-- kitluy:group:0178
-- Migration group 0178: fleet_policy_owner_values.
--
-- Authority: WS-11-T005-P02 owner package (2026-08-06) §2 "Owner-locked
-- runtime values" — terminal heartbeat timing (15 s interval; 45 s healthy;
-- 90 s degraded boundary), cloud projection freshness (120 s), and
-- per-class support-session maximums (C1 60 min, C2 30 min, C3 15 min).
-- Amends group 0177 ADDITIVELY: the 0177 file is applied history and is not
-- edited (repository rule); the development policy row it seeded carried
-- development placeholders explicitly recorded as [REQUIRED] — this group
-- records the owner's ruled values in their place.
--
-- WHAT THIS GROUP DOES NOT RULE: the C4/C5 session maximums. The owner ruled
-- C1–C3 only; C4/C5 are clamped to the STRICTEST ruled value (the C3 cap)
-- rather than the looser general cap, because a write-intervention session
-- outliving an impersonated-view session would invert the risk ladder. That
-- interim posture is recorded in the open-decisions register, not presented
-- as ruled.
--
-- ===========================================================================
-- kitluy:destructive-approved:WS-11-T005-P02 -- no DROP/TRUNCATE/DELETE in
-- this group; the marker is present so the destructive-guard never reads a
-- future edit of this file as unmarked history.
-- ===========================================================================

do $borrow$
begin
  execute format('grant kitluy_fleet_governor to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. Per-class support-session maximums (owner-locked C1–C3).
-- ---------------------------------------------------------------------------
alter table kitluy_devices.fleet_health_policy
  add column if not exists support_session_max_minutes_c1 integer,
  add column if not exists support_session_max_minutes_c2 integer,
  add column if not exists support_session_max_minutes_c3 integer;

do $seed_values$
begin
  set local role kitluy_fleet_governor;
  update kitluy_devices.fleet_health_policy
  set heartbeat_interval_seconds = 15,
      projection_stale_after_seconds = 120,
      support_session_max_minutes_c1 = 60,
      support_session_max_minutes_c2 = 30,
      support_session_max_minutes_c3 = 15,
      decision_ref = 'WS-11-T005-P02 owner package 2026-08-06: heartbeat 15 s / healthy 45 s / degraded 90 s; cloud freshness 120 s; session caps C1 60 / C2 30 / C3 15 min. Still [REQUIRED]: C4/C5 caps (clamped to the C3 value meanwhile) and clock-skew bound (development 300 s)',
      updated_at = now()
  where environment = 'development';
  reset role;
end
$seed_values$;

alter table kitluy_devices.fleet_health_policy
  add constraint fleet_health_policy_class_caps_chk
    check (support_session_max_minutes_c1 is null
           or (support_session_max_minutes_c1 > 0
               and support_session_max_minutes_c2 > 0
               and support_session_max_minutes_c3 > 0
               and support_session_max_minutes_c3 <= support_session_max_minutes_c2
               and support_session_max_minutes_c2 <= support_session_max_minutes_c1));

comment on column kitluy_devices.fleet_health_policy.support_session_max_minutes_c1 is
  'Group 0178 (WS-11-T005-P02, OWNER-LOCKED): C1_METADATA session maximum, minutes.';
comment on column kitluy_devices.fleet_health_policy.support_session_max_minutes_c2 is
  'Group 0178 (WS-11-T005-P02, OWNER-LOCKED): C2_SENSITIVE_READ session maximum, minutes.';
comment on column kitluy_devices.fleet_health_policy.support_session_max_minutes_c3 is
  'Group 0178 (WS-11-T005-P02, OWNER-LOCKED): C3_IMPERSONATED_VIEW session maximum, minutes. C4/C5 clamp to this value pending their own ruling (open-decisions register).';

-- ---------------------------------------------------------------------------
-- 2. The open door clamps PER CLASS. Retry cannot extend the original expiry:
--    a session's expires_at is written once at open; no door mutates it
--    forward, the revoke door only ends it, and the sweeper only expires it.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.open_support_access_session_v1(
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_device_id uuid,
  p_support_actor_ref text,
  p_approved_by_ref text,
  p_reason text,
  p_ticket_ref text,
  p_consent_class text,
  p_consent_ref text,
  p_environment text,
  p_requested_minutes integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $support$
declare
  v_policy kitluy_devices.fleet_health_policy;
  v_assignment kitluy_devices.device_assignments;
  v_session_id uuid;
  v_cap integer;
  v_minutes integer;
  v_expires timestamptz;
begin
  if coalesce(btrim(p_support_actor_ref), '') = '' then
    raise exception 'KLUY-SUPPORT-UNATTRIBUTED: a support session names its authenticated operator'
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'KLUY-SUPPORT-REASON-REQUIRED: a support session records its reason'
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_ticket_ref), '') = '' then
    raise exception 'KLUY-SUPPORT-TICKET-REQUIRED: a support session cites its ticket (support policy §3)'
      using errcode = 'P0001';
  end if;
  if p_consent_class not in
      ('C1_METADATA', 'C2_SENSITIVE_READ', 'C3_IMPERSONATED_VIEW',
       'C4_WRITE_INTERVENTION', 'C5_PLATFORM_SAFETY_LEGAL') then
    raise exception 'KLUY-SUPPORT-CLASS: % is not a support policy §3 consent class', p_consent_class
      using errcode = 'P0001';
  end if;
  if p_consent_class not in ('C1_METADATA', 'C5_PLATFORM_SAFETY_LEGAL')
     and coalesce(btrim(p_consent_ref), '') = '' then
    raise exception 'KLUY-SUPPORT-CONSENT-REQUIRED: % requires partner consent evidence', p_consent_class
      using errcode = 'P0001';
  end if;
  if p_consent_class not in ('C1_METADATA', 'C2_SENSITIVE_READ') then
    if coalesce(btrim(p_approved_by_ref), '') = '' then
      raise exception 'KLUY-SUPPORT-UNAPPROVED: % requires an independent approver', p_consent_class
        using errcode = 'P0001';
    end if;
    if btrim(p_approved_by_ref) = btrim(p_support_actor_ref) then
      raise exception 'KLUY-SUPPORT-SELF-APPROVAL: the support actor can never be their own approver'
        using errcode = 'P0001';
    end if;
  end if;
  if p_tenant_id is null or p_digital_store_id is null then
    raise exception 'KLUY-SUPPORT-SCOPE-REQUIRED: a support session is Tenant- and Store-scoped'
      using errcode = 'P0001';
  end if;
  if p_environment not in ('development', 'pilot', 'production') then
    raise exception 'KLUY-SUPPORT-ENVIRONMENT: % is not a known environment', p_environment
      using errcode = 'P0001';
  end if;

  if p_device_id is not null then
    select * into v_assignment from kitluy_devices.device_assignments
     where device_id = p_device_id and state in ('pending_trust', 'active');
    if not found
       or v_assignment.tenant_id <> p_tenant_id
       or v_assignment.digital_store_id <> p_digital_store_id then
      raise exception 'KLUY-SUPPORT-SCOPE-MISMATCH: device % is not assigned to the named Tenant and Store', p_device_id
        using errcode = 'P0001';
    end if;
  end if;

  select * into v_policy from kitluy_devices.fleet_health_policy
   where environment = p_environment;
  if not found then
    raise exception 'KLUY-SUPPORT-POLICY-MISSING: no fleet policy exists for %; support sessions fail closed', p_environment
      using errcode = 'P0001';
  end if;

  -- OWNER-LOCKED per-class caps (0178). C4/C5 clamp to the strictest ruled
  -- value; missing class caps fall back to the general cap, never wider.
  v_cap := case p_consent_class
    when 'C1_METADATA' then coalesce(v_policy.support_session_max_minutes_c1,
                                     v_policy.support_session_max_minutes)
    when 'C2_SENSITIVE_READ' then coalesce(v_policy.support_session_max_minutes_c2,
                                           v_policy.support_session_max_minutes)
    else coalesce(v_policy.support_session_max_minutes_c3,
                  v_policy.support_session_max_minutes)
  end;
  v_cap := least(v_cap, v_policy.support_session_max_minutes);

  v_minutes := least(coalesce(p_requested_minutes, v_cap), v_cap);
  if v_minutes < 1 then
    raise exception 'KLUY-SUPPORT-WINDOW: a support session needs a positive duration'
      using errcode = 'P0001';
  end if;
  v_expires := now() + make_interval(mins => v_minutes);

  insert into kitluy_devices.support_access_sessions
    (tenant_id, digital_store_id, store_location_id, device_id,
     support_actor_ref, approved_by_ref, reason, ticket_ref, consent_class,
     consent_ref, environment, status, starts_at, expires_at)
  values
    (p_tenant_id, p_digital_store_id, p_store_location_id, p_device_id,
     btrim(p_support_actor_ref), nullif(btrim(coalesce(p_approved_by_ref, '')), ''),
     p_reason, p_ticket_ref, p_consent_class,
     nullif(btrim(coalesce(p_consent_ref, '')), ''), p_environment, 'active',
     now(), v_expires)
  returning id into v_session_id;

  insert into kitluy_devices.support_access_events
    (session_id, event_type, actor_ref, detail)
  values
    (v_session_id, 'SESSION_OPENED', btrim(p_support_actor_ref),
     jsonb_build_object('consent_class', p_consent_class,
                        'ticket_ref', p_ticket_ref,
                        'device_id', p_device_id,
                        'expires_at', v_expires));

  return jsonb_build_object('outcome', 'OPENED',
                            'session_id', v_session_id,
                            'expires_at', v_expires,
                            'granted_minutes', v_minutes);
end;
$support$;

comment on function kitluy_devices.open_support_access_session_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer) is
  'Groups 0177/0178 (WS-11-T005). Opens a scoped, time-bound support session under support policy §3 with OWNER-LOCKED per-class caps (C1 60 / C2 30 / C3 15 min; C4/C5 clamp to the C3 value pending their ruling). Expiry is written once — no door extends it; retry opens a NEW session, it never stretches an old one. Returns metadata only - no token, credential or key exists to return.';

-- Replacing the function re-runs CREATE, which resets ownership to the
-- applying role — re-pin it and its grants exactly as 0177 left them.
alter function kitluy_devices.open_support_access_session_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer)
  owner to kitluy_fleet_governor;
revoke all on function kitluy_devices.open_support_access_session_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function kitluy_devices.open_support_access_session_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer)
  to kitluy_fleet_service, kitluy_test_harness;

-- ---------------------------------------------------------------------------
-- 3. PROVE THE VALUES ON APPLY
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_policy kitluy_devices.fleet_health_policy;
begin
  select * into v_policy from kitluy_devices.fleet_health_policy
   where environment = 'development';
  if not found
     or v_policy.heartbeat_interval_seconds <> 15
     or v_policy.projection_stale_after_seconds <> 120
     or v_policy.support_session_max_minutes_c1 <> 60
     or v_policy.support_session_max_minutes_c2 <> 30
     or v_policy.support_session_max_minutes_c3 <> 15 then
    raise exception 'KLUY-MIGRATION-0178: the owner-locked development values did not land';
  end if;
  if not has_function_privilege('kitluy_fleet_service',
      'kitluy_devices.open_support_access_session_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer)', 'execute')
     or has_function_privilege('service_role',
      'kitluy_devices.open_support_access_session_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer)', 'execute')
     or has_function_privilege('authenticated',
      'kitluy_devices.open_support_access_session_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer)', 'execute') then
    raise exception 'KLUY-MIGRATION-0178: the replaced door lost its 0177 grant boundary';
  end if;
  if (select pg_get_userbyid(p.proowner) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'kitluy_devices'
        and p.oid::regprocedure::text like 'kitluy_devices.open_support_access_session_v1%')
      <> 'kitluy_fleet_governor' then
    raise exception 'KLUY-MIGRATION-0178: the replaced door is not governor-owned';
  end if;
  raise notice 'KLUY-MIGRATION-0178: owner-locked fleet timing and per-class support caps recorded (heartbeat 15 s, freshness 120 s, C1/C2/C3 = 60/30/15 min); door boundary re-pinned';
end
$guard$;

do $hand_back$
begin
  execute format('revoke kitluy_fleet_governor from %I', current_user);
end
$hand_back$;
