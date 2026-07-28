-- kitluy:group:0123
-- Migration group 0123: trusted_time (WS-11-T003 step 2).
--
-- Implements KLD-2026-07-28-002 §12 and the owner's 2026-07-28 trusted-time
-- instruction. Groups 0120, 0121 and 0122 are COMMITTED and are not edited.
--
-- WHY THIS EXISTS BEFORE CERTIFICATE ISSUANCE.
-- §12.6 makes certificate validity, revocation-snapshot validity and
-- signed-configuration validity all depend on trusted time. A certificate
-- lifecycle built on an untrusted clock is a lifecycle whose expiry is
-- advisory, so issuance waits for this.
--
-- WHAT IS DELIBERATELY NOT DECIDED HERE.
-- The forward-jump threshold is a SIGNED POLICY VALUE, not a constant. The
-- owner refused to let it be invented, so it is a nullable column that the
-- evaluator FAILS CLOSED on. Development carries an explicit test value;
-- pilot and production carry `[REQUIRED: trusted_time_max_forward_jump_seconds]`
-- by being absent, and every evaluation in those environments refuses.
--
-- The five-minute rollback tolerance IS ruled (§12.3) and is therefore a
-- default rather than a required value.
--
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).

alter type kitluy_devices.trust_incident_type
  add value if not exists 'trusted_time_anomaly';

begin;

create type kitluy_devices.trusted_time_status as enum (
  'uninitialized',
  'trusted',
  'restricted_rtc_failure',
  'restricted_clock_rollback',
  'restricted_forward_jump',
  'restricted_no_trusted_source'
);

comment on type kitluy_devices.trusted_time_status is
  'KLD-2026-07-28-002 §12. Every `restricted_*` value puts the Hub in restricted trust mode: certificate issuance and renewal, device and assignment activation, signer changes, trust-policy changes, support access, release promotion and configuration signer rotation all stop. Existing locally authorized Laundry operations continue under the last valid signed snapshot.';

create type kitluy_devices.trusted_time_source as enum (
  'rtc',
  'authenticated_network',
  'signed_cloud_token',
  'persisted_floor',
  'none'
);

-- ===========================================================================
-- Signed trust policy — the values that must NOT be code constants
-- ===========================================================================
create table if not exists kitluy_devices.trust_policy (
  id uuid primary key default gen_random_uuid(),
  environment text not null,
  policy_version integer not null,

  -- Owner ruling 2026-07-28: the enrollment-station duplicate threshold is a
  -- POLICY value, not a universal constant. Development defaults are approved;
  -- pilot and production must come from signed configuration.
  duplicate_incident_quarantine_threshold integer not null,
  duplicate_incident_window_seconds integer not null,

  -- §12.3, RULED: a clock more than five minutes behind the floor is rollback.
  max_clock_lag_seconds integer not null default 300,

  -- DELIBERATELY NULLABLE. The owner refused to let a forward-jump threshold be
  -- invented. NULL means the evaluator fails closed for that environment.
  trusted_time_max_forward_jump_seconds integer,

  -- §6 revocation-snapshot freshness, carried here so one signed policy answers
  -- every time-dependent question.
  max_revocation_snapshot_age_seconds integer not null,

  -- Signed configuration. The signature is RECORDED but not yet VERIFIED —
  -- verification needs the configuration signer, which is step 6. Recording an
  -- unverified signature as verified would be the exact fabrication this
  -- programme keeps refusing, so `signature_verified` stays false and the
  -- evaluator refuses non-development environments on that basis alone.
  policy_payload_sha256 text not null,
  policy_signature text,
  policy_signer_key_reference text,
  signature_verified boolean not null default false,

  approved_by_decision_ref text not null,
  approved_at timestamptz not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),

  constraint trust_policy_env_chk
    check (environment in ('development', 'pilot', 'production')),
  constraint trust_policy_version_chk check (policy_version >= 1),
  constraint trust_policy_threshold_chk
    check (duplicate_incident_quarantine_threshold >= 1),
  constraint trust_policy_window_chk
    check (duplicate_incident_window_seconds > 0),
  constraint trust_policy_lag_chk check (max_clock_lag_seconds > 0),
  constraint trust_policy_forward_jump_chk
    check (trusted_time_max_forward_jump_seconds is null
        or trusted_time_max_forward_jump_seconds > 0),
  constraint trust_policy_snapshot_age_chk
    check (max_revocation_snapshot_age_seconds > 0),
  constraint trust_policy_payload_format_chk
    check (policy_payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint trust_policy_decision_ref_chk
    check (btrim(approved_by_decision_ref) <> ''
       and approved_by_decision_ref !~* '\[REQUIRED'),
  -- A verified signature must actually have a signature and a signer.
  constraint trust_policy_signature_consistency_chk
    check (not signature_verified
        or (policy_signature is not null and policy_signer_key_reference is not null))
);

comment on table kitluy_devices.trust_policy is
  'Owner: Security. Signed trust-policy values per environment. The enrollment-station duplicate threshold and window, and the trusted-time forward-jump threshold, live HERE rather than in code — the owner ruled that hardcoding them would silently authorize pilot and production. `signature_verified` is FALSE everywhere because the configuration signer does not exist yet (step 6); recording an unverified signature as verified is exactly the fabrication this programme refuses. MC: MUT (security-governed).';
