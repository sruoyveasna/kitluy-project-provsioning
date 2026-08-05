-- kitluy:group:0174
-- Migration group 0174: terminal_activation_completion.
--
-- Authority: WS-11-T004-P03A (package contract); pairing protocol §7 (the
-- terminal receives its credential, then "mark terminal active" is a LATER,
-- separate step); groups 0170/0171 (PoP challenge and atomic redemption),
-- 0120/0121 (certificates, device and assignment lifecycle), 0172/0173 (the
-- composition identity and its NOINHERIT entry boundary).
--
-- ACTIVATION-CAPABILITY CLASSIFICATION (recorded): **B — PARTIAL AUTHORITY,
-- ADDITIVE ACTIVATION STATE REQUIRED.** `attempt_activate_device_v1` (0121)
-- exists and flips a device to `active` once a certificate row and trusted
-- time exist — the Store Hub path. It proves NOTHING about the terminal
-- having received and installed its credential, so it cannot serve as
-- terminal provisioning completion. No credential-acknowledgment authority,
-- no activation challenge and no provisioning-completion record existed.
-- This group adds exactly those, and does NOT duplicate, bypass or modify
-- 0121.
--
-- ===========================================================================
-- THE DISTINCTION THIS GROUP EXISTS TO ENFORCE
-- ===========================================================================
-- A terminal must NOT become active because the cloud transaction succeeded.
-- These are separate, separately recorded facts:
--
--   code redeemed        -> device_provisioning_codes.state = 'redeemed'  (0171)
--   proof consumed       -> pop_challenges.state = 'consumed'             (0170/0171)
--   credential exists    -> device_certificates row                       (0120/0171)
--   ready for delivery   -> THIS group: an activation record exists
--   terminal acknowledged-> THIS group: a signed acknowledgment verified
--   terminal activated   -> THIS group: activated_at written
--
-- DELIVERY IS DELIBERATELY ABSENT. The repository has no Store Hub delivery
-- protocol and therefore no delivery evidence, so there is no DELIVERED
-- state: inventing one would let a row assert something nothing can prove.
-- `ready_for_delivery` means "the cloud has everything the terminal needs",
-- never "the terminal received it".
--
-- ACTIVATION AND COMPLETION ARE THE SAME INSTANT in this scope (recorded
-- decision): once a terminal proves it holds the credential, no further
-- cloud-side provisioning step exists. `activated_at` IS provisioning
-- completion; pairing (§8) is separate work with its own evidence, not a
-- later phase of this record.
--
-- ===========================================================================
-- kitluy:destructive-approved:WS-11-T004-P03A -- no DROP/TRUNCATE/DELETE in
-- this group; the marker is present so the destructive-guard never reads a
-- future edit of this file as unmarked history.
-- ===========================================================================

do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. THE ACTIVATION RECORD
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_terminal_provisioning_activations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  digital_store_id uuid not null,
  store_location_id uuid not null,
  environment text not null,
  store_hub_device_id uuid not null references kitluy_devices.devices (id),
  terminal_device_id uuid not null references kitluy_devices.devices (id),
  terminal_assignment_id uuid not null references kitluy_devices.device_terminal_assignments (id),
  terminal_profile_key text not null,
  -- The redeemed provisioning result this activation completes. ONE
  -- activation lineage per redeemed code.
  provisioning_code_id uuid not null unique
    references kitluy_devices.device_provisioning_codes (id),
  pop_challenge_id uuid not null unique
    references kitluy_devices.device_provisioning_pop_challenges (id),
  terminal_enrollment_id uuid not null references kitluy_devices.manufacturing_enrollments (id),
  terminal_key_fingerprint text not null
    constraint dtpa_fingerprint_chk check (terminal_key_fingerprint ~ '^[0-9a-f]{64}$'),
  certificate_id uuid not null references kitluy_devices.device_certificates (id),
  -- No DELIVERED state: the repository has no delivery evidence to record.
  state text not null default 'ready_for_delivery'
    constraint dtpa_state_chk check (state in ('ready_for_delivery', 'activated')),
  created_at timestamptz not null,
  -- Written together, once, by the governed completion door.
  acknowledged_at timestamptz,
  activated_at timestamptz,
  redemption_correlation_id uuid not null,
  activation_correlation_id uuid not null,
  activation_idempotency_key text,
  constraint dtpa_activated_chk
    check ((state = 'activated') = (activated_at is not null)
           and (activated_at is null) = (acknowledged_at is null)
           and (activated_at is null) = (activation_idempotency_key is null)),
  -- Completion can never precede activation, nor activation its own record.
  constraint dtpa_order_chk
    check (activated_at is null or activated_at >= created_at)
);

comment on table kitluy_devices.device_terminal_provisioning_activations is
  'Owner: Fleet. Group 0174 (WS-11-T004-P03A). ONE row per redeemed terminal provisioning result, binding it relationally and immutably to the terminal, assignment, T1-T4 profile, Store Hub, scope, environment, consumed PoP proof, current sealed enrollment, enrolled key fingerprint and the issued/bound certificate. State is a one-way machine ready_for_delivery -> activated. `ready_for_delivery` means the cloud holds everything the terminal needs; it NEVER claims the credential was delivered — no Store Hub delivery protocol exists, so no delivery evidence exists to record. `activated` is written ONLY by the governed completion door after a terminal-signed acknowledgment is verified against the enrolled key, and is simultaneously provisioning completion (no further cloud-side step exists; pairing is separate work). MC: MUT (state machine only).';

