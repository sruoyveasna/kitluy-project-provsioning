-- kitluy:group:0152
-- Migration group 0152: governed_emergency_post_approval_and_recorded_scope.
--
-- Authority: KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.2/§2.3/§2.4/§3;
--            KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1;
--            KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001.
-- Completes: Phase B — post-approval, lapse, recorded-set emergency reasons,
--            narrow tenancy binding.
--
-- Additive. Groups 0136-0151 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- kitluy:destructive-approved:KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001
--   (a) DROP CONSTRAINT reason_code_chk so PROVIDER_COMPROMISE / SECURITY_INCIDENT
--       may be stored (decision §2.2 already names them emergency-eligible).
--   (b) DROP FUNCTION of the 6-arg governed emergency RPC so the 7-arg form
--       (optional p_incident_scope_id) replaces it cleanly.

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
  execute format('grant kitluy_credential_approval_reader to %I', current_user);
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. TENANCY BRIDGE
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.emergency_device_tenancy_v1(
  p_device_record_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $tenancy$
declare
  v_tenant uuid;
  v_store uuid;
  v_location uuid;
begin
  if p_device_record_id is null then
    return jsonb_build_object(
      'tenant_id', null, 'digital_store_id', null, 'store_location_id', null);
  end if;
  select a.tenant_id, a.digital_store_id, a.store_location_id
    into v_tenant, v_store, v_location
    from kitluy_devices.device_assignments a
   where a.device_id = p_device_record_id
   order by
     case when a.state = 'active' then 0 else 1 end,
     a.assignment_generation desc nulls last,
     a.created_at desc nulls last
   limit 1;
  return jsonb_build_object(
    'tenant_id', v_tenant,
    'digital_store_id', v_store,
    'store_location_id', v_location);
end
$tenancy$;

alter function kitluy_devices.emergency_device_tenancy_v1(uuid)
  owner to kitluy_activation_governor;
revoke all on function kitluy_devices.emergency_device_tenancy_v1(uuid) from public;
grant execute on function kitluy_devices.emergency_device_tenancy_v1(uuid)
  to kitluy_credential_issuer;

comment on function kitluy_devices.emergency_device_tenancy_v1(uuid) is
  'Phase B. Narrow tenancy lookup. SECURITY DEFINER owned by kitluy_activation_governor. EXECUTE only to kitluy_credential_issuer. Adds no table grant to the credential governor.';

-- ---------------------------------------------------------------------------
-- 2. LINK COLUMN
-- ---------------------------------------------------------------------------
alter table kitluy_devices.device_credential_revocations
  add column if not exists emergency_authorization_id uuid
    references kitluy_devices.device_emergency_revocation_authorizations (authorization_id);

create index if not exists device_credential_revocations_emergency_auth_idx
  on kitluy_devices.device_credential_revocations (emergency_authorization_id)
  where emergency_authorization_id is not null;

comment on column kitluy_devices.device_credential_revocations.emergency_authorization_id is
  'Group 0152. Set by the governed emergency RPC so post-approval escalation finds every credential this authorization reached.';

-- ---------------------------------------------------------------------------
-- 3. WIDEN reason_code_chk
-- ---------------------------------------------------------------------------
alter table kitluy_devices.device_emergency_revocation_authorizations
  drop constraint if exists device_emergency_revocation_authorizations_reason_code_chk;

alter table kitluy_devices.device_emergency_revocation_authorizations
  add constraint device_emergency_revocation_authorizations_reason_code_chk
  check (reason_code in (
    'KEY_COMPROMISE', 'DEVICE_LOST', 'DEVICE_STOLEN',
    'PROVIDER_COMPROMISE', 'SECURITY_INCIDENT'));

-- ---------------------------------------------------------------------------
-- 3b. DEADLINE CHECK: allow bringing a live deadline into the past
--
-- Group 0150 required post_approval_due_at > executed_at forever. That blocked
-- the intentional 0138 asymmetry (bring a deadline FORWARD so the sweeper can
-- observe LAPSE). The RPC still issues due = executed + window; the CHECK only
-- needs to refuse a nonsense NULL, not to freeze the clock after the fact.
-- ---------------------------------------------------------------------------
alter table kitluy_devices.device_emergency_revocation_authorizations
  drop constraint if exists device_emergency_revocation_authorizations_deadline_chk;

alter table kitluy_devices.device_emergency_revocation_authorizations
  add constraint device_emergency_revocation_authorizations_deadline_chk
  check (post_approval_due_at is not null);

-- ---------------------------------------------------------------------------
-- 3c. UPDATE grant for deadline-forward-only (trigger-enforced)
-- ---------------------------------------------------------------------------
grant update on kitluy_devices.device_emergency_revocation_authorizations
  to kitluy_credential_issuer;

-- ---------------------------------------------------------------------------
-- 4. POST-APPROVAL VERDICTS
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_emergency_post_approval_verdicts (
  verdict_id uuid primary key default gen_random_uuid(),
  authorization_id uuid not null
    references kitluy_devices.device_emergency_revocation_authorizations (authorization_id),
  -- NULL only for LAPSED (nobody came). APPROVE/REFUSE require a named human.
  actor_user_id uuid references auth.users (id),
  permission_key text not null,
  reauth_evidence_id uuid
    references kitluy_auth.reauthentication_evidence (evidence_id),
  decision text not null,
  verdict kitluy_devices.emergency_post_approval_decision not null,
  scope_digest text not null,
  note text,
  late boolean not null default false,
  recorded_at timestamptz not null default clock_timestamp(),
  escalated_at timestamptz,
  escalation_reason text,
  audit_correlation_id uuid not null default gen_random_uuid(),
  sequence_no bigint generated always as identity,

  constraint device_emergency_post_approval_one_verdict
    unique (authorization_id),
  constraint device_emergency_post_approval_permission_key_chk
    check (permission_key = 'fleet.device_credential.emergency_post_approve'),
  constraint device_emergency_post_approval_decision_chk
    check (decision in ('APPROVE', 'REFUSE', 'LAPSE')),
  constraint device_emergency_post_approval_verdict_chk
    check (verdict in ('APPROVED', 'REFUSED', 'LAPSED')),
  constraint device_emergency_post_approval_digest_chk
    check (scope_digest ~ '^[0-9a-f]{64}$'),
  constraint device_emergency_post_approval_pairing_chk
    check (
      -- Nobody came (lapse worker).
      (verdict = 'LAPSED'
        and actor_user_id is null
        and reauth_evidence_id is null
        and decision = 'LAPSE'
        and late = true)
      -- Someone came after the deadline (decision §2.4 LATE → LAPSED + escalate).
      or (verdict = 'LAPSED'
        and actor_user_id is not null
        and reauth_evidence_id is not null
        and decision = 'APPROVE'
        and late = true)
      or (verdict in ('APPROVED', 'REFUSED')
        and actor_user_id is not null
        and reauth_evidence_id is not null
        and decision in ('APPROVE', 'REFUSE'))
    ),
  constraint device_emergency_post_approval_escalation_chk
    check (
      (verdict = 'APPROVED' and escalated_at is null)
      or (verdict in ('REFUSED', 'LAPSED') and escalated_at is not null)
    ),
  constraint device_emergency_post_approval_no_key_material_chk
    check (coalesce(note, '') !~* 'BEGIN [A-Z ]*PRIVATE KEY'
           and coalesce(escalation_reason, '') !~* 'BEGIN [A-Z ]*PRIVATE KEY')
);

comment on table kitluy_devices.device_emergency_post_approval_verdicts is
  'Owner: Security/Fleet. §2.4 post-approval verdict for a governed emergency. Separate from the authorization (append-only execution evidence). Absence = PENDING. REFUSED/LAPSED escalate; never restore. MC: A/O.';

create trigger trg_device_emergency_post_approval_verdicts_append_only
  before update or delete on kitluy_devices.device_emergency_post_approval_verdicts
  for each row execute function kitluy_auth.enforce_append_only();

alter table kitluy_devices.device_emergency_post_approval_verdicts
  enable row level security;
alter table kitluy_devices.device_emergency_post_approval_verdicts
  force row level security;

grant select, insert on kitluy_devices.device_emergency_post_approval_verdicts
  to kitluy_credential_issuer;
grant select on kitluy_devices.device_emergency_post_approval_verdicts
  to service_role;

create policy device_emergency_post_approval_issuer_write
  on kitluy_devices.device_emergency_post_approval_verdicts
  for all to kitluy_credential_issuer using (true) with check (true);
create policy device_emergency_post_approval_service_read
  on kitluy_devices.device_emergency_post_approval_verdicts
  for select to service_role using (true);

-- ---------------------------------------------------------------------------
-- 4b. AUTHORIZATION IMMUTABILITY (deadline may only move earlier)
--
-- Post-approval state lives on the verdicts table. The authorization remains
-- execution evidence. Group 0150 made it fully append-only; that blocked the
-- intentional 0138 asymmetry (bring a deadline FORWARD so an overdue case can
-- escalate — never EXTEND it). Replace append-only with that rule.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_device_emergency_revocation_authorizations_append_only
  on kitluy_devices.device_emergency_revocation_authorizations;

create or replace function kitluy_devices.enforce_governed_emergency_authorization_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices
as $imm$
begin
  if tg_op = 'DELETE' then
    raise exception
      'KLUY-EMERGENCY-IMMUTABLE: a governed emergency authorization cannot be deleted'
      using errcode = 'P0001';
  end if;

  if new.authorization_id is distinct from old.authorization_id
     or new.actor_user_id is distinct from old.actor_user_id
     or new.permission_key is distinct from old.permission_key
     or new.reauth_evidence_id is distinct from old.reauth_evidence_id
     or new.reason_code is distinct from old.reason_code
     or new.explanation is distinct from old.explanation
     or new.incident_reference is distinct from old.incident_reference
     or new.environment is distinct from old.environment
     or new.tenant_id is distinct from old.tenant_id
     or new.digital_store_id is distinct from old.digital_store_id
     or new.store_location_id is distinct from old.store_location_id
     or new.subject_type is distinct from old.subject_type
     or new.identifier_count is distinct from old.identifier_count
     or new.scope_digest is distinct from old.scope_digest
     or new.decision_version is distinct from old.decision_version
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at
     or new.executed_at is distinct from old.executed_at
     or new.lifecycle_state is distinct from old.lifecycle_state
     or new.audit_correlation_id is distinct from old.audit_correlation_id
     or new.sequence_no is distinct from old.sequence_no then
    raise exception
      'KLUY-EMERGENCY-IMMUTABLE: the facts of a governed emergency authorization are fixed when it executes'
      using errcode = 'P0001';
  end if;

  if new.post_approval_due_at > old.post_approval_due_at then
    raise exception
      'KLUY-EMERGENCY-DEADLINE-FIXED: an emergency post-approval deadline can be brought forward, never extended'
      using errcode = 'P0001';
  end if;

  return new;
end
$imm$;

alter function kitluy_devices.enforce_governed_emergency_authorization_immutable()
  owner to kitluy_credential_issuer;
revoke all on function kitluy_devices.enforce_governed_emergency_authorization_immutable()
  from public;

create trigger trg_device_emergency_revocation_authorizations_immutable
  before update or delete on kitluy_devices.device_emergency_revocation_authorizations
  for each row execute function
    kitluy_devices.enforce_governed_emergency_authorization_immutable();

-- ---------------------------------------------------------------------------
-- 5. POST-APPROVAL BRIDGES
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.emergency_post_approval_permitted_v1(
  p_environment text
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, kitluy_auth
as $post_permitted$
  select coalesce(kitluy_auth.has_permission(
    'fleet.device_credential.emergency_post_approve',
    'device_credential', null, p_environment), false);
$post_permitted$;

create or replace function kitluy_devices.emergency_post_approval_reauth_spend_v1(
  p_evidence_id uuid,
  p_environment text,
  p_verdict_id uuid
) returns boolean
language sql
security definer
set search_path = pg_catalog, kitluy_auth
as $post_spend$
  select coalesce(kitluy_auth.consume_reauthentication_evidence_v1(
    p_evidence_id, 'fleet.device_credential.emergency_post_approve',
    p_environment, p_verdict_id), false);
$post_spend$;

grant create on schema kitluy_devices to kitluy_credential_approval_reader;
alter function kitluy_devices.emergency_post_approval_permitted_v1(text)
  owner to kitluy_credential_approval_reader;
alter function kitluy_devices.emergency_post_approval_reauth_spend_v1(uuid, text, uuid)
  owner to kitluy_credential_approval_reader;
revoke create on schema kitluy_devices from kitluy_credential_approval_reader;

revoke all on function kitluy_devices.emergency_post_approval_permitted_v1(text) from public;
revoke all on function
  kitluy_devices.emergency_post_approval_reauth_spend_v1(uuid, text, uuid) from public;
grant execute on function kitluy_devices.emergency_post_approval_permitted_v1(text)
  to kitluy_credential_issuer;
grant execute on function
  kitluy_devices.emergency_post_approval_reauth_spend_v1(uuid, text, uuid)
  to kitluy_credential_issuer;

-- ---------------------------------------------------------------------------
-- 6. ESCALATE BY GOVERNED AUTHORIZATION
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.escalate_governed_emergency_v1(
  p_authorization_id uuid,
  p_escalation_reason text
) returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $esc$
declare
  v_opened integer := 0;
  v_moved integer := 0;
begin
  insert into kitluy_devices.device_recovery_cases (
    revocation_id, device_record_id, environment, purpose, disposition)
  select r.revocation_id, r.device_record_id, r.environment, r.purpose,
         'MANUAL_SECURITY_REVIEW'::kitluy_devices.credential_recovery_disposition
    from kitluy_devices.device_credential_revocations r
   where r.emergency_authorization_id = p_authorization_id
  on conflict (revocation_id) do nothing;
  get diagnostics v_opened = row_count;

  update kitluy_devices.device_recovery_cases c
     set disposition = 'MANUAL_SECURITY_REVIEW'
    from kitluy_devices.device_credential_revocations r
   where r.emergency_authorization_id = p_authorization_id
     and c.revocation_id = r.revocation_id
     and c.state in ('open', 'in_progress')
     and c.disposition <> 'MANUAL_SECURITY_REVIEW';
  get diagnostics v_moved = row_count;

  return jsonb_build_object(
    'escalated', true,
    'reason', p_escalation_reason,
    'cases_opened', v_opened,
    'cases_moved_to_manual_review', v_moved);
end
$esc$;

alter function kitluy_devices.escalate_governed_emergency_v1(uuid, text)
  owner to kitluy_credential_issuer;
revoke all on function kitluy_devices.escalate_governed_emergency_v1(uuid, text) from public;
grant execute on function kitluy_devices.escalate_governed_emergency_v1(uuid, text)
  to kitluy_credential_issuer;

-- ---------------------------------------------------------------------------
-- 7. GOVERNED POST-APPROVAL RPC
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.record_governed_emergency_post_approval_v1(
  p_authorization_id uuid,
  p_decision text,
  p_reauth_evidence_id uuid,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $post$
declare
  c_permission constant text := 'fleet.device_credential.emergency_post_approve';
  v_actor uuid;
  v_auth kitluy_devices.device_emergency_revocation_authorizations;
  v_prior kitluy_devices.device_emergency_post_approval_verdicts;
  v_verdict kitluy_devices.emergency_post_approval_decision;
  v_late boolean;
  v_escalation text;
  v_escalated jsonb;
  v_verdict_id uuid;
  v_still integer;
begin
  if p_decision not in ('APPROVE', 'REFUSE') then
    return jsonb_build_object(
      'outcome', 'POST_APPROVAL_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-BAD-DECISION',
      'detail', format('a post-approval is APPROVE or REFUSE, not %s', p_decision));
  end if;

  v_actor := kitluy_devices.emergency_revocation_actor_v1();
  if v_actor is null then
    return jsonb_build_object(
      'outcome', 'POST_APPROVAL_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NO-AUTHENTICATED-ACTOR',
      'detail', 'a post-approval is executed by a named authenticated human');
  end if;
  if p_reauth_evidence_id is null then
    return jsonb_build_object(
      'outcome', 'POST_APPROVAL_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NO-REAUTHENTICATION',
      'detail', 'decision §2.3 requires re-authentication evidence for post-approval');
  end if;

  select * into v_auth
    from kitluy_devices.device_emergency_revocation_authorizations
   where authorization_id = p_authorization_id
   for update;
  if not found then
    return jsonb_build_object(
      'outcome', 'POST_APPROVAL_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NOT-FOUND',
      'detail', format('no governed emergency authorization %s', p_authorization_id));
  end if;

  select * into v_prior
    from kitluy_devices.device_emergency_post_approval_verdicts
   where authorization_id = p_authorization_id;
  if found then
    return jsonb_build_object(
      'outcome', 'ALREADY_DECIDED',
      'authorization_id', p_authorization_id,
      'post_approval_decision', v_prior.verdict,
      'credential_state_changed', false);
  end if;

  if v_actor = v_auth.actor_user_id then
    return jsonb_build_object(
      'outcome', 'POST_APPROVAL_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-SELF-POST-APPROVAL',
      'detail', 'the declaring authority cannot be their own second person',
      'authorization_id', p_authorization_id,
      'credential_state_changed', false);
  end if;

  if not kitluy_devices.emergency_post_approval_permitted_v1(v_auth.environment) then
    return jsonb_build_object(
      'outcome', 'POST_APPROVAL_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-UNAUTHORIZED',
      'detail', format('the authenticated human does not hold %s in %s',
                       c_permission, v_auth.environment));
  end if;

  v_late := clock_timestamp() > v_auth.post_approval_due_at;

  if p_decision = 'APPROVE' and not v_late then
    v_verdict := 'APPROVED';
  elsif p_decision = 'APPROVE' and v_late then
    v_verdict := 'LAPSED';
    v_escalation := format(
      'post-approval arrived after the %s deadline; decision §2.4 escalates; credentials stay revoked',
      v_auth.post_approval_due_at);
  else
    v_verdict := 'REFUSED';
    v_escalation := format(
      'post-approval REFUSED by %s; decision §2.4 escalates; credentials stay revoked',
      v_actor);
  end if;

  insert into kitluy_devices.device_emergency_post_approval_verdicts (
    authorization_id, actor_user_id, permission_key, reauth_evidence_id,
    decision, verdict, scope_digest, note, late,
    escalated_at, escalation_reason)
  values (
    p_authorization_id, v_actor, c_permission, p_reauth_evidence_id,
    p_decision, v_verdict, v_auth.scope_digest, p_note, v_late,
    case when v_escalation is null then null else clock_timestamp() end,
    v_escalation)
  returning verdict_id into v_verdict_id;

  if not kitluy_devices.emergency_post_approval_reauth_spend_v1(
           p_reauth_evidence_id, v_auth.environment, v_verdict_id) then
    raise exception
      'KLUY-EMERGENCY-REAUTHENTICATION-REFUSED: post-approval evidence is not spendable for %',
      c_permission
      using errcode = 'insufficient_privilege';
  end if;

  if v_escalation is not null then
    v_escalated := kitluy_devices.escalate_governed_emergency_v1(
      p_authorization_id, v_escalation);
  end if;

  select count(*) into v_still
    from kitluy_devices.device_credential_revocations r
    join kitluy_devices.device_credentials c on c.credential_id = r.credential_id
   where r.emergency_authorization_id = p_authorization_id
     and c.state = 'revoked';

  return jsonb_build_object(
    'outcome', case when v_verdict = 'APPROVED' then 'POST_APPROVED'
                    else 'MANUAL_SECURITY_REVIEW' end,
    'authorization_id', p_authorization_id,
    'verdict_id', v_verdict_id,
    'post_approval_decision', v_verdict,
    'escalation', v_escalated,
    'credential_state_changed', false,
    'credentials_still_revoked', v_still,
    'note', 'decision §2.4: a revocation is one-way');
end
$post$;

alter function kitluy_devices.record_governed_emergency_post_approval_v1(
  uuid, text, uuid, text) owner to kitluy_credential_issuer;
revoke all on function kitluy_devices.record_governed_emergency_post_approval_v1(
  uuid, text, uuid, text) from public;
grant execute on function kitluy_devices.record_governed_emergency_post_approval_v1(
  uuid, text, uuid, text) to authenticated;

comment on function kitluy_devices.record_governed_emergency_post_approval_v1(
  uuid, text, uuid, text) is
  'Phase B. Distinct-human post-approval. Actor from auth.uid(), key fleet.device_credential.emergency_post_approve, action-bound 300s evidence, scope digest from the immutable authorization. Self-approval refused. Never restores a credential.';

-- ---------------------------------------------------------------------------
-- 8. LAPSE WORKER
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.lapse_governed_emergency_post_approvals_v1(
  p_environment text,
  p_source text default 'LAPSE_WORKER'
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $lapse$
declare
  v_row record;
  v_lapsed uuid[] := array[]::uuid[];
  v_escalation text;
begin
  if coalesce(btrim(p_environment), '') = '' then
    return jsonb_build_object('outcome', 'LAPSE_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NO-ENVIRONMENT');
  end if;

  for v_row in
    select a.authorization_id, a.post_approval_due_at, a.scope_digest
      from kitluy_devices.device_emergency_revocation_authorizations a
     where a.environment = p_environment
       and a.post_approval_due_at <= clock_timestamp()
       and not exists (
         select 1 from kitluy_devices.device_emergency_post_approval_verdicts v
          where v.authorization_id = a.authorization_id)
     order by a.post_approval_due_at
     for update of a skip locked
  loop
    v_escalation := format(
      'post-approval LAPSED (due %s) by %s; decision §2.4 escalates; credentials stay revoked',
      v_row.post_approval_due_at, p_source);

    insert into kitluy_devices.device_emergency_post_approval_verdicts (
      authorization_id, actor_user_id, permission_key, reauth_evidence_id,
      decision, verdict, scope_digest, note, late,
      escalated_at, escalation_reason)
    values (
      v_row.authorization_id, null, 'fleet.device_credential.emergency_post_approve',
      null, 'LAPSE', 'LAPSED', v_row.scope_digest, p_source, true,
      clock_timestamp(), v_escalation);

    perform kitluy_devices.escalate_governed_emergency_v1(
      v_row.authorization_id, v_escalation);
    v_lapsed := v_lapsed || v_row.authorization_id;
  end loop;

  return jsonb_build_object(
    'outcome', 'LAPSED',
    'lapsed_count', coalesce(cardinality(v_lapsed), 0),
    'authorization_ids', to_jsonb(coalesce(v_lapsed, array[]::uuid[])),
    'note', 'decision §2.4: a lapsed post-approval never restores a credential');
end
$lapse$;

alter function kitluy_devices.lapse_governed_emergency_post_approvals_v1(text, text)
  owner to kitluy_credential_issuer;
revoke all on function kitluy_devices.lapse_governed_emergency_post_approvals_v1(text, text)
  from public;
grant execute on function kitluy_devices.lapse_governed_emergency_post_approvals_v1(text, text)
  to kitluy_worker_service;
grant execute on function kitluy_devices.lapse_governed_emergency_post_approvals_v1(text, text)
  to kitluy_issuance_service;

comment on function kitluy_devices.lapse_governed_emergency_post_approvals_v1(text, text) is
  'Phase B. Durable lapse sweeper. SKIP LOCKED, idempotent, invents no approver, spends no reauth, cannot extend deadlines (authorizations append-only), escalates, never restores. EXECUTE for worker and issuance only.';

-- ---------------------------------------------------------------------------
-- 9. REPLACE GOVERNED EMERGENCY RPC (7-arg: optional recorded scope)
-- ---------------------------------------------------------------------------
drop function if exists kitluy_devices.revoke_device_credential_emergency_governed_v1(
  uuid, kitluy_devices.credential_revocation_reason, text, text, uuid, text);

create or replace function kitluy_devices.revoke_device_credential_emergency_governed_v1(
  p_credential_id uuid,
  p_reason_code kitluy_devices.credential_revocation_reason,
  p_explanation text,
  p_incident_reference text,
  p_reauth_evidence_id uuid,
  p_idempotency_key text,
  p_incident_scope_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $governed_emergency$
declare
  c_permission constant text := 'fleet.device_credential.emergency_revoke';
  c_decision constant text := 'KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001';
  c_source constant text := 'GOVERNED_EMERGENCY_RPC';
  c_disposition constant kitluy_devices.credential_recovery_disposition
    := 'MANUAL_SECURITY_REVIEW';

  v_actor uuid;
  v_cred kitluy_devices.device_credentials;
  v_env text;
  v_scope jsonb;
  v_ids uuid[];
  v_digest text;
  v_prior kitluy_devices.device_emergency_revocation_authorizations;
  v_authorization uuid;
  v_window integer;
  v_now timestamptz;
  v_due timestamptz;
  v_tenant uuid;
  v_store uuid;
  v_location uuid;
  v_tenancy jsonb;
  v_target kitluy_devices.device_credentials;
  v_row kitluy_devices.device_credential_revocations;
  v_revoked integer := 0;
  v_id uuid;
  v_recorded kitluy_devices.revocation_recorded_scopes;
  v_recomputed text;
  v_consumption jsonb;
  v_first_revocation uuid;
begin
  v_actor := kitluy_devices.emergency_revocation_actor_v1();
  if v_actor is null then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NO-AUTHENTICATED-ACTOR',
      'detail', 'an emergency revocation is executed by a named authenticated human');
  end if;

  if p_reason_code not in ('KEY_COMPROMISE', 'DEVICE_LOST', 'DEVICE_STOLEN',
                           'PROVIDER_COMPROMISE', 'SECURITY_INCIDENT') then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-REASON-NOT-ELIGIBLE',
      'detail', format('decision §2.1 requires a completed prior approval for %s', p_reason_code));
  end if;

  if coalesce(btrim(p_explanation), '') = ''
     or coalesce(btrim(p_incident_reference), '') = '' then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-INCOMPLETE',
      'detail', 'decision §2.3 requires a mandatory reason and an incident reference');
  end if;
  if coalesce(btrim(p_idempotency_key), '') = '' then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NO-IDEMPOTENCY-KEY',
      'detail', 'an emergency declaration is identified so a retry cannot open a second emergency');
  end if;
  if p_reauth_evidence_id is null then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NO-REAUTHENTICATION',
      'detail', 'decision §2.3 requires re-authentication evidence');
  end if;

  select * into v_cred from kitluy_devices.device_credentials
   where credential_id = p_credential_id
   for update;
  if not found then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NO-CREDENTIAL',
      'detail', 'no credential exists under that id');
  end if;
  v_env := v_cred.environment;

  if not kitluy_devices.emergency_revocation_permitted_v1(p_credential_id, v_env) then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-UNAUTHORIZED',
      'detail', format('the authenticated human does not hold %s for this credential in %s',
                       c_permission, v_env));
  end if;

  -- Tenancy from the activation governor's narrow bridge.
  v_tenancy := kitluy_devices.emergency_device_tenancy_v1(v_cred.device_record_id);
  v_tenant := nullif(v_tenancy ->> 'tenant_id', '')::uuid;
  v_store := nullif(v_tenancy ->> 'digital_store_id', '')::uuid;
  v_location := nullif(v_tenancy ->> 'store_location_id', '')::uuid;

  -- RECORDED-SET reasons: spend an immutable recorded scope (Ruling 1 digest).
  if p_reason_code in ('PROVIDER_COMPROMISE', 'SECURITY_INCIDENT') then
    if p_incident_scope_id is null then
      return jsonb_build_object(
        'outcome', 'EMERGENCY_REFUSED',
        'refusal_code', 'KLUY-EMERGENCY-SCOPE-MISSING',
        'detail', 'decision §3 requires a recorded incident-defined affected set');
    end if;
    select * into v_recorded
      from kitluy_devices.revocation_recorded_scopes
     where incident_scope_id = p_incident_scope_id;
    if not found then
      return jsonb_build_object(
        'outcome', 'EMERGENCY_REFUSED',
        'refusal_code', 'KLUY-EMERGENCY-SCOPE-MISSING',
        'detail', format('recorded scope %s does not exist', p_incident_scope_id));
    end if;
    if v_recorded.environment is distinct from v_env
       or v_recorded.reason_code is distinct from p_reason_code then
      return jsonb_build_object(
        'outcome', 'EMERGENCY_REFUSED',
        'refusal_code', 'KLUY-EMERGENCY-SCOPE-MISMATCH',
        'detail', 'the recorded scope does not match this emergency reason/environment');
    end if;
    if v_recorded.incident_reference is distinct from p_incident_reference then
      return jsonb_build_object(
        'outcome', 'EMERGENCY_REFUSED',
        'refusal_code', 'KLUY-EMERGENCY-SCOPE-MISMATCH',
        'detail', 'the recorded scope is bound to a different incident reference');
    end if;
    if coalesce(v_recorded.identifier_count, 0) = 0 or v_recorded.unrestricted_wildcard then
      return jsonb_build_object(
        'outcome', 'EMERGENCY_REFUSED',
        'refusal_code', 'KLUY-EMERGENCY-SCOPE-EMPTY',
        'detail', 'an empty or unrestricted recorded set is refused');
    end if;
    if v_recorded.approval_request_id is null then
      return jsonb_build_object(
        'outcome', 'EMERGENCY_REFUSED',
        'refusal_code', 'KLUY-EMERGENCY-SCOPE-NO-APPROVAL',
        'detail', 'Ruling 1 consumption requires the recorded set to cite the approval that bound it');
    end if;
    -- Integrity of the immutable digest (Ruling 1), without requiring a
    -- four-eyes approval spend here — emergency defers four-eyes to post-approval.
    v_recomputed := kitluy_devices.revocation_scope_digest_v1(
      kitluy_devices.canonical_revocation_scope_v1(
        v_recorded.reason_code, v_recorded.environment, v_recorded.subject_type,
        v_recorded.tenant_id, v_recorded.digital_store_id, v_recorded.store_location_id,
        v_recorded.requester_ref, v_recorded.decision_version,
        v_recorded.affected_device_ids, v_recorded.affected_key_references,
        v_recorded.affected_fingerprints, v_recorded.affected_credential_ids));
    if v_recomputed is distinct from v_recorded.scope_digest then
      return jsonb_build_object(
        'outcome', 'EMERGENCY_REFUSED',
        'refusal_code', 'KLUY-EMERGENCY-SCOPE-DIGEST-MISMATCH',
        'detail', 'the recorded scope does not hash to its own stored digest');
    end if;
    if not (p_credential_id = any (coalesce(v_recorded.affected_credential_ids, array[]::uuid[]))) then
      return jsonb_build_object(
        'outcome', 'EMERGENCY_REFUSED',
        'refusal_code', 'KLUY-EMERGENCY-SCOPE-NOT-IN-SET',
        'detail', 'the recorded affected set does not contain the credential this emergency names');
    end if;
    select array_agg(x order by x) into v_ids
      from unnest(v_recorded.affected_credential_ids) as x
      join kitluy_devices.device_credentials c on c.credential_id = x
     where c.state <> 'revoked';
    v_ids := coalesce(v_ids, array[]::uuid[]);
    if cardinality(v_ids) = 0 then
      return jsonb_build_object(
        'outcome', 'EMERGENCY_REFUSED',
        'refusal_code', 'KLUY-EMERGENCY-SCOPE-EMPTY',
        'detail', 'every member of the recorded set is already revoked');
    end if;
    v_digest := v_recorded.scope_digest;
    -- Prefer recorded tenancy when present.
    v_tenant := coalesce(v_recorded.tenant_id, v_tenant);
    v_store := coalesce(v_recorded.digital_store_id, v_store);
    v_location := coalesce(v_recorded.store_location_id, v_location);
    v_scope := jsonb_build_object(
      'resolved', true,
      'scope_rule', 'RECORDED_INCIDENT_DEVICE_KEY_CREDENTIAL_SET',
      'credential_ids', to_jsonb(v_ids),
      'credential_count', cardinality(v_ids));
  else
    -- Fleet-derived reasons: database answer from stored rows.
    v_scope := kitluy_devices.authoritative_revocation_scope_v1(p_credential_id, p_reason_code);
  end if;

  select * into v_prior
    from kitluy_devices.device_emergency_revocation_authorizations
   where idempotency_key = p_idempotency_key;

  if coalesce((v_scope ->> 'resolved')::boolean, false) is not true then
    if v_prior.authorization_id is not null
       and v_prior.actor_user_id = v_actor
       and v_prior.reason_code = p_reason_code
       and v_prior.environment = v_env
       and exists (select 1 from kitluy_devices.device_emergency_revocation_scope s
                    where s.authorization_id = v_prior.authorization_id
                      and s.credential_id = p_credential_id) then
      return jsonb_build_object(
        'outcome', 'ALREADY_AUTHORIZED',
        'authorization_id', v_prior.authorization_id,
        'revoked_credential_count', v_prior.identifier_count,
        'post_approval_due_at', to_char(v_prior.post_approval_due_at at time zone 'UTC',
                                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'note', 'this idempotency key already authorized this emergency');
    end if;
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', coalesce(v_scope ->> 'refusal_code', 'KLUY-EMERGENCY-SCOPE-UNRESOLVED'),
      'detail', v_scope ->> 'detail');
  end if;

  if p_reason_code not in ('PROVIDER_COMPROMISE', 'SECURITY_INCIDENT') then
    select array_agg(value::uuid order by value::uuid) into v_ids
      from jsonb_array_elements_text(v_scope -> 'credential_ids');
    v_ids := coalesce(v_ids, array[]::uuid[]);
  end if;

  if cardinality(v_ids) = 0 then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-SCOPE-EMPTY',
      'detail', 'the authoritative affected set is empty');
  end if;
  if not (p_credential_id = any (v_ids)) then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-SCOPE-NOT-IN-SET',
      'detail', 'the authoritative affected set does not contain the named credential');
  end if;

  if p_reason_code not in ('PROVIDER_COMPROMISE', 'SECURITY_INCIDENT') then
    v_digest := kitluy_devices.revocation_scope_digest_v1(
      kitluy_devices.canonical_revocation_scope_v1(
        p_reason_code, v_env, 'CREDENTIAL', v_tenant, v_store, v_location,
        v_actor::text, c_decision,
        array[]::uuid[], array[]::text[], array[]::text[], v_ids));
  end if;

  if v_prior.authorization_id is not null then
    if v_prior.scope_digest = v_digest then
      return jsonb_build_object(
        'outcome', 'ALREADY_AUTHORIZED',
        'authorization_id', v_prior.authorization_id,
        'revoked_credential_count', v_prior.identifier_count,
        'post_approval_due_at', to_char(v_prior.post_approval_due_at at time zone 'UTC',
                                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'note', 'this idempotency key already authorized this emergency');
    end if;
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-CONFLICTING-REPLAY',
      'detail', 'this idempotency key already authorized a DIFFERENT affected set');
  end if;

  select post_approval_window_hours into v_window
    from kitluy_devices.credential_revocation_policy
   where environment = v_env;
  if v_window is null then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NO-POLICY',
      'detail', format('no revocation policy governs environment %s', v_env));
  end if;
  v_now := clock_timestamp();
  v_due := v_now + make_interval(hours => v_window);

  insert into kitluy_devices.device_emergency_revocation_authorizations (
    actor_user_id, permission_key, reauth_evidence_id,
    reason_code, explanation, incident_reference, environment,
    tenant_id, digital_store_id, store_location_id,
    subject_type, identifier_count, scope_digest, decision_version,
    idempotency_key, executed_at, post_approval_due_at)
  values (
    v_actor, c_permission, p_reauth_evidence_id,
    p_reason_code, p_explanation, p_incident_reference, v_env,
    v_tenant, v_store, v_location,
    'CREDENTIAL', cardinality(v_ids), v_digest, c_decision,
    p_idempotency_key, v_now, v_due)
  returning authorization_id into v_authorization;

  insert into kitluy_devices.device_emergency_revocation_scope (authorization_id, credential_id)
  select v_authorization, m.id from unnest(v_ids) as m(id);

  foreach v_id in array v_ids loop
    select * into v_target from kitluy_devices.device_credentials
     where credential_id = v_id
     for update;
    if v_target.state = 'revoked' then
      continue;
    end if;

    insert into kitluy_devices.device_credential_revocations (
      revocation_request_id, credential_id, device_record_id, environment, purpose,
      credential_generation, public_key_fingerprint, reason_code, reason,
      requested_by, source, incident_reference, recovery_disposition, scope_rule,
      emergency_authorization_id)
    values (
      format('EMG-%s#%s', v_authorization, v_id), v_id, v_target.device_record_id,
      v_target.environment, v_target.purpose, v_target.certificate_generation,
      v_target.public_key_fingerprint, p_reason_code, p_explanation,
      v_actor::text, c_source, p_incident_reference, c_disposition,
      v_scope ->> 'scope_rule', v_authorization)
    returning * into v_row;

    if v_first_revocation is null then
      v_first_revocation := v_row.revocation_id;
    end if;

    update kitluy_devices.device_credentials
       set state = 'revoked',
           revoked_at = clock_timestamp(),
           revocation_reason = format('%s: %s', p_reason_code, p_explanation)
     where credential_id = v_id;

    insert into kitluy_devices.device_recovery_cases (
      revocation_id, device_record_id, environment, purpose, disposition)
    values (v_row.revocation_id, v_target.device_record_id, v_target.environment,
            v_target.purpose, c_disposition);

    v_revoked := v_revoked + 1;
  end loop;

  -- Consume the recorded scope atomically with the emergency (Ruling 1).
  -- Raise on failure so the revocation cannot commit without burning the set.
  if p_reason_code in ('PROVIDER_COMPROMISE', 'SECURITY_INCIDENT') then
    if v_revoked = 0 or v_first_revocation is null then
      raise exception
        'KLUY-EMERGENCY-SCOPE-CONSUME-FAILED: nothing was revoked, so the recorded scope is not consumed'
        using errcode = 'P0001';
    end if;
    v_consumption := kitluy_devices.consume_revocation_scope_v1(
      p_incident_scope_id,
      v_recorded.approval_request_id,
      v_first_revocation,
      v_env,
      format('emergency_governed:%s', v_actor));
    if coalesce(v_consumption ->> 'outcome', '') <> 'CONSUMED' then
      raise exception
        'KLUY-CRED-REVOCATION-SCOPE-CONSUMED: this recorded scope or approval has already authorized a revocation (%)',
        coalesce(v_consumption ->> 'detail', 'no detail')
        using errcode = 'unique_violation';
    end if;
  end if;

  if not kitluy_devices.emergency_revocation_reauth_spend_v1(
           p_reauth_evidence_id, v_env, v_authorization) then
    raise exception
      'KLUY-EMERGENCY-REAUTHENTICATION-REFUSED: the re-authentication evidence presented is not spendable for %',
      c_permission
      using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'outcome', 'REVOKED_IMMEDIATELY',
    'authorization_id', v_authorization,
    'revoked_credential_count', v_revoked,
    'post_approval_due_at', to_char(v_due at time zone 'UTC',
                                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'post_approval_decision', 'PENDING',
    'note', 'decision §2.4: a late, missing or refused post-approval does NOT restore these credentials');