comment on column kitluy_devices.trust_policy.trusted_time_max_forward_jump_seconds is
  'NULL = [REQUIRED: trusted_time_max_forward_jump_seconds]. The owner refused to let this be invented, so an absent value makes trusted-time evaluation FAIL CLOSED rather than fall back to a guess.';

create unique index trust_policy_one_active_per_env_idx
  on kitluy_devices.trust_policy (environment) where is_active;

-- ---------------------------------------------------------------------------
-- Development trust policy — approved DEVELOPMENT DEFAULTS, not final values.
-- ---------------------------------------------------------------------------
insert into kitluy_devices.trust_policy
  (environment, policy_version,
   duplicate_incident_quarantine_threshold, duplicate_incident_window_seconds,
   max_clock_lag_seconds, trusted_time_max_forward_jump_seconds,
   max_revocation_snapshot_age_seconds,
   policy_payload_sha256, signature_verified,
   approved_by_decision_ref, approved_at, is_active)
values
  ('development', 1,
   2,        -- owner-approved DEVELOPMENT default
   86400,    -- owner-approved DEVELOPMENT default (24h window)
   300,      -- §12.3, ruled
   3600,     -- DEVELOPMENT TEST VALUE ONLY. Not a ruled pilot/production value.
   30 * 24 * 3600,  -- §6 development maximum snapshot age
   encode(sha256(convert_to('kitluy.trust-policy.v1/development/1', 'UTF8')), 'hex'),
   false,
   'KLD-2026-07-28-002', '2026-07-28T00:00:00Z', true)
on conflict do nothing;

-- Pilot and production rows are NOT created. Their absence IS the fail-closed
-- state, and the same environment lock that guards the PKI configuration
-- applies: opening them needs a later decision that names itself.
create or replace function kitluy_devices.enforce_trust_policy_environment_lock()
returns trigger
language plpgsql
as $$
begin
  if new.environment in ('pilot', 'production') then
    if new.approved_by_decision_ref = 'KLD-2026-07-28-002' then
      raise exception
        'KLUY-DEVICE-POLICY-ENVIRONMENT-BLOCKED: KLD-2026-07-28-002 approved DEVELOPMENT defaults only. A % trust policy requires a LATER owner decision that names itself.',
        new.environment using errcode = 'P0001';
    end if;
    if not new.signature_verified then
      raise exception
        'KLUY-DEVICE-POLICY-UNSIGNED: a % trust policy must come from SIGNED configuration; no code default may silently authorize it', new.environment
        using errcode = 'P0001';
    end if;
    if new.trusted_time_max_forward_jump_seconds is null then
      raise exception
        'KLUY-DEVICE-POLICY-INCOMPLETE: [REQUIRED: trusted_time_max_forward_jump_seconds] for environment %', new.environment
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_trust_policy_environment_lock
  before insert or update on kitluy_devices.trust_policy
  for each row execute function kitluy_devices.enforce_trust_policy_environment_lock();

comment on function kitluy_devices.enforce_trust_policy_environment_lock() is
  'Owner ruling 2026-07-28: "Pilot and production values must come from signed configuration; no code default may silently authorize them." A pilot/production policy must therefore be signature-verified, carry the forward-jump threshold, and cite a decision other than the one that approved development defaults.';

create or replace function kitluy_devices.resolve_trust_policy_v1(
  p_environment text
) returns kitluy_devices.trust_policy
language plpgsql
stable
as $$
declare
  v_policy kitluy_devices.trust_policy;
begin
  select * into v_policy from kitluy_devices.trust_policy
  where environment = p_environment and is_active;

  if not found then
    raise exception
      'KLUY-DEVICE-POLICY-UNCONFIGURED: [REQUIRED: signed trust policy for environment %] — no code default may authorize it', p_environment
      using errcode = 'P0001';
  end if;

  if v_policy.trusted_time_max_forward_jump_seconds is null then
    raise exception
      'KLUY-DEVICE-POLICY-INCOMPLETE: [REQUIRED: trusted_time_max_forward_jump_seconds] for environment % — trusted-time evaluation fails closed without it', p_environment
      using errcode = 'P0001';
  end if;

  return v_policy;
end;
$$;

-- ===========================================================================
-- Trusted-time persistence
-- ===========================================================================
create table if not exists kitluy_devices.device_trusted_time (
  device_id uuid primary key references kitluy_devices.devices (id),
  -- The monotonic floor. §12.1: trusted time never moves backwards.
  trusted_time_floor timestamptz,
  last_validated_rtc_time timestamptz,
  last_authenticated_network_time timestamptz,
  last_signed_cloud_token_time timestamptz,
  last_selected_trusted_time timestamptz,
  last_source kitluy_devices.trusted_time_source not null default 'none',
  status kitluy_devices.trusted_time_status not null default 'uninitialized',
  anomaly_type text,
  policy_version integer,
  audit_correlation_id uuid,
  updated_at timestamptz not null default now(),
  -- An anomaly is recorded exactly when the status is restricted. `trusted` and
  -- `uninitialized` both carry no anomaly: never having established time is not
  -- an anomaly, it is the starting condition.
  constraint device_trusted_time_status_consistency_chk
    check ((status::text like 'restricted%') = (anomaly_type is not null)),
  constraint device_trusted_time_floor_requires_selection_chk
    check (trusted_time_floor is null or last_selected_trusted_time is not null)
);

