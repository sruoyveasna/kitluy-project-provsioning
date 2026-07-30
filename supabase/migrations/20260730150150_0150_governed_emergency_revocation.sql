-- kitluy:group:0150
-- Migration group 0150: governed_emergency_revocation.
--
-- Authority: KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.2/§2.3/§2.4
--            (the emergency path, its obligations, and the rule that a late,
--            missing or refused post-approval never restores a credential);
--            KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1 (the exact
--            affected set is a cryptographic term of what authorizes it);
--            KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001 (the governed
--            sensitive-action re-authentication window and its evidence).
-- Remediates: the half of RC-021 that groups 0148 and 0149 named and did not
--            build — an emergency entry point that VERIFIES authority instead
--            of accepting it.
--
-- Additive. Groups 0136-0149 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- WHAT RC-021 IS, IN ONE SENTENCE
-- ===========================================================================
-- `revoke_device_credential_emergency_v1` (group 0138) takes
-- `p_declaring_authority` as a caller-supplied enum and `p_reauthenticated` as
-- a caller-supplied boolean. A caller that can assert its own authority and its
-- own re-authentication has not been authorized; it has been asked politely.
-- Group 0148 registered the two permission keys that make the question
-- answerable, group 0149 built evidence that a NAMED human really did step up
-- for ONE action class within a governed window, and this group is the entry
-- point that ASKS both questions and refuses when either answers no.
--
-- The signature is the whole of the remedy. There is no actor parameter, no
-- declaring-authority parameter, no re-authenticated boolean, no fingerprint,
-- no provider key reference, no assignment generation and no affected-set
-- array. Everything that used to be asserted is now derived: the actor from the
-- session, the authority from `kitluy_auth.has_permission`, the freshness from
-- spent evidence, and the blast radius from STORED ROWS via
-- `authoritative_revocation_scope_v1`.
--
-- ===========================================================================
-- WHAT THIS GROUP DELIBERATELY DOES **NOT** DO
-- ===========================================================================
--   * It does NOT revoke EXECUTE on `revoke_device_credential_emergency_v1`.
--     Seven assertion sites in `supabase/tests/assertions.sql` (sections 41a,
--     41b, 41c and 46) still drive that function, and taking the grant away
--     before those are re-homed would turn the structural gate red without
--     closing anything. RC-021 therefore STAYS OPEN after this migration: the
--     governed door exists and is proved to work, and the ungoverned one is
--     still there beside it. An available control is not an enforced one, and
--     saying so here is cheaper than letting a later reader assume otherwise.
--   * It does NOT build the post-approval half. The authorization carries the
--     §2.3 deadline, and no function in this group records a verdict against
--     it or sweeps an expired one. Group 0138's sweeper answers only its OWN
--     declarations, so an authorization recorded here has a deadline that
--     nothing yet escalates. That gap is recorded, not implied.
--   * It does NOT serve PROVIDER_COMPROMISE or SECURITY_INCIDENT. Decision §3
--     gives both of those a RECORDED incident-defined set, and
--     `authoritative_revocation_scope_v1` refuses to derive one from the fleet
--     precisely because it cannot be derived. Routing them through here would
--     mean inventing a blast radius during an incident, so they are refused
--     with their own code until a governed path that SPENDS a recorded set is
--     built.
--
-- ===========================================================================
-- WHY THE EXECUTION IS WRITTEN HERE INSTEAD OF DELEGATED, VERIFIED BY QUERY
-- ===========================================================================
-- The obvious shape was to let this function prove the authority and then hand
-- the credential state change to committed machinery. Both candidates were
-- checked against the live database rather than assumed, and neither can serve:
--
--   * `revoke_device_credential_v1` is EXECUTE-granted to
--     `kitluy_credential_issuer` — which IS this function's definer — but it
--     computes `v_needs_approval := four_eyes_required and not (reason = any
--     (four_eyes_exempt_reasons))`, and group 0138 set `four_eyes_required =
--     true` with an EMPTY exempt list on purpose (§2.1). Every call therefore
--     demands a COMPLETED PRIOR approval, which an emergency by definition does
--     not have. Reaching it would mean manufacturing the four-eyes approval
--     whose absence is the entire point of §2.2, so it is not reached.
--   * `revoke_device_credential_emergency_v1` would require this function to
--     supply `p_declaring_authority` (CISO or INCIDENT_COMMANDER) and
--     `p_recovery_disposition`. Neither is derivable from anything the database
--     knows: holding `fleet.device_credential.emergency_revoke` does not say
--     which of the two titles a human holds, and CLAUDE.md rule 9 forbids
--     guessing an owner value. It would also re-derive its own scope through
--     `resolve_revocation_scope_v1`, whose inputs are parameters — the RC-019
--     mirror — so the set actually revoked could differ from the authoritative
--     one this function committed to.
--
-- So the loop below writes the SAME append-only evidence group 0136 defined and
-- group 0138 writes, over the set `authoritative_revocation_scope_v1` derived,
-- under the SAME one-way trigger. Recorded as a finding rather than resolved
-- silently: the duplication exists because the committed emergency executor
-- carries an unproven authority field in its signature, and collapsing the two
-- is a scoped follow-up, not a side effect of this migration.
--
-- ===========================================================================
-- THE ONE PRIVILEGE THIS GROUP ADDS, AND WHY IT IS SHAPED THIS WAY
-- ===========================================================================
-- A governed emergency RPC must (a) WRITE `kitluy_devices` and (b) ASK
-- `kitluy_auth` who the caller is, whether they hold the key, and whether their
-- re-authentication is spendable. No single identity in this database may do
-- both, and that is deliberate: sections 42, 43 and 44 each assert that
-- `kitluy_credential_issuer` holds NOTHING on `kitluy_auth` — not even schema
-- USAGE — and granting it would be the boundary change, not the fix.
--
-- Verified by execution before this file was written: inside a definer owned by
-- `kitluy_credential_issuer`, even `auth.uid()` raises `permission denied for
-- schema auth`, and `postgres` holds USAGE on `auth` WITHOUT grant option, so a
-- migration cannot widen that either.
--
-- The answer is group 0141's, unchanged in shape: the identity that touches
-- `kitluy_auth` is the one that can see nothing else. Three tiny bridges below
-- are SECURITY DEFINER owned by the NOLOGIN, non-BYPASSRLS
-- `kitluy_credential_approval_reader`, each hard-coding its permission key and
-- action class so the governor can ask ONE question and cannot ask a different
-- one. They add no table privilege, no column privilege and no policy, so the
-- section 43 census ("SELECT is the only privilege this role holds") and the
-- section 7 policy census both stand. RECORDED as RC-026: the role's NAME says
-- approval reader, and its JOB is now "the constrained identity through which
-- kitluy_devices asks kitluy_auth a question". The alternative — a fourth
-- NOLOGIN role — was rejected as inventing an identity no decision names.
--
-- Note on `auth.uid()`: it reads the JWT GUC rather than `current_user`, so a
-- SECURITY DEFINER sees the CALLING human. That was verified empirically too;
-- what it cannot do is reach the `auth` schema from the governor, hence the
-- bridge rather than a direct call.
--
-- ===========================================================================
-- WHERE THE NUMBERS COME FROM
-- ===========================================================================
-- The 300-second re-authentication window appears NOWHERE in this file. It
-- lives in `kitluy_auth.sensitive_action_reauth_policy` and is enforced inside
-- `consume_reauthentication_evidence_v1`, exactly as group 0149 requires; this
-- function never learns it, never passes it and cannot widen it. The 4-hour
-- post-approval deadline is read from
-- `credential_revocation_policy.post_approval_window_hours`, which group 0138
-- set from §2.3 — a deadline retyped into a function body is a deadline that
-- drifts.
--
-- No removal statement appears anywhere in this file, comments included:
-- `migrations:validate` reads one as destructive and demands an owner-approved
-- marker, and carrying such a marker for objects this same file creates would
-- assert a decision that does not exist (groups 0141 and 0149 recorded the
-- same).

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
  execute format('grant kitluy_credential_approval_reader to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. THE IMMUTABLE AUTHORIZATION.
--
-- One row per emergency that actually executed. It records WHO (derived from
-- the session, never a parameter), under WHICH permission key, on WHICH
-- re-authentication evidence, for WHAT reason, under WHICH incident, in WHICH
-- environment, over HOW MANY credentials, committed to WHICH digest, and by
-- WHEN a second person owes an answer.
--
-- `actor_user_id` references `auth.users` rather than storing a name string.
-- Group 0138's `declared_by text` is a label a caller chose; a foreign key is
-- an identity the database resolved.
--
-- Tenancy is present and is currently always NULL. RECORDED FINDING: the
-- credential governor deliberately holds no SELECT on
-- `device_assignment_projections`, `device_assignments` or `device_claims` —
-- those belong to the activation governor — so this path cannot read a
-- device's tenant, digital store or store location without a privilege
-- widening that no decision authorizes. The columns exist so the digest below
-- binds the same terms group 0141's canonical form binds; populating them is a
-- scoped follow-up.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_emergency_revocation_authorizations (
  authorization_id uuid primary key default gen_random_uuid(),

  -- DERIVED from auth.uid(). There is no p_actor_user_id on the RPC, and that
  -- absence is the control: a parameter for the human's identity is how a
  -- service identity asserts a delegation it cannot prove (RC-023).
  actor_user_id uuid not null references auth.users (id),
  permission_key text not null,
  reauth_evidence_id uuid not null
    references kitluy_auth.reauthentication_evidence (evidence_id),

  reason_code kitluy_devices.credential_revocation_reason not null,
  explanation text not null,
  incident_reference text not null,
  environment text not null,

  tenant_id uuid,
  digital_store_id uuid,
  store_location_id uuid,

  subject_type text not null default 'CREDENTIAL',
  identifier_count integer not null,
  -- The SHA-256 of the canonical bytes of the exact affected set, computed with
  -- group 0141's functions so the emergency path and the approval path cannot
  -- drift apart. This is what the record COMMITS TO.
  scope_digest text not null,
  decision_version text not null,

  idempotency_key text not null,

  created_at timestamptz not null default clock_timestamp(),
  executed_at timestamptz not null,
  -- §2.3, frozen at execution. Immutable, because the table is append-only.
  post_approval_due_at timestamptz not null,
  lifecycle_state text not null default 'EXECUTED_PENDING_POST_APPROVAL',
  audit_correlation_id uuid not null default gen_random_uuid(),
  sequence_no bigint generated always as identity,

  -- One authorization per idempotency key. A retry answers with the FIRST
  -- authorization; it never opens a second emergency or a second deadline.
  constraint device_emergency_revocation_authorizations_idempotency_unique
    unique (idempotency_key),
  -- The only key this path evaluates. §2.4 keeps the post-approve key distinct,
  -- so one assignment can never satisfy both halves of the four-eyes control.
  constraint device_emergency_revocation_authorizations_permission_key_chk
    check (permission_key = 'fleet.device_credential.emergency_revoke'),
  -- The three §2.2 emergency reasons whose blast radius decision §3 derives
  -- from the fleet. PROVIDER_COMPROMISE and SECURITY_INCIDENT are emergency
  -- eligible and are NOT servable here (see the header); a row for one of them
  -- would be a set this database never derived.
  constraint device_emergency_revocation_authorizations_reason_code_chk
    check (reason_code in ('KEY_COMPROMISE', 'DEVICE_LOST', 'DEVICE_STOLEN')),
  -- NOT NULL is not enough: an empty string is a missing incident reference
  -- wearing a value (group 0138's reasoning, kept).
  constraint device_emergency_revocation_authorizations_not_blank_chk
    check (btrim(explanation) <> '' and btrim(incident_reference) <> ''
           and btrim(environment) <> '' and btrim(idempotency_key) <> ''
           and btrim(decision_version) <> ''),
  constraint device_emergency_revocation_authorizations_subject_type_chk
    check (subject_type = 'CREDENTIAL'),
  constraint device_emergency_revocation_authorizations_scope_digest_chk
    check (scope_digest ~ '^[0-9a-f]{64}$'),
  -- An emergency that reached no credential is not an emergency that executed.
  constraint device_emergency_revocation_authorizations_identifiers_chk
    check (identifier_count > 0),
  constraint device_emergency_revocation_authorizations_lifecycle_chk
    check (lifecycle_state = 'EXECUTED_PENDING_POST_APPROVAL'),
  -- A deadline at or before the execution is not a deadline.
  constraint device_emergency_revocation_authorizations_deadline_chk
    check (post_approval_due_at > executed_at),
  constraint device_emergency_revocation_authorizations_no_key_material_chk
    check (explanation !~* 'BEGIN [A-Z ]*PRIVATE KEY'
           and incident_reference !~* 'BEGIN [A-Z ]*PRIVATE KEY'
           and explanation !~* '(postgres|postgresql)://')
);

comment on table kitluy_devices.device_emergency_revocation_authorizations is
  'Owner: Security/Fleet. KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.3/§2.4 with KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001. The immutable record of ONE emergency revocation that was AUTHORIZED rather than asserted: the actor resolved from auth.uid() and anchored to auth.users, the permission key evaluated through kitluy_auth.has_permission, the re-authentication evidence SPENT in the same transaction, the mandatory reason and incident reference, and the SHA-256 of the exact affected set the database itself derived. Append-only, because a record whose facts can move afterwards is not evidence. The RPC that writes it takes no actor, no declaring authority and no re-authenticated boolean — the three fields RC-021 proved a caller could assert. MC: A/O.';

comment on column kitluy_devices.device_emergency_revocation_authorizations.scope_digest is
  'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1. SHA-256 of group 0141''s canonical scope bytes over the exact credential set authoritative_revocation_scope_v1 derived from STORED ROWS, bound together with the reason, environment, subject type, tenancy and the acting human. COMPUTED inside the governed boundary and never accepted from a caller. It is also what a replayed idempotency key is compared against: the same key presented for a DIFFERENT affected set is a conflict, not a retry.';

comment on column kitluy_devices.device_emergency_revocation_authorizations.post_approval_due_at is
  'Decision §2.3. Read from credential_revocation_policy.post_approval_window_hours (4) rather than typed here, so the deadline cannot drift by being retyped. RECORDED GAP: this group builds no verdict path and no sweeper for it — group 0138''s lapse sweeper answers only group 0138''s own declarations.';

comment on column kitluy_devices.device_emergency_revocation_authorizations.tenant_id is
  'Currently always NULL, deliberately. The credential governor holds no SELECT on device_assignment_projections, device_assignments or device_claims — reading a device''s tenancy is the activation governor''s privilege — so this path cannot resolve tenancy without a widening no decision authorizes. Recorded rather than guessed (CLAUDE.md rule 9).';

create index if not exists device_emergency_revocation_authorizations_actor_idx
  on kitluy_devices.device_emergency_revocation_authorizations
     (actor_user_id, environment, executed_at desc);

create index if not exists device_emergency_revocation_authorizations_due_idx
  on kitluy_devices.device_emergency_revocation_authorizations
     (environment, post_approval_due_at);

-- ---------------------------------------------------------------------------
-- 2. THE AFFECTED SET, RELATIONALLY.
--
-- One row per credential, not a JSON array on the authorization. A jsonb column
-- can hold a credential id that no longer exists, can hold the same id twice,
-- and cannot be joined to the revocation evidence without parsing. A row with a
-- foreign key can do none of those things, and the UNIQUE pair is what makes
-- "exactly this set, once" a property of the schema rather than of a loop.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_emergency_revocation_scope (
  scope_row_id uuid primary key default gen_random_uuid(),
  authorization_id uuid not null
    references kitluy_devices.device_emergency_revocation_authorizations (authorization_id),
  credential_id uuid not null
    references kitluy_devices.device_credentials (credential_id),
  recorded_at timestamptz not null default clock_timestamp(),
  sequence_no bigint generated always as identity,

  constraint device_emergency_revocation_scope_member_unique
    unique (authorization_id, credential_id)
);

comment on table kitluy_devices.device_emergency_revocation_scope is
  'Owner: Security/Fleet. The exact affected set of one emergency authorization, ONE ROW PER CREDENTIAL with a foreign key to the credential it names. Relational rather than a jsonb array, so the set cannot name a credential that does not exist, cannot name one twice, and can be joined to the append-only revocation evidence to prove that what was revoked is what was authorized. Append-only. MC: A/O.';

create index if not exists device_emergency_revocation_scope_credential_idx
  on kitluy_devices.device_emergency_revocation_scope (credential_id);

-- Append-only on both. Groups 0136/0138/0141/0149 use the same trigger for the
-- same reason: an authorization that can be edited after the fact is a record
-- of what somebody currently says happened.
create trigger trg_device_emergency_revocation_authorizations_append_only
  before update or delete
  on kitluy_devices.device_emergency_revocation_authorizations
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_device_emergency_revocation_scope_append_only
  before update or delete
  on kitluy_devices.device_emergency_revocation_scope
  for each row execute function kitluy_auth.enforce_append_only();

alter table kitluy_devices.device_emergency_revocation_authorizations
  enable row level security;
alter table kitluy_devices.device_emergency_revocation_authorizations
  force row level security;
alter table kitluy_devices.device_emergency_revocation_scope
  enable row level security;
alter table kitluy_devices.device_emergency_revocation_scope
  force row level security;

grant select, insert on kitluy_devices.device_emergency_revocation_authorizations
  to kitluy_credential_issuer;
grant select, insert on kitluy_devices.device_emergency_revocation_scope
  to kitluy_credential_issuer;
grant select on kitluy_devices.device_emergency_revocation_authorizations to service_role;
grant select on kitluy_devices.device_emergency_revocation_scope to service_role;

-- FORCE applies to the owner too, so a forced table with no policy is writable
-- by nobody. These two policies are group 0141's pattern, in `kitluy_devices`,
-- which the section 7 policy census does not count (it counts kitluy_core,
-- kitluy_auth, kitluy_admin and kitluy_audit) — so the number group 0149 moved
-- to 62 is untouched by this migration.
create policy device_emergency_revocation_authorizations_issuer_write
  on kitluy_devices.device_emergency_revocation_authorizations
  for all to kitluy_credential_issuer using (true) with check (true);
create policy device_emergency_revocation_authorizations_service_read
  on kitluy_devices.device_emergency_revocation_authorizations
  for select to service_role using (true);
create policy device_emergency_revocation_scope_issuer_write
  on kitluy_devices.device_emergency_revocation_scope
  for all to kitluy_credential_issuer using (true) with check (true);
create policy device_emergency_revocation_scope_service_read
  on kitluy_devices.device_emergency_revocation_scope
  for select to service_role using (true);

-- ---------------------------------------------------------------------------
-- 3. THE THREE BRIDGES TO `kitluy_auth`.
--
-- Each one asks exactly ONE question, with the permission key and action class
-- written INTO the body, so the governor cannot ask about a different key or
-- spend evidence recorded for a different action. Owned by the NOLOGIN,
-- non-BYPASSRLS approval reader — the only identity in this database that may
-- reach `kitluy_auth` and can see nothing else — and executable by the
-- credential governor and by nothing else, PUBLIC included.
-- ---------------------------------------------------------------------------
grant execute on function kitluy_auth.current_actor_context()
  to kitluy_credential_approval_reader;
grant execute on function kitluy_auth.has_permission(text, text, uuid, text)
  to kitluy_credential_approval_reader;
grant execute on function
  kitluy_auth.consume_reauthentication_evidence_v1(uuid, text, text, uuid)
  to kitluy_credential_approval_reader;

-- WHO is calling. `current_actor_context()` resolves `auth.uid()` from the JWT
-- GUC, so this returns the HUMAN even though the caller is a definer running as
-- the credential governor. A service identity has no JWT and gets NULL, which
-- the RPC refuses before it looks anything up.
create or replace function kitluy_devices.emergency_revocation_actor_v1()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, kitluy_auth
as $emergency_actor$
  select nullif(kitluy_auth.current_actor_context() ->> 'user_id', '')::uuid;
$emergency_actor$;

-- WHETHER they hold the emergency key, for THIS credential, in THIS
-- environment. `has_permission` fails closed on a null actor, refuses a
-- disabled or non-ACTIVE profile before anything else, applies explicit DENY
-- precedence, and gates on the assignment's environment scope.
create or replace function kitluy_devices.emergency_revocation_permitted_v1(
  p_credential_id uuid,
  p_environment text
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, kitluy_auth
as $emergency_permitted$
  select coalesce(kitluy_auth.has_permission(
    'fleet.device_credential.emergency_revoke',
    'device_credential', p_credential_id, p_environment), false);
$emergency_permitted$;

-- WHETHER their re-authentication is spendable, and SPEND it. The action class
-- is fixed here: evidence recorded for
-- `fleet.device_credential.emergency_post_approve` cannot be spent on an
-- execution, which is what keeps one step-up from satisfying both halves of the
-- §2.4 four-eyes control. The 300-second window is enforced inside
-- `consume_reauthentication_evidence_v1` against DATABASE time and is neither
-- read nor passed here.
create or replace function kitluy_devices.emergency_revocation_reauth_spend_v1(
  p_evidence_id uuid,
  p_environment text,
  p_authorization_id uuid
) returns boolean
language sql
security definer
set search_path = pg_catalog, kitluy_auth
as $emergency_spend$
  select coalesce(kitluy_auth.consume_reauthentication_evidence_v1(
    p_evidence_id, 'fleet.device_credential.emergency_revoke',
    p_environment, p_authorization_id), false);
$emergency_spend$;

grant create on schema kitluy_devices to kitluy_credential_approval_reader;
alter function kitluy_devices.emergency_revocation_actor_v1()
  owner to kitluy_credential_approval_reader;
alter function kitluy_devices.emergency_revocation_permitted_v1(uuid, text)
  owner to kitluy_credential_approval_reader;
alter function kitluy_devices.emergency_revocation_reauth_spend_v1(uuid, text, uuid)
  owner to kitluy_credential_approval_reader;
revoke create on schema kitluy_devices from kitluy_credential_approval_reader;

revoke all on function kitluy_devices.emergency_revocation_actor_v1() from public;
revoke all on function kitluy_devices.emergency_revocation_permitted_v1(uuid, text) from public;
revoke all on function
  kitluy_devices.emergency_revocation_reauth_spend_v1(uuid, text, uuid) from public;
grant execute on function kitluy_devices.emergency_revocation_actor_v1()
  to kitluy_credential_issuer;
grant execute on function kitluy_devices.emergency_revocation_permitted_v1(uuid, text)
  to kitluy_credential_issuer;
grant execute on function
  kitluy_devices.emergency_revocation_reauth_spend_v1(uuid, text, uuid)
  to kitluy_credential_issuer;

comment on function kitluy_devices.emergency_revocation_actor_v1() is
  'Answers ONE question — which authenticated human is calling — for the governed emergency RPC, which runs as kitluy_credential_issuer and deliberately holds no USAGE on kitluy_auth or on auth (sections 42/43/44 assert it, and the governor cannot even call auth.uid() directly: verified by execution). SECURITY DEFINER owned by the NOLOGIN, non-BYPASSRLS kitluy_credential_approval_reader, pinned search_path, no dynamic SQL, no writes, returns a uuid and never a row. NULL for a service identity, which the RPC refuses.';

comment on function kitluy_devices.emergency_revocation_permitted_v1(uuid, text) is
  'Answers ONE question — does the CURRENT authenticated human hold fleet.device_credential.emergency_revoke for this credential in this environment. The permission key is written into the body, so the credential governor can ask this question and cannot ask a different one. Fails closed on a null actor, a disabled or non-ACTIVE profile, an explicit DENY and an out-of-scope environment. SECURITY DEFINER owned by kitluy_credential_approval_reader; EXECUTE revoked from PUBLIC and granted only to the credential governor.';

comment on function kitluy_devices.emergency_revocation_reauth_spend_v1(uuid, text, uuid) is
  'Spends the caller''s re-authentication evidence for the EXECUTE action class exactly once, inside the caller''s transaction, and returns a boolean rather than raising. The action class is fixed in the body: post-approval evidence cannot be spent on an execution, which is the binding that stops one step-up authorizing both halves of the §2.4 four-eyes control. The governed 300-second window is enforced by consume_reauthentication_evidence_v1 against DATABASE time; it is not read here, not passed here and cannot be widened here. Because the UPDATE lives in the caller''s transaction, an emergency that rolls back leaves the evidence ACTIVE with its ORIGINAL expiry.';

-- ---------------------------------------------------------------------------
-- 4. THE GOVERNED EMERGENCY ENTRY POINT.
--
-- SECURITY DEFINER owned by the credential governor, because it must write the
-- credential state, the append-only revocation evidence and the recovery cases.
-- SECURITY INVOKER would run as `authenticated`, which holds none of those and
-- must never hold them.
--
-- EXECUTE is granted to `authenticated` — the human's own session — and to
-- nothing else. That is the point: the authority is evaluated against the
-- session, so the session has to be the human's.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.revoke_device_credential_emergency_governed_v1(
  p_credential_id uuid,
  p_reason_code kitluy_devices.credential_revocation_reason,
  p_explanation text,
  p_incident_reference text,
  p_reauth_evidence_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $governed_emergency$
declare
  c_permission constant text := 'fleet.device_credential.emergency_revoke';
  c_decision constant text := 'KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001';
  c_source constant text := 'GOVERNED_EMERGENCY_RPC';
  -- §2.4 sends every emergency case to a human. NO_RECOVERY would leave an
  -- emergency revocation with nothing owed and nobody looking.
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
  v_target kitluy_devices.device_credentials;
  v_row kitluy_devices.device_credential_revocations;
  v_revoked integer := 0;
  v_id uuid;
begin
  -- 1. WHO. No authenticated human, no emergency. A service identity has no
  --    auth.uid() and is stopped here rather than somewhere later.
  v_actor := kitluy_devices.emergency_revocation_actor_v1();
  if v_actor is null then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NO-AUTHENTICATED-ACTOR',
      'detail', 'an emergency revocation is executed by a named authenticated human, not by a service identity');
  end if;

  -- 2. §2.2: only the five reasons that mean a private key may be in hands the
  --    operator does not control. Dressing an administrative replacement as an
  --    emergency is exactly the abuse §2.1 exists to prevent.
  if p_reason_code not in ('KEY_COMPROMISE', 'DEVICE_LOST', 'DEVICE_STOLEN',
                           'PROVIDER_COMPROMISE', 'SECURITY_INCIDENT') then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-REASON-NOT-ELIGIBLE',
      'detail', format('decision §2.1 requires a completed prior approval for %s', p_reason_code));
  end if;

  -- 3. §2.3: a mandatory explanation and a mandatory incident reference,
  --    neither satisfiable with blanks.
  if coalesce(btrim(p_explanation), '') = ''
     or coalesce(btrim(p_incident_reference), '') = '' then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-INCOMPLETE',
      'detail', 'decision §2.3 requires a mandatory reason and an incident reference on every emergency revocation');
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
      'detail', 'decision §2.3 requires re-authentication, and the evidence it produced must be presented');
  end if;

  -- 5 BEFORE 4, and deliberately. The permission is evaluated in the
  --   CREDENTIAL'S environment, which only the credential row knows; a caller
  --   that could name the environment could name one it happens to hold. The
  --   row is LOCKED here because the affected set is derived from fleet state
  --   and must not move between deriving it and revoking it.
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

  -- 4. THE AUTHORITY QUESTION RC-021 EXISTS FOR. Asked of kitluy_auth through
  --    the constrained reader, evaluated against the session, and answered no
  --    by default.
  if not kitluy_devices.emergency_revocation_permitted_v1(p_credential_id, v_env) then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-UNAUTHORIZED',
      'detail', format('the authenticated human does not hold %s for this credential in %s',
                       c_permission, v_env));
  end if;

  -- 6. §3: these two take a RECORDED incident-defined set and cannot be derived
  --    from the fleet at all. Refused with their own code rather than routed
  --    through a derivation that would have to invent one.
  if p_reason_code in ('PROVIDER_COMPROMISE', 'SECURITY_INCIDENT') then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-SCOPE-NOT-FLEET-DERIVABLE',
      'detail', 'decision §3 gives this reason an explicitly recorded incident-defined affected set; a governed path that SPENDS one is not built yet, and deriving a blast radius during an incident is not an acceptable substitute');
  end if;

  -- THE BLAST RADIUS IS THE DATABASE'S ANSWER. `authoritative_revocation_scope_v1`
  -- takes a credential id and a reason and nothing else — no fingerprint, no
  -- provider key reference, no assignment generation — so no parameter of this
  -- function can describe the fleet to it (RC-019).
  v_scope := kitluy_devices.authoritative_revocation_scope_v1(p_credential_id, p_reason_code);

  select * into v_prior
    from kitluy_devices.device_emergency_revocation_authorizations
   where idempotency_key = p_idempotency_key;

  if coalesce((v_scope ->> 'resolved')::boolean, false) is not true then
    -- 8, THE RETRY THAT MATTERS. A successful emergency CHANGES the fleet the
    -- set was derived from: every member is now revoked, so the same request
    -- replayed derives an EMPTY set. Comparing digests here would call a
    -- genuine retry a conflict, so the retry is recognised by its subject
    -- instead — same key, same human, same reason, same environment, and the
    -- credential named is one this authorization actually reached.
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
        'note', 'this idempotency key already authorized this emergency; no second emergency and no second deadline were opened');
    end if;
    -- 7. §3.2: fail closed. Nothing is written and nothing is guessed.
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', coalesce(v_scope ->> 'refusal_code', 'KLUY-EMERGENCY-SCOPE-UNRESOLVED'),
      'detail', v_scope ->> 'detail');
  end if;

  select array_agg(value::uuid order by value::uuid) into v_ids
    from jsonb_array_elements_text(v_scope -> 'credential_ids');
  v_ids := coalesce(v_ids, array[]::uuid[]);

  -- 7. An empty affected set is an unrestricted one (§3.1).
  if cardinality(v_ids) = 0 then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-SCOPE-EMPTY',
      'detail', 'the authoritative affected set is empty, and an empty set is an unrestricted one');
  end if;
  -- The set must contain the credential the human named. A derivation that
  -- reached everything EXCEPT the subject would be answering a different
  -- question from the one asked.
  if not (p_credential_id = any (v_ids)) then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-SCOPE-NOT-IN-SET',
      'detail', 'the authoritative affected set does not contain the credential this emergency names');
  end if;

  -- The digest the record commits to. Group 0141's canonical form, so the
  -- emergency path and the approval path cannot produce different bytes for the
  -- same set. The acting human is a term of it, so one idempotency key cannot
  -- be shared between two people.
  v_digest := kitluy_devices.revocation_scope_digest_v1(
    kitluy_devices.canonical_revocation_scope_v1(
      p_reason_code, v_env, 'CREDENTIAL', v_tenant, v_store, v_location,
      v_actor::text, c_decision,
      array[]::uuid[], array[]::text[], array[]::text[], v_ids));

  -- 8. The same key for a DIFFERENT affected set is a conflict, not a retry.
  if v_prior.authorization_id is not null then
    if v_prior.scope_digest = v_digest then
      return jsonb_build_object(
        'outcome', 'ALREADY_AUTHORIZED',
        'authorization_id', v_prior.authorization_id,
        'revoked_credential_count', v_prior.identifier_count,
        'post_approval_due_at', to_char(v_prior.post_approval_due_at at time zone 'UTC',
                                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'note', 'this idempotency key already authorized this emergency; no second emergency and no second deadline were opened');
    end if;
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-CONFLICTING-REPLAY',
      'detail', 'this idempotency key already authorized a DIFFERENT affected set; a changed blast radius is a new emergency, not a retry of the old one');
  end if;

  -- 9. §2.3's deadline, read from the governed policy rather than typed here.
  select post_approval_window_hours into v_window
    from kitluy_devices.credential_revocation_policy
   where environment = v_env;
  if v_window is null then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NO-POLICY',
      'detail', format('no revocation policy governs environment %s, so no post-approval deadline can be issued', v_env));
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

  -- 10. EXACTLY those credentials, and no others. The same append-only evidence
  --     group 0136 defined and group 0138 writes, under the same one-way
  --     trigger; see the header for why neither committed entry point could be
  --     called instead.
  foreach v_id in array v_ids loop
    select * into v_target from kitluy_devices.device_credentials
     where credential_id = v_id
     for update;
    -- Cannot happen: the derivation excludes revoked credentials and the rows
    -- are locked. Skipped rather than overwritten if it ever does, because the
    -- first account of why a credential was repudiated is not rewritten by the
    -- second person to notice (group 0136's ruling, kept).
    if v_target.state = 'revoked' then
      continue;
    end if;

    insert into kitluy_devices.device_credential_revocations (
      revocation_request_id, credential_id, device_record_id, environment, purpose,
      credential_generation, public_key_fingerprint, reason_code, reason,
      requested_by, source, incident_reference, recovery_disposition, scope_rule)
    values (
      format('EMG-%s#%s', v_authorization, v_id), v_id, v_target.device_record_id,
      v_target.environment, v_target.purpose, v_target.certificate_generation,
      v_target.public_key_fingerprint, p_reason_code, p_explanation,
      v_actor::text, c_source, p_incident_reference, c_disposition,
      v_scope ->> 'scope_rule')
    returning * into v_row;

    -- `revoked_at` is written WITH the state: group 0125 pairs them by CHECK,
    -- and a state without its timestamp is a failed revocation, not a partial
    -- one (the group 0139 lesson).
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

  -- 11. THE EVIDENCE IS SPENT LAST AND ATOMICALLY. It is bound to this
  --     authorization id, so the evidence row says WHAT it authorized. A refusal
  --     here RAISES rather than returns: everything above — the authorization,
  --     the scope, the revocations, the recovery cases — must disappear with it,
  --     and the evidence must stay ACTIVE with its ORIGINAL expiry so a failed
  --     attempt neither spends it nor buys more time.
  if not kitluy_devices.emergency_revocation_reauth_spend_v1(
           p_reauth_evidence_id, v_env, v_authorization) then
    raise exception
      'KLUY-EMERGENCY-REAUTHENTICATION-REFUSED: the re-authentication evidence presented is not a spendable, in-window, same-human, same-environment step-up for %',
      c_permission
      using errcode = 'insufficient_privilege';
  end if;

  -- 12. The outcome, the authorization, the count, the deadline. Never the
  --     affected identifiers, never the digest, never the scope rule: a caller
  --     that learns the derived set learns which other credentials share a key,
  --     and this function answers what it did, not what it found.
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
  uuid, kitluy_devices.credential_revocation_reason, text, text, uuid, text)
  owner to kitluy_credential_issuer;
