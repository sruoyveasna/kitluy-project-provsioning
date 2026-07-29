-- kitluy:group:0138
-- Migration group 0138: emergency_revocation_and_scope (WS-11-T003 Step 4).
--
-- Additive. Groups 0120-0137 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- AUTHORITY
-- ===========================================================================
-- Owner decision KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001, OWNER-APPROVED
-- 2026-07-29, closing `[REQUIRED: device_credential_revocation_approval_policy]`
-- and `[REQUIRED: device_revocation_scope_policy]`. Every reason list and every
-- scope rule below is taken VERBATIM from §2 and §3 of that decision. Nothing
-- here is widened, narrowed or paraphrased; where this file names a reason set,
-- the decision names the same reason set, and the section is cited beside it.
--
-- Group 0136 shipped the governed revocation path requiring a completed prior
-- approval for EVERY reason, with the missing decision named in
-- `credential_revocation_policy.required_owner_decision`. That was the
-- fail-closed default this decision now refines. This group supplies exactly
-- the refinement: which reasons may execute first and answer second, what an
-- emergency must carry, and what the post-approval can and cannot do.
--
-- Per decision §5, approval closed the missing-policy requirements only. It
-- promoted no implementation. This migration is the implementation; tests and
-- independent review decide whether it may be called implemented.
--
-- ===========================================================================
-- THE SENTENCE THIS GROUP EXISTS TO ENFORCE (decision §2.4)
-- ===========================================================================
-- "A late, missing or refused post-approval does NOT restore the credential."
--
-- An auto-reversing revocation would mean an attacker who merely delays the
-- second approver gets the credential back — the emergency path would become a
-- way to SCHEDULE un-revocation. So the post-approval here records a verdict
-- and escalates; it has no branch, anywhere, that writes a credential state.
-- The database refuses the reversal independently of the functions, through
-- `enforce_revocation_is_one_way` below, because a rule that lives only inside
-- the function that is supposed to obey it is not a rule.
--
-- ===========================================================================
-- WHY THE EMERGENCY PATH IS A SEPARATE FUNCTION
-- ===========================================================================
-- `credential_revocation_policy.four_eyes_exempt_reasons` (group 0136) was the
-- obvious place to put the five emergency reasons, and it is the WRONG place.
-- That column exempts a reason from four-eyes inside
-- `revoke_device_credential_v1`, which would let a KEY_COMPROMISE revocation
-- execute on one signature with no incident reference, no re-authentication,
-- no declaring authority and no post-approval deadline. Decision §2.3 requires
-- all five of those. So the exempt list stays EMPTY, group 0136's function keeps
-- requiring a completed prior approval for every reason it serves, and the
-- emergency path is a distinct function that carries the §2.3 obligations in
-- its signature and in its table.
--
-- Emergency revocation is not four-eyes-exempt. It is four-eyes DEFERRED, and
-- the deferral is itself recorded, deadlined and escalated.
--
-- ===========================================================================
-- RECORDED FINDING — OUT OF SCOPE, NOT FIXED HERE
-- ===========================================================================
-- `kitluy_devices.revoke_device_credential_v1` (group 0136, COMMITTED) ends with
--
--     update kitluy_devices.device_credentials set state = 'revoked' ...
--
-- and does not set `revoked_at`. Group 0125 constrains that table with
--
--     device_credentials_revoked_chk
--       CHECK ((state = 'revoked') = (revoked_at IS NOT NULL))
--
-- so the approve-before-execute path cannot complete a revocation: the UPDATE
-- raises a check-constraint violation (verified against the migrated local
-- database). Group 0136's hostile assertions never call the function, which is
-- why it shipped. This group does NOT rewrite 0136 — that is outside the scope
-- this session was given, and CLAUDE.md rule 1 says record such findings rather
-- than fix them silently. The emergency path added below sets BOTH columns, so
-- it is unaffected. The finding is reported to the owner for a scoped fix.

begin;

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- Who may declare an emergency, and what a post-approval can say.
--
-- Decision §2.3 names "an authorized CISO or incident commander" and nothing
-- else, so the authority is an ENUM rather than free text: a role nobody
-- approved cannot be typed into it.
--
-- LAPSED is a distinct verdict from REFUSED on purpose. "The approver said no"
-- and "the approver never came" are different incidents with the same effect on
-- the credential, and collapsing them would erase which one happened.
-- ---------------------------------------------------------------------------
do $emergency_enums$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'kitluy_devices'
                    and t.typname = 'emergency_declaring_authority') then
    create type kitluy_devices.emergency_declaring_authority as enum (
      'CISO', 'INCIDENT_COMMANDER');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'kitluy_devices'
                    and t.typname = 'emergency_post_approval_decision') then
    create type kitluy_devices.emergency_post_approval_decision as enum (
      'PENDING', 'APPROVED', 'REFUSED', 'LAPSED');
  end if;
end
$emergency_enums$;

-- ---------------------------------------------------------------------------
-- A. THE POLICY — decision §2.1, §2.2, §2.3, verbatim.
-- ---------------------------------------------------------------------------
alter table kitluy_devices.credential_revocation_policy
  add column if not exists emergency_eligible_reasons
    kitluy_devices.credential_revocation_reason[],
  add column if not exists approve_before_execute_reasons
    kitluy_devices.credential_revocation_reason[],
  add column if not exists post_approval_window_hours integer,
  add column if not exists emergency_requires_incident_reference boolean not null default true,
  add column if not exists emergency_requires_reauthentication boolean not null default true,
  add column if not exists machine_initiated_revocation_permitted boolean not null default false,
  add column if not exists policy_version integer not null default 1;

comment on column kitluy_devices.credential_revocation_policy.emergency_eligible_reasons is
  'Decision §2.2, verbatim: KEY_COMPROMISE, DEVICE_LOST, DEVICE_STOLEN, PROVIDER_COMPROMISE, SECURITY_INCIDENT. Every one of these means a private key may be in hands the operator does not control. These reasons are not exempt from four-eyes — they DEFER it, under the §2.3 obligations.';

comment on column kitluy_devices.credential_revocation_policy.approve_before_execute_reasons is
  'Decision §2.1, verbatim: ASSIGNMENT_INVALIDATED, CERTIFICATE_MISISSUANCE, ADMINISTRATIVE_REPLACEMENT, OTHER_APPROVED_REASON. None describes an active compromise, so waiting for a second person costs nothing that matters.';

comment on column kitluy_devices.credential_revocation_policy.post_approval_window_hours is
  'Decision §2.3: a distinct second-person post-approval within 4 hours. Server time, deliberately — this is an operator deadline, and routing it through a device trusted clock would let a device with a manipulated clock extend its own emergency window.';

comment on column kitluy_devices.credential_revocation_policy.machine_initiated_revocation_permitted is
  'Decision §2.5: no automatic machine-generated revocation is approved for Phase 1. A worker may detect, record and escalate; it may not decide to revoke. False, and the CHECK below refuses to make it true.';

-- The approved values. The UPDATE precedes the CHECKs so the constraints
-- validate against the ruled row rather than against the fail-closed one.
update kitluy_devices.credential_revocation_policy
   set emergency_eligible_reasons = array[
         'KEY_COMPROMISE',
         'DEVICE_LOST',
         'DEVICE_STOLEN',
         'PROVIDER_COMPROMISE',
         'SECURITY_INCIDENT'
       ]::kitluy_devices.credential_revocation_reason[],
       approve_before_execute_reasons = array[
         'ASSIGNMENT_INVALIDATED',
         'CERTIFICATE_MISISSUANCE',
         'ADMINISTRATIVE_REPLACEMENT',
         'OTHER_APPROVED_REASON'
       ]::kitluy_devices.credential_revocation_reason[],
       -- §2.3: within 4 hours.
       post_approval_window_hours = 4,
       emergency_requires_incident_reference = true,
       emergency_requires_reauthentication = true,
       machine_initiated_revocation_permitted = false,
       -- §2.1 stands unchanged for group 0136's function: nothing it serves is
       -- exempt from a completed PRIOR approval.
       four_eyes_required = true,
       four_eyes_exempt_reasons = '{}'::kitluy_devices.credential_revocation_reason[],
       approved_by_decision_ref = 'KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001',
       required_owner_decision = null,
       policy_version = 2,
       updated_at = now()
 where environment = 'development';

-- DISJOINT and TOTAL. A reason in NEITHER set is a revocation nobody can
-- execute correctly — the emergency path refuses it and the approve-first path
-- was never told about it. A reason in BOTH is worse: the same reason would be
-- simultaneously "may execute immediately" and "may never execute without a
-- completed prior approval", and which one won would depend on which function
-- the caller happened to reach.
--
-- `enum_range` rather than a hand-written list, so ADDING a revocation reason
-- later cannot silently leave it unclassified.
alter table kitluy_devices.credential_revocation_policy
  add constraint credential_revocation_policy_reason_sets_chk
    check (emergency_eligible_reasons is not null
           and approve_before_execute_reasons is not null
           and not (emergency_eligible_reasons && approve_before_execute_reasons)
           and (emergency_eligible_reasons || approve_before_execute_reasons)
               @> enum_range(null::kitluy_devices.credential_revocation_reason)),
  add constraint credential_revocation_policy_window_chk
    check (post_approval_window_hours is not null and post_approval_window_hours > 0),
  -- §2.5, as a constraint rather than a convention.
  add constraint credential_revocation_policy_no_machine_chk
    check (machine_initiated_revocation_permitted = false),
  -- §2.3: the incident reference and the re-authentication are not optional
  -- extras that an operator may switch off during an incident.
  add constraint credential_revocation_policy_emergency_gates_chk
    check (emergency_requires_incident_reference = true
           and emergency_requires_reauthentication = true);

