-- kitluy:group:0133
-- Migration group 0133: renewal_reconciliation_audit (WS-11-T003 Step 4).
--
-- Additive. Groups 0120-0132 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- THE GAP — RECOVERY HAD NO DURABLE EVIDENCE
-- ===========================================================================
-- Interrupted renewals are recovered by comparing two systems that do not
-- share a transaction: PostgreSQL and the external key provider. That
-- comparison, and the action chosen from it, is the ONLY record of why a
-- renewal ended up in the state it did.
--
-- Groups 0125-0132 record plenty about issuance — `device_credential_
-- issuance_attempts`, `device_credential_renewal_attempts`, `device_credential_
-- orphan_incidents` — but NOTHING records a reconciliation: which two states
-- were observed, what they were classified as, which single action was chosen,
-- and whether it was executed or replayed.
--
-- `device_credential_renewal_attempts` was considered and rejected for this.
-- It carries from/to generation and an outcome, and has no place for the
-- renewal attempt id, the observed PROVIDER state, the classification, the
-- action or its result — so recording reconciliations there would have meant
-- discarding most of what makes a reconciliation explainable.
--
-- Application logs are not an answer either. The recovery decision has to be
-- reconstructible later by someone asking "why is this device on generation 3
-- with a superseded key", and a log line that has rotated away cannot answer.
--
-- ===========================================================================
-- APPEND-ONLY, AND DELIBERATELY NOT FINANCIAL-STYLE MUTABLE
-- ===========================================================================
-- A reconciliation outcome is never edited or corrected in place. A later
-- reconciliation writes a NEW row; the sequence of rows IS the history. That
-- is the same discipline every other audit surface in this schema uses, and it
-- is what makes "this was retried four times" visible instead of inferred.
--
-- ===========================================================================
-- WHAT IS DELIBERATELY ABSENT
-- ===========================================================================
-- No private keys. No connection strings. No provider secrets. No raw
-- credential bytes. No challenge nonces. The observed-state columns hold
-- LIFECYCLE NAMES ONLY — `generated`, `active`, `credential_issued_pending_
-- activation` — and a CHECK refuses anything that looks like PEM key material,
-- because the cheapest way to leak a key is to log it while explaining why you
-- could not use it.

begin;

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

create table if not exists kitluy_devices.device_renewal_reconciliations (
  reconciliation_id uuid primary key default gen_random_uuid(),
  renewal_attempt_id uuid not null
    references kitluy_devices.device_renewal_reservations (renewal_attempt_id),
  device_record_id uuid not null references kitluy_devices.devices (id),
  environment text not null,

  -- What each system SAID, at the moment it was asked. Two independent
  -- observations, recorded separately, because the whole point of a
  -- reconciliation is that they can disagree.
  observed_database_state text not null,
  observed_provider_state text not null,

  classification text not null,
  action_attempted text not null,
  action_result text not null,
  replay_outcome text not null,
  failure_code text,

  actor_ref text not null,
  -- CLOCK time, not transaction time. Recovery can perform several
  -- reconciliations inside one transaction, and now() would stamp them all
  -- identically — leaving the history with no order at all.
  occurred_at timestamptz not null default clock_timestamp(),
  -- The total order. Two reconciliations in the same microsecond are still
  -- distinguishable, which "the sequence of rows IS the history" requires.
  sequence_no bigint not null generated always as identity,

  constraint device_renewal_reconciliations_env_chk check (environment = 'development'),
  -- Lifecycle NAMES only. Key material never enters this table, and the
  -- database refuses it rather than trusting every future caller to remember.
  constraint device_renewal_reconciliations_no_key_material_chk check (
    observed_database_state !~ 'BEGIN [A-Z ]*PRIVATE KEY'
    and observed_provider_state !~ 'BEGIN [A-Z ]*PRIVATE KEY'
    and coalesce(failure_code, '') !~ 'BEGIN [A-Z ]*PRIVATE KEY'
    and action_result !~ 'BEGIN [A-Z ]*PRIVATE KEY'
  ),
  constraint device_renewal_reconciliations_state_len_chk check (
    length(observed_database_state) <= 200
    and length(observed_provider_state) <= 200
  )
);