revoke all on function kitluy_devices.revoke_device_credential_emergency_governed_v1(
  uuid, kitluy_devices.credential_revocation_reason, text, text, uuid, text) from public;
grant execute on function kitluy_devices.revoke_device_credential_emergency_governed_v1(
  uuid, kitluy_devices.credential_revocation_reason, text, text, uuid, text)
  to authenticated;

comment on function kitluy_devices.revoke_device_credential_emergency_governed_v1(
  uuid, kitluy_devices.credential_revocation_reason, text, text, uuid, text) is
  'RC-021. The emergency revocation entry point that VERIFIES authority instead of accepting it (KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.2/§2.3/§2.4, KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001). Its SIGNATURE is the remedy: no actor, no declaring authority, no re-authenticated boolean, no fingerprint, no provider key reference, no assignment generation and no affected-set array — the three fields group 0138 accepted from the caller are the fields RC-021 proved a caller could assert. The actor is resolved from auth.uid(), the authority from kitluy_auth.has_permission evaluated in the CREDENTIAL''S environment, the freshness from re-authentication evidence spent once and bound to this authorization, and the blast radius from authoritative_revocation_scope_v1, which reads STORED ROWS and takes no parameter through which a caller could describe the fleet. Exactly the derived set is revoked, one immutable authorization and one relational scope row per credential are written, and the §2.3 deadline is read from the governed policy. A refused re-authentication RAISES, so the whole emergency rolls back and the evidence stays ACTIVE with its ORIGINAL expiry. EXECUTE is granted to `authenticated` — the human''s own session, which is what the authority is evaluated against — and revoked from PUBLIC. It does NOT close RC-021 on its own: group 0138''s ungoverned emergency function is still granted, and only a migration that re-homes the seven assertion sites may take that grant away.';

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
  execute format('revoke kitluy_credential_approval_reader from %I', current_user);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- 5. ASSERTIONS, by execution rather than by assumption. The behavioural proof