comment on table kitluy_devices.device_trusted_time is
  'Owner: Fleet. Per-device trusted-time state (KLD-2026-07-28-002 §12). trusted_time_floor is monotonic and is advanced only by advance_trusted_time_floor_v1, which writes the floor and its audit record in ONE statement pair inside the caller''s transaction — §12.2 requires the advancement and its evidence to commit atomically. MC: MUT (monotonic).';

create table if not exists kitluy_devices.device_trusted_time_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references kitluy_devices.devices (id),
  event_type text not null,
  from_floor timestamptz,
  to_floor timestamptz,
  selected_time timestamptz,
  source kitluy_devices.trusted_time_source,
  status kitluy_devices.trusted_time_status,
  anomaly_type text,
  policy_version integer,
  correlation_id uuid,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint device_trusted_time_events_type_chk
    check (event_type in (
      'FLOOR_ADVANCED', 'FLOOR_HELD', 'RESTRICTED_ENTERED', 'RESTRICTED_CLEARED',
      'EVALUATION_REFUSED', 'EMERGENCY_CORRECTION', 'FIRST_BOOT_REFUSED'))
);

comment on table kitluy_devices.device_trusted_time_events is
  'Owner: Fleet. Append-only trusted-time audit, including REFUSED evaluations and HELD floors — a floor that did not advance is the interesting record when a clock is being attacked. MC: A/O.';

create index device_trusted_time_events_device_idx
  on kitluy_devices.device_trusted_time_events (device_id, occurred_at desc);

create trigger trg_device_trusted_time_events_append_only
  before update or delete on kitluy_devices.device_trusted_time_events
  for each row execute function kitluy_auth.enforce_append_only();

-- The floor is monotonic, enforced by the database rather than by callers.
create or replace function kitluy_devices.enforce_trusted_time_floor_monotonic()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-DEVICE-TIME-IMMUTABLE: trusted-time state is never deleted'
      using errcode = 'P0001';
  end if;
  if old.trusted_time_floor is not null
     and (new.trusted_time_floor is null or new.trusted_time_floor < old.trusted_time_floor) then
    raise exception
      'KLUY-DEVICE-TIME-ROLLBACK: the trusted-time floor cannot move backwards (% -> %)',
      old.trusted_time_floor, new.trusted_time_floor
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_device_trusted_time_monotonic
  before update or delete on kitluy_devices.device_trusted_time
  for each row execute function kitluy_devices.enforce_trusted_time_floor_monotonic();

comment on function kitluy_devices.enforce_trusted_time_floor_monotonic() is
  'KLD-2026-07-28-002 §12.1, enforced structurally: the floor never moves backwards, not even for a superuser running a correction by hand. Emergency correction goes through emergency_time_correction_v1, which moves the floor FORWARD to the approved value.';

-- ===========================================================================
-- Evaluation
-- ===========================================================================
create type kitluy_devices.trusted_time_outcome as (
  status kitluy_devices.trusted_time_status,
  trusted_time timestamptz,
  source kitluy_devices.trusted_time_source,
  floor_advanced boolean,
  anomaly_type text,
  restricted boolean,
  detail text
);

-- ---------------------------------------------------------------------------
-- evaluate_trusted_time_v1 — the §12 calculation, as a TYPED OUTCOME.
-- ---------------------------------------------------------------------------
-- Returns rather than raises for every ANOMALY, so the anomaly and its audit
-- record survive (the C37 lesson). It still RAISES when policy is missing,
-- because that is a configuration refusal and there is nothing trustworthy to
-- record against.
--
-- Each source is passed in already validated by its provider. A NULL means the
-- provider could not vouch for that source, and an untrusted source never
-- advances the floor (§12 rule "an untrusted source must never advance the
-- floor") — which is why there is no way to pass an unvalidated value here.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.evaluate_trusted_time_v1(
  p_device_id uuid,
  p_environment text,
  p_valid_rtc_time timestamptz,
  p_authenticated_network_time timestamptz,
  p_valid_signed_token_time timestamptz,
  p_correlation_id uuid default null
) returns kitluy_devices.trusted_time_outcome
language plpgsql
as $$
declare
  v_policy kitluy_devices.trust_policy;
  v_state kitluy_devices.device_trusted_time;
  v_floor timestamptz;
  v_best timestamptz;
  v_source kitluy_devices.trusted_time_source := 'none';
  v_status kitluy_devices.trusted_time_status;
  v_anomaly text;
  v_advanced boolean := false;
  v_lag interval;
  v_jump interval;
  v_result kitluy_devices.trusted_time_outcome;
