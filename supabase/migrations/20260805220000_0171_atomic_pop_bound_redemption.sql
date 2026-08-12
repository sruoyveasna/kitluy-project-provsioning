-- kitluy:group:0171
-- Migration group 0171: atomic_pop_bound_redemption.
--
-- Authority: WS-11-T004-P02B3B (package contract); pairing protocol §7
-- ("cloud issues terminal operational certificate" after code + key proof);
-- P01 audit threat row 14 ("redeem requires PoP against the ENROLLED
-- fingerprint"); groups 0162-0169 (code lifecycle and doors), 0170 (verified
-- single-use PoP proof), 0120/0123 (device_certificates — the governed,
-- BLK-005-gated, trusted-time-gated SYNCHRONOUS credential capability:
-- `issue_device_certificate_v1` inserts the one active status row per device
-- and environment in the SAME transaction, which is what makes an atomic
-- redemption possible at all).
--
-- CREDENTIAL-ARCHITECTURE CLASSIFICATION (recorded):
-- A — TRANSACTIONAL CREDENTIAL AUTHORITY AVAILABLE, with the B select-and-
-- bind path reused when an eligible active certificate already exists.
-- `issue_device_certificate_v1` is a plain single-transaction INSERT gated by
-- `assert_pki_configuration_approved` (BLK-005: development approved;
-- pilot/production RAISE = fail-closed, unchanged here) and
-- `assert_trusted_time_v1`. It was proven executable by the NOLOGIN governor
-- end-to-end (probe reached the one-active-per-env unique index). No
-- asynchronous signer, job or callback exists on this path; the dev-CA
-- ARTIFACT (WS-11-T003) remains a service concern and is not part of the
-- database credential status record.
--
-- ===========================================================================
-- THE ONE DOOR THIS GROUP ADDS
-- ===========================================================================
-- `redeem_terminal_provisioning_code_v1`: the internal governed ATOMIC
-- completion of terminal provisioning. Redemption requires BOTH possessions,
-- revalidated under the final locks:
--   1. the provisioning CODE — the presented raw value is re-verified against
--      the stored digest in constant time (an earlier MATCH_READY is never
--      accepted as proof);
--   2. the terminal ENROLLMENT KEY — one VERIFIED, unconsumed 0170 proof
--      bound to exactly this code, assignment, Hub, profile, environment,
--      enrollment and fingerprint (a verified proof is non-authoritative
--      until THIS transaction consumes it).
-- One transaction then: selects-or-issues the ONE eligible certificate,
-- consumes the proof (VERIFIED->CONSUMED), redeems the code
-- (ISSUED->REDEEMED with the idempotency key, proof reference and credential
-- reference frozen onto the row) and appends the one REDEEMED event. Any
-- failure anywhere leaves EVERYTHING unchanged.
--
-- Proof-consumption evidence is the immutable challenge row itself (the 0170
-- recorded design — no new event type); the credential evidence is the
-- device lifecycle event `issue_device_certificate_v1` already appends; the
-- one REDEEMED event carries the safe ids that bind the whole story.
--
-- Out of scope (later packages): broad redemption race hardening and
-- cross-operation races (P02B3C), HTTP composition, Hub delivery, pairing,
-- activation, production grants (P02C).
--
-- ===========================================================================
-- kitluy:destructive-approved:WS-11-T004-P02B3B -- no DROP/TRUNCATE/DELETE in
-- this group; the marker is present so the destructive-guard never reads a
-- future edit of this file as unmarked history.
-- ===========================================================================

do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. REDEMPTION REPRESENTATION ON THE CODE ROW
-- ---------------------------------------------------------------------------
alter table kitluy_devices.device_provisioning_codes
  add column if not exists redemption_idempotency_key text,
  add column if not exists redeemed_with_challenge_id uuid
    references kitluy_devices.device_provisioning_pop_challenges (id),
  add column if not exists redeemed_certificate_id uuid
    references kitluy_devices.device_certificates (id);

-- One-directional by necessity: pre-0171 assertion fixtures planted redeemed
-- rows (as the migration authority) that carry no references. References
-- imply the redeemed state and always travel together; the extended trigger
-- below makes every NEW issued->redeemed transition carry all three.
alter table kitluy_devices.device_provisioning_codes
  add constraint device_provisioning_codes_redemption_binding_chk
  check ((redemption_idempotency_key is null or state = 'redeemed')
         and (redeemed_with_challenge_id is null or state = 'redeemed')
         and (redeemed_certificate_id is null or state = 'redeemed')
         and ((redemption_idempotency_key is null) = (redeemed_with_challenge_id is null))
         and ((redemption_idempotency_key is null) = (redeemed_certificate_id is null)));