create index if not exists idx_dtpa_assignment
  on kitluy_devices.device_terminal_provisioning_activations (terminal_assignment_id);
create index if not exists idx_dtpa_certificate
  on kitluy_devices.device_terminal_provisioning_activations (certificate_id);
create unique index if not exists uq_dtpa_activation_key
  on kitluy_devices.device_terminal_provisioning_activations (activation_idempotency_key)
  where activation_idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- 2. THE ACTIVATION CHALLENGE (distinct from the consumed 0170 PoP challenge)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_terminal_activation_challenges (
  id uuid primary key default gen_random_uuid(),
  challenge_version text not null default 'kitluy.activation-ack.v1'
    constraint dtac_version_chk check (challenge_version = 'kitluy.activation-ack.v1'),
  purpose text not null default 'terminal_provisioning_activation_acknowledgment'
    constraint dtac_purpose_chk
    check (purpose = 'terminal_provisioning_activation_acknowledgment'),
  activation_id uuid not null
    references kitluy_devices.device_terminal_provisioning_activations (id),
  -- 32 secure-random bytes, hex. Raw by design, exactly as 0170: it is not a
  -- bearer secret (only a signature under the ENROLLED key verifies) and the
  -- verifier must reconstruct the exact signed bytes from this row.
  nonce text not null
    constraint dtac_nonce_chk check (nonce ~ '^[0-9a-f]{64}$'),
  state text not null default 'issued'
    constraint dtac_state_chk check (state in ('issued', 'consumed')),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  -- OPTION B attestation (0127/0170 pattern): the SERVICE verified the
  -- Ed25519 signature. Only TRUE is ever storable — a failed verification is
  -- a refusal with no row transition, never a stored "false proof".
  attested_signature_verified boolean
    constraint dtac_attested_true_chk
    check (attested_signature_verified is null or attested_signature_verified = true),
  attested_challenge_hash text
    constraint dtac_hash_chk
    check (attested_challenge_hash is null or attested_challenge_hash ~ '^[0-9a-f]{64}$'),
  correlation_id uuid not null,
  constraint dtac_window_chk check (expires_at > created_at),
  constraint dtac_consumed_chk
    check ((state = 'consumed') = (consumed_at is not null)
           and (consumed_at is null) = (attested_signature_verified is null)
           and (consumed_at is null) = (attested_challenge_hash is null))
);

comment on table kitluy_devices.device_terminal_activation_challenges is
  'Owner: Fleet. Group 0174 (WS-11-T004-P03A). The server-generated activation-acknowledgment challenge. NEVER the consumed 0170 PoP challenge — a fresh domain (kitluy.activation-ack.v1) and a fresh purpose, so a provisioning proof can never be replayed as an activation acknowledgment. One-way issued -> consumed; at most one outstanding challenge per activation (partial unique index). Expiry inherits the bound certificate''s own expires_at (recorded decision: no independent TTL is invented, and an acknowledgment can never outlive the credential it acknowledges). Under OPTION B the Ed25519 verification lives in @kitluy/device-identity; this table records the service attestation, never a signature, never a key. MC: MUT (state machine only).';

create unique index if not exists uq_dtac_one_outstanding
  on kitluy_devices.device_terminal_activation_challenges (activation_id)
  where state = 'issued';
create index if not exists idx_dtac_activation
  on kitluy_devices.device_terminal_activation_challenges (activation_id);

-- ---------------------------------------------------------------------------
-- 3. IMMUTABILITY AND THE ONE-WAY MACHINES
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.enforce_terminal_activation_integrity()
returns trigger
language plpgsql
as $integrity$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-ACTIVATION-IMMUTABLE: activation evidence is never deleted'
      using errcode = 'P0001';
  end if;
  -- Every binding is frozen at preparation. Only the state machine moves.
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.digital_store_id is distinct from old.digital_store_id
     or new.store_location_id is distinct from old.store_location_id
     or new.environment is distinct from old.environment
     or new.store_hub_device_id is distinct from old.store_hub_device_id
     or new.terminal_device_id is distinct from old.terminal_device_id
     or new.terminal_assignment_id is distinct from old.terminal_assignment_id
     or new.terminal_profile_key is distinct from old.terminal_profile_key
     or new.provisioning_code_id is distinct from old.provisioning_code_id
     or new.pop_challenge_id is distinct from old.pop_challenge_id
     or new.terminal_enrollment_id is distinct from old.terminal_enrollment_id
     or new.terminal_key_fingerprint is distinct from old.terminal_key_fingerprint
     or new.certificate_id is distinct from old.certificate_id
     or new.created_at is distinct from old.created_at
     or new.redemption_correlation_id is distinct from old.redemption_correlation_id
     or new.activation_correlation_id is distinct from old.activation_correlation_id then
    raise exception 'KLUY-ACTIVATION-BINDING-IMMUTABLE: activation bindings are frozen at preparation'
      using errcode = 'P0001';
  end if;
  if old.state = 'activated' then
    raise exception 'KLUY-ACTIVATION-CLOSED: an activated terminal provisioning record never changes again'
      using errcode = 'P0001';
  end if;
  if new.state <> 'activated' then
    raise exception 'KLUY-ACTIVATION-STATE-MACHINE: ready_for_delivery may only become activated'
      using errcode = 'P0001';
  end if;
  return new;
end
$integrity$;

create trigger trg_dtpa_integrity
  before update or delete on kitluy_devices.device_terminal_provisioning_activations
  for each row execute function kitluy_devices.enforce_terminal_activation_integrity();