-- ---------------------------------------------------------------------------
-- D (support). THE EXPLICITLY RECORDED AFFECTED SET — decision §3, §3.1.
--
-- Three of the nine §3 rows cannot be derived from the fleet:
--
--   PROVIDER_COMPROMISE     "an explicitly recorded incident-defined
--                            affected-key set"
--   SECURITY_INCIDENT       "an explicitly recorded incident-defined
--                            device/key/credential set"
--   OTHER_APPROVED_REASON   "the credential only, UNLESS the approved request
--                            explicitly names a broader scope"
--
-- §3.1 forbids an unrestricted "all devices" wildcard: a wildcard revocation is
-- indistinguishable from a fleet-wide denial of service issued by whoever can
-- reach the revocation path. The refusal is by CONSTRAINT.
-- `unrestricted_wildcard` exists only so that the refusal has a name in the
-- schema; it can never be true.
--
-- ---------------------------------------------------------------------------
-- WHY THE OTHER_APPROVED_REASON BROADER SCOPE IS RECORDED HERE
-- ---------------------------------------------------------------------------
-- §3 row 7 says the APPROVED REQUEST names the broader scope. A KitLuy approval
-- request cannot: `kitluy_auth.approval_requests` carries
-- (policy_id, requester_id, resource_type, resource_id, environment, action,
-- payload_hash, reason, status) — a payload HASH, not a payload. There is no
-- column in which a request could enumerate credentials, and the credential
-- governor holds no access to that schema (the policy census in assertions
-- section 7 fixes the kitluy_auth RLS surface, and a WS-11 device migration
-- widening it would be a boundary change needing its own decision).
--
-- So the only faithful materialisation of "the approved request explicitly
-- names a broader scope" is: the broader scope is written down here, cites the
-- approving request by id, and is recorded by one person and approved by
-- another. The scope is still explicit, still approved and still auditable
-- before it happens — which is what §3.1 and §3 row 7 are both protecting.
-- Recorded as a conflict; see the decision-and-reconciliation register.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.revocation_recorded_scopes (
  incident_scope_id uuid primary key default gen_random_uuid(),
  incident_reference text not null,
  environment text not null,
  reason_code kitluy_devices.credential_revocation_reason not null,

  -- §3 row 7: the approval that authorized a broader scope, named on the
  -- record. Mandatory for OTHER_APPROVED_REASON (CHECK below).
  approval_request_id uuid,

  affected_device_ids uuid[] not null default '{}',
  affected_key_references text[] not null default '{}',
  affected_fingerprints text[] not null default '{}',
  affected_credential_ids uuid[] not null default '{}',

  -- §3.1. Never true. The column is the name of the refusal.
  unrestricted_wildcard boolean not null default false,

  recorded_by text not null,
  approved_by text not null,
  note text,
  recorded_at timestamptz not null default clock_timestamp(),
  sequence_no bigint generated always as identity,

  constraint revocation_recorded_scopes_unique
    unique (incident_reference, environment, reason_code),
  -- §3: only these three reasons take a recorded set. Every other reason
  -- derives its scope from the fleet, and letting one carry a recorded set
  -- would be a caller choosing scope by the back door.
  constraint revocation_recorded_scopes_reason_chk
    check (reason_code in ('PROVIDER_COMPROMISE', 'SECURITY_INCIDENT', 'OTHER_APPROVED_REASON')),
  -- §3 row 7: a broader scope that cites no approval is not an approved
  -- broader scope.
  constraint revocation_recorded_scopes_approval_chk
    check (reason_code <> 'OTHER_APPROVED_REASON' or approval_request_id is not null),
  constraint revocation_recorded_scopes_no_wildcard_chk
    check (unrestricted_wildcard = false),
  -- An EMPTY recorded set is a wildcard spelled differently: "nothing written
  -- down" is exactly the state §3.1 refuses to let stand in for an affected set.
  constraint revocation_recorded_scopes_not_empty_chk
    check (cardinality(affected_device_ids) + cardinality(affected_key_references)
           + cardinality(affected_fingerprints) + cardinality(affected_credential_ids) > 0),
  -- ...and a wildcard smuggled in as a string is still a wildcard.
  constraint revocation_recorded_scopes_no_token_chk
    check (not (affected_key_references && array['*', '%', 'ALL', 'all', 'ANY', 'any']::text[])
           and not (affected_fingerprints && array['*', '%', 'ALL', 'all', 'ANY', 'any']::text[])),
  -- The blast radius is itself a four-eyes decision. The person who writes down
  -- which devices an incident reaches is not the person who approves it.
  constraint revocation_recorded_scopes_four_eyes_chk
    check (btrim(approved_by) <> btrim(recorded_by)
           and btrim(recorded_by) <> '' and btrim(approved_by) <> ''),
  constraint revocation_recorded_scopes_incident_chk
    check (btrim(incident_reference) <> '')
);

comment on table kitluy_devices.revocation_recorded_scopes is
  'Owner: Security. Decision §3/§3.1. The explicitly recorded, explicitly approved affected set for the three reasons whose scope cannot be derived from the fleet: PROVIDER_COMPROMISE (an affected-key set), SECURITY_INCIDENT (a device/key/credential set) and OTHER_APPROVED_REASON (a broader scope citing the approving request, because a KitLuy approval request carries a payload HASH and cannot enumerate credentials itself). An unrestricted wildcard, an empty set and a wildcard token are each refused by CHECK, because the affected set being written down is what makes the blast radius reviewable before it happens and auditable afterwards. MC: A/O.';

create index revocation_recorded_scopes_lookup_idx
  on kitluy_devices.revocation_recorded_scopes (environment, incident_reference, reason_code);

-- One recorded broader scope per approval. An approval is authority for ONE
-- widening, the same single-use discipline group 0136 applies to the approval
-- that authorizes a revocation at all.
create unique index revocation_recorded_scopes_approval_idx
  on kitluy_devices.revocation_recorded_scopes (environment, approval_request_id)
  where approval_request_id is not null;

create trigger trg_revocation_recorded_scopes_append_only
  before update or delete on kitluy_devices.revocation_recorded_scopes
  for each row execute function kitluy_auth.enforce_append_only();

-- ---------------------------------------------------------------------------
-- B. THE EMERGENCY DECLARATION — decision §2.3, §2.4.
--
-- Durable and separate from `device_credential_revocations` because the two
-- answer different questions. The revocation rows say which credentials were
-- repudiated. This row says who declared the emergency, under what authority,
-- on what re-authentication, under which incident, by when a second person owed
-- an answer, and what that answer turned out to be — including "none arrived".
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_credential_emergency_revocations (
  emergency_revocation_id uuid primary key default gen_random_uuid(),
  -- Stable per DECLARATION. Re-running the same declaration is idempotent; it
  -- does not open a second emergency or a second post-approval deadline.
  revocation_request_id text not null,

  environment text not null,
  purpose text not null,
  -- The IDENTIFIED subject. Null only for the two incident-defined reasons,
  -- whose subject is a recorded set rather than one credential (CHECK below).
  device_record_id uuid references kitluy_devices.devices (id),
  credential_id uuid references kitluy_devices.device_credentials (credential_id),

  -- §2.3: an authorized CISO or incident commander.
  declared_by text not null,
  declaring_authority kitluy_devices.emergency_declaring_authority not null,
  -- §2.3: re-authentication.
  declarer_reauthenticated boolean not null,
  reauthentication_method text not null,

  -- §2.3: a mandatory reason and an incident reference.
  reason_code kitluy_devices.credential_revocation_reason not null,
  reason text not null,
  incident_reference text not null,

  scope_rule text not null,
  revoked_credential_count integer not null,

  declared_at timestamptz not null default clock_timestamp(),
  -- §2.3: declared_at + the policy window (4 hours).
  post_approval_due_at timestamptz not null,

  -- §2.4: the post-approval decision OR ITS ABSENCE. PENDING is a real state
  -- with a deadline attached, not a null nobody counts.
  post_approval_decision kitluy_devices.emergency_post_approval_decision
    not null default 'PENDING',
  post_approved_by text,
  post_approval_recorded_at timestamptz,
  post_approver_reauthenticated boolean,
  post_approval_note text,

  escalated_at timestamptz,
  escalation_reason text,

  source text not null,
  sequence_no bigint generated always as identity,

  constraint emergency_revocation_request_unique unique (revocation_request_id),
  -- §2.3: an emergency revocation without an incident reference is not an
  -- emergency revocation. NOT NULL is not enough — an empty string is a missing
  -- incident reference wearing a value.
  constraint emergency_revocation_incident_required
    check (btrim(incident_reference) <> ''),
  constraint emergency_revocation_reason_not_empty
    check (btrim(reason) <> '' and btrim(declared_by) <> '' and btrim(source) <> ''),
  -- §2.3: re-authentication is a fact about the declaration, so a declaration
  -- that did not re-authenticate cannot be stored at all.
  constraint emergency_revocation_reauth_required
    check (declarer_reauthenticated = true and btrim(reauthentication_method) <> ''),
  -- §3 decides what an emergency must NAME, and it differs by reason. A lost or
  -- stolen device revocation is scoped BY DEVICE, so it names one; a key
  -- compromise is scoped by key and a provider compromise or security incident
  -- by a recorded set, and requiring a device or credential from those would
  -- have forced a declarer to invent a subject the incident does not have.
  constraint emergency_revocation_subject_required
    check (reason_code not in ('DEVICE_LOST', 'DEVICE_STOLEN')
           or device_record_id is not null),
  -- §2.4: THE SECOND PERSON IS A DIFFERENT PERSON. A CHECK, not a convention:
  -- a four-eyes rule that depends on the approver choosing to be someone else
  -- is not a four-eyes rule.
  constraint emergency_revocation_approver_distinct
    check (post_approved_by is null or btrim(post_approved_by) <> btrim(declared_by)),
  constraint emergency_revocation_post_approval_pairing
    check ((post_approved_by is null) = (post_approval_recorded_at is null)),
  -- A recorded post-approval is a re-authenticated one, on the same reasoning
  -- as the declaration.
  constraint emergency_revocation_post_reauth
    check (post_approved_by is null or post_approver_reauthenticated = true),
  -- APPROVED is the only verdict that can exist without an approver. LAPSED
  -- means nobody came.
  constraint emergency_revocation_approved_has_approver
    check (post_approval_decision <> 'APPROVED' or post_approved_by is not null),
  constraint emergency_revocation_escalation_pairing
    check ((escalated_at is null) = (escalation_reason is null)),
  -- §2.4: REFUSED and LAPSED escalate. Neither is allowed to be a quiet state.
  constraint emergency_revocation_terminal_escalates
    check (post_approval_decision not in ('REFUSED', 'LAPSED') or escalated_at is not null),
  constraint emergency_revocation_no_key_material
    check (reason !~* 'BEGIN [A-Z ]*PRIVATE KEY'
           and incident_reference !~* 'BEGIN [A-Z ]*PRIVATE KEY'
           and reason !~* '(postgres|postgresql)://'
           and coalesce(post_approval_note, '') !~* 'BEGIN [A-Z ]*PRIVATE KEY')
);

comment on table kitluy_devices.device_credential_emergency_revocations is
  'Owner: Security/Fleet. Decision KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.3/§2.4. One emergency declaration: the declaring CISO or incident commander, their re-authentication, the mandatory reason, the mandatory incident reference, the §3 scope rule that decided the blast radius, the 4-hour post-approval deadline, and the post-approval decision OR ITS ABSENCE. The post-approval never restores a credential — REFUSED and LAPSED escalate and the credential stays revoked (§2.4). MC: A/O.';

comment on column kitluy_devices.device_credential_emergency_revocations.post_approval_decision is
  'Decision §2.4. PENDING is a live obligation with a deadline; LAPSED means the deadline passed with nobody answering; REFUSED means the second person said no. All three of the non-APPROVED outcomes leave the credential REVOKED and move the case to MANUAL_SECURITY_REVIEW. An auto-reversal here would let an attacker who merely delays the approver schedule un-revocation.';

comment on column kitluy_devices.device_credential_emergency_revocations.post_approval_due_at is
  'Frozen at declaration and immutable thereafter (trigger below). A deadline the declarer could move is not a deadline.';

create index device_credential_emergency_revocations_pending_idx
  on kitluy_devices.device_credential_emergency_revocations
     (environment, post_approval_due_at)
  where post_approval_decision = 'PENDING';

create index device_credential_emergency_revocations_incident_idx
  on kitluy_devices.device_credential_emergency_revocations
     (environment, incident_reference, declared_at desc);

-- The revocation evidence gains its link to the declaration and to the §3 rule
-- that reached it. Additive columns on group 0136's append-only table; the
-- append-only trigger is untouched and no existing row is rewritten.
alter table kitluy_devices.device_credential_revocations
  add column if not exists emergency_revocation_id uuid
    references kitluy_devices.device_credential_emergency_revocations (emergency_revocation_id),
  add column if not exists scope_rule text;

comment on column kitluy_devices.device_credential_revocations.scope_rule is
  'Decision §3. WHICH RULE reached this credential, recorded on the evidence so the blast radius can be audited against the reason rather than reconstructed from it.';