begin
  -- Policy first. An absent forward-jump threshold fails closed here.
  v_policy := kitluy_devices.resolve_trust_policy_v1(p_environment);

  insert into kitluy_devices.device_trusted_time (device_id)
  values (p_device_id)
  on conflict (device_id) do nothing;

  select * into v_state from kitluy_devices.device_trusted_time
  where device_id = p_device_id for update;

  v_floor := v_state.trusted_time_floor;
  v_lag := make_interval(secs => v_policy.max_clock_lag_seconds);
  v_jump := make_interval(secs => v_policy.trusted_time_max_forward_jump_seconds);

  -- §12: trusted time is the MAXIMUM of the VALID sources. A source more than
  -- max_clock_lag behind the floor is rollback and is discarded, not averaged.
  if p_valid_rtc_time is not null and (v_floor is null or p_valid_rtc_time >= v_floor - v_lag) then
    if v_best is null or p_valid_rtc_time > v_best then
      v_best := p_valid_rtc_time; v_source := 'rtc';
    end if;
  end if;
  if p_authenticated_network_time is not null
     and (v_floor is null or p_authenticated_network_time >= v_floor - v_lag) then
    if v_best is null or p_authenticated_network_time > v_best then
      v_best := p_authenticated_network_time; v_source := 'authenticated_network';
    end if;
  end if;
  if p_valid_signed_token_time is not null
     and (v_floor is null or p_valid_signed_token_time >= v_floor - v_lag) then
    if v_best is null or p_valid_signed_token_time > v_best then
      v_best := p_valid_signed_token_time; v_source := 'signed_cloud_token';
    end if;
  end if;

  -- ROLLBACK: a source was offered but every one of them is too far behind.
  if v_best is null
     and (p_valid_rtc_time is not null
       or p_authenticated_network_time is not null
       or p_valid_signed_token_time is not null) then
    v_status := 'restricted_clock_rollback';
    v_anomaly := format('every offered source is more than %s seconds behind the trusted floor',
                        v_policy.max_clock_lag_seconds);

  -- NO SOURCE AT ALL. The floor alone is not a source (§12 first-boot rule).
  elsif v_best is null then
    v_status := case when v_floor is null
      then 'restricted_no_trusted_source'
      else 'restricted_no_trusted_source' end;
    v_anomaly := 'no trustworthy time source was available';

  -- FORWARD JUMP beyond the SIGNED policy threshold. §12.4: an RTC materially
  -- ahead requires investigation and must not blindly advance the floor.
  elsif v_floor is not null and v_best > v_floor + v_jump then
    v_status := 'restricted_forward_jump';
    v_anomaly := format('selected time is more than %s seconds ahead of the trusted floor',
                        v_policy.trusted_time_max_forward_jump_seconds);
  else
    v_status := 'trusted';
    v_anomaly := null;
  end if;

  -- The floor advances ONLY on a trusted evaluation, and only forwards.
  if v_status = 'trusted' and (v_floor is null or v_best > v_floor) then
    v_advanced := true;
  end if;

  -- Floor advancement and its audit record commit together (§12.2). Both are
  -- statements in this one function call, inside the caller's transaction.
  update kitluy_devices.device_trusted_time
  set trusted_time_floor = case when v_advanced then v_best else trusted_time_floor end,
      last_validated_rtc_time = coalesce(p_valid_rtc_time, last_validated_rtc_time),
      last_authenticated_network_time = coalesce(p_authenticated_network_time, last_authenticated_network_time),
      last_signed_cloud_token_time = coalesce(p_valid_signed_token_time, last_signed_cloud_token_time),
      last_selected_trusted_time = coalesce(v_best, last_selected_trusted_time),
      last_source = case when v_best is null then 'none' else v_source end,
      status = v_status,
      anomaly_type = v_anomaly,
      policy_version = v_policy.policy_version,
      audit_correlation_id = p_correlation_id,
      updated_at = now()
  where device_id = p_device_id;

  insert into kitluy_devices.device_trusted_time_events
    (device_id, event_type, from_floor, to_floor, selected_time, source, status,
     anomaly_type, policy_version, correlation_id, detail)
  values
    (p_device_id,
     case when v_advanced then 'FLOOR_ADVANCED'
          when v_status <> 'trusted' then 'RESTRICTED_ENTERED'
          else 'FLOOR_HELD' end,
     v_floor,
     case when v_advanced then v_best else v_floor end,
     v_best, case when v_best is null then 'none' else v_source end, v_status,
     v_anomaly, v_policy.policy_version, p_correlation_id,
     jsonb_build_object('environment', p_environment,
                        'rtc_offered', p_valid_rtc_time is not null,
                        'network_offered', p_authenticated_network_time is not null,
                        'token_offered', p_valid_signed_token_time is not null));

  v_result := row(
    v_status,
    -- The reported trusted time is the greatest of the selection and the floor.
    greatest(coalesce(v_best, v_floor), coalesce(v_floor, v_best)),
    case when v_best is null then 'persisted_floor' else v_source end,
    v_advanced,
    v_anomaly,
    v_status <> 'trusted',
    case v_status
      when 'trusted' then 'trusted time established'
      else coalesce(v_anomaly, 'restricted') end
  )::kitluy_devices.trusted_time_outcome;

  return v_result;
end;
$$;

comment on function kitluy_devices.evaluate_trusted_time_v1 is
  'KLD-2026-07-28-002 §12 trusted-time calculation. Takes the MAXIMUM of the VALIDATED sources, discards any source more than the signed max_clock_lag behind the floor as rollback, refuses a jump beyond the SIGNED forward-jump threshold, and advances the monotonic floor only on a trusted evaluation. Returns a TYPED OUTCOME for anomalies so the anomaly and its audit survive; raises only when policy is missing, because there is then nothing trustworthy to record against. A caller cannot pass an unvalidated source — validation belongs to the provider, and an untrusted source never reaches the floor.';

-- ---------------------------------------------------------------------------
-- §12 first boot / restricted mode gates
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.is_trusted_time_restricted_v1(
  p_device_id uuid
) returns boolean
language sql
stable
as $$
  select coalesce(
    (select status <> 'trusted' from kitluy_devices.device_trusted_time
      where device_id = p_device_id),
    true);  -- a device with no trusted-time record has never established time