end
$governed_emergency$;

alter function kitluy_devices.revoke_device_credential_emergency_governed_v1(
  uuid, kitluy_devices.credential_revocation_reason, text, text, uuid, text, uuid)
  owner to kitluy_credential_issuer;
revoke all on function kitluy_devices.revoke_device_credential_emergency_governed_v1(
  uuid, kitluy_devices.credential_revocation_reason, text, text, uuid, text, uuid) from public;
grant execute on function kitluy_devices.revoke_device_credential_emergency_governed_v1(
  uuid, kitluy_devices.credential_revocation_reason, text, text, uuid, text, uuid)
  to authenticated;

comment on function kitluy_devices.revoke_device_credential_emergency_governed_v1(
  uuid, kitluy_devices.credential_revocation_reason, text, text, uuid, text, uuid) is
  'RC-021/Phase B. Governed emergency entry point. Optional p_incident_scope_id spends a recorded immutable set for PROVIDER_COMPROMISE / SECURITY_INCIDENT. Fleet-derived reasons still use authoritative_revocation_scope_v1. Tenancy bound via emergency_device_tenancy_v1. Writes emergency_authorization_id on revocation evidence for post-approval escalation.';

-- Compatibility: 6-arg calls (DEFAULT null on 7th) — PostgreSQL creates one
-- function with a default, so the DROP+CREATE above is the only form.

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
  execute format('revoke kitluy_credential_approval_reader from %I', current_user);
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- 10. ASSERTIONS
-- ---------------------------------------------------------------------------
do $assert_0152$
declare
  v_findings text[] := array[]::text[];
  v_sig7 constant text :=
    'kitluy_devices.revoke_device_credential_emergency_governed_v1(uuid, '
    || 'kitluy_devices.credential_revocation_reason, text, text, uuid, text, uuid)';
  v_post constant text :=
    'kitluy_devices.record_governed_emergency_post_approval_v1(uuid, text, uuid, text)';
  v_lapse constant text :=
    'kitluy_devices.lapse_governed_emergency_post_approvals_v1(text, text)';
  v_role text;
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'kitluy_devices'
       and table_name = 'device_emergency_post_approval_verdicts') then
    v_findings := v_findings || 'post-approval verdicts table missing'::text;
  end if;

  if not has_function_privilege('authenticated', v_sig7, 'execute') then
    v_findings := v_findings || 'authenticated cannot execute 7-arg governed emergency'::text;
  end if;
  if not has_function_privilege('authenticated', v_post, 'execute') then
    v_findings := v_findings || 'authenticated cannot execute governed post-approval'::text;
  end if;
  if not has_function_privilege('kitluy_worker_service', v_lapse, 'execute') then
    v_findings := v_findings || 'worker cannot execute governed lapse'::text;
  end if;
  foreach v_role in array array['public', 'anon', 'service_role'] loop
    if has_function_privilege(v_role, v_post, 'execute') then
      v_findings := v_findings || format('%s can execute governed post-approval', v_role)::text;
    end if;
  end loop;

  if has_table_privilege('kitluy_credential_issuer',
       'kitluy_devices.device_assignments', 'select') then
    v_findings := v_findings ||
      'credential governor gained SELECT on device_assignments (bridge failed closed)'::text;
  end if;

  if exists (select 1 from pg_auth_members m
              join pg_roles r on r.oid = m.member
              join pg_roles g on g.oid = m.roleid
             where g.rolname in ('kitluy_credential_issuer',
                                 'kitluy_credential_approval_reader',
                                 'kitluy_activation_governor')
               and not r.rolsuper
               -- PG16+ (KLREC-2026-08-07-PG16-CREATEROLE-001): ignore the
               -- un-removable membership PostgreSQL 16 auto-grants to the role
               -- that created this one. A borrow this chain took itself has
               -- grantor = member and is still a finding.
               and not (r.rolname = current_user and m.grantor <> m.member)) then
    v_findings := v_findings || 'borrowed membership left behind'::text;
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL 0152: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;
end
$assert_0152$;
