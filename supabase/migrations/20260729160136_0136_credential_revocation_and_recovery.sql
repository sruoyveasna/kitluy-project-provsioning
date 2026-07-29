-- kitluy:group:0136
-- Migration group 0136: credential_revocation_and_recovery (WS-11-T003 Step 4).
--
-- Additive. Groups 0120-0135 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- THE GAP — KLRISK-DEVICE-007, OPEN SINCE PROMPT 2B-2
-- ===========================================================================
-- `credential_state` has carried the value `revoked` since group 0125, and
-- `evaluateCertificateValidity` has refused a revoked credential since Step 2.
-- NOTHING could put a credential into that state. There is no governed
-- revocation operation anywhere in this schema, and neither `postgres` nor
-- `kitluy_issuance_service` can write `device_credentials` directly.
--
-- So the strongest statement the system can make about a credential —
-- "this must never be accepted again" — could not be made at all.
--
-- ===========================================================================
-- REVOCATION IS NOT FOUR OTHER THINGS
-- ===========================================================================
-- This group exists because these are distinct controls and the system has
-- repeatedly had to resist collapsing them:
--
--   credential EXPIRY          time ran out; nothing went wrong
--   overlap RETIREMENT (0134)  a newer generation superseded it
--   device CONTAINMENT         the DEVICE is restricted; its credential may
--                              still be cryptographically valid
--   key SUPERSESSION           a newer key exists
--   key DESTRUCTION (0137)     the private half is gone
--
-- and none of them means REVOCATION: a standing declaration that this
-- credential is repudiated and must fail verification immediately, before its
-- expiry, and THROUGH any granted overlap.
--
-- Retiring a credential does not revoke it. Destroying a key does not revoke
-- the credential it backed. Containing a device does not revoke anything. Each
-- of those is asserted below and in SQL section 41.
--
-- ===========================================================================
-- APPEND-ONLY EVIDENCE, DERIVED CURRENT STATE
-- ===========================================================================
-- `device_credentials.state` may become `revoked` — that is the DERIVED
-- current fact the verifier reads on the hot path. The AUTHORITATIVE record is
-- an append-only row here: who asked, who approved, why, under what incident,
-- what recovery is owed. A status column cannot answer "why was this device
-- revoked in July" six months later, and a status column is what someone
-- edits.
--
-- Revocation ERASES NOTHING. Issuance, renewal, overlap, reconciliation and
-- lifecycle history all survive it untouched.

begin;

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- Reasons and recovery dispositions.
-- ---------------------------------------------------------------------------
do $revocation_enums$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'kitluy_devices' and t.typname = 'credential_revocation_reason') then
    create type kitluy_devices.credential_revocation_reason as enum (
      'KEY_COMPROMISE',
      'DEVICE_LOST',
      'DEVICE_STOLEN',
      'PROVIDER_COMPROMISE',
      'ASSIGNMENT_INVALIDATED',
      'CERTIFICATE_MISISSUANCE',
      'SECURITY_INCIDENT',
      'ADMINISTRATIVE_REPLACEMENT',
      'OTHER_APPROVED_REASON');
  end if;

  -- Explicit, and deliberately NOT nullable on the evidence row. "We revoked
  -- it and nobody said what happens to the device" is how a fleet acquires
  -- bricked terminals nobody is responsible for.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'kitluy_devices' and t.typname = 'credential_recovery_disposition') then
    create type kitluy_devices.credential_recovery_disposition as enum (
      'NO_RECOVERY',
      'RECOVERY_REQUIRED',
      'REPROVISION_REQUIRED',
      'REASSIGNMENT_REQUIRED',
      'MANUAL_SECURITY_REVIEW');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'kitluy_devices' and t.typname = 'recovery_case_state') then
    create type kitluy_devices.recovery_case_state as enum (
      'open', 'in_progress', 'resolved', 'abandoned');
  end if;
end
$revocation_enums$;