$$;

comment on function kitluy_devices.is_trusted_time_restricted_v1(uuid) is
  'True when the device is in restricted trust mode. A device with NO trusted-time record returns TRUE: never having established trusted time is not the same as being fine, and defaulting the other way would let first boot skip the check entirely.';

create or replace function kitluy_devices.assert_trusted_time_v1(
  p_device_id uuid,
  p_operation text
) returns void
language plpgsql
stable
as $$
declare
  v_state kitluy_devices.device_trusted_time;
begin
  select * into v_state from kitluy_devices.device_trusted_time where device_id = p_device_id;

  if not found or v_state.status = 'uninitialized' then
    raise exception
      'KLUY-DEVICE-TIME-UNTRUSTED: % refused — device % has never established trusted time. A Store Hub with no WAN and an invalid RTC stays in awaiting_trust (KLD-2026-07-28-002 §12.5, §12.10)', p_operation, p_device_id
      using errcode = 'P0001';
  end if;

  if v_state.status <> 'trusted' then
    raise exception
      'KLUY-DEVICE-TIME-RESTRICTED: % refused — device % is in restricted trust mode (%): %',
      p_operation, p_device_id, v_state.status, coalesce(v_state.anomaly_type, 'unknown anomaly')
      using errcode = 'P0001',
            hint = 'Restricted mode blocks certificate issuance and renewal, device and assignment activation, signer changes, trust-policy changes, support access, release promotion and configuration signer rotation. Existing locally authorized Laundry operations continue under the last valid signed snapshot.';
  end if;
end;
$$;

comment on function kitluy_devices.assert_trusted_time_v1 is
  'The restricted-trust-mode gate (KLD-2026-07-28-002 §12.8 and the owner''s restricted-mode list). Called by every TRUST-CHANGING operation. Store operations do not call it — that is the whole point of the restricted/quarantined distinction.';

-- ---------------------------------------------------------------------------
-- Emergency correction — a TYPED OUTCOME, not an exception that erases itself.
-- ---------------------------------------------------------------------------
create type kitluy_devices.time_correction_outcome as (
  outcome text,
  device_id uuid,
  old_trusted_time timestamptz,
  new_trusted_time timestamptz,
  refusal_code text,
  refusal_message text,
  evidence_event_id uuid
);

create or replace function kitluy_devices.emergency_time_correction_v1(
  p_device_id uuid,
  p_proposed_trusted_time timestamptz,
  p_evidence_source text,
  p_reason text,
  p_approval_id text,
  p_actor_ref text,
  p_approver_ref text,
  p_correlation_id uuid default null
) returns kitluy_devices.time_correction_outcome
language plpgsql
as $$
declare
  v_state kitluy_devices.device_trusted_time;
  v_code text;
  v_message text;
  v_event_id uuid;
begin
  select * into v_state from kitluy_devices.device_trusted_time
  where device_id = p_device_id for update;

  if not found then
    insert into kitluy_devices.device_trusted_time (device_id) values (p_device_id);
    select * into v_state from kitluy_devices.device_trusted_time
    where device_id = p_device_id for update;
  end if;

  -- Every refusal below RECORDS before it returns. §12.9 requires the old and
  -- new values, evidence source, reason, approval and an immutable audit —
  -- including for the corrections that were refused.
  if coalesce(btrim(p_approval_id), '') = '' then
    v_code := 'KLUY-DEVICE-TIME-CORRECTION-UNAPPROVED';
    v_message := 'emergency time correction requires an A3/A4 approval id';
  elsif coalesce(btrim(p_approver_ref), '') = '' then
    v_code := 'KLUY-DEVICE-TIME-CORRECTION-UNAPPROVED';
    v_message := 'emergency time correction requires a named approver';
  elsif p_actor_ref = p_approver_ref then
    v_code := 'KLUY-DEVICE-TIME-CORRECTION-SELF-APPROVED';
    v_message := format('%s cannot approve their own time correction', p_actor_ref);
  elsif coalesce(btrim(p_evidence_source), '') = '' then
    v_code := 'KLUY-DEVICE-TIME-CORRECTION-UNEVIDENCED';
    v_message := 'emergency time correction requires an evidence source';
  elsif coalesce(btrim(p_reason), '') = '' then
    v_code := 'KLUY-DEVICE-TIME-CORRECTION-UNEVIDENCED';
    v_message := 'emergency time correction requires a reason';
  elsif v_state.trusted_time_floor is not null
        and p_proposed_trusted_time < v_state.trusted_time_floor then
    -- §12.1 holds even under emergency authority. Correction moves time
    -- FORWARD; moving it back is the attack this whole mechanism exists for.
    v_code := 'KLUY-DEVICE-TIME-ROLLBACK';
    v_message := format('proposed %s is behind the trusted floor %s; trusted time never moves backwards',
                        p_proposed_trusted_time, v_state.trusted_time_floor);
  end if;

  if v_code is not null then
    insert into kitluy_devices.device_trusted_time_events
      (device_id, event_type, from_floor, to_floor, selected_time, status,
       anomaly_type, correlation_id, detail)
    values
      (p_device_id, 'EMERGENCY_CORRECTION', v_state.trusted_time_floor,
       v_state.trusted_time_floor, p_proposed_trusted_time, v_state.status,
       v_code, p_correlation_id,
       jsonb_build_object('outcome', 'REFUSED', 'refusal_code', v_code,
                          'proposed', p_proposed_trusted_time,
                          'actor', p_actor_ref, 'approver', p_approver_ref,
                          'approval_id', p_approval_id,
                          'evidence_source', p_evidence_source, 'reason', p_reason))
    returning id into v_event_id;

    return row('REFUSED', p_device_id, v_state.trusted_time_floor, null,
               v_code, v_message, v_event_id)::kitluy_devices.time_correction_outcome;
  end if;

  -- The correction, the floor advancement, the approval reference and the audit
  -- all commit together (§12.9 "atomic").
  update kitluy_devices.device_trusted_time
  set trusted_time_floor = p_proposed_trusted_time,
      last_selected_trusted_time = p_proposed_trusted_time,
      last_source = 'signed_cloud_token',
      status = 'trusted',
      anomaly_type = null,
      audit_correlation_id = p_correlation_id,
      updated_at = now()
  where device_id = p_device_id;

  insert into kitluy_devices.device_trusted_time_events
    (device_id, event_type, from_floor, to_floor, selected_time, status,
     correlation_id, detail)
  values
    (p_device_id, 'EMERGENCY_CORRECTION', v_state.trusted_time_floor,
     p_proposed_trusted_time, p_proposed_trusted_time, 'trusted', p_correlation_id,
     jsonb_build_object('outcome', 'APPLIED', 'actor', p_actor_ref,
                        'approver', p_approver_ref, 'approval_id', p_approval_id,
                        'evidence_source', p_evidence_source, 'reason', p_reason))
  returning id into v_event_id;

  return row('APPLIED', p_device_id, v_state.trusted_time_floor,
             p_proposed_trusted_time, null, null,
             v_event_id)::kitluy_devices.time_correction_outcome;