-- ---------------------------------------------------------------------------
-- REVOCATION IS ONE-WAY — decision §2.4, enforced below every function.
--
-- The post-approval functions below contain no branch that writes a credential
-- state. This trigger makes that structural rather than merely true today: a
-- future function, a future migration or a direct UPDATE by the governor cannot
-- return a revoked credential to service either.
--
-- Deliberately NOT limited to the emergency path. A revocation is a standing
-- declaration that a credential is repudiated (§1); nothing in this schema has
-- ever had a legitimate reason to undo one, and the recovery answer is a NEW
-- credential, which the recovery case already owes.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.enforce_revocation_is_one_way()
returns trigger
language plpgsql
as $one_way$
begin
  if old.state = 'revoked' and new.state is distinct from 'revoked' then
    raise exception
      'KLUY-REVOCATION-IS-ONE-WAY: credential % is revoked; a revocation is never reversed, and recovery is a NEW credential (decision §2.4)',
      old.credential_id using errcode = 'P0001';
  end if;
  if old.revoked_at is not null and new.revoked_at is null then
    raise exception
      'KLUY-REVOCATION-IS-ONE-WAY: the revocation time on credential % cannot be cleared',
      old.credential_id using errcode = 'P0001';
  end if;
  return new;
end
$one_way$;

comment on function kitluy_devices.enforce_revocation_is_one_way() is
  'Decision §2.4. A revoked credential cannot return to any other state, and its revocation time cannot be cleared — by ANY caller, including the credential governor. The most important behaviour in this group is a negative one, so it is enforced where no function can route around it.';

create trigger trg_device_credentials_revocation_one_way
  before update on kitluy_devices.device_credentials
  for each row execute function kitluy_devices.enforce_revocation_is_one_way();

-- ---------------------------------------------------------------------------
-- The declaration is frozen; only the post-approval fields move, and only once.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.enforce_emergency_revocation_evidence()
returns trigger
language plpgsql
as $emergency_evidence$
begin
  if tg_op = 'DELETE' then
    raise exception
      'KLUY-EMERGENCY-IMMUTABLE: an emergency revocation declaration is answered, never deleted'
      using errcode = 'P0001';
  end if;

  if new.revocation_request_id <> old.revocation_request_id
     or new.declared_by <> old.declared_by
     or new.declaring_authority <> old.declaring_authority
     or new.reason_code <> old.reason_code
     or new.reason <> old.reason
     or new.incident_reference <> old.incident_reference
     or new.declared_at <> old.declared_at
     or new.scope_rule <> old.scope_rule
     or new.credential_id is distinct from old.credential_id
     or new.device_record_id is distinct from old.device_record_id then
    raise exception
      'KLUY-EMERGENCY-IMMUTABLE: the facts of an emergency declaration are fixed when it is declared'
      using errcode = 'P0001';
  end if;

  -- The deadline can NEVER BE EXTENDED. An attacker who can delay the approver
  -- must not also be able to buy the delay back, and a declarer must not be
  -- able to keep an emergency PENDING by pushing its own deadline out.
  --
  -- Bringing it FORWARD is permitted, and deliberately so: an earlier deadline
  -- can only cause an earlier escalation, and escalation never restores a
  -- credential (§2.4). The asymmetry is the whole rule — the direction that can
  -- be abused is the direction that is refused. The 4 hours decision §2.3
  -- grants is what the policy issues; this trigger governs only what may happen
  -- to a deadline once it has been issued.
  if new.post_approval_due_at > old.post_approval_due_at then
    raise exception
      'KLUY-EMERGENCY-DEADLINE-FIXED: an emergency post-approval deadline can be brought forward, never extended'
      using errcode = 'P0001';
  end if;

  -- One verdict, once. Re-deciding a settled case is a new incident, not an
  -- edit of the old one.
  if old.post_approval_decision <> 'PENDING'
     and new.post_approval_decision is distinct from old.post_approval_decision then
    raise exception
      'KLUY-EMERGENCY-VERDICT-FINAL: the post-approval verdict on % is already %',
      old.emergency_revocation_id, old.post_approval_decision using errcode = 'P0001';
  end if;

  return new;
end
$emergency_evidence$;

create trigger trg_device_credential_emergency_revocations_evidence
  before update or delete on kitluy_devices.device_credential_emergency_revocations
  for each row execute function kitluy_devices.enforce_emergency_revocation_evidence();

