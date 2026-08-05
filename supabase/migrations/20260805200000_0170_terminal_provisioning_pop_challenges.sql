-- kitluy:group:0170
-- Migration group 0170: terminal_provisioning_pop_challenges.
--
-- Authority: WS-11-T004-P02B3A (package contract); pairing protocol §7
-- ("terminal creates/proves non-exportable key" — the CLOUD-side proof before
-- redemption); P01 capability audit threat row 14 ("redeem requires PoP
-- against the ENROLLED fingerprint"); the OPTION B ruling of group 0127
-- (PostgreSQL cannot verify Ed25519 — the @kitluy/device-identity service is
-- the signature authority; the database enforces every RELATIONAL binding and
-- records the service's attestation); groups 0120 (manufacturing enrollments,
-- current_enrollment_id, sealed/superseded/revoked), 0162-0169 (provisioning
-- codes, doors and their assignment→code lock order).
--
-- ===========================================================================
-- WHAT THIS GROUP ADDS — AND WHAT IT DELIBERATELY DOES NOT
-- ===========================================================================
-- ONE relational challenge/verification table and TWO internal governed
-- doors:
--
--   issue_terminal_provisioning_pop_challenge_v1(assignment)
--     — derives EVERYTHING (scope, Hub, outstanding code, current sealed
--       enrollment fingerprint) from rows, generates a 32-byte secure nonce,
--       and records one immutable challenge whose expiry IS the bound
--       provisioning code's own expires_at. RECORDED DECISION: no independent
--       challenge TTL exists in repository authority and none is invented —
--       the challenge inherits the code's owner-approved 15-minute lifetime
--       and can never outlive the code it exists to redeem.
--
--   record_terminal_provisioning_pop_verification_v1(challenge, attestation)
--     — the OPTION B attestation boundary: the SERVICE verified the Ed25519
--       signature over the canonical `kitluy.provisioning-pop.v1` bytes
--       (packages/device-identity/src/provisioning-pop.ts); this door
--       re-derives and re-locks every relational fact (assignment→code→
--       challenge, the established order), refuses anything stale, and
--       atomically marks the ONE challenge verified. The verified row is the
--       single-use proof P02B3B will consume atomically with redemption.
--
-- A verified proof is a PREREQUISITE, never an authorization: this group
-- performs NO provisioning-code state transition, NO credential issuance, NO
-- activation, NO pairing, and grants NOTHING to production identities (P02C
-- owns composition; the doors are executable by the sanctioned test harness
-- only until then).
--
-- The RAW provisioning code appears NOWHERE: the binding is the code ROW id.
-- The nonce is stored raw BY DESIGN — it is not a bearer secret (possession
-- of the nonce authorizes nothing; only a signature under the ENROLLED key
-- verifies) and the verifier must reconstruct the exact signed bytes from
-- authoritative records, which hash-only storage would make impossible.
--
-- No new event type is added to the 0162 vocabulary: the challenge row itself
-- — immutable bindings, one-way state machine, attestation fields — is the
-- append-style evidence, exactly as the 0127 issuance-attempt reservation is
-- for credential issuance.
--
-- ===========================================================================
-- kitluy:destructive-approved:WS-11-T004-P02B3A -- no DROP/TRUNCATE/DELETE in
-- this group; the marker is present so the destructive-guard never reads a
-- future edit of this file as unmarked history.
-- ===========================================================================

-- Ownership borrow, same as groups 0125-0169: the applying role is not a
-- member of the NOLOGIN definer owner. Handed back at the end of this file.
do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. THE CHALLENGE / VERIFICATION TABLE
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_provisioning_pop_challenges (
  id uuid primary key default gen_random_uuid(),
  -- The canonical payload version the service signs (domain separator).
  challenge_version text not null default 'kitluy.provisioning-pop.v1'
    constraint device_provisioning_pop_challenges_version_chk
    check (challenge_version = 'kitluy.provisioning-pop.v1'),
  -- The ONE purpose this proof may serve. Distinct from every other proof
  -- domain (kitluy.csr.v1 enrollment, kitluy.renewal-pop.v1 renewal).
  purpose text not null default 'terminal_provisioning_redemption'
    constraint device_provisioning_pop_challenges_purpose_chk
    check (purpose = 'terminal_provisioning_redemption'),
  tenant_id uuid not null,
  digital_store_id uuid not null,
  store_location_id uuid not null,
  environment text not null,
  store_hub_device_id uuid not null references kitluy_devices.devices (id),
  terminal_device_id uuid not null references kitluy_devices.devices (id),
  terminal_assignment_id uuid not null references kitluy_devices.device_terminal_assignments (id),
  terminal_profile_key text not null,
  -- The provisioning-code ROW — never the raw code, never its digest.
  provisioning_code_id uuid not null references kitluy_devices.device_provisioning_codes (id),
  -- The CURRENT sealed manufacturing enrollment at issue, and its enrolled
  -- public-key fingerprint (0120: the fingerprint is the key identity; the
  -- private key never exists server-side).
  terminal_enrollment_id uuid not null references kitluy_devices.manufacturing_enrollments (id),
  terminal_key_fingerprint text not null
    constraint device_provisioning_pop_challenges_fingerprint_chk
    check (terminal_key_fingerprint ~ '^[0-9a-f]{64}$'),
  -- 32 secure-random bytes, hex. Raw by design: not a bearer secret, and the
  -- verifier reconstructs the exact signed bytes from THIS row.
  nonce text not null
    constraint device_provisioning_pop_challenges_nonce_chk
    check (nonce ~ '^[0-9a-f]{64}$'),
  state text not null default 'issued'
    constraint device_provisioning_pop_challenges_state_chk
    check (state in ('issued', 'verified', 'consumed')),
  created_at timestamptz not null,
  -- RECORDED DECISION: inherits the bound code's own expires_at. No
  -- independent TTL is invented; the challenge never outlives its code.
  expires_at timestamptz not null,
  verified_at timestamptz,
  consumed_at timestamptz,
  -- OPTION B attestation (the 0127 pattern): the SERVICE says it verified the
  -- Ed25519 signature over the canonical bytes. Recorded only on the one
  -- issued→verified transition, together, or not at all.
  attested_signature_verified boolean,
  attested_challenge_hash text
    constraint device_provisioning_pop_challenges_hash_chk
    check (attested_challenge_hash is null or attested_challenge_hash ~ '^[0-9a-f]{64}$'),
  attested_key_fingerprint text
    constraint device_provisioning_pop_challenges_attested_fp_chk
    check (attested_key_fingerprint is null or attested_key_fingerprint ~ '^[0-9a-f]{64}$'),
  correlation_id uuid not null,
  constraint device_provisioning_pop_challenges_window_chk
    check (expires_at > created_at),
  -- verified fields travel together with the verified/consumed states.
  constraint device_provisioning_pop_challenges_verified_chk
    check ((state = 'issued') = (verified_at is null)
           and (verified_at is null) = (attested_signature_verified is null)
           and (verified_at is null) = (attested_challenge_hash is null)
           and (verified_at is null) = (attested_key_fingerprint is null)),
  -- consumption (P02B3B's transition) requires a verification first.
  constraint device_provisioning_pop_challenges_consumed_chk
    check ((state = 'consumed') = (consumed_at is not null)
           and (consumed_at is null or verified_at is not null)),
  -- A recorded attestation is only ever TRUE: a failed verification is a
  -- refusal with NO row transition, never a stored "false proof".
  constraint device_provisioning_pop_challenges_attested_true_chk
    check (attested_signature_verified is null or attested_signature_verified = true)
);

comment on table kitluy_devices.device_provisioning_pop_challenges is
  'Group 0170 (WS-11-T004-P02B3A). One row per terminal provisioning proof-of-possession challenge (pairing protocol §7 cloud-side proof; purpose terminal_provisioning_redemption). Binds challenge → Tenant/Store/Location/environment → Store Hub → terminal assignment → T1-T4 profile → provisioning-code ROW (never the raw code) → current sealed manufacturing enrollment and its key fingerprint. Expiry inherits the bound code''s own expires_at (recorded decision: no independent TTL). One-way state machine issued→verified→consumed with immutable bindings; the verified row is the single-use, non-authoritative proof P02B3B consumes atomically with redemption. Under OPTION B (group 0127) the Ed25519 verification lives in @kitluy/device-identity (kitluy.provisioning-pop.v1); this table records the service''s attestation, never a signature, never a raw code, never a private key. MC: MUT (state machine only).';

create index if not exists idx_device_provisioning_pop_challenges_code
  on kitluy_devices.device_provisioning_pop_challenges (provisioning_code_id);
create index if not exists idx_device_provisioning_pop_challenges_assignment
  on kitluy_devices.device_provisioning_pop_challenges (terminal_assignment_id);
-- ONE proof per provisioning code, ever: at most one challenge for a given
-- code may reach verified (and later consumed). P02B3B consumes THE proof.
create unique index if not exists uq_device_provisioning_pop_one_proof_per_code
  on kitluy_devices.device_provisioning_pop_challenges (provisioning_code_id)
  where state in ('verified', 'consumed');

-- ---------------------------------------------------------------------------
-- 2. IMMUTABILITY AND THE ONE-WAY STATE MACHINE
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.enforce_provisioning_pop_challenge_integrity()
returns trigger
language plpgsql
as $integrity$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-PROVPOP-DELETE-FORBIDDEN: proof-of-possession challenges are immutable evidence'
      using errcode = 'P0001';
  end if;

  -- Every binding is frozen at issuance. Only the state machine moves.
  if new.id is distinct from old.id
     or new.challenge_version is distinct from old.challenge_version
     or new.purpose is distinct from old.purpose
     or new.tenant_id is distinct from old.tenant_id
     or new.digital_store_id is distinct from old.digital_store_id
     or new.store_location_id is distinct from old.store_location_id
     or new.environment is distinct from old.environment
     or new.store_hub_device_id is distinct from old.store_hub_device_id
     or new.terminal_device_id is distinct from old.terminal_device_id
     or new.terminal_assignment_id is distinct from old.terminal_assignment_id
     or new.terminal_profile_key is distinct from old.terminal_profile_key
     or new.provisioning_code_id is distinct from old.provisioning_code_id
     or new.terminal_enrollment_id is distinct from old.terminal_enrollment_id
     or new.terminal_key_fingerprint is distinct from old.terminal_key_fingerprint
     or new.nonce is distinct from old.nonce
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at
     or new.correlation_id is distinct from old.correlation_id then
    raise exception 'KLUY-PROVPOP-BINDING-IMMUTABLE: challenge bindings are frozen at issuance'
      using errcode = 'P0001';
  end if;

  -- issued → verified: the one verification, all attestation fields at once.
  if old.state = 'issued' then
    if new.state = 'issued' then
      raise exception 'KLUY-PROVPOP-NO-IDLE-UPDATE: an issued challenge only ever transitions'
        using errcode = 'P0001';
    end if;
    if new.state <> 'verified' then
      raise exception 'KLUY-PROVPOP-STATE-MACHINE: issued may only become verified'
        using errcode = 'P0001';
    end if;
  -- verified → consumed: reserved for the P02B3B redemption transaction.
  elsif old.state = 'verified' then
    if new.state <> 'consumed' then
      raise exception 'KLUY-PROVPOP-STATE-MACHINE: verified may only become consumed'
        using errcode = 'P0001';
    end if;
    if new.verified_at is distinct from old.verified_at
       or new.attested_signature_verified is distinct from old.attested_signature_verified
       or new.attested_challenge_hash is distinct from old.attested_challenge_hash
       or new.attested_key_fingerprint is distinct from old.attested_key_fingerprint then
      raise exception 'KLUY-PROVPOP-ATTESTATION-IMMUTABLE: a recorded verification is never rewritten'
        using errcode = 'P0001';
    end if;
  else
    raise exception 'KLUY-PROVPOP-TERMINAL: a consumed challenge never changes again'
      using errcode = 'P0001';
  end if;

  return new;
end
$integrity$;

create trigger trg_device_provisioning_pop_challenges_integrity
  before update or delete on kitluy_devices.device_provisioning_pop_challenges
  for each row execute function kitluy_devices.enforce_provisioning_pop_challenge_integrity();

revoke all on function kitluy_devices.enforce_provisioning_pop_challenge_integrity() from public;

-- FORCE RLS with the 0126/0163 pattern: zero policies would block the NOLOGIN
-- governor itself, so the DEFINER authority (and only it) gets row
-- visibility; every runtime identity still sees nothing.
alter table kitluy_devices.device_provisioning_pop_challenges enable row level security;
alter table kitluy_devices.device_provisioning_pop_challenges force row level security;
revoke all on table kitluy_devices.device_provisioning_pop_challenges from public;
create policy device_provisioning_pop_challenges_governor_read
  on kitluy_devices.device_provisioning_pop_challenges
  for select to kitluy_activation_governor using (true);
create policy device_provisioning_pop_challenges_governor_all
  on kitluy_devices.device_provisioning_pop_challenges
  for all to kitluy_activation_governor using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 3. THE CHALLENGE-ISSUANCE DOOR (internal; harness-only until P02C)
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(
  p_terminal_assignment_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $issue_pop$
declare
  v_assignment kitluy_devices.device_terminal_assignments;
  v_scope kitluy_devices.device_assignments;
  v_code kitluy_devices.device_provisioning_codes;
  v_enrollment kitluy_devices.manufacturing_enrollments;
  v_hub uuid;
  v_environment text;
  v_now timestamptz;
  v_challenge_id uuid;
  v_nonce text;
  v_correlation uuid;
  v_proved integer;
begin
  if p_terminal_assignment_id is null then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-NO-ASSIGNMENT',
      'detail', 'a challenge names exactly one terminal assignment');
  end if;

  -- 1. THE ASSIGNMENT, LOCKED FIRST — the established assignment→code order
  -- shared with every 0163-0169 door; no code-first path is introduced.
  select * into v_assignment
    from kitluy_devices.device_terminal_assignments
   where id = p_terminal_assignment_id
   for update;
  if not found then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-ASSIGNMENT-MISSING',
      'detail', 'no terminal assignment with that id');
  end if;
  if v_assignment.state not in ('pending_trust', 'active') then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-ASSIGNMENT-INACTIVE',
      'detail', format('the terminal assignment is %s, not live', v_assignment.state));
  end if;

  -- 2. THE SCOPE, DERIVED — never caller-supplied.
  select * into v_scope
    from kitluy_devices.device_assignments
   where id = v_assignment.assignment_id;
  if not found then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-ASSIGNMENT-MISSING',
      'detail', 'the assignment the terminal assignment references does not exist');
  end if;

  -- 3. THE ACTIVE HUB, RE-VALIDATED NOW (ADMIN-QA-014; the 0163/0167/0169
  -- rule): the projection is written ONLY by a successful activation.
  select p.device_id, p.environment into v_hub, v_environment
    from kitluy_devices.device_assignment_projections p
   where p.tenant_id = v_scope.tenant_id
     and p.digital_store_id = v_scope.digital_store_id
     and p.store_location_id = v_scope.store_location_id
   order by p.projected_at, p.device_id
   limit 1;
  if v_hub is null then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-HUB-INACTIVE',
      'detail', 'no activated Store Hub at this scope');
  end if;

  -- 4. THE OUTSTANDING CODE, LOCKED — derived relationally, never caller-
  -- chosen. Only a currently ISSUED, unexpired, unlocked code can anchor a
  -- redemption proof.
  select * into v_code
    from kitluy_devices.device_provisioning_codes
   where terminal_assignment_id = p_terminal_assignment_id
     and state = 'issued'
   for update;
  if not found then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-NO-OUTSTANDING-CODE',
      'detail', 'no outstanding issued provisioning code exists for this assignment');
  end if;
  v_now := kitluy_ops.authoritative_now_v1();
  if v_now >= v_code.expires_at then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-CODE-EXPIRED',
      'detail', 'the outstanding code is past its authoritative expiry');
  end if;
  if v_code.failed_attempt_count >= 5 then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-CODE-ATTEMPTS-EXHAUSTED',
      'detail', 'the outstanding code has exhausted its presentation attempts');
  end if;
  if v_assignment.device_id is distinct from v_code.terminal_device_id
     or v_assignment.terminal_profile_key is distinct from v_code.terminal_profile_key then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-SCOPE-INCONSISTENT',
      'detail', 'the code names a device or profile its assignment does not');
  end if;

  -- 5. ONE PROOF PER CODE, EVER: a code that already carries a verified (or
  -- consumed) proof takes no further challenges.
  select count(*) into v_proved
    from kitluy_devices.device_provisioning_pop_challenges c
   where c.provisioning_code_id = v_code.id
     and c.state in ('verified', 'consumed');
  if v_proved > 0 then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-CODE-ALREADY-PROVEN',
      'detail', 'this provisioning code already carries its one verified proof');
  end if;

  -- 6. THE CURRENT SEALED ENROLLMENT — the key identity the proof must use
  -- (0120: fingerprint only; the private key never exists server-side).
  select e.* into v_enrollment
    from kitluy_devices.devices d
    join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
   where d.id = v_assignment.device_id;
  if not found then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-ENROLLMENT-MISSING',
      'detail', 'the terminal has no current manufacturing enrollment');
  end if;
  if v_enrollment.state <> 'sealed' or v_enrollment.revoked_at is not null then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-ENROLLMENT-INELIGIBLE',
      'detail', format('the current enrollment is %s; only a sealed enrollment may prove possession', v_enrollment.state));
  end if;

  -- 7. THE CHALLENGE. 32 secure-random bytes; expiry inherits the code's own
  -- expires_at (recorded decision — no invented TTL, the challenge never
  -- outlives the code it redeems).
  v_challenge_id := gen_random_uuid();
  v_correlation := gen_random_uuid();
  v_nonce := encode(extensions.gen_random_bytes(32), 'hex');

  insert into kitluy_devices.device_provisioning_pop_challenges
    (id, tenant_id, digital_store_id, store_location_id, environment,
     store_hub_device_id, terminal_device_id, terminal_assignment_id,
     terminal_profile_key, provisioning_code_id, terminal_enrollment_id,
     terminal_key_fingerprint, nonce, created_at, expires_at, correlation_id)
  values
    (v_challenge_id, v_scope.tenant_id, v_scope.digital_store_id,
     v_scope.store_location_id, v_environment, v_hub, v_assignment.device_id,
     v_assignment.id, v_assignment.terminal_profile_key, v_code.id,
     v_enrollment.id, v_enrollment.device_public_key_fingerprint, v_nonce,
     v_now, v_code.expires_at, v_correlation);

  -- Everything the SERVICE needs to build the canonical signed bytes, and
  -- nothing more: no raw code, no digest, no permission data.
  return jsonb_build_object(
    'outcome', 'POP_CHALLENGE_ISSUED',
    'challenge_id', v_challenge_id,
    'challenge_version', 'kitluy.provisioning-pop.v1',
    'purpose', 'terminal_provisioning_redemption',
    'tenant_id', v_scope.tenant_id,
    'digital_store_id', v_scope.digital_store_id,
    'store_location_id', v_scope.store_location_id,
    'environment', v_environment,
    'store_hub_device_id', v_hub,
    'terminal_device_id', v_assignment.device_id,
    'terminal_assignment_id', v_assignment.id,
    'terminal_profile_key', v_assignment.terminal_profile_key,
    'provisioning_code_id', v_code.id,
    'terminal_enrollment_id', v_enrollment.id,
    'terminal_key_fingerprint', v_enrollment.device_public_key_fingerprint,
    'nonce', v_nonce,
    'created_at', v_now,
    'expires_at', v_code.expires_at,
    'correlation_id', v_correlation);