-- ---------------------------------------------------------------------------
-- Which revocations need two people.
--
-- No owner decision names the list, so this ships FAIL-CLOSED: every reason
-- requires four-eyes approval. That is the safe default to be RELAXED by an
-- owner, never the permissive default to be tightened after an incident.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.credential_revocation_policy (
  environment text primary key,
  four_eyes_required boolean not null default true,
  reauthentication_required boolean not null default true,
  reason_required boolean not null default true,
  -- The reasons an owner has explicitly exempted from four-eyes. Empty until
  -- someone rules; an empty list means "all reasons need two people".
  four_eyes_exempt_reasons kitluy_devices.credential_revocation_reason[] not null default '{}',
  approved_by_decision_ref text,
  required_owner_decision text,
  updated_at timestamptz not null default now(),

  -- Exempting anything requires naming the decision that exempted it.
  constraint credential_revocation_policy_exempt_needs_decision_chk
    check (cardinality(four_eyes_exempt_reasons) = 0 or approved_by_decision_ref is not null),
  constraint credential_revocation_policy_env_chk check (environment = 'development')
);

comment on table kitluy_devices.credential_revocation_policy is
  'Owner: Fleet. Which credential revocations require four-eyes approval. Ships requiring it for EVERY reason, because no owner decision narrows the list and a permissive default is the one nobody notices until an incident. Exempting a reason requires naming the approving decision (CHECK, not convention).';

insert into kitluy_devices.credential_revocation_policy (
  environment, four_eyes_required, reauthentication_required, reason_required,
  four_eyes_exempt_reasons, approved_by_decision_ref, required_owner_decision)
values (
  'development', true, true, true, '{}', null,
  '[REQUIRED: device_credential_revocation_approval_policy — which revocation reasons, if any, may proceed on a single authorized actor, and the re-authentication and audit requirements for each]')
on conflict (environment) do nothing;

-- ---------------------------------------------------------------------------
-- The authoritative record.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_credential_revocations (
  revocation_id uuid primary key default gen_random_uuid(),
  -- Stable per revocation INTENT. Retrying the same intent is idempotent;
  -- a different intent against an already-revoked credential is a conflict,
  -- not an overwrite.
  revocation_request_id text not null,

  credential_id uuid not null references kitluy_devices.device_credentials (credential_id),
  device_record_id uuid not null references kitluy_devices.devices (id),
  environment text not null,
  purpose text not null,
  credential_generation integer not null,
  public_key_fingerprint text not null,

  reason_code kitluy_devices.credential_revocation_reason not null,
  reason text not null,

  requested_by text not null,
  approved_by text,
  approval_request_id uuid,
  requested_at timestamptz not null default clock_timestamp(),
  approved_at timestamptz,
  -- When the repudiation takes effect. Server time: this is an operator
  -- decision deadline, not a device trust decision, and routing it through a
  -- device's trusted clock would let a device with a manipulated clock
  -- postpone its own revocation.
  effective_at timestamptz not null default clock_timestamp(),

  source text not null,
  incident_reference text,
  recovery_disposition kitluy_devices.credential_recovery_disposition not null,
  audit_event_id uuid,

  occurred_at timestamptz not null default clock_timestamp(),
  sequence_no bigint generated always as identity,

  constraint device_credential_revocations_request_unique unique (revocation_request_id),
  constraint device_credential_revocations_reason_not_empty check (btrim(reason) <> ''),
  constraint device_credential_revocations_source_not_empty check (btrim(source) <> ''),
  constraint device_credential_revocations_approval_pairing
    check ((approved_by is null) = (approved_at is null)),
  -- The same CHECK discipline as groups 0133 and 0135: the cheapest way to
  -- leak a key is to write it into the record explaining why you distrusted it.
  constraint device_credential_revocations_no_key_material
    check (reason !~* 'BEGIN [A-Z ]*PRIVATE KEY'
           and coalesce(incident_reference, '') !~* 'BEGIN [A-Z ]*PRIVATE KEY'
           and reason !~* '(postgres|postgresql)://')
);

