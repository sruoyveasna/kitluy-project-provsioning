-- kitluy:group:0134
-- Migration group 0134: credential_overlap_lifecycle (WS-11-T003 Step 4).
--
-- Additive. Groups 0120-0133 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- DEFECT — THE PREVIOUS CREDENTIAL COULD NEVER BE RETIRED
-- ===========================================================================
-- Group 0125 gave `device_credentials.state` the values `superseded` and
-- `expired`, and group 0127 advances the head with a `previous_generation` and
-- an `overlap_ends_at`. NOTHING ever moves a credential into either state.
--
-- Proven by execution, under both identities:
--
--   postgres            -> permission denied for table device_credentials
--   kitluy_issuance_service -> permission denied for table device_credentials
--
-- and no function in `kitluy_devices` performs the transition. So once the §5
-- three-day overlap ended, the previous credential stayed `issued` FOR EVER.
-- Nothing was wrong with the row; there was simply no way to say the overlap
-- was over.
--
-- That matters beyond tidiness. Group 0133's `permittedOverlap` lets a caller
-- present the previous credential during the granted window; without a durable
-- RETIRED state, the only thing standing between a lapsed overlap and a
-- still-accepted credential is the caller remembering to stop supplying the
-- overlap. A lifecycle fact has to be persisted, not remembered.
--
-- ===========================================================================
-- THE HEAD IS DELIBERATELY NOT REWRITTEN
-- ===========================================================================
-- Retirement sets the CREDENTIAL's state and leaves
-- `device_credential_heads.previous_generation` / `overlap_ends_at` alone.
--
-- Two reasons. First, group 0125's head trigger requires `version` to advance
-- by exactly one on any UPDATE, and bumping it would invalidate the frozen
-- `head_version_seen` of any renewal reservation in flight — retiring an old
-- credential would break a concurrent renewal. Second, `overlap_ends_at` is the
-- historical record of WHEN the overlap ended, and clearing it would destroy
-- the evidence that explains the retirement.
--
-- ===========================================================================
-- DESTRUCTION IS NOT IMPLEMENTED HERE, AND CANNOT BE
-- ===========================================================================
-- No owner decision governs private-key retention or destruction. Rather than
-- invent a duration, this migration creates the policy table EMPTY of
-- permission and names the missing decision, exactly as group 0129 did for key
-- rotation. `destruction_enabled` cannot be set true without naming a decision
-- AND both retention periods — a CHECK, not a convention.
--
-- So provider-key destruction is SPECIFIED and BLOCKED. The lifecycle service
-- can evaluate ELIGIBILITY and record it; it cannot destroy anything.

begin;

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- ===========================================================================
-- Destruction policy — created WITHOUT permission, naming what is missing
-- ===========================================================================
create table if not exists kitluy_devices.key_destruction_policy (
  environment text primary key,
  destruction_enabled boolean not null default false,
  -- Null until an owner rules. No code default may stand in for them.
  minimum_retention_days integer,
  recovery_retention_days integer,
  requires_operator_approval boolean not null default true,
  approved_by_decision_ref text,
  required_owner_decision text,
  updated_at timestamptz not null default now(),

  constraint key_destruction_policy_env_chk
    check (environment in ('development', 'pilot', 'production')),
  -- Destruction cannot be enabled by flipping a boolean.
  constraint key_destruction_policy_needs_decision_chk
    check (destruction_enabled = false or approved_by_decision_ref is not null),
  -- Nor without the two durations the decision has to supply.
  constraint key_destruction_policy_needs_retention_chk
    check (
      destruction_enabled = false
      or (minimum_retention_days is not null and recovery_retention_days is not null)
    ),
  constraint key_destruction_policy_retention_nonnegative_chk
    check (
      coalesce(minimum_retention_days, 0) >= 0 and coalesce(recovery_retention_days, 0) >= 0
    )
);

