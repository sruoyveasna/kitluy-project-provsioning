-- kitluy:group:0149
-- Migration group 0149: emergency_reauthentication_evidence.
--
-- Authority: KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001 (owner, 2026-07-30) —
--   emergency revoke and emergency post-approval each require a
--   re-authentication no older than 300 SECONDS.
--   Implements the value RC-024 was raised to obtain.
-- Depends on: group 0148's two permission keys.
--
-- Additive. Groups 0136-0148 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- WHY A TIMESTAMP ON A PROFILE WAS NOT ENOUGH
-- ===========================================================================
-- `kitluy_auth.require_reauthentication(p_max_age_seconds)` already reads
-- `admin_user_profiles.last_reauth_at` for `auth.uid()` and fails closed on a
-- missing or non-ACTIVE profile. That binding is sound and is kept.
--
-- What it cannot do is carry the properties an emergency action needs. It is
-- ONE timestamp per human, so it cannot be bound to an ACTION CLASS, cannot be
-- consumed, cannot be superseded or revoked, and cannot be audit-linked. Under
-- it, one re-authentication would authorize an emergency revocation AND the
-- post-approval of that same revocation — which is the four-eyes control
-- KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.4 requires, defeated by a
-- single step-up. Hence evidence ROWS, bound to a class and spent once.
--
-- ===========================================================================
-- THE 300 SECONDS LIVES IN EXACTLY ONE PLACE
-- ===========================================================================
-- The owner set 300 for both classes. It is stored as reference DATA, not
-- written into function bodies, and it is deliberately NOT an RPC parameter:
-- a caller that could pass a max age could pass 86400. Every RPC, assertion,
-- gateway and worker reads the same row, so the policy cannot drift by being
-- retyped somewhere.

create table if not exists kitluy_auth.sensitive_action_reauth_policy (
  action_class text primary key,
  max_age_seconds integer not null,
  decision_version text not null,
  requires_reauthentication boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  constraint sensitive_action_reauth_policy_age_chk
    check (max_age_seconds > 0 and max_age_seconds <= 3600)
);

comment on table kitluy_auth.sensitive_action_reauth_policy is
  'Owner: Security. KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001. The single governed source of the sensitive-action re-authentication window. Stored as reference data rather than written into function bodies so the number cannot drift by being retyped, and deliberately NOT exposed as an RPC parameter — a caller who could pass a max age could pass a day. MC: A/O.';

insert into kitluy_auth.sensitive_action_reauth_policy
  (action_class, max_age_seconds, decision_version)
values
  ('fleet.device_credential.emergency_revoke', 300, 'KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001'),
  ('fleet.device_credential.emergency_post_approve', 300, 'KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001')
on conflict (action_class) do nothing;

-- Every table in these schemas carries RLS enabled AND forced; the structural
-- assertion refuses one that does not, and it caught this table when it was
-- first added without it. The policy window is reference data every
-- authenticated caller may READ — it is the published rule, not a secret — and
-- nobody may write it outside a migration.
alter table kitluy_auth.sensitive_action_reauth_policy enable row level security;
alter table kitluy_auth.sensitive_action_reauth_policy force row level security;

grant select on kitluy_auth.sensitive_action_reauth_policy to authenticated;

-- No if-exists guard on the policy or the trigger. A migration runs ONCE
-- against a database built from zero, so the guard buys only development
-- convenience — and `migrations:validate` reads a removal statement anywhere in
-- the file, comments included, as destructive and demands an owner-approved
-- marker. Carrying such a marker for objects this same file creates would
-- assert a decision that does not exist. Group 0141 made and corrected the
-- same mistake.
create policy sensitive_action_reauth_policy_read
  on kitluy_auth.sensitive_action_reauth_policy
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- THE EVIDENCE.
--
-- `expires_at` is GENERATED from `verified_at` plus the policy window, so a
-- caller cannot widen its own freshness and an operator cannot extend one by
-- hand. Both timestamps come from the database.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_auth.reauthentication_evidence (
  evidence_id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users (id),
  environment text not null,
  action_class text not null
    references kitluy_auth.sensitive_action_reauth_policy (action_class),
  -- DATABASE time, never a client clock.
  verified_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  authentication_method text not null,
  session_reference text,
  lifecycle_state text not null default 'ACTIVE',
  revoked_at timestamptz,
  superseded_at timestamptz,
  consumed_at timestamptz,
  consumed_for_authorization uuid,
  audit_correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  sequence_no bigint generated always as identity,

  constraint reauthentication_evidence_state_chk
    check (lifecycle_state in ('ACTIVE', 'CONSUMED', 'REVOKED', 'SUPERSEDED', 'EXPIRED')),
  constraint reauthentication_evidence_method_chk
    check (btrim(authentication_method) <> ''),
  constraint reauthentication_evidence_env_chk
    check (btrim(environment) <> ''),
  -- Consumed means consumed FOR something. Evidence spent against nothing is a
  -- row nobody can audit.
  constraint reauthentication_evidence_consumed_chk
    check ((consumed_at is null) = (consumed_for_authorization is null)),
  constraint reauthentication_evidence_window_chk
    check (expires_at > verified_at)
);

