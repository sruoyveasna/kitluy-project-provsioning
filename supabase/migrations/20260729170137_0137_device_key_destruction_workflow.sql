-- kitluy:group:0137
-- Migration group 0137: device_key_destruction_workflow (WS-11-T003 Step 4).
--
-- Additive. Groups 0120-0136 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- AUTHORITY
-- ===========================================================================
-- Owner decision KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001, OWNER-APPROVED
-- 2026-07-29, closing KLREQ-031. Every duration, expiry and count below is
-- taken VERBATIM from §15 of that decision. Nothing here is rounded,
-- paraphrased or "simplified"; where this file states a number, the decision
-- states the same number, and the section is cited beside it.
--
-- Group 0134 shipped `key_destruction_policy` INERT with both retention
-- periods NULL and the missing decision named, and its CHECKs refuse to enable
-- destruction without an approving decision AND both retention periods. This
-- group supplies exactly those, which is why 0134 could be written before the
-- owner had ruled.
--
-- ===========================================================================
-- WHAT AN APPROVAL IS NOT
-- ===========================================================================
-- Per decision §15: `destruction_enabled = true` means the governed workflow
-- may ACCEPT REQUESTS. It authorizes neither automatic nor approval-free
-- destruction, and §7 forbids a fully automatic irreversible provider call.
-- The flag is not the authority; the four-eyes record is.
--
-- Per decision §17, approval closed the missing-policy requirement only. It
-- promoted no implementation. This migration is the implementation; tests and
-- independent review decide whether it may be called implemented.
--
-- ===========================================================================
-- WHY THE KEY-STATE ENUM IS NOT EXTENDED
-- ===========================================================================
-- Decision §10 names a destruction lifecycle. It is modelled as a REQUEST with
-- its own status rather than by adding values to `device_key_state`, for two
-- reasons. PostgreSQL will not let a value added by ALTER TYPE be used in the
-- same transaction, so the hostile assertions at the foot of this file could
-- not exercise it. And a destruction request is a distinct object with its own
-- requester, approver, expiry and retry history; collapsing it into the key's
-- state column would leave nowhere to put any of that.
--
-- `device_generation_keys.state` keeps its existing meaning, and `destroyed`
-- remains the terminal value it already was.

begin;

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- Policy values — decision §15, verbatim.
-- ---------------------------------------------------------------------------
alter table kitluy_devices.key_destruction_policy
  add column if not exists superseded_minimum_retention_days integer,
  add column if not exists abandoned_minimum_retention_days integer,
  add column if not exists approval_validity_hours integer,
  add column if not exists maximum_execution_attempts integer,
  add column if not exists automatic_provider_destruction boolean not null default false,
  add column if not exists four_eyes_required boolean not null default true,
  add column if not exists policy_version integer not null default 1;

comment on column kitluy_devices.key_destruction_policy.automatic_provider_destruction is
  'Decision §7: the irreversible provider call must NOT be fully automatic. False, and the CHECK below refuses to make it true while four-eyes is required.';

-- A policy that enabled destruction while dropping four-eyes, or while turning
-- the provider call automatic, would satisfy §15's flag and violate §7. The
-- combination is refused rather than trusted to a reviewer noticing.
alter table kitluy_devices.key_destruction_policy
  add constraint key_destruction_policy_not_automatic_chk
    check (automatic_provider_destruction = false or four_eyes_required = false),
  add constraint key_destruction_policy_four_eyes_when_enabled_chk
    check (destruction_enabled = false or four_eyes_required = true),
  add constraint key_destruction_policy_full_retention_chk
    check (destruction_enabled = false
           or (superseded_minimum_retention_days is not null
               and abandoned_minimum_retention_days is not null
               and recovery_retention_days is not null
               and approval_validity_hours is not null
               and maximum_execution_attempts is not null));

update kitluy_devices.key_destruction_policy
   set destruction_enabled = true,
       -- §2: 30 calendar days after credential overlap_ends_at.
       superseded_minimum_retention_days = 30,
       minimum_retention_days = 30,
       -- §3: 7 calendar days after abandoned_at.
       abandoned_minimum_retention_days = 7,
       -- §4: 14 calendar days after the latest verified terminal recovery.
       recovery_retention_days = 14,
       -- §6: approval expires after 24 hours.
       approval_validity_hours = 24,
       -- §13: after five failed execution attempts, manual review.
       maximum_execution_attempts = 5,
       automatic_provider_destruction = false,
       four_eyes_required = true,
       requires_operator_approval = true,
       approved_by_decision_ref = 'KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001',
       required_owner_decision = null,
       policy_version = 2,
       updated_at = now()
 where environment = 'development';

-- ---------------------------------------------------------------------------
-- Holds — decision §8.
-- ---------------------------------------------------------------------------
do $hold_enums$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'kitluy_devices' and t.typname = 'key_hold_type') then
    create type kitluy_devices.key_hold_type as enum
      ('incident', 'legal', 'regulatory', 'audit_preservation');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'kitluy_devices' and t.typname = 'key_destruction_request_status') then
    create type kitluy_devices.key_destruction_request_status as enum (
      'requested', 'approved', 'pending_execution', 'executed',
      'failed', 'manual_review', 'cancelled', 'expired');
  end if;
end
$hold_enums$;

create table if not exists kitluy_devices.device_key_holds (
  hold_id uuid primary key default gen_random_uuid(),
  hold_type kitluy_devices.key_hold_type not null,
  device_record_id uuid not null references kitluy_devices.devices (id),
  environment text not null,
  provider_key_reference text not null,
  public_key_fingerprint text not null,
  key_generation integer not null,
  reason text not null,
  declared_by text not null,
  declared_at timestamptz not null default clock_timestamp(),
  review_due_at timestamptz,
  released_by text,
  released_at timestamptz,
  release_reason text,
  audit_event_id uuid,

  constraint device_key_holds_reason_not_empty check (btrim(reason) <> ''),
  constraint device_key_holds_release_pairing
    check ((released_at is null) = (released_by is null)
           and (released_at is null) = (release_reason is null)),
  -- §8: a hold release requires an authorized human OTHER than the declarer.
  -- Enforced here rather than in a service, so it holds for every caller.
  constraint device_key_holds_release_is_four_eyes
    check (released_by is null or btrim(released_by) <> btrim(declared_by))
);