comment on table kitluy_devices.key_destruction_policy is
  'Owner: Fleet/Security. Whether a superseded device private key may be DESTROYED, and after how long. Created with destruction DISABLED and every duration NULL because no owner decision exists — inventing a retention period is exactly the failure this table prevents. `destruction_enabled` cannot be true without naming an approving decision AND both retention periods, enforced by CHECK rather than by convention.';

insert into kitluy_devices.key_destruction_policy
  (environment, destruction_enabled, requires_operator_approval, required_owner_decision)
values
  ('development', false, true, '[REQUIRED: device_key_destruction_owner_decision]')
on conflict (environment) do nothing;

-- ===========================================================================
-- Durable lifecycle evidence
-- ===========================================================================
create table if not exists kitluy_devices.device_credential_lifecycle_events (
  lifecycle_execution_id uuid primary key default gen_random_uuid(),
  device_record_id uuid not null references kitluy_devices.devices (id),
  environment text not null,
  purpose text not null,

  -- Which clock decided, and whether it was trusted. A lifecycle advanced on an
  -- untrusted clock is the thing this column exists to make visible.
  trusted_time_used timestamptz not null,
  trusted_time_source text not null,
  trusted_time_status text not null,

  current_credential_id uuid references kitluy_devices.device_credentials (credential_id),
  current_credential_generation integer,
  previous_credential_id uuid references kitluy_devices.device_credentials (credential_id),
  previous_credential_generation integer,
  overlap_ends_at timestamptz,

  classification text not null,
  credential_transition text not null,
  provider_key_transition text not null,
  destruction_policy_reference text,
  provider_result text,
  database_confirmation_result text,
  reason text not null,
  actor_ref text not null,
  replay_outcome text not null,

  occurred_at timestamptz not null default clock_timestamp(),
  -- A total order. Several advancements can share one transaction, and now()
  -- would stamp them identically — the same defect group 0133 hit.
  sequence_no bigint not null generated always as identity,

  constraint device_credential_lifecycle_events_env_chk check (environment = 'development'),
  constraint device_credential_lifecycle_events_purpose_chk
    check (purpose = 'device_identity'),
  -- Lifecycle NAMES only. The cheapest way to leak a key is to log it while
  -- explaining what happened to it.
  constraint device_credential_lifecycle_events_no_key_material_chk check (
    reason !~ 'BEGIN [A-Z ]*PRIVATE KEY'
    and coalesce(provider_result, '') !~ 'BEGIN [A-Z ]*PRIVATE KEY'
    and credential_transition !~ 'BEGIN [A-Z ]*PRIVATE KEY'
    and provider_key_transition !~ 'BEGIN [A-Z ]*PRIVATE KEY'
  )
);

comment on table kitluy_devices.device_credential_lifecycle_events is
  'Owner: Fleet. APPEND-ONLY record of every credential-overlap lifecycle advancement: the trusted time that decided it and whether that time was trusted, both credentials, the overlap end, the classification, the credential and provider-key transitions, the destruction policy consulted, and the provider and database results. Separate from device_lifecycle_events, which records DEVICE states and has nowhere to put a credential generation or a provider-key transition. Never edited: a later advancement appends. MC: A/O.';

create index device_credential_lifecycle_events_device_idx
  on kitluy_devices.device_credential_lifecycle_events (device_record_id, sequence_no desc);

create trigger trg_device_credential_lifecycle_events_append_only
  before update or delete on kitluy_devices.device_credential_lifecycle_events
  for each row execute function kitluy_auth.enforce_append_only();