create or replace function kitluy_devices.enforce_activation_challenge_integrity()
returns trigger
language plpgsql
as $chal$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-ACTIVATION-CHALLENGE-IMMUTABLE: challenges are never deleted'
      using errcode = 'P0001';
  end if;
  if new.id is distinct from old.id
     or new.challenge_version is distinct from old.challenge_version
     or new.purpose is distinct from old.purpose
     or new.activation_id is distinct from old.activation_id
     or new.nonce is distinct from old.nonce
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at
     or new.correlation_id is distinct from old.correlation_id then
    raise exception 'KLUY-ACTIVATION-CHALLENGE-BINDING-IMMUTABLE: challenge bindings are frozen at issuance'
      using errcode = 'P0001';
  end if;
  if old.state = 'consumed' then
    raise exception 'KLUY-ACTIVATION-CHALLENGE-CLOSED: a consumed challenge never changes again'
      using errcode = 'P0001';
  end if;
  if new.state <> 'consumed' then
    raise exception 'KLUY-ACTIVATION-CHALLENGE-STATE-MACHINE: issued may only become consumed'
      using errcode = 'P0001';
  end if;
  return new;
end
$chal$;

create trigger trg_dtac_integrity
  before update or delete on kitluy_devices.device_terminal_activation_challenges
  for each row execute function kitluy_devices.enforce_activation_challenge_integrity();

revoke all on function kitluy_devices.enforce_terminal_activation_integrity() from public;
revoke all on function kitluy_devices.enforce_activation_challenge_integrity() from public;

-- Deny-by-absence with the 0126/0163 governor-policy pattern (FORCE RLS with
-- zero policies would block the NOLOGIN definer owner itself).
alter table kitluy_devices.device_terminal_provisioning_activations enable row level security;
alter table kitluy_devices.device_terminal_provisioning_activations force row level security;
alter table kitluy_devices.device_terminal_activation_challenges enable row level security;
alter table kitluy_devices.device_terminal_activation_challenges force row level security;
revoke all on table kitluy_devices.device_terminal_provisioning_activations from public;
revoke all on table kitluy_devices.device_terminal_activation_challenges from public;
create policy dtpa_governor on kitluy_devices.device_terminal_provisioning_activations
  for all to kitluy_activation_governor using (true) with check (true);