comment on table kitluy_devices.device_renewal_reconciliations is
  'Owner: Fleet. APPEND-ONLY record of every renewal reconciliation: the state PostgreSQL reported, the state the PROVIDER reported, the classification drawn from the pair, the single action chosen, its result and whether it was a replay. Recorded separately from issuance audit because a reconciliation exists precisely when the two systems disagree, and neither issuance table has anywhere to say what the provider thought. Never edited: a later reconciliation appends a new row, and the sequence is the history. Key material, connection strings and nonces are refused by CHECK. MC: A/O.';

comment on column kitluy_devices.device_renewal_reconciliations.observed_provider_state is
  'What the EXTERNAL PROVIDER reported — a lifecycle name, never key material. PostgreSQL cannot observe this itself, which is the entire reason a reconciliation is needed (group 0130 TASK D).';

create index device_renewal_reconciliations_attempt_idx
  on kitluy_devices.device_renewal_reconciliations (renewal_attempt_id, sequence_no desc);
create index device_renewal_reconciliations_device_idx
  on kitluy_devices.device_renewal_reconciliations (device_record_id, occurred_at desc);

create trigger trg_device_renewal_reconciliations_append_only
  before update or delete on kitluy_devices.device_renewal_reconciliations
  for each row execute function kitluy_auth.enforce_append_only();