end;
$$;

comment on function kitluy_devices.emergency_time_correction_v1 is
  'KLD-2026-07-28-002 §12.9. Returns a TYPED OUTCOME rather than raising, so a REFUSED correction leaves the same durable evidence an applied one does — the C37 lesson. Requires an approval id, a named approver who is NOT the actor, an evidence source and a reason. Refuses to move trusted time backwards even under emergency authority, because backwards is the attack the mechanism exists to stop.';

-- ===========================================================================
-- Wire restricted trust mode into the trust-changing operations
-- ===========================================================================
create or replace function kitluy_devices.activate_device_v1(
  p_device_id uuid,
  p_environment text,
  p_actor_ref text
) returns void
language plpgsql
as $$
declare
  v_device kitluy_devices.devices;
  v_open_incidents integer;
  v_collisions integer;
  v_assignment kitluy_devices.device_assignments;
begin
  select * into v_device from kitluy_devices.devices where id = p_device_id for update;
  if not found then
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;

  -- THE BLK-005 GATE, still first.
  perform kitluy_devices.assert_pki_configuration_approved(p_environment);

  -- §12.5 / §12.10: a device that has never established trusted time cannot
  -- activate, and a device in restricted trust mode cannot either. This runs
  -- BEFORE the state check so "the clock is not trustworthy" is the answer
  -- rather than an incidental state complaint.
  perform kitluy_devices.assert_trusted_time_v1(p_device_id, 'device activation');

  if v_device.lifecycle_state <> 'awaiting_trust' then
    raise exception 'KLUY-DEVICE-ACTIVATION-STATE: device % is %; only a claimed, scope-bound device awaiting trust activates', p_device_id, v_device.lifecycle_state
      using errcode = 'P0001';
  end if;

  select count(*) into v_collisions
  from kitluy_devices.colliding_evidence_device_ids(p_device_id);
  if v_collisions > 0 then
    raise exception 'KLUY-DEVICE-EVIDENCE-COLLISION: device % shares hardware evidence with % other non-retired device(s); neither may activate until the duplicate is resolved', p_device_id, v_collisions
      using errcode = 'P0001';
  end if;

  select count(*) into v_open_incidents
  from kitluy_devices.device_trust_incidents
  where device_id = p_device_id and cleared_at is null
    and incident_type <> 'activation_blocked';
  if v_open_incidents > 0 then
    raise exception 'KLUY-DEVICE-OPEN-INCIDENT: device % has % open trust incident(s); activation requires governed clearance', p_device_id, v_open_incidents
      using errcode = 'P0001';
  end if;

  select * into v_assignment
  from kitluy_devices.device_assignments
  where device_id = p_device_id and state = 'pending_trust' for update;
  if not found then
    raise exception 'KLUY-DEVICE-NO-ASSIGNMENT: device % has no assignment pending trust; the claim must be redeemed first', p_device_id
      using errcode = 'P0001';
  end if;

  if v_assignment.assignment_generation <> v_device.assignment_generation then
    raise exception 'KLUY-DEVICE-GENERATION-STALE: device % carries generation %, the pending assignment is %',
      p_device_id, v_device.assignment_generation, v_assignment.assignment_generation
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from kitluy_devices.device_certificates
    where device_id = p_device_id and environment = p_environment and status = 'active'
  ) then
    raise exception 'KLUY-DEVICE-NO-CERTIFICATE: device % has no active % certificate; activation is certificate-backed (KLD-2026-07-21-003)', p_device_id, p_environment
      using errcode = 'P0001';
  end if;

  update kitluy_devices.devices
  set lifecycle_state = 'active', updated_at = now() where id = p_device_id;

  update kitluy_devices.device_assignments
  set state = 'active', activated_at = now() where id = v_assignment.id;

  update kitluy_devices.device_terminal_assignments
  set state = 'active' where assignment_id = v_assignment.id and state = 'pending_trust';

  insert into kitluy_devices.device_assignment_projections
    (device_id, assignment_id, assignment_generation, tenant_id,
     digital_store_id, store_location_id, terminal_profile_keys, environment)
  values
    (p_device_id, v_assignment.id, v_assignment.assignment_generation,
     v_assignment.tenant_id, v_assignment.digital_store_id, v_assignment.store_location_id,
     coalesce((select array_agg(t.terminal_profile_key order by t.terminal_profile_key)
               from kitluy_devices.device_terminal_assignments t
               where t.assignment_id = v_assignment.id and t.state = 'active'), '{}'),
     p_environment)
  on conflict (device_id) do update
    set assignment_id = excluded.assignment_id,
        assignment_generation = excluded.assignment_generation,
        tenant_id = excluded.tenant_id,
        digital_store_id = excluded.digital_store_id,
        store_location_id = excluded.store_location_id,
        terminal_profile_keys = excluded.terminal_profile_keys,
        projected_at = now(),
        environment = excluded.environment;

  update kitluy_devices.device_trust_incidents
  set cleared_at = now(), cleared_by_operator_ref = p_actor_ref,
      clearance_reason = 'ACTIVATION_SUCCEEDED'
  where device_id = p_device_id and incident_type = 'activation_blocked' and cleared_at is null;

  perform kitluy_devices.record_lifecycle_event(
    p_device_id, 'awaiting_trust', 'active', 'ACTIVATED', p_actor_ref,
    jsonb_build_object('environment', p_environment,
                       'assignment_id', v_assignment.id,
                       'assignment_generation', v_assignment.assignment_generation));