comment on table kitluy_devices.device_credential_revocations is
  'Owner: Fleet. APPEND-ONLY authoritative revocation evidence: which credential, which generation and fingerprint, why, who asked, who approved, under what incident, from when, and what recovery is owed. `device_credentials.state` carries the DERIVED current fact the verifier reads; this table carries the account of it, because a status column cannot answer "why was this revoked" months later and a status column is what someone edits. Revocation erases no issuance, renewal, overlap or reconciliation history. MC: A/O.';

comment on column kitluy_devices.device_credential_revocations.revocation_request_id is
  'Stable per revocation INTENT. A repeat of the same intent is idempotent; a DIFFERENT reason or actor against an already-revoked credential is a conflict requiring review, never a silent overwrite of the first account.';

comment on column kitluy_devices.device_credential_revocations.recovery_disposition is
  'NOT NULL by design. Revoking a device credential without stating what happens to the device is how a fleet acquires terminals nobody owns.';

create index device_credential_revocations_credential_idx
  on kitluy_devices.device_credential_revocations (credential_id, sequence_no desc);
create index device_credential_revocations_device_idx
  on kitluy_devices.device_credential_revocations (device_record_id, occurred_at desc);

create trigger trg_device_credential_revocations_append_only
  before update or delete on kitluy_devices.device_credential_revocations
  for each row execute function kitluy_auth.enforce_append_only();

-- ---------------------------------------------------------------------------
-- The recovery case. Durable, and deliberately NOT executed here.
--
-- Step 4 owes the DISPOSITION; reprovisioning and reassignment are WS-11 tasks
-- outside T003. A case is opened so the obligation is durable and countable
-- rather than living in the revocation reason as prose.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_recovery_cases (
  recovery_case_id uuid primary key default gen_random_uuid(),
  revocation_id uuid not null
    references kitluy_devices.device_credential_revocations (revocation_id),
  device_record_id uuid not null references kitluy_devices.devices (id),
  environment text not null,
  purpose text not null,
  disposition kitluy_devices.credential_recovery_disposition not null,
  state kitluy_devices.recovery_case_state not null default 'open',
  opened_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text,
  -- The replacement credential, once a LATER task issues one. Never written by
  -- this group: recording a replacement that does not exist would make the
  -- case look closed.
  replacement_credential_id uuid references kitluy_devices.device_credentials (credential_id),

  constraint device_recovery_cases_one_per_revocation unique (revocation_id),
  constraint device_recovery_cases_resolution_pairing
    check ((state in ('resolved', 'abandoned')) = (resolved_at is not null)),
  constraint device_recovery_cases_resolver
    check (resolved_at is null or coalesce(btrim(resolved_by), '') <> '')
);

comment on table kitluy_devices.device_recovery_cases is
  'Owner: Fleet. The durable obligation created by a revocation: this device needs recovery, reprovisioning, reassignment or security review. Step 4 opens and records the case; EXECUTING it belongs to later WS-11 tasks, so `replacement_credential_id` is never written here — a replacement recorded before it exists would make the case read as closed. MC: A/O.';

create index device_recovery_cases_open_idx
  on kitluy_devices.device_recovery_cases (environment, state, opened_at)
  where state in ('open', 'in_progress');

-- ---------------------------------------------------------------------------
-- The approval gate. Mirrors group 0124's, against the SAME kitluy_auth
-- aggregate rather than a second approvals mechanism.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.evaluate_credential_revocation_approval_v1(
  p_approval_request_id uuid,
  p_device_id uuid,
  p_environment text,
  p_requester_ref text
) returns kitluy_devices.approval_verdict
language plpgsql
stable
as $$
declare
  v_request kitluy_auth.approval_requests;
  v_policy kitluy_auth.approval_policies;
  v_approvers integer;
  v_self integer;
  v_deny constant text := 'KLUY-CRED-REVOCATION-';