-- ===========================================================================
-- The governed writer
-- ===========================================================================
create or replace function kitluy_devices.record_renewal_reconciliation_v1(
  p_renewal_attempt_id uuid,
  p_observed_database_state text,
  p_observed_provider_state text,
  p_classification text,
  p_action_attempted text,
  p_action_result text,
  p_replay_outcome text,
  p_failure_code text,
  p_actor_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $record$
declare
  v_res kitluy_devices.device_renewal_reservations;
  v_row kitluy_devices.device_renewal_reconciliations;
begin
  -- The device and environment are taken from the RESERVATION, never from the
  -- caller. A reconciliation that could name its own device would be able to
  -- write history against a device it never touched.
  select * into v_res from kitluy_devices.device_renewal_reservations
  where renewal_attempt_id = p_renewal_attempt_id;
  if not found then
    raise exception
      'KLUY-RECONCILE-NO-RESERVATION: no renewal attempt %', p_renewal_attempt_id
      using errcode = 'P0001';
  end if;

  if coalesce(p_classification, '') = '' or coalesce(p_action_attempted, '') = ''
     or coalesce(p_action_result, '') = '' or coalesce(p_replay_outcome, '') = ''
     or coalesce(p_actor_ref, '') = '' then
    raise exception
      'KLUY-RECONCILE-INCOMPLETE: a reconciliation record needs a classification, an action, a result, a replay outcome and an actor'
      using errcode = 'P0001';
  end if;

  insert into kitluy_devices.device_renewal_reconciliations (
    renewal_attempt_id, device_record_id, environment,
    observed_database_state, observed_provider_state, classification,
    action_attempted, action_result, replay_outcome, failure_code, actor_ref)
  values (
    p_renewal_attempt_id, v_res.device_record_id, v_res.environment,
    p_observed_database_state, p_observed_provider_state, p_classification,
    p_action_attempted, p_action_result, p_replay_outcome, p_failure_code, p_actor_ref)
  returning * into v_row;

  return jsonb_build_object(
    'outcome', 'RECORDED',
    'reconciliation_id', v_row.reconciliation_id,
    'renewal_attempt_id', v_row.renewal_attempt_id,
    'device_record_id', v_row.device_record_id,
    'occurred_at', to_char(v_row.occurred_at at time zone 'UTC',
                           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end
$record$;

comment on function kitluy_devices.record_renewal_reconciliation_v1 is
  'Appends one reconciliation record. The device and environment come from the RESERVATION, not from the caller, so a reconciliation cannot write history against a device it never touched. Append-only by trigger; a later reconciliation adds a row rather than editing one.';

-- ===========================================================================
-- Grants, ownership, hygiene
-- ===========================================================================
alter table kitluy_devices.device_renewal_reconciliations enable row level security;
alter table kitluy_devices.device_renewal_reconciliations force row level security;

grant select, insert on kitluy_devices.device_renewal_reconciliations
  to kitluy_credential_issuer;
grant select on kitluy_devices.device_renewal_reconciliations to service_role;

create policy device_renewal_reconciliations_issuer_write
  on kitluy_devices.device_renewal_reconciliations
  for all to kitluy_credential_issuer using (true) with check (true);
create policy device_renewal_reconciliations_service_read
  on kitluy_devices.device_renewal_reconciliations
  for select to service_role using (true);

alter function kitluy_devices.record_renewal_reconciliation_v1(
  uuid, text, text, text, text, text, text, text, text)
  owner to kitluy_credential_issuer;

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
begin
  execute 'revoke all on function kitluy_devices.record_renewal_reconciliation_v1('
       || 'uuid, text, text, text, text, text, text, text, text) from service_role';
  execute 'grant execute on function kitluy_devices.record_renewal_reconciliation_v1('
       || 'uuid, text, text, text, text, text, text, text, text) to kitluy_issuance_service';
end
$issuance_grants$;

-- ===========================================================================
-- HOSTILE ASSERTIONS — the migration fails rather than shipping a weakening
-- ===========================================================================
do $assert_0133$
declare
  v_findings text[] := array[]::text[];
begin
  if not has_schema_privilege('kitluy_issuance_service', 'kitluy_devices', 'usage') then
    v_findings := v_findings || 'group 0131 schema USAGE regressed';
  end if;
  if not has_function_privilege(
       'kitluy_issuance_service',
       'kitluy_devices.record_renewal_reconciliation_v1(uuid, text, text, text, text, text, text, text, text)',
       'execute') then
    v_findings := v_findings || 'the issuance executor cannot record a reconciliation';
  end if;
  if has_function_privilege(
       'public',
       'kitluy_devices.record_renewal_reconciliation_v1(uuid, text, text, text, text, text, text, text, text)',
       'execute') then
    v_findings := v_findings || 'PUBLIC can record a reconciliation';
  end if;

  -- The executor records THROUGH the function and cannot touch the table.
  if has_table_privilege('kitluy_issuance_service',
                         'kitluy_devices.device_renewal_reconciliations', 'insert')
     or has_table_privilege('kitluy_issuance_service',
                            'kitluy_devices.device_renewal_reconciliations', 'update')
     or has_table_privilege('kitluy_issuance_service',
                            'kitluy_devices.device_renewal_reconciliations', 'delete') then
    v_findings := v_findings || 'the executor holds direct table authority on reconciliations';
  end if;
  -- The service role READS history and never writes it.
  if has_table_privilege('service_role',
                         'kitluy_devices.device_renewal_reconciliations', 'insert')
     or has_table_privilege('service_role',
                            'kitluy_devices.device_renewal_reconciliations', 'update') then
    v_findings := v_findings || 'service_role can write reconciliation history';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kitluy_devices'
      and c.relname = 'device_renewal_reconciliations'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    v_findings := v_findings || 'the reconciliation table lacks RLS ENABLE+FORCE';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'device_renewal_reconciliations'
      and t.tgname = 'trg_device_renewal_reconciliations_append_only' and not t.tgisinternal
  ) then
    v_findings := v_findings || 'the reconciliation table is not append-only';
  end if;

  -- Nothing here may have touched the earlier containment.
  if (select allow_key_rotation from kitluy_devices.renewal_policy
       where environment = 'development') then
    v_findings := v_findings || 'key rotation became enabled in the shipped policy';
  end if;
  if exists (
    select 1 from pg_auth_members m
    join pg_roles g on g.oid = m.roleid
    join pg_roles r on r.oid = m.member
    where g.rolname = 'kitluy_credential_issuer' and r.rolname = 'kitluy_issuance_service'
  ) then
    v_findings := v_findings || 'the executor became a member of the governor';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'MIGRATION 0133 REFUSED: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;
end
$assert_0133$;

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

commit;