create unique index if not exists uq_device_provisioning_codes_redemption_key
  on kitluy_devices.device_provisioning_codes (redemption_idempotency_key)
  where redemption_idempotency_key is not null;
-- One proof can never redeem two codes.
create unique index if not exists uq_device_provisioning_codes_one_code_per_proof
  on kitluy_devices.device_provisioning_codes (redeemed_with_challenge_id)
  where redeemed_with_challenge_id is not null;

-- ---------------------------------------------------------------------------
-- 2. THE INTEGRITY TRIGGER, EXTENDED (the 0167 precedent): the full existing
-- body is preserved verbatim; the redemption columns join the frozen set and
-- may be written ONLY together with the one ISSUED->REDEEMED transition.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.enforce_provisioning_code_integrity()
returns trigger
language plpgsql
as $$
declare
  v_assignment kitluy_devices.device_terminal_assignments;
  v_hub_assignment kitluy_devices.device_assignments;
  v_predecessor kitluy_devices.device_provisioning_codes;
begin
  if tg_op = 'INSERT' then
    -- The terminal assignment must name the SAME device, location and
    -- profile the code row carries, and the Hub reference must be the device
    -- the assignment binds. Anything else is a fabricated scope.
    select * into v_assignment
      from kitluy_devices.device_terminal_assignments
     where id = new.terminal_assignment_id;
    if not found then
      raise exception 'KLUY-PROVCODE-ASSIGNMENT-MISSING: terminal assignment % does not exist',
        new.terminal_assignment_id using errcode = 'P0001';
    end if;
    if v_assignment.device_id is distinct from new.terminal_device_id
       or v_assignment.store_location_id is distinct from new.store_location_id
       or v_assignment.terminal_profile_key is distinct from new.terminal_profile_key then
      raise exception
        'KLUY-PROVCODE-SCOPE-INCONSISTENT: the code names a device, location or profile its assignment does not'
        using errcode = 'P0001';
    end if;
    -- The Hub reference must be a device assigned to the SAME Tenant, Store
    -- and Location.
    select * into v_hub_assignment
      from kitluy_devices.device_assignments
     where device_id = new.store_hub_device_id
       and tenant_id = new.tenant_id
       and digital_store_id = new.digital_store_id
       and store_location_id = new.store_location_id
       and state in ('pending_trust', 'active')
     limit 1;
    if not found then
      raise exception
        'KLUY-PROVCODE-SCOPE-INCONSISTENT: the named Hub has no assignment to the code''s Tenant/Store/Location'
        using errcode = 'P0001';
    end if;
    -- Group 0167: replacement lineage, when present, names the IMMEDIATE
    -- predecessor — an EXPIRED row of exactly the same scope, Hub, terminal,
    -- assignment, profile and environment. A live predecessor cannot be
    -- replaced; a cross-scope predecessor is a fabrication.
    if new.replaces_provisioning_code_id is not null then
      select * into v_predecessor
        from kitluy_devices.device_provisioning_codes
       where id = new.replaces_provisioning_code_id;
      if not found then
        raise exception
          'KLUY-PROVCODE-LINEAGE-MISSING: the named predecessor % does not exist',
          new.replaces_provisioning_code_id using errcode = 'P0001';
      end if;
      if v_predecessor.state <> 'expired' then
        raise exception
          'KLUY-PROVCODE-LINEAGE-NOT-EXPIRED: only an expired code may be replaced; predecessor % is %',
          v_predecessor.id, v_predecessor.state using errcode = 'P0001';
      end if;
      if v_predecessor.tenant_id is distinct from new.tenant_id
         or v_predecessor.digital_store_id is distinct from new.digital_store_id
         or v_predecessor.store_location_id is distinct from new.store_location_id
         or v_predecessor.store_hub_device_id is distinct from new.store_hub_device_id
         or v_predecessor.terminal_device_id is distinct from new.terminal_device_id
         or v_predecessor.terminal_assignment_id is distinct from new.terminal_assignment_id
         or v_predecessor.terminal_profile_key is distinct from new.terminal_profile_key
         or v_predecessor.environment is distinct from new.environment then
        raise exception
          'KLUY-PROVCODE-LINEAGE-INCONSISTENT: a replacement must share the exact scope, Hub, terminal, assignment, profile and environment of its predecessor'
          using errcode = 'P0001';
      end if;
    end if;
    -- Group 0171: a row is never BORN redeemed; redemption references arrive
    -- only through the governed door's ISSUED->REDEEMED transition.
    if new.state = 'redeemed'
       or new.redemption_idempotency_key is not null
       or new.redeemed_with_challenge_id is not null
       or new.redeemed_certificate_id is not null then
      raise exception
        'KLUY-PROVCODE-REDEMPTION-AT-BIRTH: a provisioning code cannot be inserted already redeemed'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'KLUY-PROVCODE-IMMUTABLE: a provisioning code is never deleted; its outcome is recorded'
      using errcode = 'P0001';
  end if;

  -- Scope, digest, payload, expiry and replacement lineage are fixed at
  -- issue (claim pattern; lineage joined the immutable set in group 0167).
  if new.tenant_id is distinct from old.tenant_id
     or new.digital_store_id is distinct from old.digital_store_id
     or new.store_location_id is distinct from old.store_location_id
     or new.store_hub_device_id is distinct from old.store_hub_device_id
     or new.terminal_device_id is distinct from old.terminal_device_id
     or new.terminal_assignment_id is distinct from old.terminal_assignment_id
     or new.terminal_profile_key is distinct from old.terminal_profile_key
     or new.environment is distinct from old.environment
     or new.code_digest is distinct from old.code_digest
     or new.digest_algorithm is distinct from old.digest_algorithm
     or new.payload_sha256 is distinct from old.payload_sha256
     or new.expires_at is distinct from old.expires_at
     or new.replaces_provisioning_code_id is distinct from old.replaces_provisioning_code_id then
    raise exception
      'KLUY-PROVCODE-IMMUTABLE: scope, digest, payload, expiry and lineage are fixed at issue; only the state may close'
      using errcode = 'P0001';
  end if;

  -- One-way machine: ISSUED is the only live state; nothing closed reopens.
  if old.state <> 'issued' and new.state is distinct from old.state then
    raise exception 'KLUY-PROVCODE-CLOSED: provisioning code % is already %',
      old.id, old.state using errcode = 'P0001';
  end if;

  -- Attempt evidence is monotonic: it may increase, never decrease.
  if new.failed_attempt_count < old.failed_attempt_count then
    raise exception
      'KLUY-PROVCODE-ATTEMPTS-NOT-MONOTONIC: failed_attempt_count may not decrease (% -> %)',
      old.failed_attempt_count, new.failed_attempt_count
      using errcode = 'P0001';
  end if;

  -- Group 0171: the redemption references are written exactly once, together
  -- with the ISSUED->REDEEMED transition, and are frozen afterwards. A code
  -- that is not transitioning to redeemed may never carry or change them.
  if old.state = 'issued' and (new.state is null or new.state = 'issued') then
    if new.redemption_idempotency_key is not null
       or new.redeemed_with_challenge_id is not null
       or new.redeemed_certificate_id is not null then
      raise exception
        'KLUY-PROVCODE-REDEMPTION-NOT-STAGED: redemption references arrive only with the redeemed transition'
        using errcode = 'P0001';
    end if;
  end if;
  if old.state <> 'issued'
     and (new.redemption_idempotency_key is distinct from old.redemption_idempotency_key
          or new.redeemed_with_challenge_id is distinct from old.redeemed_with_challenge_id
          or new.redeemed_certificate_id is distinct from old.redeemed_certificate_id) then
    raise exception
      'KLUY-PROVCODE-REDEMPTION-IMMUTABLE: a recorded redemption binding is never rewritten'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. THE ATOMIC REDEMPTION DOOR (internal; harness-only until P02C)
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.redeem_terminal_provisioning_code_v1(
  p_terminal_assignment_id uuid,
  p_presented_code text,
  p_pop_challenge_id uuid,
  p_idempotency_key text,
  p_certificate_serial text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $redeem$
declare
  v_challenge kitluy_devices.device_provisioning_pop_challenges;
  v_device kitluy_devices.devices;
  v_assignment kitluy_devices.device_terminal_assignments;
  v_scope kitluy_devices.device_assignments;
  v_code kitluy_devices.device_provisioning_codes;
  v_enrollment kitluy_devices.manufacturing_enrollments;
  v_prior kitluy_devices.device_provisioning_codes;
  v_existing_cert kitluy_devices.device_certificates;
  v_certificate kitluy_devices.device_certificates;
  v_time_status text;
  v_normalized text;
  v_now timestamptz;
  v_hub_alive integer;
  v_environment text;
  v_certificate_id uuid;
  v_credential_action text;
begin
  -- CONTRACT. Refusals are jsonb, never raised errors.
  if p_terminal_assignment_id is null or p_pop_challenge_id is null then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-CONTRACT',
      'detail', 'a redemption names exactly one assignment and one proof challenge');
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-NO-IDEMPOTENCY-KEY',
      'detail', 'a redemption needs its own idempotency key');
  end if;
  -- The 0164/0166 normalization rule, verbatim: lowercase Crockford letters
  -- normalize to uppercase; nothing is trimmed or aliased.
  v_normalized := upper(coalesce(p_presented_code, ''));
  if length(v_normalized) <> 8
     or v_normalized !~ '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$' then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-CODE-MALFORMED',
      'detail', 'the presented value is not an eight-character Crockford code');
  end if;
  if p_certificate_serial is null or btrim(p_certificate_serial) = ''
     or length(p_certificate_serial) > 128 or p_certificate_serial ~ '[[:cntrl:]]' then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-SERIAL-MALFORMED',
      'detail', 'the certificate serial must be present, bounded and printable');
  end if;

  -- 1. REDEMPTION IDEMPOTENCY FIRST (re-checked under the locks below).
  select * into v_prior
    from kitluy_devices.device_provisioning_codes
   where redemption_idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_prior.terminal_assignment_id = p_terminal_assignment_id
       and v_prior.redeemed_with_challenge_id = p_pop_challenge_id
       and kitluy_devices.constant_time_text_eq_v1(
             encode(extensions.digest(v_normalized, 'sha256'), 'hex'), v_prior.code_digest) then
      return jsonb_build_object(
        'outcome', 'ALREADY_REDEEMED',
        'provisioning_code_id', v_prior.id,
        'pop_challenge_id', v_prior.redeemed_with_challenge_id,
        'certificate_id', v_prior.redeemed_certificate_id,
        'terminal_assignment_id', v_prior.terminal_assignment_id,
        'redeemed_at', v_prior.redeemed_at,
        'replay', true,
        'detail', 'this idempotency key already completed this redemption; nothing was repeated');
    end if;
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-CONFLICTING-REPLAY',
      'detail', 'this idempotency key was used for a different redemption');
  end if;

  -- 2. THE PROOF, READ ONCE to derive lock targets; everything is re-read
  -- under the locks. Lock order: DEVICE -> ASSIGNMENT -> CODE -> CHALLENGE —
  -- consistent with 0121 (device before assignments) and with every
  -- 0163-0170 door (assignment before code before challenge); no cycle
  -- exists against any established door.
  select * into v_challenge
    from kitluy_devices.device_provisioning_pop_challenges
   where id = p_pop_challenge_id;
  if not found then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-PROOF-NOT-FOUND',
      'detail', 'no proof challenge with that id');
  end if;
  if v_challenge.terminal_assignment_id is distinct from p_terminal_assignment_id then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-PROOF-WRONG-ASSIGNMENT',
      'detail', 'the proof is bound to a different terminal assignment');
  end if;

  select * into v_device
    from kitluy_devices.devices
   where id = v_challenge.terminal_device_id
   for update;
  select * into v_assignment
    from kitluy_devices.device_terminal_assignments
   where id = p_terminal_assignment_id
   for update;
  if v_assignment.id is null or v_assignment.device_id is distinct from v_device.id then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-ASSIGNMENT-MISMATCH',
      'detail', 'the assignment does not bind the proof''s terminal');
  end if;
  select * into v_code
    from kitluy_devices.device_provisioning_codes
   where id = v_challenge.provisioning_code_id
   for update;
  select * into v_challenge
    from kitluy_devices.device_provisioning_pop_challenges
   where id = p_pop_challenge_id
   for update;

  -- Idempotency AGAIN, under the locks: a same-key race waits above and must
  -- be answered as the stable replay.
  select * into v_prior
    from kitluy_devices.device_provisioning_codes
   where redemption_idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_prior.terminal_assignment_id = p_terminal_assignment_id
       and v_prior.redeemed_with_challenge_id = p_pop_challenge_id
       and kitluy_devices.constant_time_text_eq_v1(
             encode(extensions.digest(v_normalized, 'sha256'), 'hex'), v_prior.code_digest) then
      return jsonb_build_object(
        'outcome', 'ALREADY_REDEEMED',
        'provisioning_code_id', v_prior.id,
        'pop_challenge_id', v_prior.redeemed_with_challenge_id,
        'certificate_id', v_prior.redeemed_certificate_id,
        'terminal_assignment_id', v_prior.terminal_assignment_id,
        'redeemed_at', v_prior.redeemed_at,
        'replay', true,
        'detail', 'this idempotency key already completed this redemption; nothing was repeated');
    end if;
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-CONFLICTING-REPLAY',
      'detail', 'this idempotency key was used for a different redemption');
  end if;

  -- 3. FINAL AUTHORITATIVE RECHECKS, ALL BEFORE ANY MUTATION.
  if v_assignment.state not in ('pending_trust', 'active') then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-ASSIGNMENT-INACTIVE',
      'detail', format('the terminal assignment is %s, not live', v_assignment.state));
  end if;
  if v_assignment.terminal_profile_key is distinct from v_challenge.terminal_profile_key then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-PROOF-WRONG-PROFILE',
      'detail', 'the proof is bound to a different terminal profile');
  end if;
  select * into v_scope
    from kitluy_devices.device_assignments
   where id = v_assignment.assignment_id;
  if not found
     or v_scope.tenant_id is distinct from v_challenge.tenant_id
     or v_scope.digital_store_id is distinct from v_challenge.digital_store_id
     or v_scope.store_location_id is distinct from v_challenge.store_location_id then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-SCOPE-MISMATCH',
      'detail', 'the proof is bound to a different Tenant, Store or Location');
  end if;

  -- The BOUND Hub must still be projected at the scope (ADMIN-QA-014).
  select count(*) into v_hub_alive
    from kitluy_devices.device_assignment_projections p
   where p.device_id = v_challenge.store_hub_device_id
     and p.tenant_id = v_challenge.tenant_id
     and p.digital_store_id = v_challenge.digital_store_id
     and p.store_location_id = v_challenge.store_location_id;
  if v_hub_alive = 0 then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-HUB-INACTIVE',
      'detail', 'the bound Store Hub is no longer active at this scope');
  end if;
  v_environment := v_challenge.environment;

  -- THE CODE: current, outstanding, unexpired, and POSSESSED — the presented
  -- raw value re-verifies against the stored digest in constant time. An
  -- earlier match-ready evaluator answer is never accepted as possession.
  v_now := kitluy_ops.authoritative_now_v1();
  if v_code.id is null then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-CODE-MISSING',
      'detail', 'the proof''s bound provisioning code no longer exists');
  end if;
  if v_code.state <> 'issued' then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-CODE-ALREADY-' || upper(v_code.state::text),
      'provisioning_code_id', v_code.id,
      'detail', format('the code is already %s; terminal states are never overwritten', v_code.state));
  end if;
  if v_now >= v_code.expires_at then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-CODE-EXPIRED',
      'detail', 'the code is past its authoritative expiry');
  end if;
  if v_code.failed_attempt_count >= 5 then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-CODE-ATTEMPTS-EXHAUSTED',
      'detail', 'the code has exhausted its presentation attempts');
  end if;
  if v_code.terminal_assignment_id is distinct from v_assignment.id then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-SCOPE-MISMATCH',
      'detail', 'the code does not belong to this assignment');
  end if;
  if not kitluy_devices.constant_time_text_eq_v1(
           encode(extensions.digest(v_normalized, 'sha256'), 'hex'), v_code.code_digest) then
    -- Wrong value at redemption: refuse with NO attempt increment — bounded
    -- attempt counting is the 0164 evaluator's one ownership, and this door
    -- is internal composition, not the public presentation surface.
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-CODE-MISMATCH',
      'detail', 'the presented value does not match the outstanding code');
  end if;

  -- THE PROOF: verified, unconsumed, unexpired, bound to exactly this code.
  if v_challenge.state = 'consumed' then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-PROOF-ALREADY-CONSUMED',
      'detail', 'this proof was already consumed by a redemption');
  end if;
  if v_challenge.state <> 'verified' then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-PROOF-NOT-VERIFIED',
      'detail', 'the proof challenge has not been verified');
  end if;
  if v_now >= v_challenge.expires_at then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-PROOF-EXPIRED',
      'detail', 'the proof expired on the authoritative clock');
  end if;
  if v_challenge.provisioning_code_id is distinct from v_code.id then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-PROOF-WRONG-CODE',
      'detail', 'the proof is bound to a different provisioning code');
  end if;

  -- THE ENROLLMENT AND KEY: still the current sealed enrollment the proof
  -- verified, with the same fingerprint (the device row is LOCKED, so
  -- current_enrollment_id cannot move under us).
  select e.* into v_enrollment
    from kitluy_devices.manufacturing_enrollments e
   where e.id = v_device.current_enrollment_id;
  if not found
     or v_enrollment.id is distinct from v_challenge.terminal_enrollment_id
     or v_enrollment.state <> 'sealed'
     or v_enrollment.revoked_at is not null
     or v_enrollment.device_public_key_fingerprint is distinct from v_challenge.terminal_key_fingerprint then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-ENROLLMENT-INELIGIBLE',
      'detail', 'the enrollment bound at proof time is no longer the current sealed enrollment');
  end if;

  -- Trusted time, POLITELY (the certificate authority asserts it again).
  select status::text into v_time_status
    from kitluy_devices.device_trusted_time where device_id = v_device.id;
  if v_time_status is null or v_time_status <> 'trusted' then
    return jsonb_build_object(
      'outcome', 'REDEMPTION_REFUSED',
      'refusal_code', 'KLUY-REDEEM-NO-TRUSTED-TIME',
      'detail', coalesce('the terminal is in trust mode ' || v_time_status, 'the terminal has never established trusted time'));
  end if;

  -- 4. THE CREDENTIAL: select-and-bind the ONE eligible active certificate,
  -- or synchronously issue it through the EXISTING governed authority.
  select * into v_existing_cert
    from kitluy_devices.device_certificates
   where device_id = v_device.id and environment = v_environment and status = 'active';
  if found then
    if v_existing_cert.enrollment_id = v_enrollment.id
       and v_existing_cert.public_key_fingerprint = v_enrollment.device_public_key_fingerprint then
      v_certificate_id := v_existing_cert.id;
      v_credential_action := 'BOUND';
    else
      return jsonb_build_object(
        'outcome', 'REDEMPTION_REFUSED',
        'refusal_code', 'KLUY-REDEEM-CREDENTIAL-CONFLICT',
        'detail', 'an active certificate exists for another enrollment or key; governed credential revocation must resolve it first');
    end if;
  else
    -- Synchronous issuance INSIDE this transaction. BLK-005 and trusted time
    -- are asserted by the authority itself; any refusal it raises is caught
    -- here BEFORE any mutation, so the answer is a stable refusal and the
    -- transaction commits clean with zero residue.
    begin
      v_certificate_id := kitluy_devices.issue_device_certificate_v1(
        v_device.id, v_environment, p_certificate_serial,
        v_enrollment.device_public_key_fingerprint, 'PROVISIONING-REDEMPTION');
      v_credential_action := 'ISSUED';
    exception when others then
      return jsonb_build_object(
        'outcome', 'REDEMPTION_REFUSED',
        'refusal_code', 'KLUY-REDEEM-CREDENTIAL-REFUSED',
        'detail', sqlerrm);
    end;
  end if;

  -- 5. THE ATOMIC COMPLETION. Proof consumption, code redemption and the one
  -- REDEEMED event commit together — with the certificate — or not at all.
  update kitluy_devices.device_provisioning_pop_challenges
     set state = 'consumed', consumed_at = v_now
   where id = v_challenge.id and state = 'verified';
  if not found then
    raise exception 'KLUY-REDEEM-PROOF-RACE: the proof changed under its lock' using errcode = 'P0001';
  end if;

  update kitluy_devices.device_provisioning_codes
     set state = 'redeemed',
         redeemed_at = v_now,
         redemption_idempotency_key = p_idempotency_key,
         redeemed_with_challenge_id = v_challenge.id,
         redeemed_certificate_id = v_certificate_id
   where id = v_code.id and state = 'issued';
  if not found then
    raise exception 'KLUY-REDEEM-CODE-RACE: the code changed under its lock' using errcode = 'P0001';
  end if;

  insert into kitluy_devices.device_provisioning_code_events
    (provisioning_code_id, tenant_id, digital_store_id, store_location_id, environment,
     event_type, actor_type, actor_ref, correlation_id, detail)
  values
    (v_code.id, v_code.tenant_id, v_code.digital_store_id, v_code.store_location_id,
     v_code.environment, 'REDEEMED', 'TERMINAL', v_device.id::text, v_challenge.correlation_id,
     jsonb_build_object(
       'pop_challenge_id', v_challenge.id,
       'certificate_id', v_certificate_id,
       'credential_action', v_credential_action));

  select * into v_certificate
    from kitluy_devices.device_certificates where id = v_certificate_id;

  -- Safe public credential material only: no private key, no raw code, no
  -- digest, no signer internals.
  return jsonb_build_object(
    'outcome', 'REDEEMED',
    'provisioning_code_id', v_code.id,
    'pop_challenge_id', v_challenge.id,
    'certificate_id', v_certificate_id,
    'credential_action', v_credential_action,
    'certificate_serial', v_certificate.certificate_serial,
    'certificate_fingerprint', v_certificate.public_key_fingerprint,
    'certificate_issued_at', v_certificate.issued_at,
    'certificate_expires_at', v_certificate.expires_at,
    'terminal_device_id', v_device.id,
    'terminal_assignment_id', v_assignment.id,
    'store_hub_device_id', v_challenge.store_hub_device_id,
    'terminal_profile_key', v_assignment.terminal_profile_key,
    'environment', v_environment,
    'redeemed_at', v_now,
    'consumed_at', v_now,
    'correlation_id', v_challenge.correlation_id,
    'detail', 'provisioning completed atomically; activation and pairing remain later, separately governed steps');