begin
  if p_approval_request_id is null then
    return row(false, v_deny || 'UNAPPROVED',
      'this revocation requires an approval and none was presented')::kitluy_devices.approval_verdict;
  end if;

  select * into v_request from kitluy_auth.approval_requests where id = p_approval_request_id;
  if not found then
    return row(false, v_deny || 'UNAPPROVED',
      format('approval request %s does not exist', p_approval_request_id))::kitluy_devices.approval_verdict;
  end if;

  select * into v_policy from kitluy_auth.approval_policies where id = v_request.policy_id;

  -- An UNDECLARED risk class is insufficient, not permissive. Group 0124's
  -- ruling, applied to the same aggregate.
  if coalesce(v_policy.risk_class, 'A0') not in ('A3', 'A4') then
    return row(false, v_deny || 'RISK-CLASS',
      format('approval policy risk class %s is below the A3/A4 a credential revocation requires',
             coalesce(v_policy.risk_class, 'undeclared')))::kitluy_devices.approval_verdict;
  end if;

  if v_request.action <> 'device_credential_revocation' then
    return row(false, v_deny || 'WRONG-ACTION',
      format('approval authorizes %s, not device_credential_revocation', v_request.action))::kitluy_devices.approval_verdict;
  end if;
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
  if v_request.expires_at is not null and v_request.expires_at <= now() then
    return row(false, v_deny || 'UNAPPROVED',
      format('approval expired at %s', v_request.expires_at))::kitluy_devices.approval_verdict;
  end if;

  -- Four eyes derived from the immutable decision rows, never a mutable flag.
  select count(*) filter (where d.decision = 'APPROVE'),
         count(*) filter (where d.decision = 'APPROVE' and d.approver_id = v_request.requester_id)
  into v_approvers, v_self
  from kitluy_auth.approval_decisions d
  where d.approval_request_id = p_approval_request_id;

  if v_self > 0 then
    return row(false, v_deny || 'SELF-APPROVED',
      'the requester approved their own credential revocation')::kitluy_devices.approval_verdict;
  end if;
  if v_approvers < coalesce(v_policy.quorum, 1) then
    return row(false, v_deny || 'UNAPPROVED',
      format('%s approver(s) recorded, policy requires %s',
             v_approvers, coalesce(v_policy.quorum, 1)))::kitluy_devices.approval_verdict;
  end if;

  -- Single use. An approval is authority for ONE revocation.
  if exists (select 1 from kitluy_devices.device_credential_revocations
              where approval_request_id = p_approval_request_id) then
    return row(false, v_deny || 'APPROVAL-CONSUMED',
      'this approval has already authorized a revocation')::kitluy_devices.approval_verdict;
  end if;

  return row(true, null, null)::kitluy_devices.approval_verdict;
end;
$$;

comment on function kitluy_devices.evaluate_credential_revocation_approval_v1 is
  'Database-side four-eyes gate for credential revocation, against the SAME kitluy_auth approval aggregate group 0124 uses rather than a second mechanism. Validates A3/A4 risk class (undeclared is insufficient), action, device and environment scope, APPROVED status, unexpired window, non-self-approval, quorum from immutable decision rows, and single-use consumption.';