comment on table kitluy_devices.device_key_holds is
  'Owner: Security/Legal. Decision §8. An ACTIVE hold (released_at is null) suspends destruction eligibility, execution, approval use and retry. Release requires a different human from the declarer — a CHECK, because a control that depends on the releaser choosing to be a different person is not a control. MC: A/O.';

create index device_key_holds_active_idx
  on kitluy_devices.device_key_holds (device_record_id, provider_key_reference)
  where released_at is null;

-- ---------------------------------------------------------------------------
-- Requests, approvals, execution and evidence — decision §6, §9, §11, §12, §13.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_key_destruction_requests (
  destruction_request_id uuid primary key default gen_random_uuid(),
  -- Stable per destruction INTENT, so a retry is idempotent.
  request_key text not null,

  device_record_id uuid not null references kitluy_devices.devices (id),
  environment text not null,
  purpose text not null,
  provider_key_reference text not null,
  public_key_fingerprint text not null,
  key_generation integer not null,
  key_state_at_request text not null,
  superseding_credential_id uuid references kitluy_devices.device_credentials (credential_id),

  -- The eligibility arithmetic, FROZEN as evaluated (§11 requires the
  -- calculation to survive, not just its verdict).
  eligibility_evaluated_at timestamptz not null,
  eligible_from timestamptz not null,
  retention_basis text not null,
  overlap_ends_at timestamptz,
  abandoned_at timestamptz,
  latest_terminal_recovery_at timestamptz,

  policy_decision_ref text not null,
  policy_version integer not null,

  status kitluy_devices.key_destruction_request_status not null default 'requested',

  requested_by text not null,
  requested_at timestamptz not null default clock_timestamp(),
  request_reason text not null,
  requester_reauthenticated boolean not null,

  approved_by text,
  approved_at timestamptz,
  approval_expires_at timestamptz,
  approval_reason text,
  approver_reauthenticated boolean,

  attempt_count integer not null default 0,
  last_failure_code text,
  last_failure_at timestamptz,

  -- §12: a local status is not proof. Nothing may be marked destroyed until
  -- one of these carries verified provider evidence.
  provider_result text,
  provider_receipt_digest text,
  provider_response_ref text,
  provider_confirmed_at timestamptz,
  database_confirmed_at timestamptz,

  manual_review_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  constraint device_key_destruction_requests_key_unique unique (request_key),
  constraint device_key_destruction_requests_reason_not_empty check (btrim(request_reason) <> ''),
  -- §6: the requester must re-authenticate. A request that did not is not a
  -- request.
  constraint device_key_destruction_requests_requester_reauth
    check (requester_reauthenticated = true),
  constraint device_key_destruction_requests_approval_pairing
    check ((approved_by is null) = (approved_at is null)
           and (approved_by is null) = (approval_expires_at is null)),
  -- §6: requester and approver must be different users.
  constraint device_key_destruction_requests_four_eyes
    check (approved_by is null or btrim(approved_by) <> btrim(requested_by)),
  constraint device_key_destruction_requests_approver_reauth
    check (approved_by is null or approver_reauthenticated = true),
  -- §9/§12: the database may not record a confirmed destruction without
  -- provider evidence. This is the invariant the whole decision turns on.
  constraint device_key_destruction_no_confirm_without_evidence
    check (database_confirmed_at is null
           or (provider_result in ('DESTROYED', 'ALREADY_DESTROYED')
               and provider_confirmed_at is not null
               and (provider_receipt_digest is not null or provider_response_ref is not null))),
  constraint device_key_destruction_requests_executed_is_confirmed
    check (status <> 'executed' or database_confirmed_at is not null),
  constraint device_key_destruction_requests_no_secrets
    check (request_reason !~* 'BEGIN [A-Z ]*PRIVATE KEY'
           and coalesce(provider_response_ref, '') !~* 'BEGIN [A-Z ]*PRIVATE KEY'
           and coalesce(provider_response_ref, '') !~* '(postgres|postgresql)://')
);

comment on table kitluy_devices.device_key_destruction_requests is
  'Owner: Fleet/Security. Decision KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001. One irreversible destruction intent: the frozen eligibility arithmetic, the requester, the distinct approver, the approval expiry, the provider evidence and the database confirmation. The CHECK that matters most refuses a database confirmation without a verified provider result — §12 says a local status alone is not proof of destruction. MC: A/O.';

comment on column kitluy_devices.device_key_destruction_requests.eligible_from is
  'Decision §4: the LATEST applicable of the retention floors, frozen at evaluation. Stored rather than recomputed so an approver reviews the same arithmetic the requester saw.';

create index device_key_destruction_requests_open_idx
  on kitluy_devices.device_key_destruction_requests (environment, status)
  where status in ('requested', 'approved', 'pending_execution', 'failed');

create table if not exists kitluy_devices.device_key_destruction_attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  destruction_request_id uuid not null
    references kitluy_devices.device_key_destruction_requests (destruction_request_id),
  attempt_number integer not null,
  outcome text not null,
  failure_code text,
  provider_result text,
  provider_receipt_digest text,
  executed_by text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  occurred_at timestamptz not null default clock_timestamp(),
  sequence_no bigint generated always as identity,

  constraint device_key_destruction_attempts_number check (attempt_number >= 1),
  constraint device_key_destruction_attempts_no_secrets
    check (outcome !~* 'BEGIN [A-Z ]*PRIVATE KEY'
           and coalesce(failure_code, '') !~* '(postgres|postgresql)://')
);

