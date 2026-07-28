-- kitluy:group:0124
-- Migration group 0124: time_correction_approval (WS-11-T003 step 2 closure).
--
-- Closes the approval gap the conformance test recorded: the TypeScript
-- validator enforced the A3/A4 risk class and the database did not, so a direct
-- or future caller could bypass it. The owner directed this be closed now
-- rather than deferred to a later approvals integration.
--
-- This binds to the EXISTING four-eyes aggregate (kitluy_auth.approval_policies,
-- approval_requests, approval_decisions) rather than inventing a parallel
-- approval concept. A second approval system would be a second place to get
-- four-eyes wrong.
--
-- Groups 0120-0123 are COMMITTED and are not edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).

begin;

-- ---------------------------------------------------------------------------
-- Risk class on the approval policy.
-- ---------------------------------------------------------------------------
-- The A0-A4 treatments are named in the group-0030 table comment but were never
-- a column, so nothing could enforce "this action needs A3 or A4".
-- ---------------------------------------------------------------------------
alter table kitluy_auth.approval_policies
  add column if not exists risk_class text;

alter table kitluy_auth.approval_policies
  drop constraint if exists approval_policies_risk_class_chk;
alter table kitluy_auth.approval_policies
  add constraint approval_policies_risk_class_chk
  check (risk_class is null or risk_class in ('A0', 'A1', 'A2', 'A3', 'A4'));

comment on column kitluy_auth.approval_policies.risk_class is
  'A0-A4 treatment. NULL means the policy predates group 0124 and has no declared class; a NULL is treated as INSUFFICIENT wherever a minimum class is required, so an undeclared policy cannot authorize a sensitive action by omission.';

-- ---------------------------------------------------------------------------
-- Single-use consumption of an approval for a time correction.
-- ---------------------------------------------------------------------------
-- The unique index is what makes "has not already been consumed" a fact rather
-- than a check somebody has to remember to run.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.time_correction_approvals (
  id uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null unique
    references kitluy_auth.approval_requests (id),
  device_id uuid not null references kitluy_devices.devices (id),
  environment text not null,
  consumed_at timestamptz not null default now(),
  consumed_by_actor_ref text not null,
  correlation_id uuid,
  constraint time_correction_approvals_env_chk
    check (environment in ('development', 'pilot', 'production'))
);

comment on table kitluy_devices.time_correction_approvals is
  'Owner: Security. Records that an approval request was CONSUMED by an emergency time correction. The UNIQUE constraint on approval_request_id is the single-use guarantee — an approval cannot authorize two corrections. Append-only. MC: A/O.';

create trigger trg_time_correction_approvals_append_only
  before update or delete on kitluy_devices.time_correction_approvals
  for each row execute function kitluy_auth.enforce_append_only();

-- ---------------------------------------------------------------------------
-- The approval gate.
-- ---------------------------------------------------------------------------
create type kitluy_devices.approval_verdict as (
  authorized boolean,
  refusal_code text,
  refusal_message text
);

create or replace function kitluy_devices.evaluate_time_correction_approval_v1(
  p_approval_request_id uuid,
  p_device_id uuid,
  p_environment text,
  p_requester_id uuid
) returns kitluy_devices.approval_verdict
language plpgsql
stable
as $$
declare
  v_request kitluy_auth.approval_requests;
  v_policy kitluy_auth.approval_policies;
  v_approvers integer;
  v_self integer;
  v_deny constant text := 'KLUY-DEVICE-TIME-CORRECTION-';
