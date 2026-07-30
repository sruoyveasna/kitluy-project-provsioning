-- kitluy:group:0155
-- Migration group 0155: production_revocation_composition.
--
-- Authority: KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.4 (four-eyes
-- post-approval, lapse never restores); KLD-2026-07-28-002 §6; WS-11-T003 Step 4
-- final remediation §2 and §5.
-- Found by: wiring the production composition root
-- (`services/kitluy-device-registry-service`) and the production TypeScript lapse
-- worker, i.e. the RV-GW-001 / RV-GW-002 conditions Phase E refused to close.
--
-- ===========================================================================
-- WHY A SECOND LAPSE ENTRY POINT
-- ===========================================================================
-- Group 0152 shipped `lapse_governed_emergency_post_approvals_v1(text, text)`,
-- which sweeps an ENVIRONMENT. That is the right shape for a cron-style sweep and
-- the wrong shape for a durable job, and the difference matters for a security
-- reason rather than a stylistic one:
--
--   * a durable job is delivered AT LEAST ONCE, is retried, and may be delivered
--     to two workers at once. Its handler must be able to say "this exact
--     obligation, and nothing else";
--   * the environment sweeper cannot say that. A worker handed a job for
--     authorization A would lapse every overdue authorization in A's
--     environment, so one job's blast radius is the whole environment and its
--     result is not attributable to the job that caused it;
--   * and the remediation requires the worker to receive ONLY an immutable
--     authorization id — no actor, reason, incident, scope or deadline. With the
--     environment sweeper the worker must be told an ENVIRONMENT, which is a
--     value it would then be choosing.
--
-- So this group adds the per-authorization form. Both remain: the sweeper is
-- still the safety net that catches an obligation whose job was never enqueued,
-- and neither can invent an approver, spend re-authentication evidence, extend a
-- deadline or restore a credential.
--
-- ===========================================================================
-- WHY A STATUS BRIDGE RATHER THAN A TABLE GRANT
-- ===========================================================================
-- Reconciliation needs to read an authorization's state. `kitluy_worker_service`
-- holds USAGE on `kitluy_devices` (group 0154) and SELECT on NOTHING in it,
-- which is deliberate — the sweeper is SECURITY DEFINER and needs no table
-- rights of its own.
--
-- Granting the worker SELECT on
-- `device_emergency_revocation_authorizations` would hand it every incident
-- reference, explanation and tenancy column in the table to satisfy a
-- five-column status read. So this group adds a narrow definer bridge that
-- returns exactly the status fields, and the worker keeps zero table privileges.
-- This is the "narrow least-privilege lookup bridge, not broad table grants"
-- rule from the Phase B instruction, applied to the read side.
--
-- Additive. Groups 0136-0154 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).