end;
$$;

comment on function kitluy_devices.activate_device_v1 is
  'BLK-005 gated, then TRUSTED-TIME gated, then state/evidence/assignment/certificate gated — in that order, so the refusal names the deepest blocker rather than an incidental one. Not reachable by an application role: attempt_activate_device_v1 is the only granted path (KLRISK-DEVICE-001).';

-- Certificate issuance is trust-changing, so restricted mode blocks it too.
create or replace function kitluy_devices.issue_device_certificate_v1(
  p_device_id uuid,
  p_environment text,
  p_certificate_serial text,
  p_public_key_fingerprint text,
  p_actor_ref text
) returns uuid
language plpgsql
as $$
declare
  v_config kitluy_devices.pki_trust_configuration;
  v_device kitluy_devices.devices;
  v_enrollment kitluy_devices.manufacturing_enrollments;
  v_certificate_id uuid;
begin
  select * into v_device from kitluy_devices.devices where id = p_device_id for update;
  if not found then
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;

  v_config := kitluy_devices.assert_pki_configuration_approved(p_environment);
  perform kitluy_devices.assert_trusted_time_v1(p_device_id, 'certificate issuance');

  select * into v_enrollment from kitluy_devices.manufacturing_enrollments
  where id = v_device.current_enrollment_id and state = 'sealed';
  if not found then
    raise exception 'KLUY-DEVICE-NOT-ENROLLED: device % has no sealed enrollment; certificates are issued against enrollment evidence', p_device_id
      using errcode = 'P0001';
  end if;

  if v_enrollment.key_storage_class <> v_config.required_key_storage_class then
    raise exception 'KLUY-DEVICE-KEY-STORAGE: environment % requires key storage class %, enrollment presented %',
      p_environment, v_config.required_key_storage_class, v_enrollment.key_storage_class
      using errcode = 'P0001';
  end if;

  insert into kitluy_devices.device_certificates
    (device_id, enrollment_id, environment, certificate_serial, public_key_fingerprint,
     issuer_reference, status, issued_at, expires_at)
  values
    (p_device_id, v_enrollment.id, p_environment, p_certificate_serial,
     lower(p_public_key_fingerprint), v_config.device_issuing_ca_reference,
     'active', now(), now() + make_interval(days => v_config.certificate_lifetime_days))
  returning id into v_certificate_id;

  perform kitluy_devices.record_lifecycle_event(
    p_device_id, v_device.lifecycle_state, v_device.lifecycle_state,
    'CERTIFICATE_ISSUED', p_actor_ref,
    jsonb_build_object('certificate_id', v_certificate_id, 'environment', p_environment));

  return v_certificate_id;
end;
$$;

comment on function kitluy_devices.issue_device_certificate_v1 is
  'BLK-005 gated and TRUSTED-TIME gated. Still records a certificate STATUS and issues nothing — the actual CA is step 4. §12.6 makes certificate validity depend on trusted time, so a device in restricted trust mode cannot obtain one.';

-- ---------------------------------------------------------------------------
-- Station duplicate threshold, now read from SIGNED POLICY
-- ---------------------------------------------------------------------------
alter table kitluy_devices.enrollment_stations
  add column if not exists last_duplicate_at timestamptz,
  add column if not exists monitoring_elevated boolean not null default false;