-- ---------------------------------------------------------------------------
-- revoke_device_credential_v1
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.revoke_device_credential_v1(
  p_revocation_request_id text,
  p_device_record_id uuid,
  p_environment text,
  p_purpose text,
  p_credential_generation integer,
  p_reason_code kitluy_devices.credential_revocation_reason,
  p_reason text,
  p_recovery_disposition kitluy_devices.credential_recovery_disposition,
  p_requested_by text,
  p_source text,
  p_approval_request_id uuid default null,
  p_approved_by text default null,
  p_incident_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $revoke$
declare
  v_cred kitluy_devices.device_credentials;
  v_policy kitluy_devices.credential_revocation_policy;
  v_existing kitluy_devices.device_credential_revocations;
  v_verdict kitluy_devices.approval_verdict;
  v_row kitluy_devices.device_credential_revocations;
  v_case uuid;
  v_needs_approval boolean;
begin
  if coalesce(btrim(p_revocation_request_id), '') = '' then
    raise exception 'KLUY-REVOKE-NO-REQUEST-ID: a revocation intent is identified so a retry is idempotent'
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_requested_by), '') = '' or coalesce(btrim(p_source), '') = '' then
    raise exception 'KLUY-REVOKE-INCOMPLETE: a revocation names its requester and its source'
      using errcode = 'P0001';
  end if;

  select * into v_policy from kitluy_devices.credential_revocation_policy
   where environment = p_environment;
  if not found then
    raise exception 'KLUY-REVOKE-NO-POLICY: no revocation policy for environment %', p_environment
      using errcode = 'P0001';
  end if;
  if v_policy.reason_required and coalesce(btrim(p_reason), '') = '' then
    raise exception 'KLUY-REVOKE-NO-REASON: this environment requires a reason for revocation'
      using errcode = 'P0001';
  end if;

  -- IDEMPOTENCE FIRST, before any authorization work: replaying the same
  -- intent must be cheap and must not consume a second approval.
  select * into v_existing from kitluy_devices.device_credential_revocations
   where revocation_request_id = p_revocation_request_id;
  if found then
    return jsonb_build_object(
      'outcome', 'ALREADY_REVOKED',
      'revocation_id', v_existing.revocation_id,
      'credential_id', v_existing.credential_id,
      'reason_code', v_existing.reason_code,
      'recovery_disposition', v_existing.recovery_disposition);
  end if;

  -- The credential is resolved from the DEVICE and GENERATION, never accepted
  -- from the caller. A revocation that could name its own credential id could
  -- repudiate another device's credential.
  select * into v_cred from kitluy_devices.device_credentials
   where device_record_id = p_device_record_id
     and environment = p_environment
     and purpose = p_purpose
     and certificate_generation = p_credential_generation;
  if not found then
    raise exception
      'KLUY-REVOKE-NO-CREDENTIAL: device % has no generation % credential for %/%',
      p_device_record_id, p_credential_generation, p_environment, p_purpose
      using errcode = 'P0001';
  end if;

  -- A DIFFERENT intent against an already-revoked credential is a conflict.
  -- The first account of why a credential was repudiated is not overwritten by
  -- the second person to notice.
  if v_cred.state = 'revoked' then
    select * into v_existing from kitluy_devices.device_credential_revocations
     where credential_id = v_cred.credential_id order by sequence_no limit 1;
    return jsonb_build_object(
      'outcome', 'MANUAL_REVIEW_REQUIRED',
      'refusal_code', 'KLUY-REVOKE-CONFLICTING-REASON',
      'detail', format('credential %s is already revoked as %s; a second revocation with a different intent needs review',
                       v_cred.credential_id, v_existing.reason_code),
      'revocation_id', v_existing.revocation_id,
      'credential_id', v_cred.credential_id);
  end if;

  v_needs_approval := v_policy.four_eyes_required
    and not (p_reason_code = any (v_policy.four_eyes_exempt_reasons));

  if v_needs_approval then
    v_verdict := kitluy_devices.evaluate_credential_revocation_approval_v1(
      p_approval_request_id, p_device_record_id, p_environment, p_requested_by);
    if not v_verdict.authorized then
      return jsonb_build_object(
        'outcome', 'REVOCATION_REFUSED',
        'refusal_code', v_verdict.refusal_code,
        'detail', v_verdict.refusal_message,
        'credential_id', v_cred.credential_id);
    end if;
    if coalesce(btrim(p_approved_by), '') = '' then
      return jsonb_build_object(
        'outcome', 'REVOCATION_REFUSED',
        'refusal_code', 'KLUY-CRED-REVOCATION-NO-APPROVER',
        'detail', 'the approving identity must be recorded on the evidence',
        'credential_id', v_cred.credential_id);
    end if;
    if btrim(p_approved_by) = btrim(p_requested_by) then
      return jsonb_build_object(
        'outcome', 'REVOCATION_REFUSED',
        'refusal_code', 'KLUY-CRED-REVOCATION-SELF-APPROVED',
        'detail', 'the requester and approver must be different people',
        'credential_id', v_cred.credential_id);
    end if;
  end if;

  insert into kitluy_devices.device_credential_revocations (
    revocation_request_id, credential_id, device_record_id, environment, purpose,
    credential_generation, public_key_fingerprint, reason_code, reason,
    requested_by, approved_by, approval_request_id, approved_at,
    source, incident_reference, recovery_disposition)
  values (
    p_revocation_request_id, v_cred.credential_id, p_device_record_id, p_environment, p_purpose,
    v_cred.certificate_generation, v_cred.public_key_fingerprint, p_reason_code, p_reason,
    p_requested_by, p_approved_by, p_approval_request_id,
    case when p_approved_by is null then null else clock_timestamp() end,
    p_source, p_incident_reference, p_recovery_disposition)
  returning * into v_row;

  -- The DERIVED current fact the verifier reads on the hot path. The evidence
  -- above is what explains it.
  update kitluy_devices.device_credentials
     set state = 'revoked'
   where credential_id = v_cred.credential_id;

  -- The durable obligation. NO_RECOVERY still opens no case: nothing is owed.
  if p_recovery_disposition <> 'NO_RECOVERY' then
    insert into kitluy_devices.device_recovery_cases (
      revocation_id, device_record_id, environment, purpose, disposition)
    values (v_row.revocation_id, p_device_record_id, p_environment, p_purpose,
            p_recovery_disposition)
    returning recovery_case_id into v_case;
  end if;

  return jsonb_build_object(
    'outcome', 'REVOKED',
    'revocation_id', v_row.revocation_id,
    'credential_id', v_cred.credential_id,
    'credential_generation', v_cred.certificate_generation,
    'public_key_fingerprint', v_cred.public_key_fingerprint,
    'reason_code', p_reason_code,
    'recovery_disposition', p_recovery_disposition,
    'recovery_case_id', v_case,
    'effective_at', to_char(v_row.effective_at at time zone 'UTC',
                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end
$revoke$;

comment on function kitluy_devices.revoke_device_credential_v1 is
  'The governed credential revocation KLRISK-DEVICE-007 named as absent. Resolves the credential from the DEVICE and GENERATION rather than from the caller, enforces the environment four-eyes policy against the kitluy_auth aggregate, writes append-only evidence, sets the derived `revoked` state the verifier reads, and opens a durable recovery case. Idempotent per revocation intent; a DIFFERENT intent against an already-revoked credential returns MANUAL_REVIEW_REQUIRED rather than overwriting the first account.';

-- ---------------------------------------------------------------------------
-- Grants, ownership, hygiene
-- ---------------------------------------------------------------------------
alter table kitluy_devices.device_credential_revocations enable row level security;
alter table kitluy_devices.device_credential_revocations force row level security;
alter table kitluy_devices.device_recovery_cases enable row level security;
alter table kitluy_devices.device_recovery_cases force row level security;
alter table kitluy_devices.credential_revocation_policy enable row level security;
alter table kitluy_devices.credential_revocation_policy force row level security;

grant select, insert on kitluy_devices.device_credential_revocations to kitluy_credential_issuer;
grant select, insert, update on kitluy_devices.device_recovery_cases to kitluy_credential_issuer;
grant select on kitluy_devices.credential_revocation_policy to kitluy_credential_issuer;
grant select on kitluy_devices.device_credential_revocations to service_role;
grant select on kitluy_devices.device_recovery_cases to service_role;

create policy device_credential_revocations_issuer_write
  on kitluy_devices.device_credential_revocations
  for all to kitluy_credential_issuer using (true) with check (true);
create policy device_credential_revocations_service_read
  on kitluy_devices.device_credential_revocations
  for select to service_role using (true);
create policy device_recovery_cases_issuer_write
  on kitluy_devices.device_recovery_cases
  for all to kitluy_credential_issuer using (true) with check (true);
create policy device_recovery_cases_service_read
  on kitluy_devices.device_recovery_cases
  for select to service_role using (true);
create policy credential_revocation_policy_issuer_read
  on kitluy_devices.credential_revocation_policy
  for select to kitluy_credential_issuer using (true);

alter function kitluy_devices.revoke_device_credential_v1(
  text, uuid, text, text, integer,
  kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text)
  owner to kitluy_credential_issuer;
alter function kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text)
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

do $revocation_grants$
begin
  execute 'revoke all on function kitluy_devices.revoke_device_credential_v1('
       || 'text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text, '
       || 'kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text) from service_role';
  execute 'grant execute on function kitluy_devices.revoke_device_credential_v1('
       || 'text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text, '
       || 'kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text) '
       || 'to kitluy_issuance_service';
end
$revocation_grants$;

-- ===========================================================================
-- HOSTILE ASSERTIONS — the migration fails rather than shipping a weakening
-- ===========================================================================
do $assert_0136$
declare
  v_findings text[] := array[]::text[];
begin
  -- Four-eyes is ON, and nothing is exempt without a named decision.
  if not (select four_eyes_required from kitluy_devices.credential_revocation_policy
           where environment = 'development') then
    v_findings := v_findings || 'revocation four-eyes shipped DISABLED';
  end if;
  if (select cardinality(four_eyes_exempt_reasons) from kitluy_devices.credential_revocation_policy
       where environment = 'development') <> 0 then
    v_findings := v_findings || 'a revocation reason ships exempt from four-eyes';
  end if;
  begin
    update kitluy_devices.credential_revocation_policy
       set four_eyes_exempt_reasons = array['ADMINISTRATIVE_REPLACEMENT']::kitluy_devices.credential_revocation_reason[]
     where environment = 'development';
    v_findings := v_findings || 'a reason was exempted without naming a decision';
  exception when others then
    if sqlerrm not like '%credential_revocation_policy_exempt_needs_decision_chk%' then
      v_findings := v_findings || format('wrong refusal exempting a reason: %s', sqlerrm);
    end if;
  end;

  -- The executor records only THROUGH the function.
  if has_table_privilege('kitluy_issuance_service',
                         'kitluy_devices.device_credential_revocations', 'insert')
     or has_table_privilege('kitluy_issuance_service',
                            'kitluy_devices.device_credentials', 'update') then
    v_findings := v_findings || 'the issuance executor can write revocation state directly';
  end if;
  if has_function_privilege('public',
       'kitluy_devices.revoke_device_credential_v1(text, uuid, text, text, integer, '
       || 'kitluy_devices.credential_revocation_reason, text, '
       || 'kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text)',
       'execute') then
    v_findings := v_findings || 'PUBLIC can revoke a credential';
  end if;
  if not has_function_privilege('kitluy_issuance_service',
       'kitluy_devices.revoke_device_credential_v1(text, uuid, text, text, integer, '
       || 'kitluy_devices.credential_revocation_reason, text, '
       || 'kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text)',
       'execute') then
    v_findings := v_findings || 'the named executor cannot revoke';
  end if;

  -- Evidence is append-only, and recovery disposition cannot be omitted.
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'device_credential_revocations'
                    and t.tgname = 'trg_device_credential_revocations_append_only'
                    and not t.tgisinternal) then
    v_findings := v_findings || 'revocation evidence is not append-only';
  end if;
  if (select is_nullable from information_schema.columns
       where table_schema = 'kitluy_devices'
         and table_name = 'device_credential_revocations'
         and column_name = 'recovery_disposition') <> 'NO' then
    v_findings := v_findings || 'a revocation may omit its recovery disposition';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL 0136: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;
end
$assert_0136$;

-- The membership borrowed at the top is HANDED BACK. A migration that kept it
-- would leave the login-capable migration role able to SET ROLE to the
-- credential governor for ever, which is exactly what the permanent assertion
-- in section 32 refuses — and which this group tripped before this block
-- existed.
do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

commit;