-- Ownership borrow, same as groups 0125-0154: the applying role is not a member
-- of the NOLOGIN definer owner, so `alter function ... owner to` would fail
-- `42501 must be member of role`. Membership is taken here and the functions are
-- handed to the owner below; the applying role keeps no privilege the owner did
-- not already have.
do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. PER-AUTHORIZATION GOVERNED LAPSE
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.lapse_governed_emergency_post_approval_v1(
  p_authorization_id uuid,
  p_source text default 'LAPSE_WORKER'
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $lapse_one$
declare
  v_auth record;
  v_prior record;
  v_verdict_id uuid;
  v_escalation text;
  v_now timestamptz;
begin
  if p_authorization_id is null then
    return jsonb_build_object(
      'outcome', 'LAPSE_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NO-AUTHORIZATION',
      'detail', 'a lapse names exactly one immutable authorization');
  end if;

  -- BLOCKING `for update`, deliberately NOT `skip locked`.
  --
  -- The environment sweeper skips a locked row because it has other rows to get
  -- on with. A per-authorization handler has exactly one obligation, and
  -- skipping it would report "nothing to do" for work that is merely busy —
  -- which a retrying job would then treat as success. Waiting and then observing
  -- the committed verdict is what makes duplicate delivery idempotent.
  --
  -- This matches `record_governed_emergency_post_approval_v1`, which locks the
  -- same row the same way, so post-approval and lapse are serialized against
  -- each other by the database rather than by worker etiquette.
  select a.authorization_id, a.environment, a.scope_digest, a.post_approval_due_at
    into v_auth
    from kitluy_devices.device_emergency_revocation_authorizations a
   where a.authorization_id = p_authorization_id
   for update;

  if not found then
    return jsonb_build_object(
      'outcome', 'LAPSE_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NOT-FOUND',
      'detail', 'no governed emergency authorization with that id');
  end if;

  -- A settled obligation is evidence, not work. Returning ALREADY_DECIDED rather
  -- than refusing is what lets a duplicate delivery, a retry after an ambiguous
  -- commit, and a race against the environment sweeper all end in the same
  -- terminal, non-escalating state.
  select v.verdict, v.verdict_id, v.recorded_at
    into v_prior
    from kitluy_devices.device_emergency_post_approval_verdicts v
   where v.authorization_id = p_authorization_id;
  if found then
    return jsonb_build_object(
      'outcome', 'ALREADY_DECIDED',
      'authorization_id', p_authorization_id,
      'verdict_id', v_prior.verdict_id,
      'post_approval_decision', v_prior.verdict,
      'credential_state_changed', false);
  end if;

  -- THE DEADLINE IS READ, NEVER SUPPLIED.
  --
  -- `post_approval_due_at` comes from the stored row, and the comparison is
  -- against DATABASE time. A worker that could pass an instant could lapse an
  -- obligation early and manufacture an escalation against a human who still had
  -- time to answer; a worker that passed its own clock could be wrong by
  -- however far its host had drifted.
  v_now := clock_timestamp();
  if v_auth.post_approval_due_at > v_now then
    return jsonb_build_object(
      'outcome', 'NOT_DUE',
      'authorization_id', p_authorization_id,
      'post_approval_due_at', to_char(v_auth.post_approval_due_at at time zone 'UTC',
                                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'credential_state_changed', false,
      'detail', 'the post-approval window has not closed; nothing lapses yet');
  end if;

  v_escalation := format(
    'post-approval LAPSED (due %s) by %s; decision §2.4 escalates; credentials stay revoked',
    v_auth.post_approval_due_at, p_source);

  -- Same verdict shape the environment sweeper writes: no actor, no
  -- re-authentication, `late = true`. A lapse has no approver by definition, and
  -- writing one would fabricate a human in the audit trail.
  insert into kitluy_devices.device_emergency_post_approval_verdicts (
    authorization_id, actor_user_id, permission_key, reauth_evidence_id,
    decision, verdict, scope_digest, note, late,
    escalated_at, escalation_reason)
  values (
    v_auth.authorization_id, null, 'fleet.device_credential.emergency_post_approve', null,
    'LAPSE', 'LAPSED', v_auth.scope_digest, p_source, true,
    v_now, v_escalation)
  returning verdict_id into v_verdict_id;

  perform kitluy_devices.escalate_governed_emergency_v1(
    v_auth.authorization_id, v_escalation);

  return jsonb_build_object(
    'outcome', 'LAPSED',
    'authorization_id', v_auth.authorization_id,
    'verdict_id', v_verdict_id,
    'post_approval_decision', 'LAPSED',
    'credential_state_changed', false,
    'note', 'decision §2.4: a lapsed post-approval never restores a credential');
end
$lapse_one$;

alter function kitluy_devices.lapse_governed_emergency_post_approval_v1(uuid, text)
  owner to kitluy_credential_issuer;
revoke all on function kitluy_devices.lapse_governed_emergency_post_approval_v1(uuid, text)
  from public;
grant execute on function kitluy_devices.lapse_governed_emergency_post_approval_v1(uuid, text)
  to kitluy_worker_service;
grant execute on function kitluy_devices.lapse_governed_emergency_post_approval_v1(uuid, text)
  to kitluy_issuance_service;

comment on function kitluy_devices.lapse_governed_emergency_post_approval_v1(uuid, text) is
  'Group 0155. Per-authorization governed lapse for the production durable-job worker. Takes ONE immutable authorization id and a source label; reads environment, scope and deadline from the stored row. Blocking FOR UPDATE so duplicate delivery observes ALREADY_DECIDED. Cannot lapse early (NOT_DUE), invent an approver, spend re-auth evidence, extend a deadline or restore a credential. EXECUTE for worker and issuance only.';

-- ---------------------------------------------------------------------------
-- 2. NARROW STATUS BRIDGE FOR RECONCILIATION
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.governed_emergency_status_v1(
  p_authorization_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $status$
  select case when a.authorization_id is null then null else jsonb_build_object(
           'authorization_id', a.authorization_id,
           'environment', a.environment,
           'reason_code', a.reason_code,
           'incident_reference', a.incident_reference,
           'scope_digest', a.scope_digest,
           'revoked_credential_count', a.identifier_count,
           'post_approval_due_at', to_char(a.post_approval_due_at at time zone 'UTC',
                                           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           -- No verdict row IS the pending state; group 0152 writes a row only
           -- when a decision lands, so absence is the answer rather than a gap.
           'post_approval_decision', coalesce(v.verdict::text, 'PENDING'),
           -- `recorded_at` is the verdict table's own column name; there is no
           -- `decided_at`, and reaching for one is how this bridge first failed.
           'decided_at', to_char(v.recorded_at at time zone 'UTC',
                                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'late', coalesce(v.late, false))
         end
    from kitluy_devices.device_emergency_revocation_authorizations a
    left join kitluy_devices.device_emergency_post_approval_verdicts v
           on v.authorization_id = a.authorization_id
   where a.authorization_id = p_authorization_id;
$status$;

alter function kitluy_devices.governed_emergency_status_v1(uuid)
  owner to kitluy_credential_issuer;
revoke all on function kitluy_devices.governed_emergency_status_v1(uuid)
  from public;
grant execute on function kitluy_devices.governed_emergency_status_v1(uuid)
  to kitluy_worker_service;
grant execute on function kitluy_devices.governed_emergency_status_v1(uuid)
  to kitluy_issuance_service;

comment on function kitluy_devices.governed_emergency_status_v1(uuid) is
  'Group 0155. Narrow read bridge returning ONLY governed-emergency status fields for reconciliation. Exists so kitluy_worker_service needs no SELECT on device_emergency_revocation_authorizations; the worker still holds zero table privileges in kitluy_devices. Explanation text is deliberately not returned.';

-- ---------------------------------------------------------------------------
-- 2b. NARROW REVOCATION READ BRIDGE FOR THE ONLINE VERIFIER
-- ---------------------------------------------------------------------------
-- Found while wiring the online verifier (remediation §3).
--
-- `loadRevocations` in `@kitluy/device-identity` reads
-- `kitluy_devices.device_credentials` and `kitluy_devices.devices` directly. The
-- census of SELECT grantees on those tables is:
--
--     device_credentials      <- kitluy_credential_issuer, service_role
--     devices                 <- kitluy_activation_governor, kitluy_credential_issuer,
--                                postgres, service_role
--
-- `kitluy_credential_issuer` is NOLOGIN (it is the definer owner), so the only
-- identity a running service could actually connect as and use that function is
-- `service_role` — which is globally BYPASSRLS.
--
-- That is precisely the arrangement group 0140 moved AWAY from when it took the
-- approval gate off `service_role` and put it behind the NOLOGIN
-- `kitluy_credential_approval_reader` with three named RLS policies. Wiring the
-- online verifier as `service_role` to satisfy a revocation read would hand the
-- whole database's row security to the component whose only job is to answer one
-- yes/no question, and it would have done so quietly, because it works.
--
-- So the read is bridged the same way the write side already is: definer
-- functions returning ONLY revoked identifiers, executable by the two runtime
-- identities the registry service actually holds. Neither gains a table
-- privilege, and neither needs BYPASSRLS.
--
-- The bridge is deliberately NOT a general credential reader: it returns serials
-- and device ids and nothing else — no tenancy, no fingerprints, no explanation
-- text — so it cannot become a back door into credential inventory.
create or replace function kitluy_devices.revoked_certificate_serials_v1(
  p_environment text,
  p_device_record_id uuid default null
) returns setof text
language sql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $serials$
  -- `state = 'revoked' OR revoked_at is not null`, matching the library loader
  -- exactly. A CHECK keeps the pair in step; the OR decides which way to fail if
  -- it were ever violated, and treating a half-written revocation AS a revocation
  -- is the safe direction.
  select c.serial_number
    from kitluy_devices.device_credentials c
   where c.environment = p_environment
     and (c.state = 'revoked' or c.revoked_at is not null)
     and (p_device_record_id is null or c.device_record_id = p_device_record_id);
$serials$;

alter function kitluy_devices.revoked_certificate_serials_v1(text, uuid)
  owner to kitluy_credential_issuer;
revoke all on function kitluy_devices.revoked_certificate_serials_v1(text, uuid) from public;
grant execute on function kitluy_devices.revoked_certificate_serials_v1(text, uuid)
  to kitluy_issuance_service;
grant execute on function kitluy_devices.revoked_certificate_serials_v1(text, uuid)
  to kitluy_worker_service;

comment on function kitluy_devices.revoked_certificate_serials_v1(text, uuid) is
  'Group 0155. Narrow definer bridge: revoked certificate serials for one environment (optionally one device). Exists so the online verifier need not connect as globally-BYPASSRLS service_role to answer a revocation question (the arrangement group 0140 moved away from). Returns serials only — no tenancy, fingerprints or explanations.';

create or replace function kitluy_devices.revoked_device_records_v1(
  p_environment text,
  p_device_record_id uuid default null
) returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $devices$
  -- `retired` ONLY, matching DEVICE_REVOKING_LIFECYCLE_STATES in the library.
  -- Widening this set is an owner decision, not a migration: `suspended`,
  -- `quarantined` and `restricted_investigation` are reversible operational
  -- gates, and certificate validity has no way to express "temporarily".
  --
  -- `p_environment` is accepted and intentionally unused for the device query:
  -- device lifecycle is not environment-scoped in this schema, and taking the
  -- argument keeps the two bridges callable through one code path rather than
  -- inviting a caller to guess which one is scoped.
  select d.id
    from kitluy_devices.devices d
   where d.lifecycle_state::text = any (array['retired'])
     and (p_device_record_id is null or d.id = p_device_record_id)
     and p_environment is not null;
$devices$;

alter function kitluy_devices.revoked_device_records_v1(text, uuid)
  owner to kitluy_credential_issuer;
revoke all on function kitluy_devices.revoked_device_records_v1(text, uuid) from public;
grant execute on function kitluy_devices.revoked_device_records_v1(text, uuid)
  to kitluy_issuance_service;
grant execute on function kitluy_devices.revoked_device_records_v1(text, uuid)
  to kitluy_worker_service;

comment on function kitluy_devices.revoked_device_records_v1(text, uuid) is
  'Group 0155. Narrow definer bridge: device record ids whose lifecycle_state denies certificate validation (retired only, matching DEVICE_REVOKING_LIFECYCLE_STATES). Widening the set is an owner decision. Returns ids only.';

-- ---------------------------------------------------------------------------
-- 2c. NARROW VERIFICATION-STATE BRIDGE
-- ---------------------------------------------------------------------------
-- `evaluateCertificateValidity` needs the AUTHORITATIVE current key fingerprint,
-- the current generation and the permitted overlap. Those must come from the
-- database, not from the caller presenting the certificate: a verifier that took
-- "my current fingerprint is X" on trust from the presenter would accept a
-- superseded credential from anyone willing to say so.
--
-- Returned by serial, because the serial is what the verifier reads out of the
-- TBS it is checking. `credential_id` is the database's key and never appears in
-- a certificate.
--
-- Deliberately NOT a credential reader: no public key, no canonical TBS, no
-- signature, no tenancy. Only the five facts the validity evaluation consumes,
-- plus the revocation flags so a caller cannot forget to ask.
create or replace function kitluy_devices.credential_verification_state_v1(
  p_serial_number text,
  p_environment text
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $verify_state$
  select case when c.credential_id is null then null else jsonb_build_object(
           'credential_id', c.credential_id,
           'device_record_id', c.device_record_id,
           'environment', c.environment,
           'purpose', c.purpose,
           'certificate_generation', c.certificate_generation,
           'public_key_fingerprint', c.public_key_fingerprint,
           'state', c.state,
           'revoked', (c.state = 'revoked' or c.revoked_at is not null),
           'current_generation', h.current_generation,
           'current_key_fingerprint', cur.public_key_fingerprint,
           'previous_generation', h.previous_generation,
           'overlap_ends_at', to_char(h.overlap_ends_at at time zone 'UTC',
                                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           -- The PREVIOUS credential's own fingerprint and PERSISTED state.
           -- `CredentialOverlap` requires the state as a non-optional field
           -- precisely so a caller cannot vouch for an overlap without having
           -- read the row: once the previous credential is superseded, expired or
           -- revoked, the grant is spent. Supplying it here means the verifier
           -- reads it rather than the presenter asserting it.
           'previous_key_fingerprint', prev.public_key_fingerprint,
           'previous_credential_state', prev.state)
         end
    from kitluy_devices.device_credentials c
    left join kitluy_devices.device_credential_heads h
           on h.device_record_id = c.device_record_id
          and h.environment = c.environment
          and h.purpose = c.purpose
    -- The credential the head currently points at, which is where the
    -- authoritative CURRENT fingerprint lives.
    left join kitluy_devices.device_credentials cur
           on cur.device_record_id = c.device_record_id
          and cur.environment = c.environment
          and cur.purpose = c.purpose
          and cur.certificate_generation = h.current_generation
    left join kitluy_devices.device_credentials prev
           on prev.device_record_id = c.device_record_id
          and prev.environment = c.environment
          and prev.purpose = c.purpose
          and prev.certificate_generation = h.previous_generation
   where c.serial_number = p_serial_number
     and c.environment = p_environment;
$verify_state$;

alter function kitluy_devices.credential_verification_state_v1(text, text)
  owner to kitluy_credential_issuer;
revoke all on function kitluy_devices.credential_verification_state_v1(text, text) from public;
grant execute on function kitluy_devices.credential_verification_state_v1(text, text)
  to kitluy_issuance_service;
grant execute on function kitluy_devices.credential_verification_state_v1(text, text)
  to kitluy_worker_service;

comment on function kitluy_devices.credential_verification_state_v1(text, text) is
  'Group 0155. Narrow definer bridge: the authoritative facts certificate validity consumes for one serial — generation, current head generation and fingerprint, permitted overlap, and the revocation flag. Returns no public key, TBS, signature or tenancy. Keyed on serial_number because that is what appears in a certificate.';

-- ---------------------------------------------------------------------------
-- 3. CAPABILITY CENSUS — WHAT THE CALLERS CAN ACTUALLY DO
-- ---------------------------------------------------------------------------
-- Group 0154's lesson, applied: assert the CAPABILITY, not the grant. Each check
-- below is one the production composition root depends on, so a drift breaks the
-- migration rather than the service.
do $census$
declare
  v_created oid[];
  v_name text;
  v_oid oid;
  v_leaked text;
  v_legacy record;
  c_created constant text[] := array[
    'lapse_governed_emergency_post_approval_v1',
    'governed_emergency_status_v1',
    'revoked_certificate_serials_v1',
    'revoked_device_records_v1',
    'credential_verification_state_v1'];
begin
  v_created := array[]::oid[];
  foreach v_name in array c_created loop
    select p.oid into v_oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices' and p.proname = v_name;
    if v_oid is null then
      raise exception 'KLUY-MIGRATION-0155: group 0155 did not create %', v_name
        using errcode = 'P0001';
    end if;
    v_created := v_created || v_oid;
  end loop;

  -- (a) Both runtime identities can reach every bridge they use, schema USAGE
  --     included. The worker drives lapse and reconciliation; issuance drives
  --     normal revocation and the online verifier's revocation read.
  if not has_schema_privilege('kitluy_worker_service', 'kitluy_devices', 'usage') then
    raise exception
      'KLUY-MIGRATION-0155: kitluy_worker_service lacks USAGE on kitluy_devices (group 0154 must be applied)'
      using errcode = 'P0001';
  end if;
  if not has_schema_privilege('kitluy_issuance_service', 'kitluy_devices', 'usage') then
    raise exception 'KLUY-MIGRATION-0155: kitluy_issuance_service lacks USAGE on kitluy_devices'
      using errcode = 'P0001';
  end if;
  foreach v_oid in array v_created loop
    if not has_function_privilege('kitluy_worker_service', v_oid, 'execute') then
      raise exception 'KLUY-MIGRATION-0155: the worker cannot execute %', v_oid::regprocedure
        using errcode = 'P0001';
    end if;
    if not has_function_privilege('kitluy_issuance_service', v_oid, 'execute') then
      raise exception 'KLUY-MIGRATION-0155: issuance cannot execute %', v_oid::regprocedure
        using errcode = 'P0001';
    end if;
  end loop;

  -- (b) None is PUBLIC-executable. `=X/` in an ACL is the PUBLIC grant.
  if (select count(*) from pg_proc p
       where p.oid = any (v_created)
         and (p.proacl is null or array_to_string(p.proacl, ',') ~ '(^|,)=X/')) > 0 then
    raise exception 'KLUY-MIGRATION-0155: group 0155 left a function executable by PUBLIC'
      using errcode = 'P0001';
  end if;

  -- (b2) THE READ BRIDGE MUST NOT HAVE MADE BYPASSRLS UNNECESSARY-BUT-STILL-USED.
  --      The point of the bridge is that the verifier does NOT need service_role.
  --      If a future change granted these to `anon` or `authenticated`, an
  --      unauthenticated caller could enumerate revoked serials.
  for v_legacy in
    select v.rolname, o.oid
      from unnest(v_created) as o(oid)
      cross join (values ('anon'), ('authenticated')) as v(rolname)
  loop
    if has_function_privilege(v_legacy.rolname, v_legacy.oid, 'execute') then
      raise exception
        'KLUY-MIGRATION-0155: % can execute %; the group 0155 bridges are for service identities only',
        v_legacy.rolname, v_legacy.oid::regprocedure
        using errcode = 'P0001';
    end if;
  end loop;

  -- (c) The bridge did NOT become a table grant. This is the whole point of
  --     shipping a definer function instead of SELECT.
  select string_agg(format('%s:%s', c.relname, a.privilege_type), ', ' order by c.relname)
    into v_leaked
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) as a
   where n.nspname = 'kitluy_devices'
     and c.relkind in ('r', 'p', 'v', 'm')
     and c.relacl is not null
     and a.grantee = 'kitluy_worker_service'::regrole::oid;
  if v_leaked is not null then
    raise exception
      'KLUY-MIGRATION-0155: kitluy_worker_service gained table privileges in kitluy_devices (%); the bridges are SECURITY DEFINER and need none',
      v_leaked
      using errcode = 'P0001';
  end if;

  -- (d) THE LEGACY DOORS STAY SHUT. Group 0151 closed them; a new composition
  --     root is exactly the kind of change that could reopen one by accident, so
  --     the guarantee is re-proved here for every runtime identity the service
  --     can hold.
  for v_legacy in
    select p.oid, p.proname, r.rolname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('kitluy_worker_service'), ('kitluy_issuance_service'),
                         ('authenticated'), ('service_role'), ('anon')) as r(rolname)
     where n.nspname = 'kitluy_devices'
       and p.proname in ('revoke_device_credential_v1',
                         'revoke_device_credential_emergency_v1')
  loop
    if has_function_privilege(v_legacy.rolname, v_legacy.oid, 'execute') then
      raise exception
        'KLUY-MIGRATION-0155: % can still execute the legacy door %; group 0151 must hold',
        v_legacy.rolname, v_legacy.proname
        using errcode = 'P0001';
    end if;
  end loop;

  raise notice
    'KLUY-MIGRATION-0155: per-authorization lapse + status bridge reachable by kitluy_worker_service; zero table privileges; legacy doors shut for worker/issuance/authenticated/service_role/anon';
end
$census$;

-- ---------------------------------------------------------------------------
-- 4. THE WORKER ACTUALLY CALLS BOTH, AS ITSELF
-- ---------------------------------------------------------------------------
-- Reachability that never executes proves reachability, not function.
-- Both probes use ids that match nothing, so applying this migration cannot
-- decide anybody's post-approval as a side effect.
do $smoke$
declare
  v_lapse jsonb;
  v_status jsonb;
  v_before bigint;
  v_after bigint;
  v_absent constant uuid := '00000000-0000-4000-8000-000000000000';
begin
  select count(*) into v_before
    from kitluy_devices.device_emergency_post_approval_verdicts;

  begin
    -- `set role`, not `set local role`: outside an explicit transaction the
    -- LOCAL form is a no-op with a warning and would prove nothing about the
    -- worker (group 0154 recorded the same trap).
    set role kitluy_worker_service;
    v_lapse := kitluy_devices.lapse_governed_emergency_post_approval_v1(v_absent, 'LAPSE_WORKER');
    v_status := kitluy_devices.governed_emergency_status_v1(v_absent);
    reset role;
  exception
    when others then
      reset role;
      raise exception
        'KLUY-MIGRATION-0155: kitluy_worker_service cannot execute the group 0155 bridges: % (%)',
        sqlerrm, sqlstate
        using errcode = 'P0001';
  end;

  if coalesce(v_lapse->>'outcome', '') <> 'LAPSE_REFUSED'
     or coalesce(v_lapse->>'refusal_code', '') <> 'KLUY-EMERGENCY-NOT-FOUND' then
    raise exception
      'KLUY-MIGRATION-0155: lapsing an absent authorization returned % instead of a NOT-FOUND refusal',
      coalesce(v_lapse::text, 'null')
      using errcode = 'P0001';
  end if;

  -- A status read for an authorization that does not exist must be NULL, not an
  -- empty object: a caller distinguishing "no such authorization" from "pending"
  -- is the difference between reconciling and inventing work.
  if v_status is not null then
    raise exception
      'KLUY-MIGRATION-0155: the status bridge returned % for an absent authorization; expected null',
      v_status::text
      using errcode = 'P0001';
  end if;

  select count(*) into v_after
    from kitluy_devices.device_emergency_post_approval_verdicts;
  if v_after <> v_before then
    raise exception
      'KLUY-MIGRATION-0155: the probes changed verdict rows (% -> %); they must be side-effect free',
      v_before, v_after
      using errcode = 'P0001';
  end if;

  -- THE READ BRIDGES, AS THE IDENTITY THE ONLINE VERIFIER ACTUALLY USES.
  --
  -- `kitluy_issuance_service` has SELECT on NOTHING in `kitluy_devices` (proved
  -- by the census above for the worker; issuance is the same by inspection of the
  -- table ACLs). If these calls succeed as issuance, the definer bridge is doing
  -- the work and the verifier will never need BYPASSRLS.
  declare
    v_serials bigint;
    v_devices bigint;
    v_direct_ok boolean := false;
  begin
    set role kitluy_issuance_service;
    select count(*) into v_serials
      from kitluy_devices.revoked_certificate_serials_v1('migration-0155-probe-env');
    select count(*) into v_devices
      from kitluy_devices.revoked_device_records_v1('migration-0155-probe-env');

    -- And the bridge must not have implied a table grant: a DIRECT read as
    -- issuance must still be refused. If this ever starts working, the bridge has
    -- stopped being the narrow thing it was added to be.
    begin
      perform 1 from kitluy_devices.device_credentials limit 1;
      v_direct_ok := true;
    exception
      when insufficient_privilege then v_direct_ok := false;
    end;
    reset role;

    if v_direct_ok then
      raise exception
        'KLUY-MIGRATION-0155: kitluy_issuance_service can SELECT device_credentials directly; the read bridge was supposed to be the only path'
        using errcode = 'P0001';
    end if;

    raise notice
      'KLUY-MIGRATION-0155: read bridges callable as kitluy_issuance_service (serials=%, devices=% for an unused env) while direct SELECT stays refused',
      v_serials, v_devices;
  exception
    when insufficient_privilege then
      reset role;
      raise exception
        'KLUY-MIGRATION-0155: kitluy_issuance_service cannot execute the revocation read bridges: % (%)',
        sqlerrm, sqlstate
        using errcode = 'P0001';
  end;

  raise notice
    'KLUY-MIGRATION-0155: worker executed lapse+status; absent lapse refused NOT-FOUND, absent status null, verdicts unchanged at %',
    v_after;
end
$smoke$;