comment on table kitluy_auth.reauthentication_evidence is
  'Owner: Security. KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001. Immutable proof that a NAMED authenticated human re-authenticated for ONE action class, within ONE environment, spendable ONCE. Replaces admin_user_profiles.last_reauth_at as authority for emergency actions: that column is one timestamp per human, so it cannot be bound to an action class or consumed, and a single step-up would have authorized both an emergency revocation and its own four-eyes post-approval. Rows are created only through record_reauthentication_evidence_v1, which derives the actor from auth.uid(); there is no path by which a service identity creates evidence for a human. MC: A/O.';

-- Append-only. Group 0141/0136 use the same trigger for the same reason.
create trigger trg_reauthentication_evidence_append_only
  before delete on kitluy_auth.reauthentication_evidence
  for each row execute function kitluy_auth.enforce_append_only();

create index if not exists reauthentication_evidence_actor_idx
  on kitluy_auth.reauthentication_evidence (actor_user_id, action_class, environment)
  where lifecycle_state = 'ACTIVE';

alter table kitluy_auth.reauthentication_evidence enable row level security;
alter table kitluy_auth.reauthentication_evidence force row level security;

-- ---------------------------------------------------------------------------
-- CREATION. The actor is DERIVED, never passed.
--
-- There is no `p_actor_user_id`. That absence is the control: a parameter for
-- the human's identity is exactly how a service identity would assert a
-- delegation it cannot prove, which is the RC-023 defect restated.
-- ---------------------------------------------------------------------------
create or replace function kitluy_auth.record_reauthentication_evidence_v1(
  p_environment text,
  p_action_class text,
  p_authentication_method text,
  p_session_reference text default null
) returns uuid
language plpgsql
security definer
set search_path = kitluy_auth, auth, pg_catalog
as $record_reauth$
declare
  v_actor uuid := auth.uid();
  v_window integer;
  v_id uuid;
begin
  -- No authenticated human, no evidence. A service role calling this has no
  -- auth.uid() and is refused here rather than somewhere later.
  if v_actor is null then
    raise exception 'KLUY-REAUTH-NO-AUTHENTICATED-ACTOR: re-authentication evidence requires an authenticated human session'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from kitluy_auth.admin_user_profiles p
                  where p.user_id = v_actor and p.status = 'ACTIVE' and p.disabled_at is null) then
    raise exception 'KLUY-REAUTH-PROFILE-NOT-ACTIVE: the authenticated human has no ACTIVE profile'
      using errcode = 'insufficient_privilege';
  end if;

  select max_age_seconds into v_window
    from kitluy_auth.sensitive_action_reauth_policy
   where action_class = p_action_class and requires_reauthentication;
  if v_window is null then
    raise exception 'KLUY-REAUTH-UNKNOWN-ACTION-CLASS: % has no governed re-authentication window', p_action_class
      using errcode = 'insufficient_privilege';
  end if;

  insert into kitluy_auth.reauthentication_evidence
    (actor_user_id, environment, action_class, expires_at,
     authentication_method, session_reference)
  values
    (v_actor, p_environment, p_action_class,
     clock_timestamp() + make_interval(secs => v_window),
     p_authentication_method, p_session_reference)
  returning evidence_id into v_id;

  return v_id;
end
$record_reauth$;

revoke all on function kitluy_auth.record_reauthentication_evidence_v1(text, text, text, text) from public;
grant execute on function kitluy_auth.record_reauthentication_evidence_v1(text, text, text, text) to authenticated;

comment on function kitluy_auth.record_reauthentication_evidence_v1(text, text, text, text) is
  'KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001. Records re-authentication evidence for the CURRENT authenticated human. There is deliberately no actor parameter: a parameter for the human''s identity is how a service identity asserts a delegation it cannot prove. Refuses a null auth.uid(), a non-ACTIVE profile and an action class with no governed window. The expiry is computed from the governed policy row and the DATABASE clock, so a caller cannot widen its own freshness. EXECUTE is granted to `authenticated` and revoked from PUBLIC — a service role has no auth.uid() and is refused even if it reached this function.';