end
$issue_pop$;

comment on function kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid) is
  'Group 0170 (WS-11-T004-P02B3A). INTERNAL issuance of the one cloud-side proof-of-possession challenge for terminal provisioning redemption (pairing protocol §7). Locks assignment then outstanding code (the established order), revalidates the active Hub and the current sealed manufacturing enrollment, and records one immutable challenge whose nonce is 32 secure-random bytes and whose expiry inherits the bound code''s own expires_at (recorded decision: no invented TTL). Returns exactly the authoritative material the service needs to reconstruct the canonical kitluy.provisioning-pop.v1 bytes — never a raw code, digest or key. Harness-only until P02C composes production. A code that already carries its one verified proof takes no further challenges.';

alter function kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid)
  owner to kitluy_activation_governor;
revoke all on function kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid) from public;
revoke all on function kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid) from anon;
revoke all on function kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid) from authenticated;
revoke all on function kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid) from service_role;
grant execute on function kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid)
  to kitluy_test_harness;

-- ---------------------------------------------------------------------------
-- 4. THE ATTESTATION DOOR (internal; harness-only until P02C)
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.record_terminal_provisioning_pop_verification_v1(
  p_challenge_id uuid,
  p_attested_signature_verified boolean,
  p_attested_challenge_hash text,
  p_attested_key_fingerprint text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $record_pop$
declare
  v_challenge kitluy_devices.device_provisioning_pop_challenges;
  v_assignment kitluy_devices.device_terminal_assignments;
  v_code kitluy_devices.device_provisioning_codes;
  v_enrollment kitluy_devices.manufacturing_enrollments;
  v_now timestamptz;
  v_hub_alive integer;
  v_proved integer;
begin
  if p_challenge_id is null then
    return jsonb_build_object(
      'outcome', 'POP_VERIFICATION_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-NO-CHALLENGE',
      'detail', 'a verification names exactly one challenge');
  end if;
  if p_attested_challenge_hash is null or p_attested_challenge_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object(
      'outcome', 'POP_VERIFICATION_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-MALFORMED-ATTESTATION',
      'detail', 'the attested challenge hash is not a sha-256 hex digest');
  end if;
  if p_attested_key_fingerprint is null or p_attested_key_fingerprint !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object(
      'outcome', 'POP_VERIFICATION_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-MALFORMED-ATTESTATION',
      'detail', 'the attested key fingerprint is not a sha-256 hex digest');
  end if;

  -- 1. THE CHALLENGE, READ ONCE to derive the lock targets. Everything is
  -- re-read UNDER the locks below (assignment→code→challenge, so no door in
  -- this domain ever takes these locks in a different order).
  select * into v_challenge
    from kitluy_devices.device_provisioning_pop_challenges
   where id = p_challenge_id;
  if not found then
    return jsonb_build_object(
      'outcome', 'POP_VERIFICATION_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-CHALLENGE-NOT-FOUND',
      'detail', 'no challenge with that id');
  end if;

  select * into v_assignment
    from kitluy_devices.device_terminal_assignments
   where id = v_challenge.terminal_assignment_id
   for update;
  select * into v_code
    from kitluy_devices.device_provisioning_codes
   where id = v_challenge.provisioning_code_id
   for update;
  select * into v_challenge
    from kitluy_devices.device_provisioning_pop_challenges
   where id = p_challenge_id
   for update;

  -- 2. SINGLE USE, UNDER THE LOCK: a same-challenge race serializes above and
  -- the loser answers the stable reconciliation, never a second transition.
  if v_challenge.state = 'verified' then
    return jsonb_build_object(
      'outcome', 'POP_ALREADY_VERIFIED',
      'challenge_id', v_challenge.id,
      'provisioning_code_id', v_challenge.provisioning_code_id,
      'terminal_assignment_id', v_challenge.terminal_assignment_id,
      'verified_at', v_challenge.verified_at,
      'expires_at', v_challenge.expires_at,
      'consumed', false,
      'replay', true,
      'detail', 'this challenge was already verified; the one proof stands unchanged');
  end if;
  if v_challenge.state = 'consumed' then
    return jsonb_build_object(
      'outcome', 'POP_VERIFICATION_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-ALREADY-CONSUMED',
      'challenge_id', v_challenge.id,
      'detail', 'this proof was already consumed by redemption');
  end if;

  -- 3. EXPIRY, on the authoritative clock. The equality boundary expires —
  -- the same 0166 rule the underlying code follows.
  v_now := kitluy_ops.authoritative_now_v1();
  if v_now >= v_challenge.expires_at then
    return jsonb_build_object(
      'outcome', 'POP_VERIFICATION_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-CHALLENGE-EXPIRED',
      'detail', 'the challenge expired on the authoritative clock');
  end if;

  -- 4. EVERY RELATIONAL FACT, RE-VALIDATED NOW. A proof over stale authority
  -- records nothing.
  if v_assignment.id is null or v_assignment.state not in ('pending_trust', 'active') then
    return jsonb_build_object(
      'outcome', 'POP_VERIFICATION_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-ASSIGNMENT-INACTIVE',
      'detail', 'the terminal assignment is no longer live');
  end if;
  if v_code.id is null or v_code.state <> 'issued' then
    return jsonb_build_object(
      'outcome', 'POP_VERIFICATION_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-CODE-' ||
        case when v_code.id is null then 'MISSING' else 'ALREADY-' || upper(v_code.state::text) end,
      'detail', 'the bound provisioning code is no longer outstanding');
  end if;
  if v_now >= v_code.expires_at then
    return jsonb_build_object(
      'outcome', 'POP_VERIFICATION_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-CODE-EXPIRED',
      'detail', 'the bound provisioning code is past its authoritative expiry');
  end if;
  if v_code.failed_attempt_count >= 5 then
    return jsonb_build_object(
      'outcome', 'POP_VERIFICATION_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-CODE-ATTEMPTS-EXHAUSTED',
      'detail', 'the bound provisioning code has exhausted its presentation attempts');
  end if;
  select count(*) into v_hub_alive
    from kitluy_devices.device_assignment_projections p
   where p.device_id = v_challenge.store_hub_device_id
     and p.tenant_id = v_challenge.tenant_id
     and p.digital_store_id = v_challenge.digital_store_id
     and p.store_location_id = v_challenge.store_location_id;
  if v_hub_alive = 0 then
    return jsonb_build_object(
      'outcome', 'POP_VERIFICATION_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-HUB-INACTIVE',
      'detail', 'the bound Store Hub is no longer active at this scope');
  end if;
  select e.* into v_enrollment
    from kitluy_devices.devices d
    join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
   where d.id = v_challenge.terminal_device_id;
  if not found
     or v_enrollment.id is distinct from v_challenge.terminal_enrollment_id
     or v_enrollment.state <> 'sealed'
     or v_enrollment.revoked_at is not null then
    return jsonb_build_object(
      'outcome', 'POP_VERIFICATION_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-ENROLLMENT-INELIGIBLE',
      'detail', 'the terminal enrollment bound at issue is no longer the current sealed enrollment');
  end if;

  -- 5. THE ATTESTATION ITSELF. Only a TRUE service attestation over the
  -- correct enrolled key ever transitions the row; a failed verification is
  -- a refusal with zero residue (no stored "false proof", no code mutation,
  -- no attempt increment — presentation attempts belong to the 0164 code
  -- contract, not to PoP).
  if p_attested_signature_verified is distinct from true then
    return jsonb_build_object(
      'outcome', 'POP_VERIFICATION_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-SIGNATURE-REJECTED',
      'detail', 'the service did not attest a verified signature; nothing was recorded');
  end if;
  if p_attested_key_fingerprint is distinct from v_challenge.terminal_key_fingerprint then
    return jsonb_build_object(
      'outcome', 'POP_VERIFICATION_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-KEY-MISMATCH',
      'detail', 'the attested key is not the enrolled key this challenge bound');
  end if;

  -- 6. ONE PROOF PER CODE (the partial unique index backs this; the check
  -- under the code lock keeps a two-challenge race polite instead of 23505).
  select count(*) into v_proved
    from kitluy_devices.device_provisioning_pop_challenges c
   where c.provisioning_code_id = v_challenge.provisioning_code_id
     and c.state in ('verified', 'consumed')
     and c.id <> v_challenge.id;
  if v_proved > 0 then
    return jsonb_build_object(
      'outcome', 'POP_VERIFICATION_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-CODE-ALREADY-PROVEN',
      'detail', 'another challenge already proved this code');
  end if;

  update kitluy_devices.device_provisioning_pop_challenges
     set state = 'verified',
         verified_at = v_now,
         attested_signature_verified = true,
         attested_challenge_hash = p_attested_challenge_hash,
         attested_key_fingerprint = p_attested_key_fingerprint
   where id = v_challenge.id and state = 'issued';
  if not found then
    -- Unreachable under the held locks; fail closed as the stable replay.
    return jsonb_build_object(
      'outcome', 'POP_VERIFICATION_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-CONFLICTING-VERIFICATION',
      'detail', 'a competing verification committed first');
  end if;

  -- The single-use, NON-AUTHORITATIVE proof. P02B3B must re-lock and recheck
  -- everything before consuming it atomically with redemption.
  return jsonb_build_object(
    'outcome', 'POP_VERIFIED',
    'challenge_id', v_challenge.id,
    'provisioning_code_id', v_challenge.provisioning_code_id,
    'terminal_assignment_id', v_challenge.terminal_assignment_id,
    'terminal_device_id', v_challenge.terminal_device_id,
    'store_hub_device_id', v_challenge.store_hub_device_id,
    'terminal_profile_key', v_challenge.terminal_profile_key,
    'environment', v_challenge.environment,
    'terminal_enrollment_id', v_challenge.terminal_enrollment_id,
    'terminal_key_fingerprint', v_challenge.terminal_key_fingerprint,
    'verified_at', v_now,
    'expires_at', v_challenge.expires_at,
    'consumed', false,
    'correlation_id', v_challenge.correlation_id,
    'detail', 'the proof is recorded, single-use and NON-AUTHORITATIVE; P02B3B must recheck everything before redemption');
end
$record_pop$;

comment on function kitluy_devices.record_terminal_provisioning_pop_verification_v1(uuid, boolean, text, text) is
  'Group 0170 (WS-11-T004-P02B3A). The OPTION B attestation boundary for terminal provisioning proof of possession: the @kitluy/device-identity service verified the Ed25519 signature over the canonical kitluy.provisioning-pop.v1 bytes; this door re-locks assignment→code→challenge (the established order), re-validates the live assignment, the outstanding unexpired code, the bound Hub''s current projection and the current sealed enrollment, and atomically records the ONE issued→verified transition (all attestation fields together; only TRUE is ever stored — a failed verification is a refusal with zero residue and NO code-attempt increment). Identical replay answers POP_ALREADY_VERIFIED with no second transition. The verified row is single-use and NON-AUTHORITATIVE: P02B3B consumes it atomically with redemption after rechecking everything. Harness-only until P02C composes production.';

alter function kitluy_devices.record_terminal_provisioning_pop_verification_v1(uuid, boolean, text, text)
  owner to kitluy_activation_governor;
revoke all on function kitluy_devices.record_terminal_provisioning_pop_verification_v1(uuid, boolean, text, text) from public;
revoke all on function kitluy_devices.record_terminal_provisioning_pop_verification_v1(uuid, boolean, text, text) from anon;
revoke all on function kitluy_devices.record_terminal_provisioning_pop_verification_v1(uuid, boolean, text, text) from authenticated;
revoke all on function kitluy_devices.record_terminal_provisioning_pop_verification_v1(uuid, boolean, text, text) from service_role;
grant execute on function kitluy_devices.record_terminal_provisioning_pop_verification_v1(uuid, boolean, text, text)
  to kitluy_test_harness;

alter table kitluy_devices.device_provisioning_pop_challenges
  owner to kitluy_activation_governor;

-- ---------------------------------------------------------------------------
-- 5. HAND THE MEMBERSHIP BACK
-- ---------------------------------------------------------------------------
do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- 6. PROVE THE BOUNDARY ON APPLY (non-vacuous assertions)
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_issue_def text;
  v_record_def text;
begin
  -- Both doors exist with the intended signatures, definer, NOLOGIN owner,
  -- pinned search_path.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname = 'issue_terminal_provisioning_pop_challenge_v1'
       and pg_get_function_arguments(p.oid) = 'p_terminal_assignment_id uuid'
       and p.prosecdef
       and pg_get_userbyid(p.proowner) = 'kitluy_activation_governor'
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
     or not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname = 'record_terminal_provisioning_pop_verification_v1'
       and pg_get_function_arguments(p.oid)
           = 'p_challenge_id uuid, p_attested_signature_verified boolean, p_attested_challenge_hash text, p_attested_key_fingerprint text'
       and p.prosecdef
       and pg_get_userbyid(p.proowner) = 'kitluy_activation_governor'
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then
    raise exception 'KLUY-MIGRATION-0170: a PoP door is missing, mis-signed, not definer, not governor-owned or unpinned'
      using errcode = 'P0001';
  end if;

  -- The grant boundary: HARNESS-ONLY. No public, anon, authenticated,
  -- service_role or worker execution on either door.
  if has_function_privilege('public', 'kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid)', 'execute')
     or has_function_privilege('anon', 'kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid)', 'execute')
     or has_function_privilege('kitluy_worker_service', 'kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid)', 'execute')
     or not has_function_privilege('kitluy_test_harness', 'kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid)', 'execute')
     or has_function_privilege('public', 'kitluy_devices.record_terminal_provisioning_pop_verification_v1(uuid, boolean, text, text)', 'execute')
     or has_function_privilege('anon', 'kitluy_devices.record_terminal_provisioning_pop_verification_v1(uuid, boolean, text, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.record_terminal_provisioning_pop_verification_v1(uuid, boolean, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.record_terminal_provisioning_pop_verification_v1(uuid, boolean, text, text)', 'execute')
     or has_function_privilege('kitluy_worker_service', 'kitluy_devices.record_terminal_provisioning_pop_verification_v1(uuid, boolean, text, text)', 'execute')
     or not has_function_privilege('kitluy_test_harness', 'kitluy_devices.record_terminal_provisioning_pop_verification_v1(uuid, boolean, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0170: the PoP door grant boundary is wrong'
      using errcode = 'P0001';
  end if;

  -- No table access for any runtime identity; FORCE RLS holds.
  if has_table_privilege('authenticated', 'kitluy_devices.device_provisioning_pop_challenges', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', 'kitluy_devices.device_provisioning_pop_challenges', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('service_role', 'kitluy_devices.device_provisioning_pop_challenges', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_worker_service', 'kitluy_devices.device_provisioning_pop_challenges', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'KLUY-MIGRATION-0170: a runtime identity can reach the PoP challenge table directly'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_devices'
       and c.relname = 'device_provisioning_pop_challenges'
       and (not c.relrowsecurity or not c.relforcerowsecurity)) then
    raise exception 'KLUY-MIGRATION-0170: FORCE RLS does not hold on the PoP challenge table'
      using errcode = 'P0001';
  end if;

  -- The doors' bodies prove the structural contract: the assignment→code
  -- order, the Hub gate, the enrollment gate, the one-proof rule, and NO
  -- delegation that could mutate provisioning-code state.
  select pg_get_functiondef(p.oid) into v_issue_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices' and p.proname = 'issue_terminal_provisioning_pop_challenge_v1';
  select pg_get_functiondef(p.oid) into v_record_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices' and p.proname = 'record_terminal_provisioning_pop_verification_v1';
  if v_issue_def not like '%device_assignment_projections%'
     or v_record_def not like '%device_assignment_projections%' then
    raise exception 'KLUY-MIGRATION-0170: the active-Hub gate is missing from a PoP door'
      using errcode = 'P0001';
  end if;
  if v_issue_def not like '%current_enrollment_id%'
     or v_record_def not like '%current_enrollment_id%' then
    raise exception 'KLUY-MIGRATION-0170: the sealed-enrollment gate is missing from a PoP door'
      using errcode = 'P0001';
  end if;
  if v_issue_def like '%update kitluy_devices.device_provisioning_codes%'
     or v_record_def like '%update kitluy_devices.device_provisioning_codes%' then
    raise exception 'KLUY-MIGRATION-0170: a PoP door mutates provisioning-code state; proof is a prerequisite, never a transition'
      using errcode = 'P0001';
  end if;
  if v_record_def not like '%KLUY-PROVPOP-CODE-ALREADY-PROVEN%'
     or v_issue_def not like '%KLUY-PROVPOP-CODE-ALREADY-PROVEN%' then
    raise exception 'KLUY-MIGRATION-0170: the one-proof-per-code rule is missing'
      using errcode = 'P0001';
  end if;

  -- The one-proof partial unique index exists.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'kitluy_devices'
       and indexname = 'uq_device_provisioning_pop_one_proof_per_code') then
    raise exception 'KLUY-MIGRATION-0170: the one-proof-per-code unique index is missing'
      using errcode = 'P0001';
  end if;

  -- No raw-code-capable and no private-key-capable column exists on the
  -- challenge table (identifier and version exclusions).
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'kitluy_devices'
       and table_name = 'device_provisioning_pop_challenges'
       and (column_name ~ '(^|_)(code|raw|plain|secret|private)(_|$)'
            and column_name not in ('provisioning_code_id'))) then
    raise exception 'KLUY-MIGRATION-0170: a column that could hold a raw code or private key exists'
      using errcode = 'P0001';
  end if;
  -- No stored-signature column: only the sha-256 attestation hash exists.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'kitluy_devices'
       and table_name = 'device_provisioning_pop_challenges'
       and column_name ~ 'signature'
       and column_name <> 'attested_signature_verified') then
    raise exception 'KLUY-MIGRATION-0170: a stored-signature column exists'
      using errcode = 'P0001';
  end if;

  -- The provisioning-code and event boundaries of 0162-0169 are untouched:
  -- signatures, grants and FORCE RLS stand exactly as 0169 asserted them.
  if not has_function_privilege('authenticated', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'kitluy_devices.recover_terminal_provisioning_code_v1(uuid, text, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'kitluy_devices.revoke_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or not has_function_privilege('kitluy_test_harness', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute')
     or not has_function_privilege('kitluy_test_harness', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0170: an earlier provisioning-code boundary drifted'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_devices'
       and c.relname in ('device_provisioning_codes', 'device_provisioning_code_events')
       and (not c.relrowsecurity or not c.relforcerowsecurity)) then
    raise exception 'KLUY-MIGRATION-0170: FORCE RLS no longer holds on the provisioning-code tables'
      using errcode = 'P0001';
  end if;

  -- The immutability trigger is attached.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'kitluy_devices.device_provisioning_pop_challenges'::regclass
       and tgname = 'trg_device_provisioning_pop_challenges_integrity') then
    raise exception 'KLUY-MIGRATION-0170: the challenge integrity trigger is missing'
      using errcode = 'P0001';
  end if;

  -- No login-capable role holds the NOLOGIN owner.
  if exists (
    select 1 from pg_auth_members m
      join pg_roles r on r.oid = m.member
     where m.roleid = (select oid from pg_roles where rolname = 'kitluy_activation_governor')
       and r.rolcanlogin) then
    raise exception 'KLUY-MIGRATION-0170: a login-capable role is a member of the governor'
      using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-MIGRATION-0170: terminal provisioning PoP foundation applied (one challenge/verification table, issued->verified->consumed; issue + attestation doors harness-only until P02C; OPTION B — Ed25519 verification stays in @kitluy/device-identity kitluy.provisioning-pop.v1; challenge expiry inherits the code''s own expires_at; one proof per code; proof is single-use and NON-AUTHORITATIVE — P02B3B owns redemption, P02C owns production grants)';
end
$guard$;