create policy dtac_governor on kitluy_devices.device_terminal_activation_challenges
  for all to kitluy_activation_governor using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 4. PREPARATION DOOR
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.prepare_terminal_provisioning_activation_v1(
  p_terminal_assignment_id uuid,
  p_redemption_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $prepare$
declare
  v_device kitluy_devices.devices;
  v_assignment kitluy_devices.device_terminal_assignments;
  v_scope kitluy_devices.device_assignments;
  v_code kitluy_devices.device_provisioning_codes;
  v_challenge kitluy_devices.device_provisioning_pop_challenges;
  v_enrollment kitluy_devices.manufacturing_enrollments;
  v_cert kitluy_devices.device_certificates;
  v_activation kitluy_devices.device_terminal_provisioning_activations;
  v_ack kitluy_devices.device_terminal_activation_challenges;
  v_now timestamptz;
  v_hub_alive integer;
  v_activation_id uuid;
  v_ack_id uuid;
begin
  if p_terminal_assignment_id is null
     or p_redemption_idempotency_key is null or btrim(p_redemption_idempotency_key) = '' then
    return jsonb_build_object(
      'outcome', 'ACTIVATION_PREP_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-CONTRACT',
      'detail', 'a preparation names one assignment and its redemption idempotency key');
  end if;

  -- The redeemed result IS the input. Lock order DEVICE -> ASSIGNMENT -> CODE
  -- -> ACTIVATION -> CHALLENGE extends the established provisioning order and
  -- introduces no cycle.
  select * into v_code
    from kitluy_devices.device_provisioning_codes
   where redemption_idempotency_key = p_redemption_idempotency_key;
  if not found then
    return jsonb_build_object(
      'outcome', 'ACTIVATION_PREP_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-NO-REDEMPTION',
      'detail', 'no redemption committed under that key');
  end if;
  if v_code.terminal_assignment_id is distinct from p_terminal_assignment_id then
    return jsonb_build_object(
      'outcome', 'ACTIVATION_PREP_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-WRONG-ASSIGNMENT',
      'detail', 'the redemption belongs to a different terminal assignment');
  end if;

  select * into v_device from kitluy_devices.devices
   where id = v_code.terminal_device_id for update;
  select * into v_assignment from kitluy_devices.device_terminal_assignments
   where id = p_terminal_assignment_id for update;
  select * into v_code from kitluy_devices.device_provisioning_codes
   where id = v_code.id for update;

  if v_code.state <> 'redeemed' then
    return jsonb_build_object(
      'outcome', 'ACTIVATION_PREP_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-CODE-NOT-REDEEMED',
      'detail', format('the provisioning code is %s, not redeemed', v_code.state));
  end if;
  select * into v_challenge from kitluy_devices.device_provisioning_pop_challenges
   where id = v_code.redeemed_with_challenge_id;
  if not found or v_challenge.state <> 'consumed' then
    return jsonb_build_object(
      'outcome', 'ACTIVATION_PREP_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-PROOF-NOT-CONSUMED',
      'detail', 'the redemption proof is not consumed');
  end if;
  if v_assignment.id is null or v_assignment.state not in ('pending_trust', 'active') then
    return jsonb_build_object(
      'outcome', 'ACTIVATION_PREP_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-ASSIGNMENT-INACTIVE',
      'detail', 'the terminal assignment is not live');
  end if;

  select * into v_scope from kitluy_devices.device_assignments
   where id = v_assignment.assignment_id;
  select count(*) into v_hub_alive
    from kitluy_devices.device_assignment_projections p
   where p.device_id = v_challenge.store_hub_device_id
     and p.tenant_id = v_challenge.tenant_id
     and p.digital_store_id = v_challenge.digital_store_id
     and p.store_location_id = v_challenge.store_location_id;
  if v_hub_alive = 0 then
    return jsonb_build_object(
      'outcome', 'ACTIVATION_PREP_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-HUB-INACTIVE',
      'detail', 'the bound Store Hub is no longer active at this scope');
  end if;

  select e.* into v_enrollment
    from kitluy_devices.manufacturing_enrollments e
   where e.id = v_device.current_enrollment_id;
  if not found
     or v_enrollment.id is distinct from v_challenge.terminal_enrollment_id
     or v_enrollment.state <> 'sealed'
     or v_enrollment.revoked_at is not null then
    return jsonb_build_object(
      'outcome', 'ACTIVATION_PREP_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-ENROLLMENT-INELIGIBLE',
      'detail', 'the enrollment bound at redemption is no longer the current sealed enrollment');
  end if;

  select * into v_cert from kitluy_devices.device_certificates
   where id = v_code.redeemed_certificate_id;
  if not found or v_cert.status <> 'active' then
    return jsonb_build_object(
      'outcome', 'ACTIVATION_PREP_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-CREDENTIAL-INELIGIBLE',
      'detail', 'the bound credential is missing or no longer active');
  end if;
  v_now := kitluy_ops.authoritative_now_v1();
  if v_cert.expires_at is not null and v_now >= v_cert.expires_at then
    return jsonb_build_object(
      'outcome', 'ACTIVATION_PREP_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-CREDENTIAL-EXPIRED',
      'detail', 'the bound credential is past its expiry');
  end if;

  -- IDEMPOTENT PREPARATION: one activation lineage per redeemed code.
  select * into v_activation
    from kitluy_devices.device_terminal_provisioning_activations
   where provisioning_code_id = v_code.id for update;
  if found then
    if v_activation.state = 'activated' then
      return jsonb_build_object(
        'outcome', 'ALREADY_ACTIVATED',
        'activation_id', v_activation.id,
        'terminal_device_id', v_activation.terminal_device_id,
        'terminal_assignment_id', v_activation.terminal_assignment_id,
        'certificate_id', v_activation.certificate_id,
        'activated_at', v_activation.activated_at,
        'replay', true,
        'detail', 'this provisioning result is already activated; nothing was repeated');
    end if;
    select * into v_ack
      from kitluy_devices.device_terminal_activation_challenges
     where activation_id = v_activation.id and state = 'issued' for update;
    if found and v_now < v_ack.expires_at then
      return jsonb_build_object(
        'outcome', 'ACTIVATION_PREPARED',
        'activation_id', v_activation.id,
        'activation_challenge_id', v_ack.id,
        'challenge_version', v_ack.challenge_version,
        'purpose', v_ack.purpose,
        'nonce', v_ack.nonce,
        'created_at', v_ack.created_at,
        'expires_at', v_ack.expires_at,
        'certificate_id', v_activation.certificate_id,
        'terminal_profile_key', v_activation.terminal_profile_key,
        'correlation_id', v_ack.correlation_id,
        'replay', true,
        'detail', 'the outstanding activation challenge stands; no duplicate was created');
    end if;
    v_activation_id := v_activation.id;
  else
    v_activation_id := gen_random_uuid();
    insert into kitluy_devices.device_terminal_provisioning_activations
      (id, tenant_id, digital_store_id, store_location_id, environment,
       store_hub_device_id, terminal_device_id, terminal_assignment_id,
       terminal_profile_key, provisioning_code_id, pop_challenge_id,
       terminal_enrollment_id, terminal_key_fingerprint, certificate_id,
       created_at, redemption_correlation_id, activation_correlation_id)
    values
      (v_activation_id, v_challenge.tenant_id, v_challenge.digital_store_id,
       v_challenge.store_location_id, v_challenge.environment,
       v_challenge.store_hub_device_id, v_device.id, v_assignment.id,
       v_assignment.terminal_profile_key, v_code.id, v_challenge.id,
       v_enrollment.id, v_enrollment.device_public_key_fingerprint, v_cert.id,
       v_now, v_challenge.correlation_id, gen_random_uuid());
  end if;

  -- The activation challenge. Expiry inherits the CREDENTIAL's own expiry
  -- (recorded decision: no invented TTL; an acknowledgment can never outlive
  -- the credential it acknowledges).
  v_ack_id := gen_random_uuid();
  insert into kitluy_devices.device_terminal_activation_challenges
    (id, activation_id, nonce, created_at, expires_at, correlation_id)
  values
    (v_ack_id, v_activation_id, encode(extensions.gen_random_bytes(32), 'hex'),
     v_now, v_cert.expires_at, gen_random_uuid());

  select * into v_ack from kitluy_devices.device_terminal_activation_challenges
   where id = v_ack_id;
  return jsonb_build_object(
    'outcome', 'ACTIVATION_PREPARED',
    'activation_id', v_activation_id,
    'activation_challenge_id', v_ack_id,
    'challenge_version', v_ack.challenge_version,
    'purpose', v_ack.purpose,
    'nonce', v_ack.nonce,
    'created_at', v_ack.created_at,
    'expires_at', v_ack.expires_at,
    'certificate_id', v_cert.id,
    'certificate_serial', v_cert.certificate_serial,
    'certificate_fingerprint', v_cert.public_key_fingerprint,
    'terminal_device_id', v_device.id,
    'terminal_assignment_id', v_assignment.id,
    'terminal_profile_key', v_assignment.terminal_profile_key,
    'store_hub_device_id', v_challenge.store_hub_device_id,
    'environment', v_challenge.environment,
    'correlation_id', v_ack.correlation_id,
    'detail', 'the cloud holds everything the terminal needs; this does NOT claim the credential was delivered');
end
$prepare$;

comment on function kitluy_devices.prepare_terminal_provisioning_activation_v1(uuid, text) is
  'Group 0174 (WS-11-T004-P03A). Prepares terminal provisioning activation from a COMMITTED redemption (0171). Locks device -> assignment -> code -> activation -> challenge, revalidates the redeemed code, consumed proof, live assignment, active Hub, current sealed enrollment and active unexpired credential, then records ONE activation lineage per redeemed code and ONE outstanding activation challenge (kitluy.activation-ack.v1, 32 secure-random bytes, expiry inherited from the credential). Returns only terminal-facing material. It NEVER activates the terminal, never claims delivery, never issues a credential and never touches the code or proof. Composition-identity and harness EXECUTE only.';

-- ---------------------------------------------------------------------------
-- 5. CONTEXT READER (so the service never needs table SELECT)
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.read_terminal_activation_challenge_context_v1(
  p_activation_challenge_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops
as $ctx$
declare
  v_ack kitluy_devices.device_terminal_activation_challenges;
  v_act kitluy_devices.device_terminal_provisioning_activations;
  v_cert kitluy_devices.device_certificates;
  v_enr kitluy_devices.manufacturing_enrollments;
begin
  if p_activation_challenge_id is null then
    return jsonb_build_object('outcome', 'CONTEXT_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-CTX-NO-CHALLENGE', 'detail', 'names one challenge');
  end if;
  select * into v_ack from kitluy_devices.device_terminal_activation_challenges
   where id = p_activation_challenge_id;
  if not found then
    return jsonb_build_object('outcome', 'CONTEXT_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-CTX-NOT-FOUND', 'detail', 'no challenge with that id');
  end if;
  select * into v_act from kitluy_devices.device_terminal_provisioning_activations
   where id = v_ack.activation_id;
  select * into v_cert from kitluy_devices.device_certificates where id = v_act.certificate_id;
  select * into v_enr from kitluy_devices.manufacturing_enrollments
   where id = v_act.terminal_enrollment_id;

  return jsonb_build_object(
    'outcome', 'CONTEXT',
    'activation_challenge_id', v_ack.id,
    'challenge_version', v_ack.challenge_version,
    'purpose', v_ack.purpose,
    'activation_id', v_act.id,
    'tenant_id', v_act.tenant_id,
    'digital_store_id', v_act.digital_store_id,
    'store_location_id', v_act.store_location_id,
    'environment', v_act.environment,
    'store_hub_device_id', v_act.store_hub_device_id,
    'terminal_device_id', v_act.terminal_device_id,
    'terminal_assignment_id', v_act.terminal_assignment_id,
    'terminal_profile_key', v_act.terminal_profile_key,
    'provisioning_code_id', v_act.provisioning_code_id,
    'pop_challenge_id', v_act.pop_challenge_id,
    'terminal_enrollment_id', v_act.terminal_enrollment_id,
    'terminal_key_fingerprint', v_act.terminal_key_fingerprint,
    'certificate_id', v_act.certificate_id,
    'certificate_serial', v_cert.certificate_serial,
    'certificate_fingerprint', v_cert.public_key_fingerprint,
    'nonce', v_ack.nonce,
    'created_at', v_ack.created_at,
    'expires_at', v_ack.expires_at,
    'state', v_ack.state,
    'activation_state', v_act.state,
    'acknowledged_at', v_act.acknowledged_at,
    'activated_at', v_act.activated_at,
    'enrollment_state', coalesce(v_enr.state::text, 'missing'),
    'authoritative_now', kitluy_ops.authoritative_now_v1());
end
$ctx$;

comment on function kitluy_devices.read_terminal_activation_challenge_context_v1(uuid) is
  'Group 0174 (WS-11-T004-P03A). The ONE narrow read the composition service needs to reconstruct the canonical kitluy.activation-ack.v1 bytes from AUTHORITATIVE rows and judge trusted time. Returns the challenge bindings, nonce, states and the authoritative clock; never a provisioning-code digest, raw code or key. Composition-identity and harness EXECUTE only.';

-- ---------------------------------------------------------------------------
-- 6. COMPLETION DOOR
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.complete_terminal_provisioning_activation_v1(
  p_activation_challenge_id uuid,
  p_attested_signature_verified boolean,
  p_attested_challenge_hash text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $complete$
declare
  v_ack kitluy_devices.device_terminal_activation_challenges;
  v_act kitluy_devices.device_terminal_provisioning_activations;
  v_device kitluy_devices.devices;
  v_assignment kitluy_devices.device_terminal_assignments;
  v_code kitluy_devices.device_provisioning_codes;
  v_pop kitluy_devices.device_provisioning_pop_challenges;
  v_cert kitluy_devices.device_certificates;
  v_enr kitluy_devices.manufacturing_enrollments;
  v_prior kitluy_devices.device_terminal_provisioning_activations;
  v_now timestamptz;
  v_hub_alive integer;
begin
  if p_activation_challenge_id is null
     or p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    return jsonb_build_object('outcome', 'ACTIVATION_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-CONTRACT',
      'detail', 'a completion names one challenge and its idempotency key');
  end if;
  if p_attested_challenge_hash is null or p_attested_challenge_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'ACTIVATION_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-MALFORMED-ATTESTATION',
      'detail', 'the attested hash is not a sha-256 hex digest');
  end if;

  -- Idempotency first, then again under the locks.
  select * into v_prior from kitluy_devices.device_terminal_provisioning_activations
   where activation_idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('outcome', 'ALREADY_ACTIVATED',
      'activation_id', v_prior.id,
      'terminal_device_id', v_prior.terminal_device_id,
      'terminal_assignment_id', v_prior.terminal_assignment_id,
      'certificate_id', v_prior.certificate_id,
      'activated_at', v_prior.activated_at,
      'acknowledged_at', v_prior.acknowledged_at,
      'replay', true,
      'detail', 'this idempotency key already activated this terminal; nothing was repeated');
  end if;

  select * into v_ack from kitluy_devices.device_terminal_activation_challenges
   where id = p_activation_challenge_id;
  if not found then
    return jsonb_build_object('outcome', 'ACTIVATION_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-CHALLENGE-NOT-FOUND', 'detail', 'no challenge with that id');
  end if;
  select * into v_act from kitluy_devices.device_terminal_provisioning_activations
   where id = v_ack.activation_id;

  -- Lock order: DEVICE -> ASSIGNMENT -> CODE -> ACTIVATION -> CHALLENGE.
  select * into v_device from kitluy_devices.devices
   where id = v_act.terminal_device_id for update;
  select * into v_assignment from kitluy_devices.device_terminal_assignments
   where id = v_act.terminal_assignment_id for update;
  select * into v_code from kitluy_devices.device_provisioning_codes
   where id = v_act.provisioning_code_id for update;
  select * into v_act from kitluy_devices.device_terminal_provisioning_activations
   where id = v_ack.activation_id for update;
  select * into v_ack from kitluy_devices.device_terminal_activation_challenges
   where id = p_activation_challenge_id for update;

  if v_act.state = 'activated' then
    return jsonb_build_object('outcome', 'ALREADY_ACTIVATED',
      'activation_id', v_act.id, 'certificate_id', v_act.certificate_id,
      'activated_at', v_act.activated_at, 'replay', true,
      'detail', 'this provisioning result is already activated');
  end if;
  if v_ack.state = 'consumed' then
    return jsonb_build_object('outcome', 'ACTIVATION_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-CHALLENGE-CONSUMED',
      'detail', 'this activation challenge was already consumed');
  end if;

  v_now := kitluy_ops.authoritative_now_v1();
  if v_now >= v_ack.expires_at then
    return jsonb_build_object('outcome', 'ACTIVATION_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-CHALLENGE-EXPIRED',
      'detail', 'the activation challenge expired on the authoritative clock');
  end if;

  -- FINAL RECHECKS, all before any mutation.
  if v_code.state <> 'redeemed' then
    return jsonb_build_object('outcome', 'ACTIVATION_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-CODE-NOT-REDEEMED',
      'detail', 'the provisioning code is no longer redeemed');
  end if;
  select * into v_pop from kitluy_devices.device_provisioning_pop_challenges
   where id = v_act.pop_challenge_id;
  if not found or v_pop.state <> 'consumed' then
    return jsonb_build_object('outcome', 'ACTIVATION_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-PROOF-NOT-CONSUMED', 'detail', 'the redemption proof is not consumed');
  end if;
  if v_assignment.id is null or v_assignment.state not in ('pending_trust', 'active')
     or v_assignment.terminal_profile_key is distinct from v_act.terminal_profile_key then
    return jsonb_build_object('outcome', 'ACTIVATION_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-ASSIGNMENT-INACTIVE',
      'detail', 'the terminal assignment is no longer live or its profile changed');
  end if;
  select count(*) into v_hub_alive
    from kitluy_devices.device_assignment_projections p
   where p.device_id = v_act.store_hub_device_id
     and p.tenant_id = v_act.tenant_id
     and p.digital_store_id = v_act.digital_store_id
     and p.store_location_id = v_act.store_location_id;
  if v_hub_alive = 0 then
    return jsonb_build_object('outcome', 'ACTIVATION_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-HUB-INACTIVE',
      'detail', 'the bound Store Hub is no longer active at this scope');
  end if;
  select e.* into v_enr from kitluy_devices.manufacturing_enrollments e
   where e.id = v_device.current_enrollment_id;
  if not found
     or v_enr.id is distinct from v_act.terminal_enrollment_id
     or v_enr.state <> 'sealed'
     or v_enr.revoked_at is not null
     or v_enr.device_public_key_fingerprint is distinct from v_act.terminal_key_fingerprint then
    return jsonb_build_object('outcome', 'ACTIVATION_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-ENROLLMENT-INELIGIBLE',
      'detail', 'the enrollment bound at preparation is no longer the current sealed enrollment');
  end if;
  select * into v_cert from kitluy_devices.device_certificates where id = v_act.certificate_id;
  if not found or v_cert.status <> 'active'
     or v_cert.device_id is distinct from v_act.terminal_device_id
     or v_cert.environment is distinct from v_act.environment then
    return jsonb_build_object('outcome', 'ACTIVATION_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-CREDENTIAL-INELIGIBLE',
      'detail', 'the acknowledged credential is no longer active for this terminal and environment');
  end if;
  if v_cert.expires_at is not null and v_now >= v_cert.expires_at then
    return jsonb_build_object('outcome', 'ACTIVATION_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-CREDENTIAL-EXPIRED',
      'detail', 'the acknowledged credential is past its expiry');
  end if;

  -- The attestation itself. Only a TRUE service attestation ever activates;
  -- a rejected verification is a refusal with zero residue.
  if p_attested_signature_verified is distinct from true then
    return jsonb_build_object('outcome', 'ACTIVATION_REFUSED',
      'refusal_code', 'KLUY-ACTIVATION-SIGNATURE-REJECTED',
      'detail', 'the service did not attest a verified acknowledgment; nothing was recorded');
  end if;

  -- ATOMIC COMPLETION: challenge consumed, acknowledgment recorded, terminal
  -- activated. Provisioning completion IS activation in this scope.
  update kitluy_devices.device_terminal_activation_challenges
     set state = 'consumed', consumed_at = v_now,
         attested_signature_verified = true,
         attested_challenge_hash = p_attested_challenge_hash
   where id = v_ack.id and state = 'issued';
  if not found then
    raise exception 'KLUY-ACTIVATION-CHALLENGE-RACE: the challenge changed under its lock'
      using errcode = 'P0001';
  end if;

  update kitluy_devices.device_terminal_provisioning_activations
     set state = 'activated', acknowledged_at = v_now, activated_at = v_now,
         activation_idempotency_key = p_idempotency_key
   where id = v_act.id and state = 'ready_for_delivery';
  if not found then
    raise exception 'KLUY-ACTIVATION-RACE: the activation changed under its lock'
      using errcode = 'P0001';
  end if;

  -- Canonical lifecycle evidence through the existing registry.
  perform kitluy_devices.record_lifecycle_event(
    v_act.terminal_device_id, v_device.lifecycle_state, v_device.lifecycle_state,
    'TERMINAL_PROVISIONING_ACTIVATED', v_act.terminal_device_id::text,
    jsonb_build_object(
      'activation_id', v_act.id,
      'certificate_id', v_act.certificate_id,
      'terminal_assignment_id', v_act.terminal_assignment_id,
      'terminal_profile_key', v_act.terminal_profile_key,
      'activation_correlation_id', v_act.activation_correlation_id));

  return jsonb_build_object(
    'outcome', 'ACTIVATED',
    'activation_id', v_act.id,
    'terminal_device_id', v_act.terminal_device_id,
    'terminal_assignment_id', v_act.terminal_assignment_id,
    'terminal_profile_key', v_act.terminal_profile_key,
    'store_hub_device_id', v_act.store_hub_device_id,
    'environment', v_act.environment,
    'certificate_id', v_act.certificate_id,
    'certificate_serial', v_cert.certificate_serial,
    'certificate_fingerprint', v_cert.public_key_fingerprint,
    'acknowledged_at', v_now,
    'activated_at', v_now,
    'correlation_id', v_act.activation_correlation_id,
    'detail', 'the terminal proved it holds the credential and provisioning is complete; this claims NO Store Hub delivery, NO pairing and NO operational connectivity');
end
$complete$;

comment on function kitluy_devices.complete_terminal_provisioning_activation_v1(uuid, boolean, text, text) is
  'Group 0174 (WS-11-T004-P03A). The governed atomic terminal activation. Under DEVICE -> ASSIGNMENT -> CODE -> ACTIVATION -> CHALLENGE locks it revalidates the redeemed code, consumed proof, live assignment and profile, active Hub, current sealed enrollment with matching fingerprint, and the active unexpired credential, then — only on a TRUE service attestation of the kitluy.activation-ack.v1 signature (OPTION B; Ed25519 lives in @kitluy/device-identity) — consumes the challenge, records the acknowledgment and activates in ONE transaction. Activation IS provisioning completion here; it claims no Store Hub delivery, no pairing and no operational connectivity. Identical replay answers ALREADY_ACTIVATED. Composition-identity and harness EXECUTE only.';

-- ---------------------------------------------------------------------------
-- 7. OWNERSHIP AND THE CAPABILITY BOUNDARY (0172/0173 posture preserved)
-- ---------------------------------------------------------------------------
alter table kitluy_devices.device_terminal_provisioning_activations
  owner to kitluy_activation_governor;
alter table kitluy_devices.device_terminal_activation_challenges
  owner to kitluy_activation_governor;

do $own$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'kitluy_devices.prepare_terminal_provisioning_activation_v1(uuid, text)',
    'kitluy_devices.read_terminal_activation_challenge_context_v1(uuid)',
    'kitluy_devices.complete_terminal_provisioning_activation_v1(uuid, boolean, text, text)'] loop
    execute format('alter function %s owner to kitluy_activation_governor', v_fn);
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
    execute format('grant execute on function %s to kitluy_provisioning_service, kitluy_test_harness', v_fn);
  end loop;
end
$own$;

do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- 8. PROVE THE BOUNDARY ON APPLY
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_fn text;
  v_extra integer;
  v_fns text[] := array[
    'kitluy_devices.prepare_terminal_provisioning_activation_v1(uuid, text)',
    'kitluy_devices.read_terminal_activation_challenge_context_v1(uuid)',
    'kitluy_devices.complete_terminal_provisioning_activation_v1(uuid, boolean, text, text)'];
begin
  -- Doors: definer, governor-owned, pinned, harness+composer only.
  foreach v_fn in array v_fns loop
    if not exists (
      select 1 from pg_proc p where p.oid = v_fn::regprocedure
        and p.prosecdef and pg_get_userbyid(p.proowner) = 'kitluy_activation_governor'
        and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then
      raise exception 'KLUY-MIGRATION-0174: % is not definer, governor-owned or pinned', v_fn
        using errcode = 'P0001';
    end if;
    if has_function_privilege('public', v_fn, 'execute')
       or has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('kitluy_worker_service', v_fn, 'execute')
       or not has_function_privilege('kitluy_provisioning_service', v_fn, 'execute')
       or not has_function_privilege('kitluy_test_harness', v_fn, 'execute') then
      raise exception 'KLUY-MIGRATION-0174: the grant boundary for % is wrong', v_fn
        using errcode = 'P0001';
    end if;
    -- EFFECTIVE privilege: the 0173 correction must still hold — service_role
    -- must not carry the new capabilities without entering the composer.
    if has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'KLUY-MIGRATION-0174: service_role EFFECTIVELY holds % without entering the composer', v_fn
        using errcode = 'P0001';
    end if;
  end loop;

  -- The composer's census grew by exactly these three and nothing else.
  select count(*) into v_extra
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices'
     and has_function_privilege('kitluy_provisioning_service', p.oid, 'execute')
     and p.proname not in (
       'evaluate_terminal_provisioning_code_v1',
       'issue_terminal_provisioning_pop_challenge_v1',
       'read_terminal_provisioning_pop_challenge_context_v1',
       'record_terminal_provisioning_pop_verification_v1',
       'redeem_terminal_provisioning_code_v1',
       'prepare_terminal_provisioning_activation_v1',
       'read_terminal_activation_challenge_context_v1',
       'complete_terminal_provisioning_activation_v1');
  if v_extra > 0 then
    raise exception 'KLUY-MIGRATION-0174: the composer gained % capability beyond the intended eight', v_extra
      using errcode = 'P0001';
  end if;
  -- The 0173 gateway still enforces explicit entry.
  if not pg_has_role('service_role', 'kitluy_provisioning_service', 'MEMBER')
     or pg_has_role('service_role', 'kitluy_provisioning_service', 'USAGE')
     or not exists (select 1 from pg_roles
                     where rolname = 'kitluy_provisioning_gateway' and not rolinherit) then
    raise exception 'KLUY-MIGRATION-0174: the 0173 explicit-entry boundary was weakened'
      using errcode = 'P0001';
  end if;

  -- Tables: FORCE RLS, zero runtime reach, immutability triggers attached.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_devices'
       and c.relname in ('device_terminal_provisioning_activations',
                         'device_terminal_activation_challenges')
       and (not c.relrowsecurity or not c.relforcerowsecurity)) then
    raise exception 'KLUY-MIGRATION-0174: FORCE RLS does not hold on an activation table'
      using errcode = 'P0001';
  end if;
  if has_table_privilege('authenticated', 'kitluy_devices.device_terminal_provisioning_activations', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', 'kitluy_devices.device_terminal_provisioning_activations', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_provisioning_service', 'kitluy_devices.device_terminal_provisioning_activations', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_provisioning_service', 'kitluy_devices.device_terminal_activation_challenges', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'KLUY-MIGRATION-0174: an identity holds direct activation-table access'
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_dtpa_integrity')
     or not exists (select 1 from pg_trigger where tgname = 'trg_dtac_integrity') then
    raise exception 'KLUY-MIGRATION-0174: an activation immutability trigger is missing'
      using errcode = 'P0001';
  end if;

  -- Structural rules: one activation per redeemed code, one per consumed
  -- proof, one outstanding challenge per activation.
  if not exists (
    select 1 from pg_indexes where schemaname = 'kitluy_devices'
      and indexname = 'uq_dtac_one_outstanding') then
    raise exception 'KLUY-MIGRATION-0174: the one-outstanding-challenge rule is missing'
      using errcode = 'P0001';
  end if;

  -- The activation model records no raw code, digest, signature or key.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'kitluy_devices'
       and table_name in ('device_terminal_provisioning_activations',
                          'device_terminal_activation_challenges')
       and ((column_name ~ '(^|_)(raw|plain|secret|private|digest)(_|$)')
            or (column_name ~ 'signature' and column_name <> 'attested_signature_verified'))) then
    raise exception 'KLUY-MIGRATION-0174: a raw, digest, signature or private-material column exists'
      using errcode = 'P0001';
  end if;

  -- No DELIVERED state was invented. (`ready_for_delivery` is the intended
  -- name and must not trip this — the forbidden value is `delivered`, a claim
  -- nothing in the repository can currently evidence.)
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'dtpa_state_chk')
       ~ '''delivered''' then
    raise exception 'KLUY-MIGRATION-0174: a delivery state was invented without delivery evidence'
      using errcode = 'P0001';
  end if;

  -- Earlier boundaries stand.
  if not has_function_privilege('authenticated', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.redeem_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0174: an earlier provisioning boundary drifted'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from pg_auth_members m join pg_roles r on r.oid = m.member
     where m.roleid in (select oid from pg_roles
                         where rolname in ('kitluy_activation_governor',
                                           'kitluy_provisioning_service',
                                           'kitluy_provisioning_gateway'))
       and r.rolcanlogin) then
    raise exception 'KLUY-MIGRATION-0174: a login-capable role belongs to a NOLOGIN authority'
      using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-MIGRATION-0174: terminal activation and provisioning completion applied (activation record + activation-ack challenge, ready_for_delivery -> activated; NO delivery state because no delivery evidence exists; activation requires a terminal-signed acknowledgment under the enrolled key and IS provisioning completion; three doors added to the composer, effective-privilege boundary of 0173 re-proven; Store Hub delivery, pairing and terminal transport remain unimplemented)';
end
$guard$;