-- ---------------------------------------------------------------------------
-- CONSUMPTION. Single use, class-bound, environment-bound, and atomic with
-- whatever it authorized — the caller passes the authorization it was spent on.
-- ---------------------------------------------------------------------------
create or replace function kitluy_auth.consume_reauthentication_evidence_v1(
  p_evidence_id uuid,
  p_action_class text,
  p_environment text,
  p_authorization_id uuid
) returns boolean
language plpgsql
security definer
set search_path = kitluy_auth, auth, pg_catalog
as $consume_reauth$
declare
  v_actor uuid := auth.uid();
  v_row kitluy_auth.reauthentication_evidence;
begin
  if v_actor is null or p_authorization_id is null then
    return false;
  end if;

  -- Locked, so two concurrent actions cannot both spend one row.
  select * into v_row from kitluy_auth.reauthentication_evidence
   where evidence_id = p_evidence_id
   for update;
  if not found then return false; end if;

  -- Every binding, each refused for its own reason rather than as "invalid".
  if v_row.actor_user_id is distinct from v_actor then return false; end if;
  if v_row.action_class is distinct from p_action_class then return false; end if;
  if v_row.environment is distinct from p_environment then return false; end if;
  if v_row.lifecycle_state <> 'ACTIVE' then return false; end if;
  if v_row.consumed_at is not null then return false; end if;
  if v_row.revoked_at is not null or v_row.superseded_at is not null then return false; end if;
  -- Freshness against DATABASE time. `expires_at` was computed from the
  -- governed window at creation and no path updates it.
  if clock_timestamp() > v_row.expires_at then return false; end if;

  update kitluy_auth.reauthentication_evidence
     set consumed_at = clock_timestamp(),
         consumed_for_authorization = p_authorization_id,
         lifecycle_state = 'CONSUMED'
   where evidence_id = p_evidence_id
     and consumed_at is null;

  -- If the action that called this rolls back, so does this UPDATE, and the
  -- evidence stays ACTIVE with its ORIGINAL expiry. A failed attempt neither
  -- spends the evidence nor buys more time with it.
  return found;
end
$consume_reauth$;

revoke all on function kitluy_auth.consume_reauthentication_evidence_v1(uuid, text, text, uuid) from public;

comment on function kitluy_auth.consume_reauthentication_evidence_v1(uuid, text, text, uuid) is
  'KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001. Spends re-authentication evidence exactly once, for one action class, in one environment, for the human who created it, within the governed 300-second window measured on DATABASE time. Locks the row so two concurrent actions cannot both spend it. Returns false rather than raising, so a caller refuses cleanly. Because the UPDATE lives in the caller''s transaction, a rolled-back action leaves the evidence ACTIVE with its ORIGINAL expiry: a failed attempt neither spends it nor buys more time. Class binding is what stops one step-up authorizing both an emergency revocation and its own four-eyes post-approval.';

-- ---------------------------------------------------------------------------
-- ASSERTIONS, by execution.
-- ---------------------------------------------------------------------------
do $assert_0149$
declare
  v_findings text[] := array[]::text[];
  v_n integer;
begin
  select count(*) into v_n from kitluy_auth.sensitive_action_reauth_policy
   where action_class in ('fleet.device_credential.emergency_revoke',
                          'fleet.device_credential.emergency_post_approve')
     and max_age_seconds = 300;
  if v_n <> 2 then
    v_findings := v_findings || format('expected 2 governed 300-second policy rows, found %s', v_n)::text;
  end if;

  -- The window is data, not a literal scattered through function bodies.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'kitluy_auth'
         and p.proname in ('record_reauthentication_evidence_v1',
                           'consume_reauthentication_evidence_v1')
         and pg_get_functiondef(p.oid) ~ '\m300\M') > 0 then
    v_findings := v_findings || 'a 300 literal appears in a re-auth function body instead of being read from policy'::text;
  end if;

  -- No actor parameter on the recorder: the identity must be derived.
  if pg_get_function_arguments(
       'kitluy_auth.record_reauthentication_evidence_v1(text, text, text, text)'::regprocedure) ~* 'actor' then
    v_findings := v_findings || 'the recorder accepts an actor parameter, which would let a service assert a human'::text;
  end if;

  if has_function_privilege('public',
       'kitluy_auth.record_reauthentication_evidence_v1(text, text, text, text)', 'execute') then
    v_findings := v_findings || 'PUBLIC can record re-authentication evidence'::text;
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL 0149: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;
end
$assert_0149$;

-- ---------------------------------------------------------------------------
-- WHAT THIS GROUP DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------------
-- It does not build the governed emergency RPC, does not re-home the seven
-- emergency assertion sites, and does not revoke EXECUTE on
-- `revoke_device_credential_emergency_v1`. RC-021 therefore stays OPEN and the
-- reproduced bypass is still reachable.
--
-- This group supplies the evidence contract those depend on. Revoking the old
-- grant before the governed RPC exists would make emergency revocation
-- unreachable rather than governed, which is its own incident.