end
$redeem$;

comment on function kitluy_devices.redeem_terminal_provisioning_code_v1(uuid, text, uuid, text, text) is
  'Group 0171 (WS-11-T004-P02B3B). The internal governed ATOMIC completion of terminal provisioning (pairing protocol §7). Requires BOTH possessions revalidated under DEVICE->ASSIGNMENT->CODE->CHALLENGE locks: the presented raw code re-verified against the stored digest in constant time (MATCH_READY is never proof) AND one VERIFIED unconsumed 0170 proof bound to exactly this code/assignment/Hub/profile/environment/enrollment/fingerprint. One transaction selects-and-binds the eligible active certificate or synchronously issues one through issue_device_certificate_v1 (BLK-005 development-approved; pilot/production fail closed inside the same authority), consumes the proof (VERIFIED->CONSUMED), redeems the code (ISSUED->REDEEMED with idempotency key, proof and certificate references frozen by the extended 0162 trigger) and appends the one REDEEMED event. Any failure leaves everything unchanged. Identical replay answers ALREADY_REDEEMED; conflicting replay fails closed. Raw code and private keys are never stored or returned. Harness-only until P02C composes production; activation and pairing are NOT performed here.';

alter function kitluy_devices.redeem_terminal_provisioning_code_v1(uuid, text, uuid, text, text)
  owner to kitluy_activation_governor;