create or replace function kitluy_devices.record_station_duplicate_submission_v1(
  p_station_key text,
  p_device_id uuid,
  -- No DEFAULTs. With defaults, a two-argument call would match BOTH this and
  -- the group-0122 signature and PostgreSQL would refuse the call as ambiguous.
  -- Requiring both arguments keeps the overload resolvable and makes the
  -- environment an explicit choice at every call site.
  p_environment text,
  p_immediate_reason text
) returns boolean
language plpgsql
as $$
declare
  v_station kitluy_devices.enrollment_stations;
  v_policy kitluy_devices.trust_policy;
  v_in_window boolean;
  v_count integer;
begin
  v_policy := kitluy_devices.resolve_trust_policy_v1(p_environment);

  select * into v_station from kitluy_devices.enrollment_stations
  where station_key = p_station_key for update;

  if not found then
    perform kitluy_devices.record_lifecycle_event(
      p_device_id, null, 'quarantined', 'UNREGISTERED_ENROLLMENT_STATION', p_station_key,
      jsonb_build_object('station_key', p_station_key));
    return false;
  end if;

  -- Only submissions inside the signed window count toward the threshold.
  -- Outside it, the counter restarts — two duplicates a year apart are not a
  -- pattern, and treating them as one would quarantine an honest station.
  v_in_window := v_station.last_duplicate_at is not null
    and v_station.last_duplicate_at > now() - make_interval(secs => v_policy.duplicate_incident_window_seconds);
  v_count := case when v_in_window then v_station.duplicate_submission_count + 1 else 1 end;

  update kitluy_devices.enrollment_stations
  set duplicate_submission_count = v_count,
      last_duplicate_at = now(),
      -- First duplicate: increased monitoring, per the owner's ruling.
      monitoring_elevated = true
  where id = v_station.id;

  -- Immediate quarantine REGARDLESS of count, per the owner's four conditions.
  if p_immediate_reason is not null
     or v_count >= v_policy.duplicate_incident_quarantine_threshold then
    if v_station.status = 'active' then
      update kitluy_devices.enrollment_stations
      set status = 'quarantined', quarantined_at = now(),
          quarantine_reason = coalesce(
            p_immediate_reason,
            format('%s duplicate-evidence submissions within %s seconds reached the signed threshold of %s',
                   v_count, v_policy.duplicate_incident_window_seconds,
                   v_policy.duplicate_incident_quarantine_threshold))
      where id = v_station.id;

      insert into kitluy_devices.device_trust_incidents
        (device_id, incident_type, severity, detected_by, detail)
      values
        (p_device_id, 'enrollment_station_abuse', 'CRITICAL', p_station_key,
         jsonb_build_object('station_key', p_station_key,
                            'submission_count', v_count,
                            'threshold', v_policy.duplicate_incident_quarantine_threshold,
                            'window_seconds', v_policy.duplicate_incident_window_seconds,
                            'immediate_reason', p_immediate_reason,
                            'policy_version', v_policy.policy_version));
      return true;
    end if;
  end if;

  return false;
end;
$$;

-- The group-0122 two-argument form is kept and DELEGATES, rather than being
-- dropped. `enroll_device_v1` calls it, and dropping it would mean re-pasting
-- that whole function here to change one call site — more surface for a
-- transcription error than the wrapper costs.
create or replace function kitluy_devices.record_station_duplicate_submission_v1(
  p_station_key text,
  p_device_id uuid
) returns boolean
language sql
as $$
  select kitluy_devices.record_station_duplicate_submission_v1(
    p_station_key, p_device_id, 'development', null);
$$;

comment on function kitluy_devices.record_station_duplicate_submission_v1(text, uuid) is
  'Compatibility wrapper for the group-0122 call site in enroll_device_v1. Delegates to the four-argument form with the DEVELOPMENT policy. A pilot or production enrollment path must call the four-argument form with its own environment, because resolve_trust_policy_v1 fails closed there.';

comment on function kitluy_devices.record_station_duplicate_submission_v1(text, uuid, text, text) is
  'Owner ruling 2026-07-28: the duplicate threshold and window are SIGNED POLICY, not code constants. First duplicate raises monitoring; a second inside the window quarantines the station. p_immediate_reason quarantines regardless of count for the four listed conditions (same TPM/secure-element identity, same private-key fingerprint, invalid or revoked station certificate, evidence of deliberate tampering). Submissions outside the window restart the counter — two duplicates a year apart are not a pattern, and treating them as one would contain an honest station.';

-- ---------------------------------------------------------------------------
-- RLS and grants.
-- ---------------------------------------------------------------------------
alter table kitluy_devices.trust_policy enable row level security;
alter table kitluy_devices.trust_policy force row level security;
alter table kitluy_devices.device_trusted_time enable row level security;
alter table kitluy_devices.device_trusted_time force row level security;
alter table kitluy_devices.device_trusted_time_events enable row level security;
alter table kitluy_devices.device_trusted_time_events force row level security;

grant select, insert, update on
  kitluy_devices.trust_policy, kitluy_devices.device_trusted_time,
  kitluy_devices.device_trusted_time_events
  to service_role;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'kitluy_devices'
  loop
    execute format('revoke all on function %s from public', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
end $$;

revoke all on function
  kitluy_devices.activate_device_v1(uuid, text, text) from public, service_role;

commit;