-- ---------------------------------------------------------------------------
-- D. SCOPE RESOLUTION — decision §3, one branch per row of the table.
--
-- The scope is derived FROM THE REASON. It is never accepted from the caller,
-- for the same reason group 0136 resolves the credential from the device and
-- generation rather than from a credential id: a revocation that can name its
-- own blast radius can name someone else's.
--
-- §3.2: when the scope cannot be determined the answer is a refusal and manual
-- security review. It does not guess narrow — that would leave a compromised
-- credential live — and it does not guess wide — that is the fleet-wide denial
-- of service §3.1 exists to prevent.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.resolve_revocation_scope_v1(
  p_reason_code kitluy_devices.credential_revocation_reason,
  p_environment text,
  p_device_record_id uuid default null,
  p_purpose text default 'device_identity',
  p_credential_generation integer default null,
  p_provider_key_reference text default null,
  p_public_key_fingerprint text default null,
  p_assignment_generation integer default null,
  p_incident_reference text default null,
  p_linked_credential_ids uuid[] default null,
  p_approval_request_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $scope$
declare
  v_ids uuid[] := array[]::uuid[];
  v_rule text;
  v_identified uuid;
  v_links uuid[] := coalesce(p_linked_credential_ids, array[]::uuid[]);
  v_scope kitluy_devices.revocation_recorded_scopes;
  v_foreign integer;
begin
  if p_environment is null then
    return jsonb_build_object('resolved', false,
      'refusal_code', 'KLUY-REVOCATION-SCOPE-NO-ENVIRONMENT',
      'detail', 'a revocation scope is resolved within one environment');
  end if;

  -- The IDENTIFIED credential, where the reason has one. Resolved from the
  -- device and generation, never from a caller-supplied credential id.
  if p_device_record_id is not null and p_credential_generation is not null then
    select c.credential_id into v_identified
      from kitluy_devices.device_credentials c
     where c.device_record_id = p_device_record_id
       and c.environment = p_environment
       and c.purpose = p_purpose
       and c.certificate_generation = p_credential_generation;
  end if;

  case p_reason_code

    -- §3: DEVICE_LOST / DEVICE_STOLEN — "All active and overlapping credentials
    -- for that device in the affected environment". NOT every credential the
    -- device ever held: the decision distinguishes this row from the rows that
    -- say "every credential", so this implementation distinguishes them too.
    -- `issued` covers both the current credential and a previous generation
    -- still inside its granted overlap (which stays `issued` until group 0134
    -- retires it); the head is consulted as well so an overlap that has not yet
    -- been swept is still reached.
    when 'DEVICE_LOST', 'DEVICE_STOLEN' then
      v_rule := 'DEVICE_ACTIVE_AND_OVERLAPPING';
      if p_device_record_id is null then
        return jsonb_build_object('resolved', false,
          'refusal_code', 'KLUY-REVOCATION-SCOPE-NO-DEVICE',
          'scope_rule', v_rule,
          'detail', 'a lost or stolen device revocation names the device it reaches');
      end if;
      select coalesce(array_agg(distinct c.credential_id), array[]::uuid[]) into v_ids
        from kitluy_devices.device_credentials c
        left join kitluy_devices.device_credential_heads h
          on h.device_record_id = c.device_record_id
         and h.environment = c.environment
         and h.purpose = c.purpose
       where c.device_record_id = p_device_record_id
         and c.environment = p_environment
         and c.state <> 'revoked'
         and (c.state = 'issued'
              or (h.previous_generation = c.certificate_generation
                  and h.overlap_ends_at is not null
                  and h.overlap_ends_at > now()));

    -- §3: KEY_COMPROMISE — "Every credential bound to the compromised provider
    -- key reference or public-key fingerprint". EVERY, so no state filter
    -- beyond skipping what is already revoked, and no device filter: the point
    -- of a key compromise is that the key may back more than one credential.
    when 'KEY_COMPROMISE' then
      v_rule := 'KEY_BOUND_CREDENTIALS';
      if coalesce(btrim(p_provider_key_reference), '') = ''
         and coalesce(btrim(p_public_key_fingerprint), '') = '' then
        return jsonb_build_object('resolved', false,
          'refusal_code', 'KLUY-REVOCATION-SCOPE-NO-KEY',
          'scope_rule', v_rule,
          'detail', 'a key compromise names the compromised provider key reference or public-key fingerprint');
      end if;
      select coalesce(array_agg(distinct c.credential_id), array[]::uuid[]) into v_ids
        from kitluy_devices.device_credentials c
       where c.environment = p_environment
         and c.state <> 'revoked'
         and (c.public_key_fingerprint = p_public_key_fingerprint
              or c.public_key_fingerprint in (
                   select k.public_key_fingerprint
                     from kitluy_devices.device_generation_keys k
                    where k.environment = p_environment
                      and k.key_handle = p_provider_key_reference));

    -- §3: ASSIGNMENT_INVALIDATED — "All credentials issued under the
    -- invalidated assignment generation".
    when 'ASSIGNMENT_INVALIDATED' then
      v_rule := 'ASSIGNMENT_GENERATION_CREDENTIALS';
      if p_device_record_id is null or p_assignment_generation is null then
        return jsonb_build_object('resolved', false,
          'refusal_code', 'KLUY-REVOCATION-SCOPE-NO-ASSIGNMENT',
          'scope_rule', v_rule,
          'detail', 'an invalidated assignment names the device and the assignment generation it invalidated');
      end if;
      select coalesce(array_agg(distinct c.credential_id), array[]::uuid[]) into v_ids
        from kitluy_devices.device_credentials c
       where c.device_record_id = p_device_record_id
         and c.environment = p_environment
         and c.assignment_generation = p_assignment_generation
         and c.state <> 'revoked';

    -- §3: CERTIFICATE_MISISSUANCE — "The identified credential only, plus
    -- explicitly linked duplicates". The duplicates come from the caller
    -- because the decision says EXPLICITLY LINKED, but each one must belong to
    -- the same device and environment: "explicitly linked" is not a licence to
    -- reach another device's credential.
    when 'CERTIFICATE_MISISSUANCE' then
      v_rule := 'IDENTIFIED_PLUS_LINKED_DUPLICATES';
      if v_identified is null then
        return jsonb_build_object('resolved', false,
          'refusal_code', 'KLUY-REVOCATION-SCOPE-NO-CREDENTIAL',
          'scope_rule', v_rule,
          'detail', 'a mis-issuance names the identified credential by device and generation');
      end if;
      select count(*) into v_foreign
        from unnest(v_links) l(id)
        left join kitluy_devices.device_credentials c on c.credential_id = l.id
       where c.credential_id is null
          or c.device_record_id <> p_device_record_id
          or c.environment <> p_environment;
      if v_foreign > 0 then
        return jsonb_build_object('resolved', false,
          'refusal_code', 'KLUY-REVOCATION-SCOPE-LINK-FOREIGN',
          'scope_rule', v_rule,
          'detail', format('%s linked duplicate(s) do not belong to this device and environment', v_foreign));
      end if;
      v_ids := array[v_identified] || v_links;

    -- §3: ADMINISTRATIVE_REPLACEMENT — "The identified credential only".
    -- ONLY. A caller offering more is refused rather than quietly trimmed,
    -- because a silently trimmed request leaves the caller believing the
    -- extras were revoked.
    when 'ADMINISTRATIVE_REPLACEMENT' then
      v_rule := 'IDENTIFIED_CREDENTIAL_ONLY';
      if v_identified is null then
        return jsonb_build_object('resolved', false,
          'refusal_code', 'KLUY-REVOCATION-SCOPE-NO-CREDENTIAL',
          'scope_rule', v_rule,
          'detail', 'an administrative replacement names the identified credential by device and generation');
      end if;
      if cardinality(v_links) > 0 then
        return jsonb_build_object('resolved', false,
          'refusal_code', 'KLUY-REVOCATION-SCOPE-WIDENED',
          'scope_rule', v_rule,
          'detail', 'decision §3 gives an administrative replacement the identified credential only');
      end if;
      v_ids := array[v_identified];

    -- §3: OTHER_APPROVED_REASON — "The credential only, unless the approved
    -- request explicitly names a broader scope". A broader scope is legal ONLY
    -- when one has been RECORDED against an approval id; without that record
    -- the answer is a refusal, not a quiet narrowing (§3.2 forbids guessing in
    -- either direction, and narrowing is a guess).
    --
    -- The recorded set is the authority, not the caller's list: a caller who
    -- asks to widen must ask for exactly what was approved.
    when 'OTHER_APPROVED_REASON' then
      v_rule := 'IDENTIFIED_CREDENTIAL_ONLY';
      if v_identified is null then
        return jsonb_build_object('resolved', false,
          'refusal_code', 'KLUY-REVOCATION-SCOPE-NO-CREDENTIAL',
          'scope_rule', v_rule,
          'detail', 'an other-approved-reason revocation names the identified credential by device and generation');
      end if;
      if p_approval_request_id is null and cardinality(v_links) = 0 then
        v_ids := array[v_identified];
      else
        select * into v_scope from kitluy_devices.revocation_recorded_scopes
         where environment = p_environment
           and reason_code = 'OTHER_APPROVED_REASON'
           and approval_request_id = p_approval_request_id;
        if not found then
          return jsonb_build_object('resolved', false,
            'refusal_code', 'KLUY-REVOCATION-SCOPE-UNAPPROVED-BROADENING',
            'scope_rule', v_rule,
            'detail', 'a broader scope for OTHER_APPROVED_REASON requires an approved scope recorded against the approving request');
        end if;
        if v_scope.unrestricted_wildcard then
          return jsonb_build_object('resolved', false,
            'refusal_code', 'KLUY-REVOCATION-SCOPE-WILDCARD-REFUSED',
            'scope_rule', v_rule,
            'detail', 'decision §3.1 forbids an unrestricted all-devices wildcard');
        end if;
        -- The caller may ask for the approved widening; it may not ask for a
        -- credential the approval did not name.
        select count(*) into v_foreign
          from unnest(v_links) l(id)
         where not (l.id = any (v_scope.affected_credential_ids))
           and l.id <> v_identified;
        if v_foreign > 0 then
          return jsonb_build_object('resolved', false,
            'refusal_code', 'KLUY-REVOCATION-SCOPE-UNAPPROVED-BROADENING',
            'scope_rule', v_rule,
            'detail', format('%s requested credential(s) are outside the approved broader scope', v_foreign));
        end if;
        select count(*) into v_foreign
          from unnest(v_scope.affected_credential_ids) l(id)
          left join kitluy_devices.device_credentials c on c.credential_id = l.id
         where c.credential_id is null or c.environment <> p_environment;
        if v_foreign > 0 then
          return jsonb_build_object('resolved', false,
            'refusal_code', 'KLUY-REVOCATION-SCOPE-LINK-FOREIGN',
            'scope_rule', v_rule,
            'detail', 'the recorded broader scope names credentials outside this environment');
        end if;
        v_rule := 'APPROVED_BROADER_SCOPE';
        select coalesce(array_agg(distinct c.credential_id), array[]::uuid[]) into v_ids
          from kitluy_devices.device_credentials c
         where c.environment = p_environment
           and c.state <> 'revoked'
           and (c.credential_id = v_identified
                or c.credential_id = any (v_scope.affected_credential_ids));
      end if;

    -- §3: PROVIDER_COMPROMISE — "An explicitly recorded incident-defined
    -- affected-KEY set". Keys, so a recorded set that names only devices or
    -- credentials does not satisfy this row and fails closed.
    -- §3.1: no unrestricted wildcard, re-checked at read time even though the
    -- table cannot hold one.
    when 'PROVIDER_COMPROMISE' then
      v_rule := 'RECORDED_INCIDENT_KEY_SET';
      if coalesce(btrim(p_incident_reference), '') = '' then
        return jsonb_build_object('resolved', false,
          'refusal_code', 'KLUY-REVOCATION-SCOPE-NO-INCIDENT',
          'scope_rule', v_rule,
          'detail', 'a provider compromise names the incident whose affected key set was recorded');
      end if;
      select * into v_scope from kitluy_devices.revocation_recorded_scopes
       where incident_reference = p_incident_reference
         and environment = p_environment
         and reason_code = 'PROVIDER_COMPROMISE';
      if not found then
        return jsonb_build_object('resolved', false,
          'refusal_code', 'KLUY-REVOCATION-SCOPE-NOT-RECORDED',
          'scope_rule', v_rule,
          'detail', format('no approved affected-key set is recorded for incident %s', p_incident_reference));
      end if;
      if v_scope.unrestricted_wildcard then
        return jsonb_build_object('resolved', false,
          'refusal_code', 'KLUY-REVOCATION-SCOPE-WILDCARD-REFUSED',
          'scope_rule', v_rule,
          'detail', 'decision §3.1 forbids an unrestricted all-devices wildcard');
      end if;
      if cardinality(v_scope.affected_key_references) + cardinality(v_scope.affected_fingerprints) = 0 then
        return jsonb_build_object('resolved', false,
          'refusal_code', 'KLUY-REVOCATION-SCOPE-NO-KEY',
          'scope_rule', v_rule,
          'detail', 'a provider compromise scope is an affected-KEY set; none is recorded');
      end if;
      select coalesce(array_agg(distinct c.credential_id), array[]::uuid[]) into v_ids
        from kitluy_devices.device_credentials c
       where c.environment = p_environment
         and c.state <> 'revoked'
         and (c.public_key_fingerprint = any (v_scope.affected_fingerprints)
              or c.public_key_fingerprint in (
                   select k.public_key_fingerprint
                     from kitluy_devices.device_generation_keys k
                    where k.environment = p_environment
                      and k.key_handle = any (v_scope.affected_key_references)));

    -- §3: SECURITY_INCIDENT — "An explicitly recorded incident-defined
    -- device/key/credential set". All three kinds are honoured, and at least
    -- one must be present (the table's CHECK already guarantees it).
    when 'SECURITY_INCIDENT' then
      v_rule := 'RECORDED_INCIDENT_DEVICE_KEY_CREDENTIAL_SET';
      if coalesce(btrim(p_incident_reference), '') = '' then
        return jsonb_build_object('resolved', false,
          'refusal_code', 'KLUY-REVOCATION-SCOPE-NO-INCIDENT',
          'scope_rule', v_rule,
          'detail', 'a security incident revocation names the incident whose affected set was recorded');
      end if;
      select * into v_scope from kitluy_devices.revocation_recorded_scopes
       where incident_reference = p_incident_reference
         and environment = p_environment
         and reason_code = 'SECURITY_INCIDENT';
      if not found then
        return jsonb_build_object('resolved', false,
          'refusal_code', 'KLUY-REVOCATION-SCOPE-NOT-RECORDED',
          'scope_rule', v_rule,
          'detail', format('no approved affected set is recorded for incident %s', p_incident_reference));
      end if;
      if v_scope.unrestricted_wildcard then
        return jsonb_build_object('resolved', false,
          'refusal_code', 'KLUY-REVOCATION-SCOPE-WILDCARD-REFUSED',
          'scope_rule', v_rule,
          'detail', 'decision §3.1 forbids an unrestricted all-devices wildcard');
      end if;
      select coalesce(array_agg(distinct c.credential_id), array[]::uuid[]) into v_ids
        from kitluy_devices.device_credentials c
       where c.environment = p_environment
         and c.state <> 'revoked'
         and (c.device_record_id = any (v_scope.affected_device_ids)
              or c.credential_id = any (v_scope.affected_credential_ids)
              or c.public_key_fingerprint = any (v_scope.affected_fingerprints)
              or c.public_key_fingerprint in (
                   select k.public_key_fingerprint
                     from kitluy_devices.device_generation_keys k
                    where k.environment = p_environment
                      and k.key_handle = any (v_scope.affected_key_references)));

    else
      -- Unreachable while the policy CHECK keeps the two reason sets total, and
      -- fail-closed if a future enum value ever slips past it.
      return jsonb_build_object('resolved', false,
        'refusal_code', 'KLUY-REVOCATION-SCOPE-UNKNOWN-REASON',
        'detail', format('no decision §3 scope rule covers reason %s', p_reason_code));
  end case;

  return jsonb_build_object(
    'resolved', true,
    'scope_rule', v_rule,
    'reason_code', p_reason_code,
    'credential_ids', to_jsonb(coalesce(v_ids, array[]::uuid[])),
    'credential_count', cardinality(coalesce(v_ids, array[]::uuid[])));
end
$scope$;

comment on function kitluy_devices.resolve_revocation_scope_v1 is
  'Decision §3, one branch per row of the scope table. The affected credential set is derived FROM THE REASON and never accepted from the caller: DEVICE_LOST/DEVICE_STOLEN reach the active and overlapping credentials of that device, KEY_COMPROMISE reaches every credential bound to the key, ASSIGNMENT_INVALIDATED reaches the invalidated assignment generation, CERTIFICATE_MISISSUANCE the identified credential plus explicitly linked duplicates on the same device, ADMINISTRATIVE_REPLACEMENT the identified credential ONLY, OTHER_APPROVED_REASON the credential only unless an APPROVED request names a broader scope, and PROVIDER_COMPROMISE/SECURITY_INCIDENT only an explicitly recorded, wildcard-free affected set. §3.2: an undeterminable scope is a refusal, never a guess in either direction.';

-- ---------------------------------------------------------------------------
-- Recording an incident-defined affected set — decision §3, §3.1.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.record_revocation_scope_v1(
  p_incident_reference text,
  p_environment text,
  p_reason_code kitluy_devices.credential_revocation_reason,
  p_affected_device_ids uuid[],
  p_affected_key_references text[],
  p_affected_fingerprints text[],
  p_affected_credential_ids uuid[],
  p_recorded_by text,
  p_approved_by text,
  p_note text default null,
  p_approval_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $incident_scope$
declare
  v_existing kitluy_devices.revocation_recorded_scopes;
  v_id uuid;
  v_devices uuid[] := coalesce(p_affected_device_ids, array[]::uuid[]);
  v_keys text[] := coalesce(p_affected_key_references, array[]::text[]);
  v_fps text[] := coalesce(p_affected_fingerprints, array[]::text[]);
  v_creds uuid[] := coalesce(p_affected_credential_ids, array[]::uuid[]);
begin
  if p_reason_code not in ('PROVIDER_COMPROMISE', 'SECURITY_INCIDENT', 'OTHER_APPROVED_REASON') then
    return jsonb_build_object('outcome', 'SCOPE_REFUSED',
      'refusal_code', 'KLUY-REVOCATION-SCOPE-REASON-NOT-RECORDABLE',
      'detail', 'decision §3 derives every other reason from the fleet; only these three take a recorded set');
  end if;
  -- §3 row 7: a broader scope that cites no approval is not an approved
  -- broader scope, and a broader scope naming no credential is not a scope.
  if p_reason_code = 'OTHER_APPROVED_REASON'
     and (p_approval_request_id is null or cardinality(v_creds) = 0) then
    return jsonb_build_object('outcome', 'SCOPE_REFUSED',
      'refusal_code', 'KLUY-REVOCATION-SCOPE-UNAPPROVED-BROADENING',
      'detail', 'a recorded broader scope names the approving request and the credentials it reaches');
  end if;
  if coalesce(btrim(p_incident_reference), '') = '' then
    return jsonb_build_object('outcome', 'SCOPE_REFUSED',
      'refusal_code', 'KLUY-REVOCATION-SCOPE-NO-INCIDENT',
      'detail', 'a recorded affected set belongs to a named incident');
  end if;
  if btrim(coalesce(p_recorded_by, '')) = '' or btrim(coalesce(p_approved_by, '')) = ''
     or btrim(p_recorded_by) = btrim(p_approved_by) then
    return jsonb_build_object('outcome', 'SCOPE_REFUSED',
      'refusal_code', 'KLUY-REVOCATION-SCOPE-SELF-APPROVED',
      'detail', 'the blast radius is written down by one person and approved by another');
  end if;

  -- §3.1, before the CHECK gets a chance: an empty set is not a scope.
  if cardinality(v_devices) + cardinality(v_keys)
     + cardinality(v_fps) + cardinality(v_creds) = 0 then
    return jsonb_build_object('outcome', 'SCOPE_REFUSED',
      'refusal_code', 'KLUY-REVOCATION-SCOPE-WILDCARD-REFUSED',
      'detail', 'decision §3.1: the affected set must be explicitly recorded, and an empty set is an unrestricted one');
  end if;
  if v_keys && array['*', '%', 'ALL', 'all', 'ANY', 'any']::text[]
     or v_fps && array['*', '%', 'ALL', 'all', 'ANY', 'any']::text[] then
    return jsonb_build_object('outcome', 'SCOPE_REFUSED',
      'refusal_code', 'KLUY-REVOCATION-SCOPE-WILDCARD-REFUSED',
      'detail', 'decision §3.1 forbids an unrestricted all-devices wildcard, however it is spelled');
  end if;

  select * into v_existing from kitluy_devices.revocation_recorded_scopes
   where incident_reference = p_incident_reference
     and environment = p_environment
     and reason_code = p_reason_code;
  if found then
    return jsonb_build_object('outcome', 'ALREADY_RECORDED',
      'incident_scope_id', v_existing.incident_scope_id,
      'detail', 'a recorded affected set is append-only; a changed blast radius is a new incident reference');
  end if;

  insert into kitluy_devices.revocation_recorded_scopes (
    incident_reference, environment, reason_code, approval_request_id,
    affected_device_ids, affected_key_references, affected_fingerprints,
    affected_credential_ids, recorded_by, approved_by, note)
  values (
    p_incident_reference, p_environment, p_reason_code, p_approval_request_id,
    v_devices, v_keys, v_fps, v_creds, p_recorded_by, p_approved_by, p_note)
  returning incident_scope_id into v_id;

  return jsonb_build_object('outcome', 'RECORDED', 'incident_scope_id', v_id);
end
$incident_scope$;

-- ---------------------------------------------------------------------------
-- Escalation — decision §2.4. Shared by the post-approval and the sweeper.
--
-- Escalating changes the CASE, never the credential. Every revocation this
-- emergency produced is moved to MANUAL_SECURITY_REVIEW, and one is opened for
-- any revocation that had no case (a NO_RECOVERY emergency whose post-approval
-- then failed is precisely a case somebody must look at).
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.escalate_emergency_revocation_v1(
  p_emergency_revocation_id uuid,
  p_escalation_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $escalate$
declare
  v_opened integer := 0;
  v_moved integer := 0;
begin
  insert into kitluy_devices.device_recovery_cases (
    revocation_id, device_record_id, environment, purpose, disposition)
  select r.revocation_id, r.device_record_id, r.environment, r.purpose,
         'MANUAL_SECURITY_REVIEW'::kitluy_devices.credential_recovery_disposition
    from kitluy_devices.device_credential_revocations r
   where r.emergency_revocation_id = p_emergency_revocation_id
  on conflict (revocation_id) do nothing;
  get diagnostics v_opened = row_count;

  update kitluy_devices.device_recovery_cases c
     set disposition = 'MANUAL_SECURITY_REVIEW'
    from kitluy_devices.device_credential_revocations r
   where r.emergency_revocation_id = p_emergency_revocation_id
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
$escalate$;

comment on function kitluy_devices.escalate_emergency_revocation_v1 is
  'Decision §2.4. Moves every recovery case produced by an emergency revocation to MANUAL_SECURITY_REVIEW and opens one where none existed. Touches no credential: escalation decides what happens NEXT, never whether the revocation happened.';

-- ---------------------------------------------------------------------------
-- B. THE EMERGENCY PATH — decision §2.2, §2.3.
--
-- Executes IMMEDIATELY, with no prior approval, and only when all of §2.3 is
-- present. The checks are ordered so that an ineligible reason, a missing
-- incident reference or a missing re-authentication is refused BEFORE anything
-- is looked up, let alone written.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.revoke_device_credential_emergency_v1(
  p_revocation_request_id text,
  p_environment text,
  p_purpose text,
  p_reason_code kitluy_devices.credential_revocation_reason,
  p_reason text,
  p_recovery_disposition kitluy_devices.credential_recovery_disposition,
  p_declared_by text,
  p_declaring_authority kitluy_devices.emergency_declaring_authority,
  p_reauthenticated boolean,
  p_reauthentication_method text,
  p_incident_reference text,
  p_source text,
  p_device_record_id uuid default null,
  p_credential_generation integer default null,
  p_provider_key_reference text default null,
  p_public_key_fingerprint text default null,
  p_assignment_generation integer default null,
  p_linked_credential_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $emergency$
declare
  v_policy kitluy_devices.credential_revocation_policy;
  v_existing kitluy_devices.device_credential_emergency_revocations;
  v_scope jsonb;
  v_ids uuid[];
  v_emergency uuid;
  v_identified uuid;
  v_due timestamptz;
  v_revoked uuid[] := array[]::uuid[];
  v_skipped uuid[] := array[]::uuid[];
  v_cred kitluy_devices.device_credentials;
  v_row kitluy_devices.device_credential_revocations;
  v_id uuid;
begin
  if coalesce(btrim(p_revocation_request_id), '') = '' then
    raise exception 'KLUY-EMERGENCY-NO-REQUEST-ID: an emergency declaration is identified so a retry is idempotent'
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_declared_by), '') = '' or coalesce(btrim(p_source), '') = '' then
    raise exception 'KLUY-EMERGENCY-INCOMPLETE: an emergency revocation names its declaring authority and its source'
      using errcode = 'P0001';
  end if;

  select * into v_policy from kitluy_devices.credential_revocation_policy
   where environment = p_environment;
  if not found then
    raise exception 'KLUY-EMERGENCY-NO-POLICY: no revocation policy for environment %', p_environment
      using errcode = 'P0001';
  end if;

  -- §2.2 FIRST. The emergency path exists for the five reasons that mean a
  -- private key may be in hands the operator does not control. An
  -- administrative replacement is not one of them, and dressing it as an
  -- emergency is precisely the abuse §2.1 exists to prevent.
  if not (p_reason_code = any (v_policy.emergency_eligible_reasons)) then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-REASON-NOT-ELIGIBLE',
      'detail', format(
        'decision §2.1 requires a completed prior approval for %s; only %s may execute immediately',
        p_reason_code, array_to_string(v_policy.emergency_eligible_reasons::text[], ', ')),
      'reason_code', p_reason_code);
  end if;

  -- §2.3: an incident reference. Not optional, and not satisfiable with blanks.
  if v_policy.emergency_requires_incident_reference
     and coalesce(btrim(p_incident_reference), '') = '' then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NO-INCIDENT-REFERENCE',
      'detail', 'decision §2.3 requires an incident reference on every emergency revocation',
      'reason_code', p_reason_code);
  end if;

  -- §2.3: re-authentication.
  if v_policy.emergency_requires_reauthentication
     and (p_reauthenticated is not true or coalesce(btrim(p_reauthentication_method), '') = '') then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NO-REAUTH',
      'detail', 'decision §2.3 requires the declaring authority to re-authenticate',
      'reason_code', p_reason_code);
  end if;

  -- §2.3: a mandatory reason.
  if v_policy.reason_required and coalesce(btrim(p_reason), '') = '' then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NO-REASON',
      'detail', 'decision §2.3 requires a mandatory reason',
      'reason_code', p_reason_code);
  end if;

  -- Idempotence before any further work: replaying a declaration must not open
  -- a second emergency, and must not restart the post-approval clock.
  select * into v_existing from kitluy_devices.device_credential_emergency_revocations
   where revocation_request_id = p_revocation_request_id;
  if found then
    return jsonb_build_object(
      'outcome', 'ALREADY_DECLARED',
      'emergency_revocation_id', v_existing.emergency_revocation_id,
      'reason_code', v_existing.reason_code,
      'post_approval_due_at', v_existing.post_approval_due_at,
      'post_approval_decision', v_existing.post_approval_decision,
      'revoked_credential_count', v_existing.revoked_credential_count);
  end if;

  -- §3: the blast radius comes from the reason.
  v_scope := kitluy_devices.resolve_revocation_scope_v1(
    p_reason_code, p_environment, p_device_record_id, p_purpose,
    p_credential_generation, p_provider_key_reference, p_public_key_fingerprint,
    p_assignment_generation, p_incident_reference, p_linked_credential_ids, null);

  -- §3.2: fail closed. Nothing is written and nothing is guessed.
  if not (v_scope ->> 'resolved')::boolean then
    return jsonb_build_object(
      'outcome', 'MANUAL_SECURITY_REVIEW',
      'refusal_code', v_scope ->> 'refusal_code',
      'detail', v_scope ->> 'detail',
      'scope_rule', v_scope ->> 'scope_rule',
      'reason_code', p_reason_code);
  end if;

  select array_agg(value::uuid) into v_ids
    from jsonb_array_elements_text(v_scope -> 'credential_ids');
  v_ids := coalesce(v_ids, array[]::uuid[]);

  -- A declaration that reaches no credential is a mismatch between the incident
  -- and the fleet. It is reviewed, not recorded as a successful revocation.
  if cardinality(v_ids) = 0 then
    return jsonb_build_object(
      'outcome', 'MANUAL_SECURITY_REVIEW',
      'refusal_code', 'KLUY-EMERGENCY-NO-CREDENTIAL-IN-SCOPE',
      'detail', 'the resolved scope reached no live credential; the declaration and the fleet disagree',
      'scope_rule', v_scope ->> 'scope_rule',
      'reason_code', p_reason_code);
  end if;

  if p_device_record_id is not null and p_credential_generation is not null then
    select c.credential_id into v_identified from kitluy_devices.device_credentials c
     where c.device_record_id = p_device_record_id
       and c.environment = p_environment
       and c.purpose = p_purpose
       and c.certificate_generation = p_credential_generation;
  end if;

  -- §2.3: the deadline. Server time — an operator deadline, never a device's.
  v_due := clock_timestamp() + make_interval(hours => v_policy.post_approval_window_hours);

  insert into kitluy_devices.device_credential_emergency_revocations (
    revocation_request_id, environment, purpose, device_record_id, credential_id,
    declared_by, declaring_authority, declarer_reauthenticated, reauthentication_method,
    reason_code, reason, incident_reference, scope_rule, revoked_credential_count,
    post_approval_due_at, source)
  values (
    p_revocation_request_id, p_environment, p_purpose, p_device_record_id, v_identified,
    p_declared_by, p_declaring_authority, p_reauthenticated, p_reauthentication_method,
    p_reason_code, p_reason, p_incident_reference, v_scope ->> 'scope_rule', 0,
    v_due, p_source)
  returning emergency_revocation_id into v_emergency;

  -- IMMEDIATE EXECUTION. No approval is consulted; §2.2 already authorized it.
  foreach v_id in array v_ids loop
    select * into v_cred from kitluy_devices.device_credentials
     where credential_id = v_id for update;

    -- Already revoked: the first account of why is not overwritten by the
    -- second person to notice (group 0136's ruling, kept).
    if v_cred.state = 'revoked' then
      v_skipped := v_skipped || v_id;
      continue;
    end if;

    insert into kitluy_devices.device_credential_revocations (
      -- One evidence row per credential, so the request id is qualified by the
      -- credential it reached: group 0136 makes `revocation_request_id` unique,
      -- and a scope that reaches four credentials owes four accounts.
      revocation_request_id, credential_id, device_record_id, environment, purpose,
      credential_generation, public_key_fingerprint, reason_code, reason,
      requested_by, source, incident_reference, recovery_disposition,
      emergency_revocation_id, scope_rule)
    values (
      format('%s#%s', p_revocation_request_id, v_id), v_id, v_cred.device_record_id,
      v_cred.environment, v_cred.purpose, v_cred.certificate_generation,
      v_cred.public_key_fingerprint, p_reason_code, p_reason,
      p_declared_by, p_source, p_incident_reference, p_recovery_disposition,
      v_emergency, v_scope ->> 'scope_rule')
    returning * into v_row;

    -- The DERIVED current fact the verifier reads. `revoked_at` is written with
    -- it: group 0125's device_credentials_revoked_chk pairs the two, and a
    -- state without its timestamp is refused by the table.
    update kitluy_devices.device_credentials
       set state = 'revoked',
           revoked_at = clock_timestamp(),
           revocation_reason = format('%s: %s', p_reason_code, p_reason)
     where credential_id = v_id;

    if p_recovery_disposition <> 'NO_RECOVERY' then
      insert into kitluy_devices.device_recovery_cases (
        revocation_id, device_record_id, environment, purpose, disposition)
      values (v_row.revocation_id, v_cred.device_record_id, v_cred.environment,
              v_cred.purpose, p_recovery_disposition);
    end if;

    v_revoked := v_revoked || v_id;
  end loop;

  update kitluy_devices.device_credential_emergency_revocations
     set revoked_credential_count = cardinality(v_revoked)
   where emergency_revocation_id = v_emergency;

  return jsonb_build_object(
    'outcome', 'REVOKED_IMMEDIATELY',
    'emergency_revocation_id', v_emergency,
    'reason_code', p_reason_code,
    'scope_rule', v_scope ->> 'scope_rule',
    'revoked_credential_ids', to_jsonb(v_revoked),
    'revoked_credential_count', cardinality(v_revoked),
    'already_revoked_credential_ids', to_jsonb(v_skipped),
    'post_approval_due_at', to_char(v_due at time zone 'UTC',
                                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'post_approval_decision', 'PENDING',
    'note', 'decision §2.4: a late, missing or refused post-approval does NOT restore these credentials');
end
$emergency$;

comment on function kitluy_devices.revoke_device_credential_emergency_v1 is
  'Decision §2.2/§2.3. The emergency path: executes IMMEDIATELY with no prior approval, but ONLY for KEY_COMPROMISE, DEVICE_LOST, DEVICE_STOLEN, PROVIDER_COMPROMISE or SECURITY_INCIDENT, ONLY from a re-authenticated CISO or incident commander, and ONLY with a mandatory reason and an incident reference. The blast radius is resolved from the reason per §3 and fails closed when it cannot be determined. Writes the same append-only device_credential_revocations evidence group 0136 defined, one row per credential reached, plus the durable emergency declaration carrying the 4-hour post-approval deadline.';

-- ---------------------------------------------------------------------------
-- C. THE POST-APPROVAL — decision §2.4, and the one rule that matters most.
--
-- There is no branch in this function that writes `device_credentials`. A
-- refusal is recorded and escalated; a late answer is recorded as LAPSED and
-- escalated; a missing answer is swept into LAPSED by the function below. In
-- every one of those the credential stays revoked, because an auto-reversing
-- revocation would turn the emergency path into a way to SCHEDULE
-- un-revocation: delay the approver, get the credential back.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.record_emergency_revocation_post_approval_v1(
  p_emergency_revocation_id uuid,
  p_approver text,
  p_decision text,
  p_reauthenticated boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $post_approval$
declare
  v_em kitluy_devices.device_credential_emergency_revocations;
  v_verdict kitluy_devices.emergency_post_approval_decision;
  v_late boolean;
  v_escalation text;
  v_escalated jsonb;
  v_still integer;
begin
  if p_decision not in ('APPROVE', 'REFUSE') then
    raise exception 'KLUY-EMERGENCY-BAD-DECISION: a post-approval is APPROVE or REFUSE, not %', p_decision
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_approver), '') = '' then
    raise exception 'KLUY-EMERGENCY-NO-APPROVER: a post-approval names the second person'
      using errcode = 'P0001';
  end if;
  if p_reauthenticated is not true then
    raise exception 'KLUY-EMERGENCY-APPROVER-NO-REAUTH: the post-approver must re-authenticate (decision §2.3)'
      using errcode = 'P0001';
  end if;

  select * into v_em from kitluy_devices.device_credential_emergency_revocations
   where emergency_revocation_id = p_emergency_revocation_id for update;
  if not found then
    raise exception 'KLUY-EMERGENCY-NOT-FOUND: no emergency revocation %', p_emergency_revocation_id
      using errcode = 'P0001';
  end if;

  if v_em.post_approval_decision <> 'PENDING' then
    return jsonb_build_object(
      'outcome', 'ALREADY_DECIDED',
      'emergency_revocation_id', v_em.emergency_revocation_id,
      'post_approval_decision', v_em.post_approval_decision,
      'credential_state_changed', false);
  end if;

  -- §2.4: A DISTINCT SECOND PERSON. The CHECK refuses it too; refusing here
  -- gives the caller a reason instead of a constraint violation.
  if btrim(p_approver) = btrim(v_em.declared_by) then
    return jsonb_build_object(
      'outcome', 'POST_APPROVAL_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-SELF-POST-APPROVAL',
      'detail', 'the declaring authority cannot be their own second person',
      'emergency_revocation_id', v_em.emergency_revocation_id,
      'credential_state_changed', false);
  end if;

  -- Server time against a deadline frozen in server time. Comparing an operator
  -- deadline against a device's trusted clock would let the wrong skew sign
  -- decide whether an incident was answered in time.
  v_late := now() > v_em.post_approval_due_at;

  if p_decision = 'APPROVE' and not v_late then
    v_verdict := 'APPROVED';
  elsif p_decision = 'APPROVE' and v_late then
    -- §2.4: LATE. The approval arrived, but not inside the window it was owed
    -- in, so the case still goes to review. It does NOT un-revoke anything.
    v_verdict := 'LAPSED';
    v_escalation := format(
      'post-approval arrived at %s, after the %s deadline; decision §2.4 moves the case to MANUAL_SECURITY_REVIEW and the credentials stay revoked',
      now(), v_em.post_approval_due_at);
  else
    -- §2.4: REFUSED. The strongest form of the rule — the second person said
    -- the revocation should not have happened, and the credential STILL stays
    -- revoked. What happens next is decided by the review, not by this row.
    v_verdict := 'REFUSED';
    v_escalation := format(
      'post-approval REFUSED by %s; decision §2.4 keeps the credentials revoked and escalates to MANUAL_SECURITY_REVIEW',
      p_approver);
  end if;

  update kitluy_devices.device_credential_emergency_revocations
     set post_approval_decision = v_verdict,
         post_approved_by = p_approver,
         post_approval_recorded_at = clock_timestamp(),
         post_approver_reauthenticated = p_reauthenticated,
         post_approval_note = p_note,
         escalated_at = case when v_escalation is null then null else clock_timestamp() end,
         escalation_reason = v_escalation
   where emergency_revocation_id = p_emergency_revocation_id;

  if v_escalation is not null then
    v_escalated := kitluy_devices.escalate_emergency_revocation_v1(
      p_emergency_revocation_id, v_escalation);
  end if;

  -- Counted, not assumed. The return value states what is true of the fleet
  -- after the verdict rather than what the verdict was supposed to leave.
  select count(*) into v_still
    from kitluy_devices.device_credential_revocations r
    join kitluy_devices.device_credentials c on c.credential_id = r.credential_id
   where r.emergency_revocation_id = p_emergency_revocation_id
     and c.state = 'revoked';

  return jsonb_build_object(
    'outcome', case when v_verdict = 'APPROVED' then 'POST_APPROVED'
                    else 'MANUAL_SECURITY_REVIEW' end,
    'emergency_revocation_id', p_emergency_revocation_id,
    'post_approval_decision', v_verdict,
    'escalation', v_escalated,
    'credential_state_changed', false,
    'credentials_still_revoked', v_still,
    'note', 'decision §2.4: a revocation is one-way; this verdict decides what happens next, not whether it happened');
end
$post_approval$;

comment on function kitluy_devices.record_emergency_revocation_post_approval_v1 is
  'Decision §2.4. Records the distinct second-person post-approval of an emergency revocation. The approver must differ from the declarer (refused here, and refused by CHECK). An on-time APPROVE closes the obligation; a LATE approve becomes LAPSED and a REFUSE becomes REFUSED, and BOTH escalate to MANUAL_SECURITY_REVIEW while leaving every credential revoked. This function contains no statement that writes device_credentials, and enforce_revocation_is_one_way refuses the reversal independently of it.';

-- ---------------------------------------------------------------------------
-- The MISSING post-approval — decision §2.4, the "late or missing" half.
--
-- A deadline that nothing sweeps is a deadline that quietly never expires, and
-- an emergency that stays PENDING for ever is an escalation nobody made.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.lapse_emergency_revocation_post_approvals_v1(
  p_environment text,
  p_source text default 'SWEEP'
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $lapse$
declare
  v_row record;
  v_lapsed uuid[] := array[]::uuid[];
  v_reason text;
begin
  for v_row in
    select emergency_revocation_id, post_approval_due_at
      from kitluy_devices.device_credential_emergency_revocations
     where environment = p_environment
       and post_approval_decision = 'PENDING'
       and post_approval_due_at <= now()
     order by post_approval_due_at
     for update
  loop
    v_reason := format(
      'no post-approval was recorded by the %s deadline; decision §2.4 moves the case to MANUAL_SECURITY_REVIEW and the credentials stay revoked',
      v_row.post_approval_due_at);

    -- LAPSED carries no approver: nobody came. The APPROVED-has-approver CHECK
    -- is what keeps that distinction honest.
    update kitluy_devices.device_credential_emergency_revocations
       set post_approval_decision = 'LAPSED',
           escalated_at = clock_timestamp(),
           escalation_reason = v_reason,
           post_approval_note = coalesce(post_approval_note, p_source)
     where emergency_revocation_id = v_row.emergency_revocation_id;

    perform kitluy_devices.escalate_emergency_revocation_v1(
      v_row.emergency_revocation_id, v_reason);

    v_lapsed := v_lapsed || v_row.emergency_revocation_id;
  end loop;

  return jsonb_build_object(
    'outcome', 'SWEPT',
    'lapsed', to_jsonb(v_lapsed),
    'lapsed_count', cardinality(v_lapsed),
    'credential_state_changed', false,
    'note', 'decision §2.4: a MISSING post-approval escalates; it does not restore anything');
end
$lapse$;

comment on function kitluy_devices.lapse_emergency_revocation_post_approvals_v1 is
  'Decision §2.4, the "missing" half. Sweeps emergency revocations whose 4-hour post-approval deadline passed with no answer into LAPSED and escalates them to MANUAL_SECURITY_REVIEW. Writes no credential state: a deadline nobody answered is an escalation, never a reversal.';

-- ---------------------------------------------------------------------------
-- Grants, ownership, hygiene
-- ---------------------------------------------------------------------------
alter table kitluy_devices.revocation_recorded_scopes enable row level security;
alter table kitluy_devices.revocation_recorded_scopes force row level security;
alter table kitluy_devices.device_credential_emergency_revocations enable row level security;
alter table kitluy_devices.device_credential_emergency_revocations force row level security;

grant select, insert on kitluy_devices.revocation_recorded_scopes to kitluy_credential_issuer;
grant select, insert, update on kitluy_devices.device_credential_emergency_revocations
  to kitluy_credential_issuer;
grant select on kitluy_devices.revocation_recorded_scopes to service_role;
grant select on kitluy_devices.device_credential_emergency_revocations to service_role;

create policy revocation_recorded_scopes_issuer_write
  on kitluy_devices.revocation_recorded_scopes
  for all to kitluy_credential_issuer using (true) with check (true);
create policy revocation_recorded_scopes_service_read
  on kitluy_devices.revocation_recorded_scopes
  for select to service_role using (true);
create policy emergency_revocations_issuer_write
  on kitluy_devices.device_credential_emergency_revocations
  for all to kitluy_credential_issuer using (true) with check (true);
create policy emergency_revocations_service_read
  on kitluy_devices.device_credential_emergency_revocations
  for select to service_role using (true);

do $own_and_grant_0138$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname in ('resolve_revocation_scope_v1',
                         'record_revocation_scope_v1',
                         'escalate_emergency_revocation_v1',
                         'revoke_device_credential_emergency_v1',
                         'record_emergency_revocation_post_approval_v1',
                         'lapse_emergency_revocation_post_approvals_v1')
  loop
    execute format('alter function %s owner to kitluy_credential_issuer', r.signature);
    execute format('revoke all on function %s from public', r.signature);
    execute format('revoke all on function %s from service_role', r.signature);
    execute format('grant execute on function %s to kitluy_issuance_service', r.signature);
  end loop;
end
$own_and_grant_0138$;

-- Group 0136's hygiene sweep, repeated because this group added functions after
-- it ran. PUBLIC holds EXECUTE on a new function by default, and that includes
-- the two trigger functions above: PostgreSQL checks EXECUTE when the trigger is
-- CREATED, never when it fires, so revoking it costs the triggers nothing and
-- removes the only handle PUBLIC had on this schema.
do $revoke_public_0138$
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
$revoke_public_0138$;

-- ===========================================================================
-- HOSTILE ASSERTIONS — the migration fails rather than shipping a weakening
--
-- These run BEFORE the seed, so no device, credential or hardware profile
-- exists yet. Everything provable without one is proved here; the behavioural
-- proofs that need a live credential — an emergency executing immediately, and
-- above all a lapsed or refused post-approval leaving it revoked — are in
-- supabase/tests/assertions.sql section 41, which runs after the seed.
-- ===========================================================================
do $assert_0138$
declare
  v_findings text[] := array[]::text[];
  v_p kitluy_devices.credential_revocation_policy;
  v_res jsonb;
  r record;
begin
  select * into v_p from kitluy_devices.credential_revocation_policy
   where environment = 'development';

  -- ---- A. the approved sets, verbatim (§2.1, §2.2, §2.3) -------------------
  if not (v_p.emergency_eligible_reasons @> array[
            'KEY_COMPROMISE','DEVICE_LOST','DEVICE_STOLEN','PROVIDER_COMPROMISE',
            'SECURITY_INCIDENT']::kitluy_devices.credential_revocation_reason[]
          and cardinality(v_p.emergency_eligible_reasons) = 5) then
    v_findings := v_findings || 'the emergency reason set is not decision §2.2 verbatim';
  end if;
  if not (v_p.approve_before_execute_reasons @> array[
            'ASSIGNMENT_INVALIDATED','CERTIFICATE_MISISSUANCE',
            'ADMINISTRATIVE_REPLACEMENT','OTHER_APPROVED_REASON'
          ]::kitluy_devices.credential_revocation_reason[]
          and cardinality(v_p.approve_before_execute_reasons) = 4) then
    v_findings := v_findings || 'the approve-before-execute reason set is not decision §2.1 verbatim';
  end if;
  if v_p.post_approval_window_hours is distinct from 4 then
    v_findings := v_findings || 'the post-approval window is not the approved 4 hours';
  end if;
  if v_p.approved_by_decision_ref is distinct from 'KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001' then
    v_findings := v_findings || 'the policy does not name the approving owner decision';
  end if;
  if v_p.required_owner_decision is not null then
    v_findings := v_findings || 'the policy still names a missing owner decision';
  end if;
  -- The emergency reasons must NOT have become four-eyes exemptions for group
  -- 0136's function: that would be single-signature revocation with none of the
  -- §2.3 obligations attached.
  if cardinality(v_p.four_eyes_exempt_reasons) <> 0 or not v_p.four_eyes_required then
    v_findings := v_findings || 'an emergency reason was made four-eyes EXEMPT rather than four-eyes DEFERRED';
  end if;

  -- The two sets are DISJOINT and TOTAL, by constraint.
  begin
    update kitluy_devices.credential_revocation_policy
       set emergency_eligible_reasons = emergency_eligible_reasons
             || 'OTHER_APPROVED_REASON'::kitluy_devices.credential_revocation_reason
     where environment = 'development';
    v_findings := v_findings || 'a reason was placed in BOTH the emergency and approve-first sets';
  exception when others then
    if sqlerrm not like '%credential_revocation_policy_reason_sets_chk%' then
      v_findings := v_findings || format('wrong refusal for overlapping reason sets: %s', sqlerrm);
    end if;
  end;
  begin
    update kitluy_devices.credential_revocation_policy
       set approve_before_execute_reasons = array[
             'ASSIGNMENT_INVALIDATED']::kitluy_devices.credential_revocation_reason[]
     where environment = 'development';
    v_findings := v_findings || 'a revocation reason was left in NEITHER set';
  exception when others then
    if sqlerrm not like '%credential_revocation_policy_reason_sets_chk%' then
      v_findings := v_findings || format('wrong refusal for an unclassified reason: %s', sqlerrm);
    end if;
  end;

  -- §2.3 gates and §2.5 cannot be relaxed.
  begin
    update kitluy_devices.credential_revocation_policy
       set emergency_requires_incident_reference = false where environment = 'development';
    v_findings := v_findings || 'the mandatory incident reference was switched off';
  exception when others then
    if sqlerrm not like '%emergency_gates_chk%' then
      v_findings := v_findings || format('wrong refusal relaxing the incident reference: %s', sqlerrm);
    end if;
  end;
  begin
    update kitluy_devices.credential_revocation_policy
       set emergency_requires_reauthentication = false where environment = 'development';
    v_findings := v_findings || 'the mandatory re-authentication was switched off';
  exception when others then
    if sqlerrm not like '%emergency_gates_chk%' then
      v_findings := v_findings || format('wrong refusal relaxing re-authentication: %s', sqlerrm);
    end if;
  end;
  begin
    update kitluy_devices.credential_revocation_policy
       set machine_initiated_revocation_permitted = true where environment = 'development';
    v_findings := v_findings || 'machine-initiated revocation was permitted (decision §2.5)';
  exception when others then
    if sqlerrm not like '%no_machine_chk%' then
      v_findings := v_findings || format('wrong refusal permitting machine revocation: %s', sqlerrm);
    end if;
  end;

  -- ---- B. the emergency path refuses what §2 says it must ------------------
  -- An approve-before-execute reason cannot be smuggled through the emergency
  -- door. Checked before any device lookup, so a synthetic device id suffices.
  v_res := kitluy_devices.revoke_device_credential_emergency_v1(
    'assert-0138-ineligible-' || gen_random_uuid(), 'development', 'device_identity',
    'ADMINISTRATIVE_REPLACEMENT', 'a routine swap dressed as an incident',
    'REPROVISION_REQUIRED', 'ciso@assert', 'CISO', true, 'webauthn',
    'INC-ASSERT-0138', 'ASSERT-0138', gen_random_uuid(), 1);
  if (v_res ->> 'refusal_code') is distinct from 'KLUY-EMERGENCY-REASON-NOT-ELIGIBLE' then
    v_findings := v_findings ||
      format('an approve-first reason executed through the emergency path: %s', v_res);
  end if;

  -- §2.3: no incident reference, no emergency.
  v_res := kitluy_devices.revoke_device_credential_emergency_v1(
    'assert-0138-noincident-' || gen_random_uuid(), 'development', 'device_identity',
    'KEY_COMPROMISE', 'private half seen off-device', 'REPROVISION_REQUIRED',
    'ciso@assert', 'CISO', true, 'webauthn', '   ', 'ASSERT-0138',
    gen_random_uuid(), 1);
  if (v_res ->> 'refusal_code') is distinct from 'KLUY-EMERGENCY-NO-INCIDENT-REFERENCE' then
    v_findings := v_findings ||
      format('an emergency executed with no incident reference: %s', v_res);
  end if;

  -- §2.3: no re-authentication, no emergency.
  v_res := kitluy_devices.revoke_device_credential_emergency_v1(
    'assert-0138-noreauth-' || gen_random_uuid(), 'development', 'device_identity',
    'DEVICE_STOLEN', 'terminal taken from the store', 'REPROVISION_REQUIRED',
    'ic@assert', 'INCIDENT_COMMANDER', false, 'webauthn', 'INC-ASSERT-0138',
    'ASSERT-0138', gen_random_uuid(), 1);
  if (v_res ->> 'refusal_code') is distinct from 'KLUY-EMERGENCY-NO-REAUTH' then
    v_findings := v_findings || format('an emergency executed with no re-authentication: %s', v_res);
  end if;

  -- ---- D. §3.1: a wildcard affected set is refused by CONSTRAINT ------------
  begin
    insert into kitluy_devices.revocation_recorded_scopes (
      incident_reference, environment, reason_code, affected_device_ids,
      unrestricted_wildcard, recorded_by, approved_by)
    values ('INC-ASSERT-0138-WILD', 'development', 'PROVIDER_COMPROMISE',
            array[gen_random_uuid()], true, 'sec-a', 'sec-b');
    v_findings := v_findings || 'a PROVIDER_COMPROMISE wildcard scope was recorded';
  exception when others then
    if sqlerrm not like '%no_wildcard_chk%' then
      v_findings := v_findings || format('wrong refusal for a provider wildcard: %s', sqlerrm);
    end if;
  end;
  begin
    insert into kitluy_devices.revocation_recorded_scopes (
      incident_reference, environment, reason_code, affected_device_ids,
      unrestricted_wildcard, recorded_by, approved_by)
    values ('INC-ASSERT-0138-WILD2', 'development', 'SECURITY_INCIDENT',
            array[gen_random_uuid()], true, 'sec-a', 'sec-b');
    v_findings := v_findings || 'a SECURITY_INCIDENT wildcard scope was recorded';
  exception when others then
    if sqlerrm not like '%no_wildcard_chk%' then
      v_findings := v_findings || format('wrong refusal for an incident wildcard: %s', sqlerrm);
    end if;
  end;
  -- An EMPTY recorded set is the same wildcard spelled differently.
  begin
    insert into kitluy_devices.revocation_recorded_scopes (
      incident_reference, environment, reason_code, recorded_by, approved_by)
    values ('INC-ASSERT-0138-EMPTY', 'development', 'SECURITY_INCIDENT', 'sec-a', 'sec-b');
    v_findings := v_findings || 'an EMPTY affected set was recorded as a scope';
  exception when others then
    if sqlerrm not like '%not_empty_chk%' then
      v_findings := v_findings || format('wrong refusal for an empty scope: %s', sqlerrm);
    end if;
  end;
  -- ...and so is a wildcard smuggled in as a string.
  begin
    insert into kitluy_devices.revocation_recorded_scopes (
      incident_reference, environment, reason_code, affected_key_references,
      recorded_by, approved_by)
    values ('INC-ASSERT-0138-STAR', 'development', 'PROVIDER_COMPROMISE',
            array['*'], 'sec-a', 'sec-b');
    v_findings := v_findings || 'a wildcard token was accepted as an affected key set';
  exception when others then
    if sqlerrm not like '%no_token_chk%' then
      v_findings := v_findings || format('wrong refusal for a wildcard token: %s', sqlerrm);
    end if;
  end;
  -- The blast radius is itself four-eyes.
  begin
    insert into kitluy_devices.revocation_recorded_scopes (
      incident_reference, environment, reason_code, affected_device_ids,
      recorded_by, approved_by)
    values ('INC-ASSERT-0138-SELF', 'development', 'SECURITY_INCIDENT',
            array[gen_random_uuid()], 'sec-a', 'sec-a');
    v_findings := v_findings || 'one person recorded and approved the same blast radius';
  exception when others then
    if sqlerrm not like '%four_eyes_chk%' then
      v_findings := v_findings || format('wrong refusal for a self-approved scope: %s', sqlerrm);
    end if;
  end;
  -- Only the two incident-defined reasons take a recorded set at all.
  begin
    insert into kitluy_devices.revocation_recorded_scopes (
      incident_reference, environment, reason_code, affected_device_ids,
      recorded_by, approved_by)
    values ('INC-ASSERT-0138-WRONGREASON', 'development', 'DEVICE_LOST',
            array[gen_random_uuid()], 'sec-a', 'sec-b');
    v_findings := v_findings || 'a fleet-derived reason was given a caller-recorded scope';
  exception when others then
    if sqlerrm not like '%reason_chk%' then
      v_findings := v_findings || format('wrong refusal for a recordable reason: %s', sqlerrm);
    end if;
  end;

  -- §3.2: an unrecorded incident scope fails closed rather than resolving wide.
  v_res := kitluy_devices.resolve_revocation_scope_v1(
    'PROVIDER_COMPROMISE', 'development', null, 'device_identity', null, null, null, null,
    'INC-ASSERT-0138-NEVER-RECORDED');
  if (v_res ->> 'resolved')::boolean
     or (v_res ->> 'refusal_code') is distinct from 'KLUY-REVOCATION-SCOPE-NOT-RECORDED' then
    v_findings := v_findings || format('an unrecorded provider-compromise scope resolved: %s', v_res);
  end if;
  v_res := kitluy_devices.resolve_revocation_scope_v1(
    'SECURITY_INCIDENT', 'development', null, 'device_identity', null, null, null, null,
    'INC-ASSERT-0138-NEVER-RECORDED');
  if (v_res ->> 'resolved')::boolean
     or (v_res ->> 'refusal_code') is distinct from 'KLUY-REVOCATION-SCOPE-NOT-RECORDED' then
    v_findings := v_findings || format('an unrecorded security-incident scope resolved: %s', v_res);
  end if;
  -- A key compromise that names no key is undeterminable, not fleet-wide.
  v_res := kitluy_devices.resolve_revocation_scope_v1('KEY_COMPROMISE', 'development');
  if (v_res ->> 'resolved')::boolean
     or (v_res ->> 'refusal_code') is distinct from 'KLUY-REVOCATION-SCOPE-NO-KEY' then
    v_findings := v_findings || format('a key compromise with no key resolved: %s', v_res);
  end if;
  -- ...and a lost device that names no device likewise.
  v_res := kitluy_devices.resolve_revocation_scope_v1('DEVICE_LOST', 'development');
  if (v_res ->> 'resolved')::boolean
     or (v_res ->> 'refusal_code') is distinct from 'KLUY-REVOCATION-SCOPE-NO-DEVICE' then
    v_findings := v_findings || format('a lost-device revocation with no device resolved: %s', v_res);
  end if;

  -- ---- C. the structure that makes §2.4 impossible to violate --------------
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'device_credentials'
                    and t.tgname = 'trg_device_credentials_revocation_one_way'
                    and not t.tgisinternal) then
    v_findings := v_findings || 'nothing prevents a revoked credential returning to service';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'kitluy_devices.device_credential_emergency_revocations'::regclass
                    and conname = 'emergency_revocation_approver_distinct') then
    v_findings := v_findings || 'a declarer may be their own post-approver';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'kitluy_devices.device_credential_emergency_revocations'::regclass
                    and conname = 'emergency_revocation_incident_required') then
    v_findings := v_findings || 'an emergency record may omit its incident reference';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'kitluy_devices.device_credential_emergency_revocations'::regclass
                    and conname = 'emergency_revocation_terminal_escalates') then
    v_findings := v_findings || 'a refused or lapsed post-approval may stay quiet';
  end if;
  if (select is_nullable from information_schema.columns
       where table_schema = 'kitluy_devices'
         and table_name = 'device_credential_emergency_revocations'
         and column_name = 'incident_reference') <> 'NO' then
    v_findings := v_findings || 'the emergency incident reference is nullable';
  end if;
  -- NO branch of either post-approval function may write a credential state.
  -- Proved from the shipped source, not from intent.
  for r in
    select p.proname, pg_get_functiondef(p.oid) as src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname in ('record_emergency_revocation_post_approval_v1',
                         'lapse_emergency_revocation_post_approvals_v1',
                         'escalate_emergency_revocation_v1')
  loop
    if r.src ~* 'update\s+kitluy_devices\.device_credentials' then
      v_findings := v_findings ||
        format('%s writes device_credentials; a post-approval must never reverse a revocation', r.proname);
    end if;
  end loop;

  -- ---- E. §2.5: no machine-initiated revocation ---------------------------
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and (p.proname like '%revoke%' or p.proname like '%revocation%')
  loop
    if has_function_privilege('kitluy_worker_service', r.sig, 'execute') then
      v_findings := v_findings ||
        format('the worker role can execute %s (decision §2.5 forbids machine-initiated revocation)', r.proname);
    end if;
    if has_function_privilege('public', r.sig, 'execute') then
      v_findings := v_findings || format('PUBLIC can execute %s', r.proname);
    end if;
  end loop;
  if has_table_privilege('kitluy_worker_service',
                         'kitluy_devices.device_credential_emergency_revocations', 'insert')
     or has_table_privilege('kitluy_worker_service',
                            'kitluy_devices.revocation_recorded_scopes', 'insert')
     or has_table_privilege('kitluy_worker_service',
                            'kitluy_devices.credential_revocation_policy', 'update')
     or has_table_privilege('kitluy_worker_service',
                            'kitluy_devices.device_credentials', 'update') then
    v_findings := v_findings || 'the worker holds direct authority over revocation state';
  end if;
  -- The named executor records only THROUGH the governed functions.
  if has_table_privilege('kitluy_issuance_service',
                         'kitluy_devices.device_credential_emergency_revocations', 'insert')
     or has_table_privilege('kitluy_issuance_service',
                            'kitluy_devices.revocation_recorded_scopes', 'insert') then
    v_findings := v_findings || 'the issuance executor can write emergency evidence directly';
  end if;
  if not has_function_privilege('kitluy_issuance_service',
       'kitluy_devices.record_emergency_revocation_post_approval_v1(uuid, text, text, boolean, text)',
       'execute') then
    v_findings := v_findings || 'the named executor cannot record a post-approval';
  end if;

  -- The credential governor holds NO authority over the approvals aggregate.
  -- A governor that could write kitluy_auth could manufacture the approval that
  -- authorizes its own broader scope, and one that could read it would have
  -- crossed the boundary the policy census in section 7 exists to hold.
  if has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_requests', 'insert')
     or has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_requests', 'update')
     or has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_requests', 'delete')
     or has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_requests', 'select') then
    v_findings := v_findings || 'the credential governor reaches the approvals aggregate directly';
  end if;

  -- ---- shape: definer, fixed search_path, governor-owned, RLS forced -------
  for r in
    select p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname in ('resolve_revocation_scope_v1', 'record_revocation_scope_v1',
                         'escalate_emergency_revocation_v1', 'revoke_device_credential_emergency_v1',
                         'record_emergency_revocation_post_approval_v1',
                         'lapse_emergency_revocation_post_approvals_v1')
  loop
    if not r.prosecdef then
      v_findings := v_findings || format('%s is not SECURITY DEFINER', r.proname);
    end if;
    if r.owner <> 'kitluy_credential_issuer' then
      v_findings := v_findings || format('%s is owned by %s', r.proname, r.owner);
    end if;
    if r.proconfig is null
       or not exists (select 1 from unnest(r.proconfig) c where c like 'search_path=%') then
      v_findings := v_findings || format('%s has no fixed search_path', r.proname);
    end if;
  end loop;
  for r in
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_devices'
       and c.relname in ('revocation_recorded_scopes',
                         'device_credential_emergency_revocations')
  loop
    if not r.relrowsecurity or not r.relforcerowsecurity then
      v_findings := v_findings || format('%s does not have RLS ENABLED and FORCED', r.relname);
    end if;
  end loop;

  -- And shipping this revoked nothing and destroyed nothing.
  if exists (select 1 from kitluy_devices.device_credentials where state = 'revoked') then
    v_findings := v_findings || 'a credential was revoked by the migration';
  end if;
  if exists (select 1 from kitluy_devices.device_credential_emergency_revocations) then
    v_findings := v_findings || 'the migration declared an emergency';
  end if;
  if exists (select 1 from kitluy_devices.revocation_recorded_scopes) then
    v_findings := v_findings || 'the migration recorded an incident scope';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL 0138: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;
end
$assert_0138$;

-- The membership borrowed at the top is HANDED BACK, exactly as group 0137
-- does. A migration that kept it would leave the login-capable migration role
-- able to SET ROLE to the credential governor for ever, which is what the
-- permanent assertion in section 32 refuses.
do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

commit;