begin
  select * into v_request
  from kitluy_auth.approval_requests where id = p_approval_request_id;

  if not found then
    return row(false, v_deny || 'UNAPPROVED',
      format('approval request %s does not exist', p_approval_request_id))::kitluy_devices.approval_verdict;
  end if;

  select * into v_policy
  from kitluy_auth.approval_policies where id = v_request.policy_id;

  -- A NULL risk class is INSUFFICIENT, not permissive. A policy that never
  -- declared its treatment must not authorize an emergency action by omission.
  if coalesce(v_policy.risk_class, 'A0') not in ('A3', 'A4') then
    return row(false, v_deny || 'RISK-CLASS',
      format('approval policy risk class %s is below the A3/A4 an emergency time correction requires',
             coalesce(v_policy.risk_class, 'undeclared')))::kitluy_devices.approval_verdict;
  end if;

  if v_request.action <> 'emergency_time_correction' then
    return row(false, v_deny || 'WRONG-ACTION',
      format('approval authorizes %s, not emergency_time_correction', v_request.action))::kitluy_devices.approval_verdict;
  end if;

  -- Scope: the approval must cover THIS device and THIS environment. An
  -- approval for another Hub is not an approval for this one.
  if v_request.environment <> p_environment then
    return row(false, v_deny || 'WRONG-SCOPE',
      format('approval is scoped to environment %s, not %s', v_request.environment, p_environment))::kitluy_devices.approval_verdict;
  end if;
  if v_request.resource_id is distinct from p_device_id then
    return row(false, v_deny || 'WRONG-SCOPE',
      'approval does not name this device')::kitluy_devices.approval_verdict;
  end if;

  if v_request.status <> 'APPROVED' then
    return row(false, v_deny || 'UNAPPROVED',
      format('approval request is %s', v_request.status))::kitluy_devices.approval_verdict;
  end if;

  -- Expiry uses the DATABASE clock deliberately. This is an approvals-workflow
  -- deadline, not a device trust decision — an operator's approval window is
  -- measured in server time, and routing it through a Hub's trusted time would
  -- let a device with a manipulated clock extend its own authorization.
  if v_request.expires_at is not null and v_request.expires_at <= now() then
    return row(false, v_deny || 'UNAPPROVED',
      format('approval expired at %s', v_request.expires_at))::kitluy_devices.approval_verdict;
  end if;

  -- Four eyes, derived from the immutable decision rows rather than a mutable
  -- flag (group 0030's design).
  select count(*) filter (where d.decision = 'APPROVE'),
         count(*) filter (where d.decision = 'APPROVE' and d.approver_id = v_request.requester_id)
  into v_approvers, v_self
  from kitluy_auth.approval_decisions d
  where d.approval_request_id = p_approval_request_id;

  if v_self > 0 then
    return row(false, v_deny || 'SELF-APPROVED',
      'the requester approved their own emergency time correction')::kitluy_devices.approval_verdict;
  end if;
  if v_approvers < coalesce(v_policy.quorum, 1) then
    return row(false, v_deny || 'UNAPPROVED',
      format('%s approver(s) recorded, policy requires %s', v_approvers, coalesce(v_policy.quorum, 1)))::kitluy_devices.approval_verdict;
  end if;
  if p_requester_id is not null and v_request.requester_id <> p_requester_id then
    return row(false, v_deny || 'WRONG-SCOPE',
      'the approval was requested by a different actor')::kitluy_devices.approval_verdict;
  end if;

  if exists (select 1 from kitluy_devices.time_correction_approvals
              where approval_request_id = p_approval_request_id) then
    return row(false, v_deny || 'APPROVAL-CONSUMED',
      'this approval has already authorized a time correction')::kitluy_devices.approval_verdict;
  end if;

  return row(true, null, null)::kitluy_devices.approval_verdict;
end;
$$;

comment on function kitluy_devices.evaluate_time_correction_approval_v1 is
  'The database-side approval gate for an emergency time correction, closing the gap the TypeScript layer alone was covering. Validates risk class A3/A4 (an UNDECLARED class is insufficient, not permissive), action match, device and environment scope, APPROVED status, unexpired window, four-eyes derived from immutable decision rows, and single-use consumption. Returns a verdict rather than raising so the refusal can be recorded.';

-- ---------------------------------------------------------------------------
-- emergency_time_correction_v1 — approval-gated, and atomic.
-- ---------------------------------------------------------------------------
-- The correction, the floor advancement, the approval consumption and the audit
-- are statements in ONE function call inside the caller's transaction. Any
-- failure rolls back all four; there is no state where the floor moved but the
-- approval was not consumed, or the reverse.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.emergency_time_correction_v1(
  p_device_id uuid,
  p_proposed_trusted_time timestamptz,
  p_evidence_source text,
  p_reason text,
  p_approval_request_id uuid,
  p_actor_ref text,
  p_requester_id uuid,
  p_correlation_id uuid,
  p_environment text
) returns kitluy_devices.time_correction_outcome
language plpgsql
as $$
declare
  v_state kitluy_devices.device_trusted_time;
  v_verdict kitluy_devices.approval_verdict;
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

  if coalesce(btrim(p_evidence_source), '') = ''
     or coalesce(btrim(p_reason), '') = '' then
    v_code := 'KLUY-DEVICE-TIME-CORRECTION-UNEVIDENCED';
    v_message := 'emergency time correction requires an evidence source and a reason';
  elsif p_approval_request_id is null then
    v_code := 'KLUY-DEVICE-TIME-CORRECTION-UNAPPROVED';
    v_message := 'emergency time correction requires an approval request';
  else
    v_verdict := kitluy_devices.evaluate_time_correction_approval_v1(
      p_approval_request_id, p_device_id, p_environment, p_requester_id);
    if not v_verdict.authorized then
      v_code := v_verdict.refusal_code;
      v_message := v_verdict.refusal_message;
    elsif v_state.trusted_time_floor is not null
          and p_proposed_trusted_time < v_state.trusted_time_floor then
      -- §12.1 holds even under emergency authority.
      v_code := 'KLUY-DEVICE-TIME-ROLLBACK';
      v_message := format('proposed %s is behind the trusted floor %s; trusted time never moves backwards',
                          p_proposed_trusted_time, v_state.trusted_time_floor);
    end if;
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
                          'proposed', p_proposed_trusted_time, 'actor', p_actor_ref,
                          'approval_request_id', p_approval_request_id,
                          'environment', p_environment,
                          'evidence_source', p_evidence_source, 'reason', p_reason))
    returning id into v_event_id;

    return row('REFUSED', p_device_id, v_state.trusted_time_floor, null,
               v_code, v_message, v_event_id)::kitluy_devices.time_correction_outcome;
  end if;

  -- Consume the approval FIRST. The unique constraint is the single-use
  -- guarantee, and doing it before the floor moves means a concurrent second
  -- correction loses here rather than after changing trusted time.
  insert into kitluy_devices.time_correction_approvals
    (approval_request_id, device_id, environment, consumed_by_actor_ref, correlation_id)
  values
    (p_approval_request_id, p_device_id, p_environment, p_actor_ref, p_correlation_id);

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
                        'approval_request_id', p_approval_request_id,
                        'environment', p_environment,
                        'evidence_source', p_evidence_source, 'reason', p_reason))
  returning id into v_event_id;

  return row('APPLIED', p_device_id, v_state.trusted_time_floor,
             p_proposed_trusted_time, null, null,
             v_event_id)::kitluy_devices.time_correction_outcome;
end;
$$;

comment on function kitluy_devices.emergency_time_correction_v1(uuid, timestamptz, text, text, uuid, text, uuid, uuid, text) is
  'Emergency time correction, gated on a REAL four-eyes approval (KLD-2026-07-28-002 §12.9). Validates risk class, action, device and environment scope, status, expiry, quorum, non-self-approval and single use — closing the gap where only the TypeScript layer enforced the risk class. Correction, floor advancement, approval consumption and audit are one transaction: any failure rolls back all four, so there is no state where the floor moved but the approval was not consumed. Refuses to move time backwards even with full authority.';

-- The group-0123 seven-argument form is DROPPED, not left as an overload. It
-- accepted a free-text approval id and could therefore be called instead of the
-- gated form — leaving it would leave the bypass this migration exists to close.
-- kitluy:destructive-approved:KLD-2026-07-28-002
drop function if exists kitluy_devices.emergency_time_correction_v1(
  uuid, timestamptz, text, text, text, text, text, uuid);

alter table kitluy_devices.time_correction_approvals enable row level security;
alter table kitluy_devices.time_correction_approvals force row level security;
grant select, insert on kitluy_devices.time_correction_approvals to service_role;

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