-- ===========================================================================
-- RETIRE the previous credential once its overlap has ended
-- ===========================================================================
create or replace function kitluy_devices.retire_overlapped_credential_v1(
  p_device_record_id uuid,
  p_environment text,
  p_purpose text,
  p_trusted_time timestamptz,
  p_trusted_time_status text,
  p_actor_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $retire$
declare
  v_head kitluy_devices.device_credential_heads;
  v_previous kitluy_devices.device_credentials;
begin
  if p_trusted_time_status is distinct from 'trusted' or p_trusted_time is null then
    raise exception
      'KLUY-LIFECYCLE-NO-TRUSTED-TIME: retirement requires established trusted time (status %)',
      coalesce(p_trusted_time_status, 'null') using errcode = 'P0001';
  end if;

  select * into v_head from kitluy_devices.device_credential_heads
  where device_record_id = p_device_record_id
    and environment = p_environment and purpose = p_purpose
  for update;
  if not found then
    raise exception 'KLUY-LIFECYCLE-NO-HEAD: nothing to advance for this device'
      using errcode = 'P0001';
  end if;

  if v_head.previous_generation is null then
    return jsonb_build_object('outcome', 'NO_PREVIOUS_GENERATION',
                              'current_generation', v_head.current_generation);
  end if;

  select * into v_previous from kitluy_devices.device_credentials
  where device_record_id = p_device_record_id and environment = p_environment
    and purpose = p_purpose and certificate_generation = v_head.previous_generation
  for update;
  if not found then
    raise exception
      'KLUY-LIFECYCLE-NO-PREVIOUS-CREDENTIAL: the head names generation % and no credential exists there',
      v_head.previous_generation using errcode = 'P0001';
  end if;

  -- IDEMPOTENT. A credential already retired replays; a REVOKED one is left
  -- exactly as it is, because revocation is a stronger statement than
  -- supersession and overwriting it would erase why it stopped being usable.
  if v_previous.state <> 'issued' then
    return jsonb_build_object(
      'outcome', 'ALREADY_RETIRED',
      'previous_credential_id', v_previous.credential_id,
      'previous_generation', v_previous.certificate_generation,
      'previous_state', v_previous.state::text);
  end if;

  -- HALF-OPEN INTERVAL: valid while trusted_now < overlap_ends_at, expired at
  -- and after it. Stated once, here, so no caller invents a millisecond gap.
  if p_trusted_time < v_head.overlap_ends_at then
    return jsonb_build_object(
      'outcome', 'OVERLAP_ACTIVE',
      'overlap_ends_at', to_char(v_head.overlap_ends_at at time zone 'UTC',
                                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'previous_credential_id', v_previous.credential_id,
      'previous_generation', v_previous.certificate_generation);
  end if;

  -- The CURRENT credential is never retired by this path, whatever a caller
  -- asks for: it is selected by the head, not named by the caller.
  if v_previous.certificate_generation >= v_head.current_generation then
    raise exception
      'KLUY-LIFECYCLE-WOULD-RETIRE-CURRENT: generation % is not behind the head at %',
      v_previous.certificate_generation, v_head.current_generation using errcode = 'P0001';
  end if;

  update kitluy_devices.device_credentials
  set state = 'superseded'
  where credential_id = v_previous.credential_id;

  return jsonb_build_object(
    'outcome', 'RETIRED',
    'previous_credential_id', v_previous.credential_id,
    'previous_generation', v_previous.certificate_generation,
    'current_generation', v_head.current_generation,
    'overlap_ends_at', to_char(v_head.overlap_ends_at at time zone 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end
$retire$;

comment on function kitluy_devices.retire_overlapped_credential_v1 is
  'Retires the PREVIOUS credential once its §5 overlap has ended, on a HALF-OPEN interval: valid while trusted_now < overlap_ends_at, expired at and after it. The credential is selected from the HEAD, never named by the caller, so the current credential cannot be retired. Idempotent, and it never overwrites a revoked credential — revocation says more than supersession and must not be erased. The head row is deliberately untouched: bumping its version would invalidate the frozen head_version_seen of any renewal in flight, and overlap_ends_at is the evidence explaining the retirement.';

-- ===========================================================================
-- The lifecycle audit writer
-- ===========================================================================
create or replace function kitluy_devices.record_credential_lifecycle_event_v1(
  p_device_record_id uuid,
  p_environment text,
  p_purpose text,
  p_trusted_time timestamptz,
  p_trusted_time_source text,
  p_trusted_time_status text,
  p_current_credential_id uuid,
  p_current_credential_generation integer,
  p_previous_credential_id uuid,
  p_previous_credential_generation integer,
  p_overlap_ends_at timestamptz,
  p_classification text,
  p_credential_transition text,
  p_provider_key_transition text,
  p_destruction_policy_reference text,
  p_provider_result text,
  p_database_confirmation_result text,
  p_reason text,
  p_replay_outcome text,
  p_actor_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $record$
declare
  v_row kitluy_devices.device_credential_lifecycle_events;
begin
  if coalesce(p_classification, '') = '' or coalesce(p_reason, '') = ''
     or coalesce(p_actor_ref, '') = '' or coalesce(p_replay_outcome, '') = '' then
    raise exception
      'KLUY-LIFECYCLE-INCOMPLETE: a lifecycle record needs a classification, a reason, a replay outcome and an actor'
      using errcode = 'P0001';
  end if;

  insert into kitluy_devices.device_credential_lifecycle_events (
    device_record_id, environment, purpose, trusted_time_used, trusted_time_source,
    trusted_time_status, current_credential_id, current_credential_generation,
    previous_credential_id, previous_credential_generation, overlap_ends_at,
    classification, credential_transition, provider_key_transition,
    destruction_policy_reference, provider_result, database_confirmation_result,
    reason, replay_outcome, actor_ref)
  values (
    p_device_record_id, p_environment, p_purpose, p_trusted_time, p_trusted_time_source,
    p_trusted_time_status, p_current_credential_id, p_current_credential_generation,
    p_previous_credential_id, p_previous_credential_generation, p_overlap_ends_at,
    p_classification, p_credential_transition, p_provider_key_transition,
    p_destruction_policy_reference, p_provider_result, p_database_confirmation_result,
    p_reason, p_replay_outcome, p_actor_ref)
  returning * into v_row;

  return jsonb_build_object(
    'outcome', 'RECORDED',
    'lifecycle_execution_id', v_row.lifecycle_execution_id,
    'sequence_no', v_row.sequence_no);
end
$record$;

comment on function kitluy_devices.record_credential_lifecycle_event_v1 is
  'Appends one credential-lifecycle advancement record. Append-only by trigger; a later advancement adds a row rather than editing one. Records WHICH clock decided and whether it was trusted, because a lifecycle advanced on an untrusted clock has to be visible rather than inferred.';

-- ===========================================================================
-- Grants, ownership, hygiene
-- ===========================================================================
alter table kitluy_devices.key_destruction_policy enable row level security;
alter table kitluy_devices.key_destruction_policy force row level security;
alter table kitluy_devices.device_credential_lifecycle_events enable row level security;
alter table kitluy_devices.device_credential_lifecycle_events force row level security;

grant select on kitluy_devices.key_destruction_policy
  to kitluy_credential_issuer, service_role;
grant select, insert on kitluy_devices.device_credential_lifecycle_events
  to kitluy_credential_issuer;
grant select on kitluy_devices.device_credential_lifecycle_events to service_role;

create policy key_destruction_policy_issuer_read on kitluy_devices.key_destruction_policy
  for select to kitluy_credential_issuer using (true);
create policy key_destruction_policy_service_read on kitluy_devices.key_destruction_policy
  for select to service_role using (true);
create policy device_credential_lifecycle_events_issuer_write
  on kitluy_devices.device_credential_lifecycle_events
  for all to kitluy_credential_issuer using (true) with check (true);
create policy device_credential_lifecycle_events_service_read
  on kitluy_devices.device_credential_lifecycle_events
  for select to service_role using (true);

alter function kitluy_devices.retire_overlapped_credential_v1(
  uuid, text, text, timestamptz, text, text) owner to kitluy_credential_issuer;
alter function kitluy_devices.record_credential_lifecycle_event_v1(
  uuid, text, text, timestamptz, text, text, uuid, integer, uuid, integer, timestamptz,
  text, text, text, text, text, text, text, text, text) owner to kitluy_credential_issuer;

do $revoke_public$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'kitluy_devices'
  loop
    execute format('revoke all on function %s from public', r.signature);
  end loop;
end
$revoke_public$;

do $issuance_grants$
declare
  r text;
begin
  foreach r in array array[
    'retire_overlapped_credential_v1(uuid, text, text, timestamptz, text, text)',
    'record_credential_lifecycle_event_v1(uuid, text, text, timestamptz, text, text, uuid, integer, uuid, integer, timestamptz, text, text, text, text, text, text, text, text, text)']
  loop
    execute format('revoke all on function kitluy_devices.%s from service_role', r);
    execute format('grant execute on function kitluy_devices.%s to kitluy_issuance_service', r);
  end loop;
end
$issuance_grants$;

-- ===========================================================================
-- HOSTILE ASSERTIONS — the migration fails rather than shipping a weakening
-- ===========================================================================
do $assert_0134$
declare
  v_findings text[] := array[]::text[];
begin
  -- Destruction ships DISABLED, with the missing decision named.
  if (select destruction_enabled from kitluy_devices.key_destruction_policy
       where environment = 'development') then
    v_findings := v_findings || 'key destruction shipped ENABLED';
  end if;
  if (select coalesce(required_owner_decision, '') from kitluy_devices.key_destruction_policy
       where environment = 'development') = '' then
    v_findings := v_findings || 'the missing destruction decision is not named';
  end if;
  if (select approved_by_decision_ref is not null
        from kitluy_devices.key_destruction_policy where environment = 'development') then
    v_findings := v_findings || 'a destruction decision reference was invented';
  end if;
  if (select minimum_retention_days is not null or recovery_retention_days is not null
        from kitluy_devices.key_destruction_policy where environment = 'development') then
    v_findings := v_findings || 'a retention period was invented';
  end if;

  -- The executor calls the functions and touches no table directly.
  if has_table_privilege('kitluy_issuance_service',
                         'kitluy_devices.device_credential_lifecycle_events', 'insert')
     or has_table_privilege('kitluy_issuance_service',
                            'kitluy_devices.key_destruction_policy', 'update') then
    v_findings := v_findings || 'the issuance executor gained direct table authority';
  end if;
  if not has_function_privilege(
       'kitluy_issuance_service',
       'kitluy_devices.retire_overlapped_credential_v1(uuid, text, text, timestamptz, text, text)',
       'execute') then
    v_findings := v_findings || 'the executor cannot retire an overlapped credential';
  end if;
  if has_function_privilege(
       'public',
       'kitluy_devices.retire_overlapped_credential_v1(uuid, text, text, timestamptz, text, text)',
       'execute') then
    v_findings := v_findings || 'PUBLIC can retire a credential';
  end if;

  -- Append-only and RLS.
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'device_credential_lifecycle_events'
      and t.tgname = 'trg_device_credential_lifecycle_events_append_only'
      and not t.tgisinternal
  ) then
    v_findings := v_findings || 'the lifecycle audit is not append-only';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kitluy_devices'
      and c.relname in ('key_destruction_policy', 'device_credential_lifecycle_events')
      and not (c.relrowsecurity and c.relforcerowsecurity)
  ) then
    v_findings := v_findings || 'a group-0134 table lacks RLS ENABLE+FORCE';
  end if;

  -- Earlier containment is untouched.
  if (select allow_key_rotation from kitluy_devices.renewal_policy
       where environment = 'development') then
    v_findings := v_findings || 'key rotation became enabled in the shipped policy';
  end if;
  if not has_schema_privilege('kitluy_issuance_service', 'kitluy_devices', 'usage') then
    v_findings := v_findings || 'group 0131 schema USAGE regressed';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'MIGRATION 0134 REFUSED: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;
end
$assert_0134$;

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

commit;