comment on table kitluy_devices.device_key_destruction_attempts is
  'Owner: Fleet/Security. Decision §13. APPEND-ONLY history of every execution attempt against a destruction request. A retry appends; the record of how many times an irreversible operation was attempted, and why each failed, must survive the operation. MC: A/O.';

create trigger trg_device_key_destruction_attempts_append_only
  before update or delete on kitluy_devices.device_key_destruction_attempts
  for each row execute function kitluy_auth.enforce_append_only();

-- ---------------------------------------------------------------------------
-- Eligibility — decision §2, §3, §4, §5.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.evaluate_key_destruction_eligibility_v1(
  p_device_record_id uuid,
  p_environment text,
  p_provider_key_reference text,
  p_trusted_now timestamptz,
  p_trusted_time_status text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $eligibility$
declare
  v_key kitluy_devices.device_generation_keys;
  v_policy kitluy_devices.key_destruction_policy;
  v_head kitluy_devices.device_credential_heads;
  v_blockers text[] := array[]::text[];
  v_eligible_from timestamptz;
  v_basis text;
  v_recovery timestamptz;
  v_overlap timestamptz;
begin
  -- §5: trusted time unavailable or untrusted is a BLOCKER, not a warning.
  if p_trusted_time_status is distinct from 'trusted' or p_trusted_now is null then
    return jsonb_build_object('eligible', false, 'authorized', false,
      'blockers', to_jsonb(array['TRUSTED_TIME_UNAVAILABLE']),
      'reason', 'destruction eligibility is decided against trusted time');
  end if;

  select * into v_policy from kitluy_devices.key_destruction_policy
   where environment = p_environment;
  if not found or not v_policy.destruction_enabled then
    return jsonb_build_object('eligible', false, 'authorized', false,
      'blockers', to_jsonb(array['DESTRUCTION_NOT_ENABLED']),
      'reason', 'no enabled destruction policy for this environment');
  end if;

  select * into v_key from kitluy_devices.device_generation_keys
   where device_record_id = p_device_record_id
     and environment = p_environment
     and key_handle = p_provider_key_reference;
  if not found then
    return jsonb_build_object('eligible', false, 'authorized', false,
      'blockers', to_jsonb(array['PROVIDER_KEY_NOT_FOUND']),
      'reason', 'no such provider key for this device');
  end if;

  -- §5: only a finished key is a candidate at all. `active` and
  -- `credential_issued_pending_activation` are refused outright (§10).
  if v_key.state not in ('superseded', 'abandoned') then
    v_blockers := v_blockers || format('KEY_STATE_%s', upper(v_key.state::text));
  end if;
  if v_key.destroyed_at is not null then
    return jsonb_build_object('eligible', false, 'authorized', false,
      'blockers', to_jsonb(array['ALREADY_DESTROYED']), 'reason', 'the key is already destroyed');
  end if;

  select * into v_head from kitluy_devices.device_credential_heads
   where device_record_id = p_device_record_id and environment = p_environment;

  -- §5: referenced by the CURRENT credential, or by any credential still
  -- issued. Under same-key renewal the superseded key still backs the current
  -- credential, which is the case that would otherwise destroy a working key.
  if exists (
    select 1 from kitluy_devices.device_credentials c
     where c.device_record_id = p_device_record_id
       and c.environment = p_environment
       and c.public_key_fingerprint = v_key.public_key_fingerprint
       and c.state = 'issued')
  then
    v_blockers := v_blockers || 'REFERENCED_BY_ISSUED_CREDENTIAL';
  end if;

  -- §5: attached to an unfinished renewal, issuance or reconciliation.
  if exists (
    select 1 from kitluy_devices.device_renewal_reservations r
     where r.device_record_id = p_device_record_id
       and r.status not in ('completed', 'refused', 'abandoned'))
  then
    v_blockers := v_blockers || 'UNFINISHED_RENEWAL';
  end if;

  -- The retention floors. §4: the eligibility time is the LATEST applicable.
  select max(occurred_at) into v_recovery
    from kitluy_devices.device_renewal_reconciliations
   where device_record_id = p_device_record_id;

  if v_key.state = 'superseded' then
    v_overlap := v_head.overlap_ends_at;
    if v_overlap is null then
      -- §2: absent overlap_ends_at means the retention clock never started.
      v_blockers := v_blockers || 'OVERLAP_END_UNKNOWN';
      v_eligible_from := null;
    else
      v_eligible_from := v_overlap + make_interval(days => v_policy.superseded_minimum_retention_days);
    end if;
    v_basis := 'superseded';
  else
    if v_key.abandoned_at is null then
      v_blockers := v_blockers || 'ABANDONED_AT_UNKNOWN';
      v_eligible_from := null;
    else
      v_eligible_from := v_key.abandoned_at + make_interval(days => v_policy.abandoned_minimum_retention_days);
    end if;
    v_basis := 'abandoned';
  end if;

  -- §4: recovery retention applies to BOTH bases. When no verified terminal
  -- recovery timestamp exists the key is NOT eligible — absence is a blocker,
  -- not a zero.
  if v_recovery is null then
    v_blockers := v_blockers || 'NO_VERIFIED_TERMINAL_RECOVERY';
  elsif v_eligible_from is not null then
    v_eligible_from := greatest(
      v_eligible_from, v_recovery + make_interval(days => v_policy.recovery_retention_days));
  end if;

  -- §5, §8: any ACTIVE hold blocks.
  if exists (
    select 1 from kitluy_devices.device_key_holds h
     where h.device_record_id = p_device_record_id
       and h.provider_key_reference = p_provider_key_reference
       and h.released_at is null)
  then
    v_blockers := v_blockers || 'HOLD_ACTIVE';
  end if;

  if v_eligible_from is not null and p_trusted_now < v_eligible_from then
    v_blockers := v_blockers || 'RETENTION_NOT_ELAPSED';
  end if;

  return jsonb_build_object(
    'eligible', cardinality(v_blockers) = 0,
    -- ELIGIBLE IS NOT AUTHORIZED. Four-eyes decides the second (§6), and it
    -- has not happened at evaluation time.
    'authorized', false,
    'blockers', to_jsonb(v_blockers),
    'retention_basis', v_basis,
    'eligible_from', v_eligible_from,
    'overlap_ends_at', v_overlap,
    'abandoned_at', v_key.abandoned_at,
    'latest_terminal_recovery_at', v_recovery,
    'public_key_fingerprint', v_key.public_key_fingerprint,
    'key_generation', v_key.key_generation,
    'key_state', v_key.state::text,
    'policy_decision_ref', v_policy.approved_by_decision_ref,
    'policy_version', v_policy.policy_version);
end
$eligibility$;

comment on function kitluy_devices.evaluate_key_destruction_eligibility_v1 is
  'Decision §2-§5. Returns eligibility and the arithmetic behind it, and ALWAYS returns authorized=false: eligibility is a fact about the fleet, authorization is a four-eyes decision that has not happened yet. Unknown states fail closed — an absent overlap end, an absent abandonment time and an absent verified terminal recovery are each blockers rather than zeros.';

-- ---------------------------------------------------------------------------
-- Request, approve, execute, confirm.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.request_key_destruction_v1(
  p_request_key text,
  p_device_record_id uuid,
  p_environment text,
  p_purpose text,
  p_provider_key_reference text,
  p_requested_by text,
  p_request_reason text,
  p_reauthenticated boolean,
  p_trusted_now timestamptz,
  p_trusted_time_status text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $request$
declare
  v_eval jsonb;
  v_existing kitluy_devices.device_key_destruction_requests;
  v_row kitluy_devices.device_key_destruction_requests;
  v_key kitluy_devices.device_generation_keys;
begin
  if coalesce(btrim(p_request_key), '') = '' or coalesce(btrim(p_requested_by), '') = ''
     or coalesce(btrim(p_request_reason), '') = '' then
    raise exception 'KLUY-KEYDESTROY-INCOMPLETE: a destruction request names its key, requester and reason'
      using errcode = 'P0001';
  end if;
  -- §6: the requester must re-authenticate.
  if p_reauthenticated is not true then
    raise exception 'KLUY-KEYDESTROY-NO-REAUTH: the requester must re-authenticate (decision §6)'
      using errcode = 'P0001';
  end if;

  select * into v_existing from kitluy_devices.device_key_destruction_requests
   where request_key = p_request_key;
  if found then
    return jsonb_build_object('outcome', 'ALREADY_REQUESTED',
      'destruction_request_id', v_existing.destruction_request_id,
      'status', v_existing.status);
  end if;

  v_eval := kitluy_devices.evaluate_key_destruction_eligibility_v1(
    p_device_record_id, p_environment, p_provider_key_reference,
    p_trusted_now, p_trusted_time_status);

  if not (v_eval ->> 'eligible')::boolean then
    return jsonb_build_object('outcome', 'REQUEST_REFUSED',
      'refusal_code', 'KLUY-KEYDESTROY-NOT-ELIGIBLE',
      'blockers', v_eval -> 'blockers');
  end if;

  select * into v_key from kitluy_devices.device_generation_keys
   where device_record_id = p_device_record_id
     and environment = p_environment
     and key_handle = p_provider_key_reference;

  insert into kitluy_devices.device_key_destruction_requests (
    request_key, device_record_id, environment, purpose,
    provider_key_reference, public_key_fingerprint, key_generation,
    key_state_at_request, eligibility_evaluated_at, eligible_from,
    retention_basis, overlap_ends_at, abandoned_at, latest_terminal_recovery_at,
    policy_decision_ref, policy_version, requested_by, request_reason,
    requester_reauthenticated)
  values (
    p_request_key, p_device_record_id, p_environment, p_purpose,
    p_provider_key_reference, v_eval ->> 'public_key_fingerprint',
    (v_eval ->> 'key_generation')::integer, v_eval ->> 'key_state',
    p_trusted_now, (v_eval ->> 'eligible_from')::timestamptz,
    v_eval ->> 'retention_basis', (v_eval ->> 'overlap_ends_at')::timestamptz,
    (v_eval ->> 'abandoned_at')::timestamptz,
    (v_eval ->> 'latest_terminal_recovery_at')::timestamptz,
    v_eval ->> 'policy_decision_ref', (v_eval ->> 'policy_version')::integer,
    p_requested_by, p_request_reason, p_reauthenticated)
  returning * into v_row;

  return jsonb_build_object('outcome', 'REQUESTED',
    'destruction_request_id', v_row.destruction_request_id,
    'eligible_from', v_row.eligible_from,
    'retention_basis', v_row.retention_basis);
end
$request$;

create or replace function kitluy_devices.approve_key_destruction_v1(
  p_destruction_request_id uuid,
  p_approved_by text,
  p_approval_reason text,
  p_reauthenticated boolean,
  p_trusted_now timestamptz,
  p_trusted_time_status text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $approve$
declare
  v_req kitluy_devices.device_key_destruction_requests;
  v_policy kitluy_devices.key_destruction_policy;
  v_eval jsonb;
begin
  if coalesce(btrim(p_approved_by), '') = '' or coalesce(btrim(p_approval_reason), '') = '' then
    raise exception 'KLUY-KEYDESTROY-APPROVAL-INCOMPLETE: an approval names its approver and reason'
      using errcode = 'P0001';
  end if;
  if p_reauthenticated is not true then
    raise exception 'KLUY-KEYDESTROY-APPROVER-NO-REAUTH: the approver must re-authenticate (decision §6)'
      using errcode = 'P0001';
  end if;

  select * into v_req from kitluy_devices.device_key_destruction_requests
   where destruction_request_id = p_destruction_request_id for update;
  if not found then
    raise exception 'KLUY-KEYDESTROY-NO-REQUEST: no destruction request %', p_destruction_request_id
      using errcode = 'P0001';
  end if;
  if v_req.status = 'approved' then
    return jsonb_build_object('outcome', 'ALREADY_APPROVED',
      'destruction_request_id', v_req.destruction_request_id,
      'approval_expires_at', v_req.approval_expires_at);
  end if;
  if v_req.status <> 'requested' then
    return jsonb_build_object('outcome', 'APPROVAL_REFUSED',
      'refusal_code', 'KLUY-KEYDESTROY-WRONG-STATUS',
      'detail', format('request is %s', v_req.status));
  end if;

  -- §6: a different human. The CHECK enforces it too; refusing here gives the
  -- caller a reason instead of a constraint violation.
  if btrim(p_approved_by) = btrim(v_req.requested_by) then
    return jsonb_build_object('outcome', 'APPROVAL_REFUSED',
      'refusal_code', 'KLUY-KEYDESTROY-SELF-APPROVED',
      'detail', 'the requester and approver must be different people');
  end if;

  -- §6: the approver independently verifies eligibility. Re-evaluated rather
  -- than trusted from the request, because the world moves between the two —
  -- a hold placed after the request must stop the approval.
  v_eval := kitluy_devices.evaluate_key_destruction_eligibility_v1(
    v_req.device_record_id, v_req.environment, v_req.provider_key_reference,
    p_trusted_now, p_trusted_time_status);
  if not (v_eval ->> 'eligible')::boolean then
    update kitluy_devices.device_key_destruction_requests
       set status = 'manual_review',
           manual_review_reason = format('eligibility lapsed before approval: %s', v_eval -> 'blockers'),
           updated_at = clock_timestamp()
     where destruction_request_id = p_destruction_request_id;
    return jsonb_build_object('outcome', 'APPROVAL_REFUSED',
      'refusal_code', 'KLUY-KEYDESTROY-ELIGIBILITY-LAPSED',
      'blockers', v_eval -> 'blockers');
  end if;
  -- §6: the approver verifies the reference and fingerprint still match.
  if (v_eval ->> 'public_key_fingerprint') is distinct from v_req.public_key_fingerprint
     or (v_eval ->> 'key_generation')::integer is distinct from v_req.key_generation then
    update kitluy_devices.device_key_destruction_requests
       set status = 'manual_review',
           manual_review_reason = 'the key fingerprint or generation changed between request and approval',
           updated_at = clock_timestamp()
     where destruction_request_id = p_destruction_request_id;
    return jsonb_build_object('outcome', 'APPROVAL_REFUSED',
      'refusal_code', 'KLUY-KEYDESTROY-KEY-CHANGED');
  end if;

  select * into v_policy from kitluy_devices.key_destruction_policy
   where environment = v_req.environment;

  update kitluy_devices.device_key_destruction_requests
     set status = 'approved',
         approved_by = p_approved_by,
         approved_at = clock_timestamp(),
         -- §6: 24 hours. Server time, deliberately: an approval window is an
         -- operator deadline, and routing it through a device's trusted clock
         -- would let a device extend its own authorization.
         approval_expires_at = now() + make_interval(hours => v_policy.approval_validity_hours),
         approval_reason = p_approval_reason,
         approver_reauthenticated = p_reauthenticated,
         updated_at = clock_timestamp()
   where destruction_request_id = p_destruction_request_id;

  return jsonb_build_object('outcome', 'APPROVED',
    'destruction_request_id', p_destruction_request_id,
    'approval_expires_at', now() + make_interval(hours => v_policy.approval_validity_hours));
end
$approve$;

-- Claim the right to CALL the provider. Separated from confirmation because
-- the provider call happens outside this transaction and may be lost: §9 and
-- §12 forbid recording destruction the provider has not evidenced.
create or replace function kitluy_devices.begin_key_destruction_execution_v1(
  p_destruction_request_id uuid,
  p_executed_by text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $begin_exec$
declare
  v_req kitluy_devices.device_key_destruction_requests;
  v_policy kitluy_devices.key_destruction_policy;
begin
  select * into v_req from kitluy_devices.device_key_destruction_requests
   where destruction_request_id = p_destruction_request_id for update;
  if not found then
    raise exception 'KLUY-KEYDESTROY-NO-REQUEST: no destruction request %', p_destruction_request_id
      using errcode = 'P0001';
  end if;
  select * into v_policy from kitluy_devices.key_destruction_policy
   where environment = v_req.environment;

  if v_req.status = 'executed' then
    return jsonb_build_object('outcome', 'ALREADY_EXECUTED',
      'destruction_request_id', v_req.destruction_request_id);
  end if;
  if v_req.status not in ('approved', 'pending_execution', 'failed') then
    return jsonb_build_object('outcome', 'EXECUTION_REFUSED',
      'refusal_code', 'KLUY-KEYDESTROY-NOT-APPROVED',
      'detail', format('request is %s', v_req.status));
  end if;
  if v_req.approved_by is null then
    return jsonb_build_object('outcome', 'EXECUTION_REFUSED',
      'refusal_code', 'KLUY-KEYDESTROY-NOT-APPROVED',
      'detail', 'no approval recorded');
  end if;
  -- §6: an expired approval requires a NEW eligibility evaluation and approval.
  if v_req.approval_expires_at <= now() then
    update kitluy_devices.device_key_destruction_requests
       set status = 'expired', updated_at = clock_timestamp()
     where destruction_request_id = p_destruction_request_id;
    return jsonb_build_object('outcome', 'EXECUTION_REFUSED',
      'refusal_code', 'KLUY-KEYDESTROY-APPROVAL-EXPIRED',
      'detail', format('the approval expired at %s', v_req.approval_expires_at));
  end if;
  -- §8: a hold placed after approval stops execution, and releasing it does
  -- NOT resume this approval.
  if exists (select 1 from kitluy_devices.device_key_holds h
              where h.device_record_id = v_req.device_record_id
                and h.provider_key_reference = v_req.provider_key_reference
                and h.released_at is null) then
    return jsonb_build_object('outcome', 'EXECUTION_REFUSED',
      'refusal_code', 'KLUY-KEYDESTROY-HOLD-ACTIVE');
  end if;
  -- §13: after five failed attempts, manual review.
  if v_req.attempt_count >= v_policy.maximum_execution_attempts then
    update kitluy_devices.device_key_destruction_requests
       set status = 'manual_review',
           manual_review_reason = format('%s execution attempts failed', v_req.attempt_count),
           updated_at = clock_timestamp()
     where destruction_request_id = p_destruction_request_id;
    return jsonb_build_object('outcome', 'EXECUTION_REFUSED',
      'refusal_code', 'KLUY-KEYDESTROY-ATTEMPTS-EXHAUSTED');
  end if;

  update kitluy_devices.device_key_destruction_requests
     set status = 'pending_execution',
         attempt_count = v_req.attempt_count + 1,
         updated_at = clock_timestamp()
   where destruction_request_id = p_destruction_request_id;

  return jsonb_build_object('outcome', 'EXECUTION_CLEARED',
    'destruction_request_id', v_req.destruction_request_id,
    'attempt_number', v_req.attempt_count + 1,
    'provider_key_reference', v_req.provider_key_reference,
    'public_key_fingerprint', v_req.public_key_fingerprint,
    'key_generation', v_req.key_generation,
    'executed_by', p_executed_by);
end
$begin_exec$;

-- Record what the provider actually said, and only then confirm.
create or replace function kitluy_devices.confirm_key_destruction_v1(
  p_destruction_request_id uuid,
  p_provider_result text,
  p_provider_receipt_digest text,
  p_provider_response_ref text,
  p_observed_fingerprint text,
  p_observed_key_reference text,
  p_executed_by text,
  p_started_at timestamptz,
  p_finished_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $confirm$
declare
  v_req kitluy_devices.device_key_destruction_requests;
  v_review text;
begin
  select * into v_req from kitluy_devices.device_key_destruction_requests
   where destruction_request_id = p_destruction_request_id for update;
  if not found then
    raise exception 'KLUY-KEYDESTROY-NO-REQUEST: no destruction request %', p_destruction_request_id
      using errcode = 'P0001';
  end if;
  if v_req.status = 'executed' then
    return jsonb_build_object('outcome', 'ALREADY_CONFIRMED',
      'destruction_request_id', v_req.destruction_request_id);
  end if;

  -- §9: the provider must be talking about the key we asked about. A changed
  -- reference or fingerprint is a DIVERGENCE, never a success.
  if p_observed_fingerprint is distinct from v_req.public_key_fingerprint then
    v_review := 'the provider reported a different key fingerprint';
  elsif p_observed_key_reference is distinct from v_req.provider_key_reference then
    v_review := 'the provider reported a different key reference';
  elsif p_provider_result not in ('DESTROYED', 'ALREADY_DESTROYED') then
    -- §9: timeout, ambiguity or a missing key produce manual review, never
    -- assumed success.
    v_review := format('provider outcome %s is not an accepted destruction result',
                       coalesce(p_provider_result, 'NONE'));
  elsif p_provider_receipt_digest is null and p_provider_response_ref is null then
    -- §12: a local status is not proof.
    v_review := 'no provider receipt, attestation or correlatable response was retained';
  end if;

  insert into kitluy_devices.device_key_destruction_attempts (
    destruction_request_id, attempt_number, outcome, failure_code,
    provider_result, provider_receipt_digest, executed_by, started_at, finished_at)
  values (
    p_destruction_request_id, greatest(v_req.attempt_count, 1),
    case when v_review is null then 'CONFIRMED' else 'REVIEW' end,
    v_review, p_provider_result, p_provider_receipt_digest,
    p_executed_by, p_started_at, p_finished_at);

  if v_review is not null then
    update kitluy_devices.device_key_destruction_requests
       set status = 'manual_review', manual_review_reason = v_review,
           last_failure_code = 'PROVIDER_EVIDENCE_INSUFFICIENT',
           last_failure_at = clock_timestamp(), updated_at = clock_timestamp()
     where destruction_request_id = p_destruction_request_id;
    return jsonb_build_object('outcome', 'MANUAL_REVIEW_REQUIRED', 'detail', v_review);
  end if;

  update kitluy_devices.device_key_destruction_requests
     set status = 'executed',
         provider_result = p_provider_result,
         provider_receipt_digest = p_provider_receipt_digest,
         provider_response_ref = p_provider_response_ref,
         provider_confirmed_at = clock_timestamp(),
         database_confirmed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where destruction_request_id = p_destruction_request_id;

  -- ONLY NOW. §12: the database follows verified provider evidence; it never
  -- leads it.
  update kitluy_devices.device_generation_keys
     set state = 'destroyed', destroyed_at = clock_timestamp()
   where device_record_id = v_req.device_record_id
     and environment = v_req.environment
     and key_handle = v_req.provider_key_reference;

  return jsonb_build_object('outcome', 'DESTROYED',
    'destruction_request_id', v_req.destruction_request_id,
    'provider_result', p_provider_result);
end
$confirm$;

-- ---------------------------------------------------------------------------
-- Holds — place and release (§8).
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.place_key_hold_v1(
  p_hold_type kitluy_devices.key_hold_type,
  p_device_record_id uuid,
  p_environment text,
  p_provider_key_reference text,
  p_reason text,
  p_declared_by text,
  p_review_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $place_hold$
declare
  v_key kitluy_devices.device_generation_keys;
  v_id uuid;
begin
  if coalesce(btrim(p_declared_by), '') = '' or coalesce(btrim(p_reason), '') = '' then
    raise exception 'KLUY-KEYHOLD-INCOMPLETE: a hold names who declared it and why'
      using errcode = 'P0001';
  end if;
  select * into v_key from kitluy_devices.device_generation_keys
   where device_record_id = p_device_record_id
     and environment = p_environment and key_handle = p_provider_key_reference;
  if not found then
    raise exception 'KLUY-KEYHOLD-NO-KEY: no such provider key' using errcode = 'P0001';
  end if;

  insert into kitluy_devices.device_key_holds (
    hold_type, device_record_id, environment, provider_key_reference,
    public_key_fingerprint, key_generation, reason, declared_by, review_due_at)
  values (
    p_hold_type, p_device_record_id, p_environment, p_provider_key_reference,
    v_key.public_key_fingerprint, v_key.key_generation, p_reason, p_declared_by, p_review_due_at)
  returning hold_id into v_id;

  -- §8: the hold suspends any approval already granted. It does not merely
  -- prevent the next one.
  update kitluy_devices.device_key_destruction_requests
     set status = 'manual_review',
         manual_review_reason = format('%s hold %s placed', p_hold_type, v_id),
         updated_at = clock_timestamp()
   where device_record_id = p_device_record_id
     and provider_key_reference = p_provider_key_reference
     and status in ('requested', 'approved', 'pending_execution', 'failed');

  return jsonb_build_object('outcome', 'HELD', 'hold_id', v_id);
end
$place_hold$;

create or replace function kitluy_devices.release_key_hold_v1(
  p_hold_id uuid,
  p_released_by text,
  p_release_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $release_hold$
declare
  v_hold kitluy_devices.device_key_holds;
begin
  if coalesce(btrim(p_released_by), '') = '' or coalesce(btrim(p_release_reason), '') = '' then
    raise exception 'KLUY-KEYHOLD-RELEASE-INCOMPLETE: a release names who released it and why'
      using errcode = 'P0001';
  end if;
  select * into v_hold from kitluy_devices.device_key_holds where hold_id = p_hold_id for update;
  if not found then
    raise exception 'KLUY-KEYHOLD-NOT-FOUND: no hold %', p_hold_id using errcode = 'P0001';
  end if;
  if v_hold.released_at is not null then
    return jsonb_build_object('outcome', 'ALREADY_RELEASED', 'hold_id', p_hold_id);
  end if;
  -- §8: a different human than the declarer.
  if btrim(p_released_by) = btrim(v_hold.declared_by) then
    return jsonb_build_object('outcome', 'RELEASE_REFUSED',
      'refusal_code', 'KLUY-KEYHOLD-SELF-RELEASE',
      'detail', 'a hold is released by someone other than the person who declared it');
  end if;

  update kitluy_devices.device_key_holds
     set released_by = p_released_by, released_at = clock_timestamp(),
         release_reason = p_release_reason
   where hold_id = p_hold_id;

  return jsonb_build_object('outcome', 'RELEASED', 'hold_id', p_hold_id,
    'note', 'releasing a hold does not resume any prior approval; eligibility and four-eyes must be performed again');
end
$release_hold$;

-- ---------------------------------------------------------------------------
-- The key state machine, tightened to decision §10.
--
-- Group 0128 permitted `generated -> destroyed` and `active -> destroyed`, and
-- group 0130 added `credential_issued_pending_activation` WITHOUT giving it a
-- transition edge. Decision §10 forbids both destructive shortcuts outright:
-- `active` cannot transition directly to `destroyed`, and a key holding an
-- issued-but-unactivated credential cannot be destroyed at all.
--
-- Replacing the function is additive — group 0128 is not rewritten — and it
-- closes the path by which an approved workflow could have been bypassed with
-- a single UPDATE by the governor.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.enforce_device_key_transitions()
returns trigger
language plpgsql
as $key_transitions$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-KEY-IMMUTABLE: a device key is superseded, abandoned or destroyed, never deleted'
      using errcode = 'P0001';
  end if;

  if current_user <> 'kitluy_credential_issuer' then
    raise exception 'KLUY-KEY-UNAUTHORIZED: only the governed path may write a device key (current_user %)',
      current_user using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'generated' then
      raise exception 'KLUY-KEY-BAD-INITIAL-STATE: a key begins generated, not %', new.state
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.device_record_id <> old.device_record_id
     or new.environment <> old.environment
     or new.purpose <> old.purpose
     or new.generation <> old.generation
     or new.key_handle <> old.key_handle
     or new.public_key_fingerprint <> old.public_key_fingerprint then
    raise exception 'KLUY-KEY-MUTATED: a key''s identity is fixed at generation'
      using errcode = 'P0001';
  end if;

  if new.state <> old.state then
    -- DECISION §10. `destroyed` is reachable only from a FINISHED key, and only
    -- through the governed destruction workflow that produced provider
    -- evidence. `active -> destroyed` would destroy a key that is still
    -- serving; `credential_issued_pending_activation -> destroyed` would
    -- destroy the key a device is about to start using.
    if not (case old.state
              when 'generated' then new.state in ('credential_issued_pending_activation', 'active', 'abandoned')
              when 'credential_issued_pending_activation' then new.state in ('active', 'abandoned')
              when 'active' then new.state in ('superseded', 'abandoned')
              when 'superseded' then new.state = 'destroyed'
              when 'abandoned' then new.state = 'destroyed'
              when 'destroyed' then false
              else false
            end) then
      raise exception 'KLUY-KEY-BAD-TRANSITION: % -> % is not a permitted device key transition',
        old.state, new.state using errcode = 'P0001';
    end if;
  end if;

  return new;
end
$key_transitions$;

comment on function kitluy_devices.enforce_device_key_transitions() is
  'Decision §10. `destroyed` is reachable ONLY from `superseded` or `abandoned`. Group 0128 permitted generated->destroyed and active->destroyed, and group 0130 added credential_issued_pending_activation without a transition edge; both were paths by which an UPDATE could have skipped the four-eyes destruction workflow entirely.';

-- ---------------------------------------------------------------------------
-- Grants, ownership, hygiene
-- ---------------------------------------------------------------------------
alter table kitluy_devices.device_key_holds enable row level security;
alter table kitluy_devices.device_key_holds force row level security;
alter table kitluy_devices.device_key_destruction_requests enable row level security;
alter table kitluy_devices.device_key_destruction_requests force row level security;
alter table kitluy_devices.device_key_destruction_attempts enable row level security;
alter table kitluy_devices.device_key_destruction_attempts force row level security;

grant select, insert, update on kitluy_devices.device_key_holds to kitluy_credential_issuer;
grant select, insert, update on kitluy_devices.device_key_destruction_requests to kitluy_credential_issuer;
grant select, insert on kitluy_devices.device_key_destruction_attempts to kitluy_credential_issuer;
grant select on kitluy_devices.device_key_holds to service_role;
grant select on kitluy_devices.device_key_destruction_requests to service_role;
grant select on kitluy_devices.device_key_destruction_attempts to service_role;

create policy device_key_holds_issuer_write on kitluy_devices.device_key_holds
  for all to kitluy_credential_issuer using (true) with check (true);
create policy device_key_holds_service_read on kitluy_devices.device_key_holds
  for select to service_role using (true);
create policy device_key_destruction_requests_issuer_write on kitluy_devices.device_key_destruction_requests
  for all to kitluy_credential_issuer using (true) with check (true);
create policy device_key_destruction_requests_service_read on kitluy_devices.device_key_destruction_requests
  for select to service_role using (true);
create policy device_key_destruction_attempts_issuer_write on kitluy_devices.device_key_destruction_attempts
  for all to kitluy_credential_issuer using (true) with check (true);
create policy device_key_destruction_attempts_service_read on kitluy_devices.device_key_destruction_attempts
  for select to service_role using (true);

do $own_and_grant$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname in ('evaluate_key_destruction_eligibility_v1', 'request_key_destruction_v1',
                         'approve_key_destruction_v1', 'begin_key_destruction_execution_v1',
                         'confirm_key_destruction_v1', 'place_key_hold_v1', 'release_key_hold_v1')
  loop
    execute format('alter function %s owner to kitluy_credential_issuer', r.signature);
    execute format('revoke all on function %s from public', r.signature);
    execute format('revoke all on function %s from service_role', r.signature);
    execute format('grant execute on function %s to kitluy_issuance_service', r.signature);
  end loop;
end
$own_and_grant$;

-- ===========================================================================
-- HOSTILE ASSERTIONS
-- ===========================================================================
do $assert_0137$
declare
  v_findings text[] := array[]::text[];
  v_p kitluy_devices.key_destruction_policy;
begin
  select * into v_p from kitluy_devices.key_destruction_policy where environment = 'development';

  -- The approved values, exactly (§15).
  if v_p.superseded_minimum_retention_days <> 30 or v_p.abandoned_minimum_retention_days <> 7
     or v_p.recovery_retention_days <> 14 or v_p.approval_validity_hours <> 24
     or v_p.maximum_execution_attempts <> 5 then
    v_findings := v_findings || 'the configured values do not match owner decision §15';
  end if;
  if v_p.approved_by_decision_ref is distinct from 'KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001' then
    v_findings := v_findings || 'the policy does not name the approving decision';
  end if;
  if v_p.automatic_provider_destruction or not v_p.four_eyes_required then
    v_findings := v_findings || 'the policy permits automatic or single-person destruction';
  end if;

  -- §7: automatic destruction cannot be switched on while four-eyes stands.
  begin
    update kitluy_devices.key_destruction_policy set automatic_provider_destruction = true
     where environment = 'development';
    v_findings := v_findings || 'the irreversible provider call was made automatic';
  exception when others then
    if sqlerrm not like '%key_destruction_policy_not_automatic_chk%' then
      v_findings := v_findings || format('wrong refusal automating destruction: %s', sqlerrm);
    end if;
  end;
  -- Nor can four-eyes be dropped while destruction is enabled.
  begin
    update kitluy_devices.key_destruction_policy set four_eyes_required = false
     where environment = 'development';
    v_findings := v_findings || 'four-eyes was disabled while destruction is enabled';
  exception when others then
    if sqlerrm not like '%four_eyes_when_enabled_chk%' then
      v_findings := v_findings || format('wrong refusal disabling four-eyes: %s', sqlerrm);
    end if;
  end;

  -- §12: no database confirmation without provider evidence.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'kitluy_devices.device_key_destruction_requests'::regclass
       and conname = 'device_key_destruction_no_confirm_without_evidence') then
    v_findings := v_findings || 'the database may confirm destruction without provider evidence';
  end if;
  -- §6: four-eyes and re-authentication are constraints, not conventions.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'kitluy_devices.device_key_destruction_requests'::regclass
       and conname = 'device_key_destruction_requests_four_eyes') then
    v_findings := v_findings || 'a requester may approve their own destruction';
  end if;
  -- §8: a hold cannot be released by the person who declared it.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'kitluy_devices.device_key_holds'::regclass
       and conname = 'device_key_holds_release_is_four_eyes') then
    v_findings := v_findings || 'a hold may be released by its own declarer';
  end if;

  -- Nothing PUBLIC, and the executor cannot write these tables directly.
  if has_function_privilege('public',
       'kitluy_devices.confirm_key_destruction_v1(uuid, text, text, text, text, text, text, timestamptz, timestamptz)',
       'execute') then
    v_findings := v_findings || 'PUBLIC can confirm a destruction';
  end if;
  if has_table_privilege('kitluy_issuance_service',
                         'kitluy_devices.device_key_destruction_requests', 'update')
     or has_table_privilege('kitluy_issuance_service', 'kitluy_devices.device_key_holds', 'insert') then
    v_findings := v_findings || 'the executor holds direct authority over destruction state';
  end if;

  -- And nothing has actually been destroyed by shipping this.
  if exists (select 1 from kitluy_devices.device_generation_keys
              where state = 'destroyed' or destroyed_at is not null) then
    v_findings := v_findings || 'a provider key was destroyed by the migration';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL 0137: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;
end
$assert_0137$;

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

commit;