--    lives in `supabase/tests/assertions.sql`; what is checked here is the
--    shape that behaviour depends on, after the hand-back so it describes what
--    this migration LEAVES.
-- ---------------------------------------------------------------------------
do $assert_0150$
declare
  v_findings text[] := array[]::text[];
  v_sig constant text :=
    'kitluy_devices.revoke_device_credential_emergency_governed_v1(uuid, '
    || 'kitluy_devices.credential_revocation_reason, text, text, uuid, text)';
  v_args text;
  v_rel text;
  v_fn text;
  v_role text;
begin
  -- The signature carries none of the fields a caller could assert.
  v_args := pg_get_function_arguments(v_sig::regprocedure);
  if v_args ~* 'actor' or v_args ~* 'authority' or v_args ~* 'reauthenticated'
     or v_args ~* 'fingerprint' or v_args ~* 'key_reference'
     or v_args ~* 'assignment_generation' or v_args ~* 'affected'
     or v_args ~* 'declar' then
    v_findings := v_findings ||
      format('the governed emergency RPC still accepts an assertable field: %s', v_args)::text;
  end if;

  -- The governed window is NOT retyped anywhere in this group's bodies.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'kitluy_devices'
         and p.proname in ('revoke_device_credential_emergency_governed_v1',
                           'emergency_revocation_actor_v1',
                           'emergency_revocation_permitted_v1',
                           'emergency_revocation_reauth_spend_v1')
         and pg_get_functiondef(p.oid) ~ '\m300\M') > 0 then
    v_findings := v_findings ||
      'a 300 literal appears in a group 0150 function body instead of being read from policy'::text;
  end if;

  -- The human's session reaches it; nothing wider does.
  if not has_function_privilege('authenticated', v_sig, 'execute') then
    v_findings := v_findings ||
      'the authenticated human cannot execute the governed emergency entry point'::text;
  end if;
  foreach v_role in array array['public', 'anon', 'service_role',
                                'kitluy_issuance_service', 'kitluy_worker_service'] loop
    if has_function_privilege(v_role, v_sig, 'execute') then
      v_findings := v_findings ||
        format('%s can execute the governed emergency entry point', v_role)::text;
    end if;
  end loop;

  -- Ownership and shape: the entry point is the governor's, the three bridges
  -- are the reader's, and every one of them pins search_path and is invisible
  -- to PUBLIC.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'kitluy_devices'
                    and p.proname = 'revoke_device_credential_emergency_governed_v1'
                    and p.prosecdef
                    and pg_get_userbyid(p.proowner) = 'kitluy_credential_issuer') then
    v_findings := v_findings ||
      'the governed emergency entry point is not a governor-owned SECURITY DEFINER'::text;
  end if;
  foreach v_fn in array array['emergency_revocation_actor_v1',
                              'emergency_revocation_permitted_v1',
                              'emergency_revocation_reauth_spend_v1'] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'kitluy_devices' and p.proname = v_fn
                      and p.prosecdef
                      and pg_get_userbyid(p.proowner) = 'kitluy_credential_approval_reader'
                      and p.proconfig is not null
                      and exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%')) then
      v_findings := v_findings ||
        format('%s is not a reader-owned SECURITY DEFINER with a pinned search_path', v_fn)::text;
    end if;
    if (select bool_or(has_function_privilege('public', p.oid, 'execute'))
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'kitluy_devices' and p.proname = v_fn) then
      v_findings := v_findings || format('PUBLIC can execute %s', v_fn)::text;
    end if;
    if (select bool_or(has_function_privilege('authenticated', p.oid, 'execute'))
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'kitluy_devices' and p.proname = v_fn) then
      v_findings := v_findings ||
        format('the browser-facing role can execute the kitluy_auth bridge %s', v_fn)::text;
    end if;
  end loop;

  -- The two new tables carry RLS ENABLED AND FORCED and refuse UPDATE/DELETE.
  foreach v_rel in array array['device_emergency_revocation_authorizations',
                               'device_emergency_revocation_scope'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'kitluy_devices' and c.relname = v_rel
                      and c.relrowsecurity and c.relforcerowsecurity) then
      v_findings := v_findings || format('%s does not have RLS ENABLED and FORCED', v_rel)::text;
    end if;
    if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                    join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'kitluy_devices' and c.relname = v_rel
                     and not t.tgisinternal
                     and t.tgname like '%append_only') then
      v_findings := v_findings || format('%s carries no append-only trigger', v_rel)::text;
    end if;
    if exists (select 1 from pg_policies
                where schemaname = 'kitluy_devices' and tablename = v_rel
                  and 'anon' = any (roles::text[])) then
      v_findings := v_findings || format('%s is readable by anon', v_rel)::text;
    end if;
  end loop;

  -- The boundary sections 42/43/44 depend on is UNTOUCHED: the governor still
  -- holds nothing whatsoever on kitluy_auth, and the reader gained EXECUTE on
  -- three functions and not one table or column privilege.
  if has_schema_privilege('kitluy_credential_issuer', 'kitluy_auth', 'usage') then
    v_findings := v_findings ||
      'the credential governor now reaches kitluy_auth directly'::text;
  end if;
  if (select count(*) from (
        select privilege_type from information_schema.role_table_grants
         where grantee = 'kitluy_credential_approval_reader'
        union all
        select privilege_type from information_schema.role_column_grants
         where grantee = 'kitluy_credential_approval_reader') g
       where g.privilege_type <> 'SELECT') <> 0 then
    v_findings := v_findings ||
      'the approval reader gained a non-SELECT table or column privilege'::text;
  end if;
  if (select count(*) from pg_policies
       where 'kitluy_credential_approval_reader' = any (roles::text[])) <> 3 then
    v_findings := v_findings ||
      'the approval reader is named by a number of policies other than Ruling 2''s three'::text;
  end if;

  -- Group 0138's emergency function is STILL granted. Asserted positively, so
  -- the header's claim that RC-021 stays open is checked rather than trusted,
  -- and so the migration that eventually revokes it has to come here and say so.
  if not has_function_privilege('kitluy_issuance_service',
       'kitluy_devices.revoke_device_credential_emergency_v1(text, text, text, '
       || 'kitluy_devices.credential_revocation_reason, text, '
       || 'kitluy_devices.credential_recovery_disposition, text, '
       || 'kitluy_devices.emergency_declaring_authority, boolean, text, text, text, '
       || 'uuid, integer, text, text, integer, uuid[])', 'execute') then
    v_findings := v_findings ||
      'group 0138''s emergency function lost its grant in this migration, which would turn seven assertion sites red'::text;
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL 0150: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;
end
$assert_0150$;