revoke all on function kitluy_devices.redeem_terminal_provisioning_code_v1(uuid, text, uuid, text, text) from public;
revoke all on function kitluy_devices.redeem_terminal_provisioning_code_v1(uuid, text, uuid, text, text) from anon;
revoke all on function kitluy_devices.redeem_terminal_provisioning_code_v1(uuid, text, uuid, text, text) from authenticated;
revoke all on function kitluy_devices.redeem_terminal_provisioning_code_v1(uuid, text, uuid, text, text) from service_role;
grant execute on function kitluy_devices.redeem_terminal_provisioning_code_v1(uuid, text, uuid, text, text)
  to kitluy_test_harness;

do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- 4. PROVE THE BOUNDARY ON APPLY (non-vacuous assertions)
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_door_def text;
  v_trigger_def text;
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname = 'redeem_terminal_provisioning_code_v1'
       and pg_get_function_arguments(p.oid)
           = 'p_terminal_assignment_id uuid, p_presented_code text, p_pop_challenge_id uuid, p_idempotency_key text, p_certificate_serial text'
       and p.prosecdef
       and pg_get_userbyid(p.proowner) = 'kitluy_activation_governor'
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then
    raise exception 'KLUY-MIGRATION-0171: the redemption door is missing, mis-signed, not definer, not governor-owned or unpinned'
      using errcode = 'P0001';
  end if;

  if has_function_privilege('public', 'kitluy_devices.redeem_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'kitluy_devices.redeem_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.redeem_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.redeem_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or has_function_privilege('kitluy_worker_service', 'kitluy_devices.redeem_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or not has_function_privilege('kitluy_test_harness', 'kitluy_devices.redeem_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0171: the redemption door grant boundary is wrong'
      using errcode = 'P0001';
  end if;

  -- The door proves the structural contract: both possessions, the Hub gate,
  -- the enrollment gate, the credential authority reuse, constant-time
  -- comparison, and NO acceptance of MATCH_READY.
  select pg_get_functiondef(p.oid) into v_door_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices' and p.proname = 'redeem_terminal_provisioning_code_v1';
  if v_door_def not like '%constant_time_text_eq_v1%'
     or v_door_def not like '%issue_device_certificate_v1%'
     or v_door_def not like '%device_assignment_projections%'
     or v_door_def not like '%current_enrollment_id%'
     or v_door_def not like '%device_trusted_time%' then
    raise exception 'KLUY-MIGRATION-0171: a required recheck is missing from the redemption door'
      using errcode = 'P0001';
  end if;
  if v_door_def like '%MATCH_READY%' then
    raise exception 'KLUY-MIGRATION-0171: the door must never consult MATCH_READY as possession'
      using errcode = 'P0001';
  end if;

  -- The redemption columns exist, are constrained together, and are frozen
  -- by the extended trigger (which keeps every earlier rule verbatim).
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'kitluy_devices' and table_name = 'device_provisioning_codes'
       and column_name = 'redemption_idempotency_key')
     or not exists (
    select 1 from pg_indexes
     where schemaname = 'kitluy_devices'
       and indexname = 'uq_device_provisioning_codes_redemption_key')
     or not exists (
    select 1 from pg_indexes
     where schemaname = 'kitluy_devices'
       and indexname = 'uq_device_provisioning_codes_one_code_per_proof') then
    raise exception 'KLUY-MIGRATION-0171: the redemption representation is incomplete'
      using errcode = 'P0001';
  end if;
  select pg_get_functiondef(p.oid) into v_trigger_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices' and p.proname = 'enforce_provisioning_code_integrity';
  if v_trigger_def not like '%KLUY-PROVCODE-LINEAGE-NOT-EXPIRED%'
     or v_trigger_def not like '%KLUY-PROVCODE-REDEMPTION-IMMUTABLE%'
     or v_trigger_def not like '%KLUY-PROVCODE-REDEMPTION-NOT-STAGED%'
     or v_trigger_def not like '%KLUY-PROVCODE-REDEMPTION-AT-BIRTH%'
     or v_trigger_def not like '%KLUY-PROVCODE-ATTEMPTS-NOT-MONOTONIC%' then
    raise exception 'KLUY-MIGRATION-0171: the extended integrity trigger lost a rule'
      using errcode = 'P0001';
  end if;

  -- FORCE RLS still holds on every table this door touches; the one-active
  -- certificate rule stands.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_devices'
       and c.relname in ('device_provisioning_codes', 'device_provisioning_code_events',
                         'device_provisioning_pop_challenges', 'device_certificates')
       and (not c.relrowsecurity or not c.relforcerowsecurity)) then
    raise exception 'KLUY-MIGRATION-0171: FORCE RLS no longer holds on a redemption-path table'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'kitluy_devices'
       and indexname = 'device_certificates_one_active_per_env_idx') then
    raise exception 'KLUY-MIGRATION-0171: the one-active-certificate rule is missing'
      using errcode = 'P0001';
  end if;

  -- No raw-code or private-key capable column joined either table.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'kitluy_devices'
       and table_name in ('device_provisioning_codes', 'device_provisioning_pop_challenges')
       and (column_name ~ '(^|_)(raw|plain|secret|private)(_|$)')) then
    raise exception 'KLUY-MIGRATION-0171: a raw or private-material column exists'
      using errcode = 'P0001';
  end if;

  -- Earlier boundaries stand exactly as 0169/0170 asserted them.
  if not has_function_privilege('authenticated', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'kitluy_devices.recover_terminal_provisioning_code_v1(uuid, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or not has_function_privilege('kitluy_test_harness', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid)', 'execute')
     or not has_function_privilege('kitluy_test_harness', 'kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.record_terminal_provisioning_pop_verification_v1(uuid, boolean, text, text)', 'execute')
     or not has_function_privilege('kitluy_test_harness', 'kitluy_devices.record_terminal_provisioning_pop_verification_v1(uuid, boolean, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0171: an earlier provisioning or PoP boundary drifted'
      using errcode = 'P0001';
  end if;

  -- No login-capable role holds the NOLOGIN owner.
  if exists (
    select 1 from pg_auth_members m
      join pg_roles r on r.oid = m.member
     where m.roleid = (select oid from pg_roles where rolname = 'kitluy_activation_governor')
       and r.rolcanlogin
       -- PG16+ (KLREC-2026-08-07-PG16-CREATEROLE-001): exclude the automatic,
       -- un-removable membership PostgreSQL 16 grants the creating role. Any
       -- other login-capable member is still a finding.
       and not (r.rolname = current_user and m.grantor <> m.member)) then
    raise exception 'KLUY-MIGRATION-0171: a login-capable role is a member of the governor'
      using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-MIGRATION-0171: atomic PoP-bound redemption applied (dual-possession recheck under DEVICE->ASSIGNMENT->CODE->CHALLENGE locks; select-and-bind or synchronous issue via the BLK-005-gated certificate authority; VERIFIED->CONSUMED + ISSUED->REDEEMED + one REDEEMED event in one transaction; harness-only until P02C; activation and pairing remain later steps; P02B3C owns broad race hardening)';
end
$guard$;
