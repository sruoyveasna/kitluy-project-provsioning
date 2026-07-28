-- kitluy:group:0121
-- Migration group 0121: device_claim_and_assignment (WS-11-T002, Cycle 10).
--
-- PART A — residual controls the owner required BEFORE T002 (2026-07-28):
--   A1 KLRISK-DEVICE-001. Activation-refusal evidence was caller-enforced: a
--      defective or malicious caller could invoke activate_device_v1, receive
--      the refusal, and simply omit record_activation_refusal_v1. Closed by
--      `attempt_activate_device_v1`, which writes the refusal or the activation
--      result, commits, and RETURNS a typed outcome instead of raising. The
--      raising form is no longer reachable by any application role, so there is
--      no path that produces a refusal without producing its evidence.
--   A2 Activation refuses any device whose hardware evidence collides with
--      another NON-RETIRED device. Keeping duplicate evidence as rows is only
--      sound if neither identity can activate.
--   A3 A duplicate at enrollment now quarantines BOTH identities, not just the
--      newcomer. Which unit is the clone is not knowable from the evidence.
--
-- PART B — T002 claim, scope and assignment:
--   device_claims, device_assignments, device_terminal_assignments,
--   device_assignment_projections, device_claim_events
--   + claim creation/expiry, token hashing and single-use enforcement, scope
--     resolution, assignment generation, replacement and revocation, terminal
--     assignment, ownership-transfer refusal, stale-generation rejection,
--     quarantine enforcement, audit, offline projection and claim recovery.
--
-- Authority: docs/source/security/kitluy-device-certificate-and-trust-policy-v1.0.0.md
--   §5 provisioning sequence, §10 revocation; KLD-2026-07-21-003 (OWNER-LOCKED
--   provisioning chain); Cycle 10 T002 owner instruction (2026-07-28).
-- Column contract: DD v1.0.0 `kitluy_devices.device_assignments` and
--   `provisioning_sessions`. Deviations recorded in the decision register.
--
-- THE ACTIVATION BOUNDARY (owner-stated, and enforced here):
--     claim accepted -> identity and scope bound -> assignment created
--       -> device remains `awaiting_trust`
--         -> BLK-005 configuration required
--           -> certificate issuance
--             -> activation
--
-- Without BLK-005, NOTHING in this file moves a device into `active`.
-- `awaiting_trust` is a terminal resting state for the whole of Cycle 10.
--
-- Purely additive; LOCAL execution only; never automatic in production
-- (KL-INF-P1-037, OWNER-LOCKED).

-- ---------------------------------------------------------------------------
-- New lifecycle state, added OUTSIDE the transaction below.
-- ---------------------------------------------------------------------------
-- PostgreSQL forbids USING an enum value in the same transaction that adds it.
-- This statement therefore runs on its own, before `begin`, so the rest of the
-- migration can reference `awaiting_trust` normally.
-- ---------------------------------------------------------------------------
alter type kitluy_devices.device_lifecycle_state
  add value if not exists 'awaiting_trust' after 'enrolled';

begin;

comment on type kitluy_devices.device_lifecycle_state is
  'Device lifecycle. `awaiting_trust` is where a claimed, scope-bound, assigned device WAITS: the claim is accepted and the assignment exists, but activation additionally requires approved PKI configuration (BLK-005). While BLK-005 is open, `awaiting_trust` is where every correctly-provisioned device stops.';

-- ===========================================================================
-- PART A1 — KLRISK-DEVICE-001: refusal evidence that does not depend on the
-- caller choosing to record it.
-- ===========================================================================

create type kitluy_devices.activation_outcome as (
  outcome text,
  device_id uuid,
  lifecycle_state kitluy_devices.device_lifecycle_state,
  refusal_code text,
  refusal_message text,
  evidence_event_id uuid
);

comment on type kitluy_devices.activation_outcome is
  'Typed result of an activation attempt. `outcome` is ACTIVATED or REFUSED. A REFUSED outcome carries the machine-readable refusal_code the API converts into an external error, and evidence_event_id proves the refusal was recorded before this value was returned.';

-- ---------------------------------------------------------------------------
-- attempt_activate_device_v1 — THE ONLY reachable activation path.
-- ---------------------------------------------------------------------------
-- Writes the refusal or the activation result, then RETURNS. It does not raise
-- on a refusal, so the evidence is committed with the caller's transaction
-- rather than depending on the caller remembering to record it afterwards.
--
-- The inner raising form, activate_device_v1, is revoked from every application
-- role at the end of this migration. There is no path that produces a refusal
-- without producing its evidence.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.attempt_activate_device_v1(
  p_device_id uuid,
  p_environment text,
  p_actor_ref text
) returns kitluy_devices.activation_outcome
language plpgsql
security definer
set search_path = kitluy_devices, pg_catalog, public
as $$
declare
  v_result kitluy_devices.activation_outcome;
  v_state kitluy_devices.device_lifecycle_state;
  v_code text;
  v_message text;
begin
  select lifecycle_state into v_state
  from kitluy_devices.devices where id = p_device_id;

  if not found then
    -- A device that does not exist has nowhere to record evidence. This is the
    -- one case that still raises, because there is no subject to attach a
    -- refusal to.
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;

  begin
    perform kitluy_devices.activate_device_v1(p_device_id, p_environment, p_actor_ref);

    select lifecycle_state into v_state
    from kitluy_devices.devices where id = p_device_id;

    v_result := row('ACTIVATED', p_device_id, v_state, null, null,
      kitluy_devices.record_lifecycle_event(
        p_device_id, v_state, v_state, 'ACTIVATION_CONFIRMED', p_actor_ref,
        jsonb_build_object('environment', p_environment)))::kitluy_devices.activation_outcome;
    return v_result;
  exception when others then
    -- The subtransaction rolled back, so nothing activate_device_v1 attempted
    -- survives. What follows runs in the caller's still-live transaction and
    -- DOES survive.
    v_message := sqlerrm;
    v_code := split_part(v_message, ':', 1);
    if v_code !~ '^KLUY-DEVICE-[A-Z-]+$' then
      v_code := 'KLUY-DEVICE-ACTIVATION-FAILED';
    end if;
  end;

  v_result := row(
    'REFUSED', p_device_id, v_state, v_code, v_message,
    kitluy_devices.record_activation_refusal_v1(
      p_device_id, p_environment, p_actor_ref, v_code, v_message)
  )::kitluy_devices.activation_outcome;

  return v_result;
end;
$$;

comment on function kitluy_devices.attempt_activate_device_v1 is
  'The only activation path reachable by an application role (KLRISK-DEVICE-001). Records the refusal or the activation, commits it with the caller''s transaction, and returns a typed outcome; the API converts a REFUSED outcome into the external error. Refusal evidence no longer depends on a caller choosing to write it — the raising form activate_device_v1 is revoked from every application role.';

-- ===========================================================================
-- PART A2/A3 — duplicate hardware evidence blocks activation, and quarantines
-- BOTH identities at enrollment.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- colliding_evidence_device_ids — non-storage evidence shared with another
-- non-retired device.
-- ---------------------------------------------------------------------------
-- Storage-module signals are excluded: a refurbished NVMe legitimately carries
-- a serial that another device once reported, and trust policy §11 already
-- routes storage-module changes through the replacement path.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.colliding_evidence_device_ids(
  p_device_id uuid
) returns setof uuid
language sql
stable
as $$
  select distinct other_device.id
  from kitluy_devices.devices d
  join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
  join kitluy_devices.hardware_manifest_signals mine on mine.manifest_id = e.hardware_manifest_id
  join kitluy_devices.hardware_manifest_signals theirs
    on theirs.signal_type = mine.signal_type
   and theirs.signal_value = mine.signal_value
   and theirs.manifest_id <> mine.manifest_id
  join kitluy_devices.manufacturing_enrollments other_e
    on other_e.hardware_manifest_id = theirs.manifest_id
  join kitluy_devices.devices other_device
    on other_device.id = other_e.device_id
  where d.id = p_device_id
    and other_device.id <> d.id
    -- Only the OTHER device's CURRENT enrollment counts. A superseded manifest
    -- is history, and a repaired device must not collide with its own past.
    and other_device.current_enrollment_id = other_e.id
    and other_device.lifecycle_state not in ('retired', 'replaced')
    and not kitluy_devices.is_storage_module_signal(mine.signal_type);
$$;

comment on function kitluy_devices.colliding_evidence_device_ids(uuid) is
  'Non-retired devices sharing non-storage hardware evidence with this one. Compares CURRENT enrollments only, so a repaired device never collides with its own superseded manifest. Storage-module signals are excluded because a refurbished NVMe legitimately carries a previously-reported serial.';

-- ===========================================================================
-- PART B — claim, scope and assignment
-- ===========================================================================

create type kitluy_devices.claim_state as enum (
  'issued',
  'redeemed',
  'expired',
  'revoked'
);

create type kitluy_devices.assignment_state as enum (
  'pending_trust',
  'active',
  'superseded',
  'revoked'
);

-- ---------------------------------------------------------------------------
-- kitluy_devices.device_claims — short-lived, single-use Hub claim.
-- ---------------------------------------------------------------------------
-- DD `provisioning_sessions` (id, device_id, code_hash, intended assignment,
-- expires_at, used_at, status), named for what it is.
--
-- The claim TOKEN is never stored. Only its SHA-256 is, so a database read
-- cannot produce a usable claim (repository rule 4).
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_claims (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references kitluy_devices.devices (id),
  -- The intended scope, resolved and validated at creation.
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  store_location_id uuid not null references kitluy_core.store_locations (id),
  -- SHA-256 of the claim token. The token itself never touches this database.
  claim_token_sha256 text not null unique,
  -- SHA-256 over the canonical claim payload (device + scope + expiry). A
  -- redemption presenting an ALTERED payload does not match and is refused,
  -- so a token cannot be replayed against a scope it was not issued for.
  payload_sha256 text not null,
  state kitluy_devices.claim_state not null default 'issued',
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_assignment_id uuid,
  created_by_operator_ref text not null,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  constraint device_claims_token_format_chk
    check (claim_token_sha256 ~ '^[0-9a-f]{64}$'),
  constraint device_claims_payload_format_chk
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint device_claims_redeemed_consistency_chk
    check ((state = 'redeemed') = (redeemed_at is not null)),
  constraint device_claims_revoked_consistency_chk
    check ((state = 'revoked') = (revoked_at is not null))
);

comment on table kitluy_devices.device_claims is
  'Owner: Fleet. Short-lived single-use Store Hub claim (DD provisioning_sessions; trust policy §5). Stores the SHA-256 of the claim token, never the token — a database read cannot produce a usable claim. payload_sha256 binds the token to the exact device and scope it was issued for, so a captured token cannot be replayed against a different Tenant, Digital Store or Location. MC: MUT (state machine only).';
comment on column kitluy_devices.device_claims.claim_token_sha256 is
  'SHA-256 of the claim token. The token is generated outside the database, shown once to the operator, and never persisted anywhere in KitLuy.';

-- At most one OUTSTANDING claim per device. This is what makes concurrent
-- claim creation for one device a constraint violation rather than a race.
create unique index device_claims_one_outstanding_idx
  on kitluy_devices.device_claims (device_id)
  where state = 'issued';

create index device_claims_device_idx
  on kitluy_devices.device_claims (device_id, created_at desc);
create index device_claims_scope_idx
  on kitluy_devices.device_claims (store_location_id, state);

-- ---------------------------------------------------------------------------
-- kitluy_devices.device_assignments — Tenant/Store/Location binding (DD).
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_assignments (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references kitluy_devices.devices (id),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  store_location_id uuid not null references kitluy_core.store_locations (id),
  -- Monotonic per device. This is the value WS-10 carries in every batch and
  -- every configuration snapshot; a stale generation is refused, not tolerated.
  assignment_generation integer not null,
  state kitluy_devices.assignment_state not null default 'pending_trust',
  claim_id uuid references kitluy_devices.device_claims (id),
  supersedes_assignment_id uuid references kitluy_devices.device_assignments (id),
  valid_from timestamptz not null default now(),
  activated_at timestamptz,
  superseded_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  created_by_operator_ref text not null,
  created_at timestamptz not null default now(),
  unique (device_id, assignment_generation),
  constraint device_assignments_generation_chk check (assignment_generation >= 1),
  constraint device_assignments_activated_consistency_chk
    check ((activated_at is not null) or state <> 'active'),
  constraint device_assignments_superseded_consistency_chk
    check ((state = 'superseded') = (superseded_at is not null)),
  constraint device_assignments_revoked_consistency_chk
    check ((state = 'revoked') = (revoked_at is not null))
);

comment on table kitluy_devices.device_assignments is
  'Owner: Fleet. Device-to-Tenant/Digital-Store/Location binding with a monotonic generation (DD kitluy_devices.device_assignments). Created in `pending_trust` and STAYS there until certificate-backed activation, which is gated on BLK-005. A generation is never reused, never edited, and never widened — a scope change creates a NEW generation that supersedes the old one. MC: MUT (state machine only).';

create unique index device_assignments_one_live_idx
  on kitluy_devices.device_assignments (device_id)
  where state in ('pending_trust', 'active');

create index device_assignments_scope_idx
  on kitluy_devices.device_assignments (store_location_id, state);

alter table kitluy_devices.device_claims
  add constraint device_claims_assignment_fk
  foreign key (redeemed_assignment_id)
  references kitluy_devices.device_assignments (id);

-- ---------------------------------------------------------------------------
-- kitluy_devices.device_terminal_assignments — T1-T4 profile per device.
-- ---------------------------------------------------------------------------
-- `kitluy_devices` is NEUTRAL Fleet, so no Laundry vocabulary is enumerated
-- here (repository rule 2). The profile key is validated STRUCTURALLY as
-- `<vertical>.t<n>.<role>`, which enforces the owner-locked T1-T4 shape without
-- putting Laundry terms into a neutral schema.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_terminal_assignments (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references kitluy_devices.devices (id),
  assignment_id uuid not null references kitluy_devices.device_assignments (id),
  -- Denormalised from the assignment so the wrong-Location case is a CONSTRAINT
  -- rather than a check somebody has to remember to write.
  store_location_id uuid not null references kitluy_core.store_locations (id),
  terminal_profile_key text not null,
  state kitluy_devices.assignment_state not null default 'pending_trust',
  assigned_by_operator_ref text not null,
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint device_terminal_assignments_profile_shape_chk
    check (terminal_profile_key ~ '^[a-z0-9_]+\.t[1-9][0-9]*\.[a-z0-9_]+$'),
  constraint device_terminal_assignments_revoked_consistency_chk
    check ((state = 'revoked') = (revoked_at is not null))
);

comment on table kitluy_devices.device_terminal_assignments is
  'Owner: Fleet. Terminal profile bound to a device under a specific assignment generation. store_location_id is denormalised and trigger-checked against the assignment, so "terminal assigned to the wrong Location" is refused structurally. The profile key is validated as <vertical>.t<n>.<role> — the owner-locked T1-T4 shape enforced WITHOUT importing Laundry vocabulary into neutral Fleet (repository rule 2). MC: MUT (state machine only).';

create unique index device_terminal_assignments_one_live_idx
  on kitluy_devices.device_terminal_assignments (device_id, terminal_profile_key)
  where state in ('pending_trust', 'active');

create index device_terminal_assignments_assignment_idx
  on kitluy_devices.device_terminal_assignments (assignment_id);

-- ---------------------------------------------------------------------------
-- kitluy_devices.device_assignment_projections — offline projection.
-- ---------------------------------------------------------------------------
-- The last ACTIVATED assignment, which is what a Hub carries offline. Written
-- ONLY by a successful activation, so while BLK-005 is open this table is
-- necessarily empty — and that emptiness is asserted rather than assumed.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_assignment_projections (
  device_id uuid primary key references kitluy_devices.devices (id),
  assignment_id uuid not null references kitluy_devices.device_assignments (id),
  assignment_generation integer not null,
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  store_location_id uuid not null references kitluy_core.store_locations (id),
  terminal_profile_keys text[] not null default '{}',
  projected_at timestamptz not null default now(),
  environment text not null,
  constraint device_assignment_projections_env_chk
    check (environment in ('development', 'pilot', 'production'))
);

comment on table kitluy_devices.device_assignment_projections is
  'Owner: Fleet. The last ACTIVATED assignment, projected for offline use by the Store Hub. Written only by a successful activation. While BLK-005 is open no activation can succeed, so this table is EMPTY — asserted, not assumed. MC: MUT (projection).';

-- ---------------------------------------------------------------------------
-- kitluy_devices.device_claim_events — append-only claim/assignment audit.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_claim_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references kitluy_devices.devices (id),
  claim_id uuid references kitluy_devices.device_claims (id),
  assignment_id uuid references kitluy_devices.device_assignments (id),
  event_type text not null,
  actor_ref text not null,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint device_claim_events_type_chk
    check (event_type in (
      'CLAIM_CREATED', 'CLAIM_REDEEMED', 'CLAIM_REDEMPTION_REPLAYED',
      'CLAIM_REFUSED', 'CLAIM_EXPIRED', 'CLAIM_REVOKED',
      'ASSIGNMENT_CREATED', 'ASSIGNMENT_REPLACED', 'ASSIGNMENT_REVOKED',
      'TERMINAL_ASSIGNED', 'TERMINAL_REVOKED'))
);

comment on table kitluy_devices.device_claim_events is
  'Owner: Fleet. Append-only audit of claim and assignment activity, including REFUSED claims — a refused claim is the interesting one, so it is recorded rather than only rejected. MC: A/O.';

create index device_claim_events_device_idx
  on kitluy_devices.device_claim_events (device_id, occurred_at desc);

create or replace function kitluy_devices.record_claim_event(
  p_device_id uuid,
  p_claim_id uuid,
  p_assignment_id uuid,
  p_event_type text,
  p_actor_ref text,
  p_detail jsonb default '{}'::jsonb
) returns uuid
language sql
as $$
  insert into kitluy_devices.device_claim_events
    (device_id, claim_id, assignment_id, event_type, actor_ref, detail)
  values (p_device_id, p_claim_id, p_assignment_id, p_event_type, p_actor_ref,
          coalesce(p_detail, '{}'::jsonb))
  returning id;
$$;

-- ---------------------------------------------------------------------------
-- resolve_device_scope_v1 — Tenant / Digital Store / Location consistency.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.resolve_device_scope_v1(
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid
) returns void
language plpgsql
stable
as $$
declare
  v_store_tenant uuid;
  v_location_tenant uuid;
  v_location_store uuid;
begin
  select tenant_id into v_store_tenant
  from kitluy_core.digital_stores where id = p_digital_store_id;
  if not found then
    raise exception 'KLUY-DEVICE-SCOPE-UNKNOWN: digital store % does not exist', p_digital_store_id
      using errcode = 'P0001';
  end if;

  select tenant_id, digital_store_id into v_location_tenant, v_location_store
  from kitluy_core.store_locations where id = p_store_location_id;
  if not found then
    raise exception 'KLUY-DEVICE-SCOPE-UNKNOWN: store location % does not exist', p_store_location_id
      using errcode = 'P0001';
  end if;

  -- Each hop is checked separately so the refusal names the hop that failed.
  if v_store_tenant <> p_tenant_id then
    raise exception 'KLUY-DEVICE-SCOPE-CROSS-TENANT: digital store % belongs to tenant %, not %',
      p_digital_store_id, v_store_tenant, p_tenant_id using errcode = 'P0001';
  end if;
  if v_location_tenant <> p_tenant_id then
    raise exception 'KLUY-DEVICE-SCOPE-CROSS-TENANT: store location % belongs to tenant %, not %',
      p_store_location_id, v_location_tenant, p_tenant_id using errcode = 'P0001';
  end if;
  if v_location_store <> p_digital_store_id then
    raise exception 'KLUY-DEVICE-SCOPE-CROSS-STORE: store location % belongs to digital store %, not %',
      p_store_location_id, v_location_store, p_digital_store_id using errcode = 'P0001';
  end if;
end;
$$;

comment on function kitluy_devices.resolve_device_scope_v1 is
  'Refuses a scope whose Tenant, Digital Store and Location do not form one consistent chain. Each hop is checked separately so the error names the hop that failed rather than reporting a generic mismatch.';

-- ---------------------------------------------------------------------------
-- create_device_claim_v1
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.create_device_claim_v1(
  p_device_id uuid,
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_claim_token_sha256 text,
  p_payload_sha256 text,
  p_ttl_seconds integer,
  p_operator_ref text
) returns uuid
language plpgsql
as $$
declare
  v_device kitluy_devices.devices;
  v_claim_id uuid;
  v_collisions integer;
begin
  select * into v_device from kitluy_devices.devices where id = p_device_id for update;
  if not found then
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;

  if p_ttl_seconds is null or p_ttl_seconds <= 0 or p_ttl_seconds > 86400 then
    raise exception 'KLUY-DEVICE-CLAIM-TTL: a claim lives between 1 second and 24 hours; % was requested', p_ttl_seconds
      using errcode = 'P0001';
  end if;

  -- Quarantine and retirement are enforced here, not left to the redeemer.
  if v_device.lifecycle_state = 'quarantined' then
    perform kitluy_devices.record_claim_event(
      p_device_id, null, null, 'CLAIM_REFUSED', p_operator_ref,
      jsonb_build_object('reason', 'device_quarantined'));
    raise exception 'KLUY-DEVICE-QUARANTINED: device % is quarantined and cannot be claimed until the incident is cleared through governed re-enrollment', p_device_id
      using errcode = 'P0001';
  end if;
  if v_device.lifecycle_state in ('retired', 'replaced') then
    raise exception 'KLUY-DEVICE-TERMINAL: device % is % and cannot be claimed', p_device_id, v_device.lifecycle_state
      using errcode = 'P0001';
  end if;
  if v_device.lifecycle_state not in ('enrolled', 'awaiting_trust') then
    raise exception 'KLUY-DEVICE-CLAIM-STATE: device % is %; only an enrolled device is claimable', p_device_id, v_device.lifecycle_state
      using errcode = 'P0001';
  end if;

  -- Duplicate hardware evidence blocks the whole provisioning chain, not only
  -- activation. Claiming a suspected clone is not a useful thing to allow.
  select count(*) into v_collisions
  from kitluy_devices.colliding_evidence_device_ids(p_device_id);
  if v_collisions > 0 then
    perform kitluy_devices.record_claim_event(
      p_device_id, null, null, 'CLAIM_REFUSED', p_operator_ref,
      jsonb_build_object('reason', 'duplicate_hardware_evidence', 'colliding_devices', v_collisions));
    raise exception 'KLUY-DEVICE-EVIDENCE-COLLISION: device % shares hardware evidence with % other non-retired device(s); neither may be claimed or activated until the duplicate is resolved', p_device_id, v_collisions
      using errcode = 'P0001';
  end if;

  -- Ownership transfer is refused, not silently performed (trust policy §10:
  -- "transfer to another Location without approved reassignment" is a
  -- revocation trigger, not a claim path).
  if exists (
    select 1 from kitluy_devices.device_assignments a
    where a.device_id = p_device_id
      and a.state in ('pending_trust', 'active')
      and (a.tenant_id <> p_tenant_id
        or a.digital_store_id <> p_digital_store_id
        or a.store_location_id <> p_store_location_id)
  ) then
    perform kitluy_devices.record_claim_event(
      p_device_id, null, null, 'CLAIM_REFUSED', p_operator_ref,
      jsonb_build_object('reason', 'ownership_transfer'));
    raise exception 'KLUY-DEVICE-OWNERSHIP-TRANSFER: device % already holds a live assignment to a different Tenant/Store/Location; revoke it explicitly before reassigning', p_device_id
      using errcode = 'P0001',
            hint = 'Use revoke_device_assignment_v1 with a named operator. A device never changes owner as a side effect of a new claim.';
  end if;

  if exists (
    select 1 from kitluy_devices.device_assignments a
    where a.device_id = p_device_id and a.state in ('pending_trust', 'active')
  ) then
    raise exception 'KLUY-DEVICE-ALREADY-CLAIMED: device % already holds a live assignment', p_device_id
      using errcode = 'P0001';
  end if;

  perform kitluy_devices.resolve_device_scope_v1(
    p_tenant_id, p_digital_store_id, p_store_location_id);

  insert into kitluy_devices.device_claims
    (device_id, tenant_id, digital_store_id, store_location_id,
     claim_token_sha256, payload_sha256, expires_at, created_by_operator_ref)
  values
    (p_device_id, p_tenant_id, p_digital_store_id, p_store_location_id,
     lower(p_claim_token_sha256), lower(p_payload_sha256),
     now() + make_interval(secs => p_ttl_seconds), p_operator_ref)
  returning id into v_claim_id;

  perform kitluy_devices.record_claim_event(
    p_device_id, v_claim_id, null, 'CLAIM_CREATED', p_operator_ref,
    jsonb_build_object('expires_in_seconds', p_ttl_seconds));

  return v_claim_id;
end;
$$;

comment on function kitluy_devices.create_device_claim_v1 is
  'Creates a short-lived single-use claim (trust policy §5). Refuses a quarantined, retired or evidence-colliding device, refuses an ownership transfer disguised as a new claim, and validates the Tenant/Store/Location chain. A second outstanding claim for one device is refused by a partial unique index, so concurrent creation is a constraint violation rather than a race.';

-- ---------------------------------------------------------------------------
-- redeem_device_claim_v1
-- ---------------------------------------------------------------------------
-- Single-use, with one deliberate exception: re-presenting the SAME token from
-- the SAME device returns the SAME assignment. That is the "claim committed but
-- response lost" recovery path, and it is the only reason a redeemed token is
-- ever accepted again. Presenting it from a DIFFERENT device is token reuse and
-- is refused.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.redeem_device_claim_v1(
  p_claim_token_sha256 text,
  p_presented_payload_sha256 text,
  p_device_id uuid,
  p_actor_ref text
) returns uuid
language plpgsql
as $$
declare
  v_claim kitluy_devices.device_claims;
  v_device kitluy_devices.devices;
  v_assignment_id uuid;
  v_generation integer;
  v_collisions integer;
begin
  select * into v_claim
  from kitluy_devices.device_claims
  where claim_token_sha256 = lower(p_claim_token_sha256)
  for update;

  if not found then
    -- No claim, so no device to attach the event to beyond the presenter's.
    perform kitluy_devices.record_claim_event(
      p_device_id, null, null, 'CLAIM_REFUSED', p_actor_ref,
      jsonb_build_object('reason', 'unknown_token'));
    raise exception 'KLUY-DEVICE-CLAIM-UNKNOWN: no claim matches the presented token'
      using errcode = 'P0001';
  end if;

  -- RECOVERY PATH, checked before the single-use refusal. A response lost in
  -- transit must not cost the operator the claim.
  if v_claim.state = 'redeemed' then
    if v_claim.device_id = p_device_id
       and v_claim.payload_sha256 = lower(p_presented_payload_sha256) then
      perform kitluy_devices.record_claim_event(
        p_device_id, v_claim.id, v_claim.redeemed_assignment_id,
        'CLAIM_REDEMPTION_REPLAYED', p_actor_ref,
        jsonb_build_object('reason', 'idempotent_retry_after_response_loss'));
      return v_claim.redeemed_assignment_id;
    end if;
    perform kitluy_devices.record_claim_event(
      coalesce(p_device_id, v_claim.device_id), v_claim.id, null,
      'CLAIM_REFUSED', p_actor_ref,
      jsonb_build_object('reason', 'token_reuse_by_another_device',
                         'claimed_device', v_claim.device_id,
                         'presenting_device', p_device_id));
    raise exception 'KLUY-DEVICE-CLAIM-REUSED: this claim token was already redeemed by device %; a token is single-use', v_claim.device_id
      using errcode = 'P0001';
  end if;

  if v_claim.state = 'revoked' then
    raise exception 'KLUY-DEVICE-CLAIM-REVOKED: this claim was revoked at %', v_claim.revoked_at
      using errcode = 'P0001';
  end if;

  -- clock_timestamp(), NOT now(). `now()` is TRANSACTION START time, so a
  -- transaction that opened before the claim expired would redeem it after
  -- expiry and never notice. Expiry is a wall-clock question.
  if v_claim.expires_at <= clock_timestamp() then
    update kitluy_devices.device_claims set state = 'expired' where id = v_claim.id;
    perform kitluy_devices.record_claim_event(
      v_claim.device_id, v_claim.id, null, 'CLAIM_EXPIRED', p_actor_ref,
      jsonb_build_object('expired_at', v_claim.expires_at));
    raise exception 'KLUY-DEVICE-CLAIM-EXPIRED: this claim expired at %', v_claim.expires_at
      using errcode = 'P0001';
  end if;

  -- The payload binds the token to the device and scope it was issued for.
  if v_claim.payload_sha256 <> lower(p_presented_payload_sha256) then
    perform kitluy_devices.record_claim_event(
      v_claim.device_id, v_claim.id, null, 'CLAIM_REFUSED', p_actor_ref,
      jsonb_build_object('reason', 'payload_mismatch'));
    raise exception 'KLUY-DEVICE-CLAIM-PAYLOAD-ALTERED: the presented claim payload does not match the payload this token was issued for'
      using errcode = 'P0001';
  end if;

  if v_claim.device_id <> p_device_id then
    perform kitluy_devices.record_claim_event(
      p_device_id, v_claim.id, null, 'CLAIM_REFUSED', p_actor_ref,
      jsonb_build_object('reason', 'wrong_device',
                         'issued_for', v_claim.device_id));
    raise exception 'KLUY-DEVICE-CLAIM-WRONG-DEVICE: this claim was issued for device %, not %', v_claim.device_id, p_device_id
      using errcode = 'P0001';
  end if;

  select * into v_device from kitluy_devices.devices where id = p_device_id for update;

  if v_device.lifecycle_state = 'quarantined' then
    perform kitluy_devices.record_claim_event(
      p_device_id, v_claim.id, null, 'CLAIM_REFUSED', p_actor_ref,
      jsonb_build_object('reason', 'device_quarantined'));
    raise exception 'KLUY-DEVICE-QUARANTINED: device % is quarantined; a claim cannot be redeemed until the incident is cleared', p_device_id
      using errcode = 'P0001';
  end if;
  if v_device.lifecycle_state in ('retired', 'replaced') then
    raise exception 'KLUY-DEVICE-TERMINAL: device % is %', p_device_id, v_device.lifecycle_state
      using errcode = 'P0001';
  end if;

  select count(*) into v_collisions
  from kitluy_devices.colliding_evidence_device_ids(p_device_id);
  if v_collisions > 0 then
    perform kitluy_devices.record_claim_event(
      p_device_id, v_claim.id, null, 'CLAIM_REFUSED', p_actor_ref,
      jsonb_build_object('reason', 'duplicate_hardware_evidence'));
    raise exception 'KLUY-DEVICE-EVIDENCE-COLLISION: device % shares hardware evidence with % other non-retired device(s)', p_device_id, v_collisions
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from kitluy_devices.device_assignments a
    where a.device_id = p_device_id and a.state in ('pending_trust', 'active')
  ) then
    raise exception 'KLUY-DEVICE-ALREADY-CLAIMED: device % already holds a live assignment', p_device_id
      using errcode = 'P0001';
  end if;

  -- The next generation follows the HIGHEST EVER ISSUED, not the device's
  -- current value. A revoked device carries generation 0, so `current + 1`
  -- would re-issue a number that already exists and a stale Hub presenting the
  -- old generation would be silently accepted as current.
  select coalesce(max(assignment_generation), 0) + 1 into v_generation
  from kitluy_devices.device_assignments where device_id = p_device_id;

  insert into kitluy_devices.device_assignments
    (device_id, tenant_id, digital_store_id, store_location_id,
     assignment_generation, state, claim_id, created_by_operator_ref)
  values
    (p_device_id, v_claim.tenant_id, v_claim.digital_store_id, v_claim.store_location_id,
     v_generation, 'pending_trust', v_claim.id, p_actor_ref)
  returning id into v_assignment_id;

  update kitluy_devices.device_claims
  set state = 'redeemed', redeemed_at = now(), redeemed_assignment_id = v_assignment_id
  where id = v_claim.id;

  -- The device is now claimed, scope-bound and assigned. It STOPS HERE.
  -- `active` requires certificate-backed activation, gated on BLK-005.
  update kitluy_devices.devices
  set assignment_generation = v_generation,
      lifecycle_state = 'awaiting_trust',
      updated_at = now()
  where id = p_device_id;

  perform kitluy_devices.record_claim_event(
    p_device_id, v_claim.id, v_assignment_id, 'CLAIM_REDEEMED', p_actor_ref,
    jsonb_build_object('assignment_generation', v_generation));
  perform kitluy_devices.record_claim_event(
    p_device_id, v_claim.id, v_assignment_id, 'ASSIGNMENT_CREATED', p_actor_ref,
    jsonb_build_object('assignment_generation', v_generation));
  perform kitluy_devices.record_lifecycle_event(
    p_device_id, v_device.lifecycle_state, 'awaiting_trust', 'CLAIM_REDEEMED', p_actor_ref,
    jsonb_build_object('assignment_id', v_assignment_id,
                       'assignment_generation', v_generation));

  return v_assignment_id;
end;
$$;

comment on function kitluy_devices.redeem_device_claim_v1 is
  'Redeems a single-use claim and creates the assignment. The device lands in `awaiting_trust` and STOPS: activation is certificate-backed and gated on BLK-005. Re-presenting the same token from the SAME device with the SAME payload returns the SAME assignment — the "claim committed but response lost" recovery path. Presenting it from a different device is token reuse and is refused. Expired, revoked, altered-payload, wrong-device, quarantined, retired, evidence-colliding and already-assigned cases are each refused with their own code, and every refusal is recorded.';

-- ---------------------------------------------------------------------------
-- assert_assignment_generation_current_v1 — stale-generation rejection.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.assert_assignment_generation_current_v1(
  p_device_id uuid,
  p_assignment_generation integer
) returns uuid
language plpgsql
stable
as $$
declare
  v_assignment kitluy_devices.device_assignments;
begin
  select * into v_assignment
  from kitluy_devices.device_assignments
  where device_id = p_device_id
    and assignment_generation = p_assignment_generation;

  if not found then
    raise exception 'KLUY-DEVICE-GENERATION-UNKNOWN: device % has no assignment generation %', p_device_id, p_assignment_generation
      using errcode = 'P0001';
  end if;

  if v_assignment.state = 'revoked' then
    raise exception 'KLUY-DEVICE-GENERATION-REVOKED: assignment generation % for device % was revoked at %',
      p_assignment_generation, p_device_id, v_assignment.revoked_at
      using errcode = 'P0001';
  end if;
  if v_assignment.state = 'superseded' then
    raise exception 'KLUY-DEVICE-GENERATION-STALE: assignment generation % for device % was superseded at %',
      p_assignment_generation, p_device_id, v_assignment.superseded_at
      using errcode = 'P0001';
  end if;

  return v_assignment.id;
end;
$$;

comment on function kitluy_devices.assert_assignment_generation_current_v1 is
  'Refuses a stale or revoked assignment generation. This is the check WS-10 batches and configuration snapshots resolve against: a Hub still presenting an old generation after a reassignment is refused, not tolerated.';

-- ---------------------------------------------------------------------------
-- revoke_device_assignment_v1
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.revoke_device_assignment_v1(
  p_device_id uuid,
  p_reason_code text,
  p_operator_ref text
) returns integer
language plpgsql
as $$
declare
  v_device kitluy_devices.devices;
  v_assignment_id uuid;
  v_revoked integer := 0;
begin
  select * into v_device from kitluy_devices.devices where id = p_device_id for update;
  if not found then
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;

  select id into v_assignment_id
  from kitluy_devices.device_assignments
  where device_id = p_device_id and state in ('pending_trust', 'active');

  if v_assignment_id is null then
    raise exception 'KLUY-DEVICE-NO-ASSIGNMENT: device % holds no live assignment to revoke', p_device_id
      using errcode = 'P0001';
  end if;

  -- Terminal assignments fall with the assignment that authorized them.
  update kitluy_devices.device_terminal_assignments
  set state = 'revoked', revoked_at = now()
  where assignment_id = v_assignment_id and state in ('pending_trust', 'active');

  update kitluy_devices.device_assignments
  set state = 'revoked', revoked_at = now(), revocation_reason = p_reason_code
  where id = v_assignment_id;
  get diagnostics v_revoked = row_count;

  -- Any outstanding claim for this device dies with the assignment.
  update kitluy_devices.device_claims
  set state = 'revoked', revoked_at = now(), revocation_reason = p_reason_code
  where device_id = p_device_id and state = 'issued';

  -- The offline projection is withdrawn. A revoked assignment that still
  -- projects is a revocation that did not happen.
  delete from kitluy_devices.device_assignment_projections where device_id = p_device_id;

  -- Generation 0 means "no valid assignment". The NEXT assignment takes the
  -- next number after the highest ever issued, so a revoked generation is
  -- never reused.
  update kitluy_devices.devices
  set assignment_generation = 0, updated_at = now()
  where id = p_device_id;

  if v_device.lifecycle_state in ('awaiting_trust', 'active') then
    update kitluy_devices.devices
    set lifecycle_state = 'enrolled', updated_at = now()
    where id = p_device_id;
    perform kitluy_devices.record_lifecycle_event(
      p_device_id, v_device.lifecycle_state, 'enrolled', p_reason_code, p_operator_ref,
      jsonb_build_object('assignment_id', v_assignment_id));
  end if;

  perform kitluy_devices.record_claim_event(
    p_device_id, null, v_assignment_id, 'ASSIGNMENT_REVOKED', p_operator_ref,
    jsonb_build_object('reason', p_reason_code));

  return v_revoked;
end;
$$;

comment on function kitluy_devices.revoke_device_assignment_v1 is
  'Revokes the live assignment, its terminal assignments, any outstanding claim and the offline projection, and returns the device to `enrolled` with generation 0. A revoked generation number is never reused. Withdrawing the projection is part of the revocation — a revoked assignment that still projects is a revocation that did not happen.';

-- ---------------------------------------------------------------------------
-- assign_terminal_profile_v1
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.assign_terminal_profile_v1(
  p_device_id uuid,
  p_assignment_generation integer,
  p_terminal_profile_key text,
  p_store_location_id uuid,
  p_operator_ref text
) returns uuid
language plpgsql
as $$
declare
  v_assignment_id uuid;
  v_assignment kitluy_devices.device_assignments;
  v_terminal_id uuid;
begin
  v_assignment_id := kitluy_devices.assert_assignment_generation_current_v1(
    p_device_id, p_assignment_generation);

  select * into v_assignment
  from kitluy_devices.device_assignments where id = v_assignment_id;

  if v_assignment.store_location_id <> p_store_location_id then
    raise exception 'KLUY-DEVICE-TERMINAL-WRONG-LOCATION: assignment generation % binds device % to location %, not %',
      p_assignment_generation, p_device_id, v_assignment.store_location_id, p_store_location_id
      using errcode = 'P0001';
  end if;

  insert into kitluy_devices.device_terminal_assignments
    (device_id, assignment_id, store_location_id, terminal_profile_key,
     state, assigned_by_operator_ref)
  values
    (p_device_id, v_assignment_id, p_store_location_id, p_terminal_profile_key,
     'pending_trust', p_operator_ref)
  returning id into v_terminal_id;

  perform kitluy_devices.record_claim_event(
    p_device_id, null, v_assignment_id, 'TERMINAL_ASSIGNED', p_operator_ref,
    jsonb_build_object('terminal_profile_key', p_terminal_profile_key));

  return v_terminal_id;
end;
$$;

comment on function kitluy_devices.assign_terminal_profile_v1 is
  'Binds a terminal profile to a device under a specific assignment generation. Refuses a stale or revoked generation and refuses a Location that is not the one the assignment binds — the installer cannot change role or Location by presenting different arguments (trust policy §5: "the installer cannot change role by editing local files").';

-- ---------------------------------------------------------------------------
-- replace_device_assignment_v1 — governed reassignment.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.replace_device_assignment_v1(
  p_device_id uuid,
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_reason_code text,
  p_operator_ref text
) returns uuid
language plpgsql
as $$
declare
  v_device kitluy_devices.devices;
  v_prior kitluy_devices.device_assignments;
  v_highest integer;
  v_assignment_id uuid;
begin
  select * into v_device from kitluy_devices.devices where id = p_device_id for update;
  if not found then
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;
  if v_device.lifecycle_state in ('retired', 'replaced', 'quarantined') then
    raise exception 'KLUY-DEVICE-REASSIGN-STATE: device % is % and cannot be reassigned', p_device_id, v_device.lifecycle_state
      using errcode = 'P0001';
  end if;

  perform kitluy_devices.resolve_device_scope_v1(
    p_tenant_id, p_digital_store_id, p_store_location_id);

  select * into v_prior
  from kitluy_devices.device_assignments
  where device_id = p_device_id and state in ('pending_trust', 'active')
  for update;

  if not found then
    raise exception 'KLUY-DEVICE-NO-ASSIGNMENT: device % holds no live assignment to replace', p_device_id
      using errcode = 'P0001';
  end if;

  update kitluy_devices.device_terminal_assignments
  set state = 'revoked', revoked_at = now()
  where assignment_id = v_prior.id and state in ('pending_trust', 'active');

  update kitluy_devices.device_assignments
  set state = 'superseded', superseded_at = now()
  where id = v_prior.id;

  delete from kitluy_devices.device_assignment_projections where device_id = p_device_id;

  -- The next generation follows the HIGHEST ever issued, so a superseded or
  -- revoked number is never reused even after several reassignments.
  select max(assignment_generation) into v_highest
  from kitluy_devices.device_assignments where device_id = p_device_id;

  insert into kitluy_devices.device_assignments
    (device_id, tenant_id, digital_store_id, store_location_id,
     assignment_generation, state, supersedes_assignment_id, created_by_operator_ref)
  values
    (p_device_id, p_tenant_id, p_digital_store_id, p_store_location_id,
     v_highest + 1, 'pending_trust', v_prior.id, p_operator_ref)
  returning id into v_assignment_id;

  update kitluy_devices.devices
  set assignment_generation = v_highest + 1,
      lifecycle_state = 'awaiting_trust',
      updated_at = now()
  where id = p_device_id;

  if v_device.lifecycle_state <> 'awaiting_trust' then
    perform kitluy_devices.record_lifecycle_event(
      p_device_id, v_device.lifecycle_state, 'awaiting_trust', p_reason_code, p_operator_ref,
      jsonb_build_object('assignment_id', v_assignment_id));
  end if;

  perform kitluy_devices.record_claim_event(
    p_device_id, null, v_assignment_id, 'ASSIGNMENT_REPLACED', p_operator_ref,
    jsonb_build_object('supersedes', v_prior.id,
                       'prior_generation', v_prior.assignment_generation,
                       'new_generation', v_highest + 1,
                       'reason', p_reason_code));

  return v_assignment_id;
end;
$$;

comment on function kitluy_devices.replace_device_assignment_v1 is
  'Governed reassignment: supersedes the live assignment, revokes its terminal assignments, withdraws the offline projection and issues the NEXT generation after the highest ever used. A reassigned device returns to `awaiting_trust`, never straight to `active`.';

-- ===========================================================================
-- Activation, extended for the assignment boundary and evidence collisions
-- ===========================================================================
create or replace function kitluy_devices.activate_device_v1(
  p_device_id uuid,
  p_environment text,
  p_actor_ref text
) returns void
language plpgsql
as $$
declare
  v_device kitluy_devices.devices;
  v_open_incidents integer;
  v_collisions integer;
  v_assignment kitluy_devices.device_assignments;
begin
  select * into v_device from kitluy_devices.devices where id = p_device_id for update;
  if not found then
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;

  -- Refusal evidence is the caller's job only in the sense that
  -- attempt_activate_device_v1 is the caller (KLRISK-DEVICE-001). A raise here
  -- rolls back this function's own writes, so it deliberately writes none.

  -- THE BLK-005 GATE, before every other check, so "activation is blocked" is
  -- the answer regardless of how healthy the device looks.
  perform kitluy_devices.assert_pki_configuration_approved(p_environment);

  if v_device.lifecycle_state <> 'awaiting_trust' then
    raise exception 'KLUY-DEVICE-ACTIVATION-STATE: device % is %; only a claimed, scope-bound device awaiting trust activates', p_device_id, v_device.lifecycle_state
      using errcode = 'P0001';
  end if;

  -- A2: duplicate hardware evidence blocks activation. Keeping both rows is
  -- only sound if neither identity can activate.
  select count(*) into v_collisions
  from kitluy_devices.colliding_evidence_device_ids(p_device_id);
  if v_collisions > 0 then
    raise exception 'KLUY-DEVICE-EVIDENCE-COLLISION: device % shares hardware evidence with % other non-retired device(s); neither may activate until the duplicate is resolved', p_device_id, v_collisions
      using errcode = 'P0001';
  end if;

  -- `activation_blocked` is excluded: it records that the PLATFORM was blocked
  -- (BLK-005), not that the DEVICE is suspect. Counting it would mean that
  -- resolving BLK-005 left every device permanently un-activatable by the
  -- evidence of having been blocked.
  select count(*) into v_open_incidents
  from kitluy_devices.device_trust_incidents
  where device_id = p_device_id
    and cleared_at is null
    and incident_type <> 'activation_blocked';

  if v_open_incidents > 0 then
    raise exception 'KLUY-DEVICE-OPEN-INCIDENT: device % has % open trust incident(s); activation requires governed clearance', p_device_id, v_open_incidents
      using errcode = 'P0001';
  end if;

  select * into v_assignment
  from kitluy_devices.device_assignments
  where device_id = p_device_id and state = 'pending_trust'
  for update;

  if not found then
    raise exception 'KLUY-DEVICE-NO-ASSIGNMENT: device % has no assignment pending trust; the claim must be redeemed first', p_device_id
      using errcode = 'P0001';
  end if;

  if v_assignment.assignment_generation <> v_device.assignment_generation then
    raise exception 'KLUY-DEVICE-GENERATION-STALE: device % carries generation %, the pending assignment is %',
      p_device_id, v_device.assignment_generation, v_assignment.assignment_generation
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from kitluy_devices.device_certificates
    where device_id = p_device_id and environment = p_environment and status = 'active'
  ) then
    raise exception 'KLUY-DEVICE-NO-CERTIFICATE: device % has no active % certificate; activation is certificate-backed (KLD-2026-07-21-003)', p_device_id, p_environment
      using errcode = 'P0001';
  end if;

  update kitluy_devices.devices
  set lifecycle_state = 'active', updated_at = now()
  where id = p_device_id;

  update kitluy_devices.device_assignments
  set state = 'active', activated_at = now()
  where id = v_assignment.id;

  update kitluy_devices.device_terminal_assignments
  set state = 'active'
  where assignment_id = v_assignment.id and state = 'pending_trust';

  -- The offline projection is written ONLY here. A device that never activated
  -- has nothing to carry offline.
  insert into kitluy_devices.device_assignment_projections
    (device_id, assignment_id, assignment_generation, tenant_id,
     digital_store_id, store_location_id, terminal_profile_keys, environment)
  values
    (p_device_id, v_assignment.id, v_assignment.assignment_generation,
     v_assignment.tenant_id, v_assignment.digital_store_id, v_assignment.store_location_id,
     coalesce((select array_agg(t.terminal_profile_key order by t.terminal_profile_key)
               from kitluy_devices.device_terminal_assignments t
               where t.assignment_id = v_assignment.id and t.state = 'active'), '{}'),
     p_environment)
  on conflict (device_id) do update
    set assignment_id = excluded.assignment_id,
        assignment_generation = excluded.assignment_generation,
        tenant_id = excluded.tenant_id,
        digital_store_id = excluded.digital_store_id,
        store_location_id = excluded.store_location_id,
        terminal_profile_keys = excluded.terminal_profile_keys,
        projected_at = now(),
        environment = excluded.environment;

  update kitluy_devices.device_trust_incidents
  set cleared_at = now(),
      cleared_by_operator_ref = p_actor_ref,
      clearance_reason = 'ACTIVATION_SUCCEEDED'
  where device_id = p_device_id
    and incident_type = 'activation_blocked'
    and cleared_at is null;

  perform kitluy_devices.record_lifecycle_event(
    p_device_id, 'awaiting_trust', 'active', 'ACTIVATED', p_actor_ref,
    jsonb_build_object('environment', p_environment,
                       'assignment_id', v_assignment.id,
                       'assignment_generation', v_assignment.assignment_generation));
end;
$$;

comment on function kitluy_devices.activate_device_v1 is
  'BLK-005 GATED, and the gate runs BEFORE every other check so the refusal reason is always the missing cryptographic configuration. NOT reachable by an application role — attempt_activate_device_v1 is the only granted path (KLRISK-DEVICE-001). Enforces the owner-locked chain end to end: claim accepted -> identity and scope bound -> assignment created -> awaiting_trust -> BLK-005 configuration -> certificate issuance -> activation. Additionally refuses a device whose hardware evidence collides with another non-retired device, and refuses a device whose carried generation does not match the pending assignment.';

-- ---------------------------------------------------------------------------
-- Lifecycle transitions, extended for awaiting_trust.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.enforce_device_lifecycle_transition()
returns trigger
language plpgsql
as $$
declare
  v_legal boolean;
begin
  if new.lifecycle_state is not distinct from old.lifecycle_state then
    return new;
  end if;

  v_legal := case old.lifecycle_state
    when 'manufactured'   then new.lifecycle_state in ('enrolled', 'quarantined', 'retired')
    when 'enrolled'       then new.lifecycle_state in ('awaiting_trust', 'quarantined', 'suspended', 'retired', 'replaced')
    -- `enrolled -> active` is GONE. A device reaches `active` only through
    -- `awaiting_trust`, which means only through an accepted claim and a bound
    -- assignment. The provisioning chain is now a state-machine property, not
    -- a convention a caller could route around.
    when 'awaiting_trust' then new.lifecycle_state in ('active', 'enrolled', 'quarantined', 'suspended', 'retired', 'replaced')
    when 'active'         then new.lifecycle_state in ('suspended', 'quarantined', 'enrolled', 'retired', 'replaced')
    when 'suspended'      then new.lifecycle_state in ('awaiting_trust', 'enrolled', 'quarantined', 'retired', 'replaced')
    when 'quarantined'    then new.lifecycle_state in ('enrolled', 'retired', 'replaced')
    when 'retired'        then false
    when 'replaced'       then false
    else false
  end;

  if not v_legal then
    raise exception
      'KLUY-DEVICE-TRANSITION-ILLEGAL: % -> % is not a legal device lifecycle transition',
      old.lifecycle_state, new.lifecycle_state
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function kitluy_devices.enforce_device_lifecycle_transition() is
  'The device lifecycle state machine. `enrolled -> active` was REMOVED in group 0121: `active` is reachable only from `awaiting_trust`, so a device cannot be activated without an accepted claim and a bound assignment. `retired` and `replaced` stay terminal. Legality here remains necessary but not sufficient — `awaiting_trust -> active` is legal in this matrix and still refused by the BLK-005 gate.';

-- ---------------------------------------------------------------------------
-- A3 — a duplicate at enrollment quarantines BOTH identities.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.quarantine_evidence_collisions_v1(
  p_device_id uuid,
  p_detected_by text
) returns integer
language plpgsql
as $$
declare
  v_other uuid;
  v_count integer := 0;
begin
  for v_other in select * from kitluy_devices.colliding_evidence_device_ids(p_device_id) loop
    -- Which unit is the clone is NOT knowable from the evidence, so both are
    -- held. This is deliberate: silently trusting the incumbent would let an
    -- attacker who reaches an enrollment station inherit a live identity.
    perform kitluy_devices.quarantine_device_v1(
      v_other, 'duplicate_hardware_signal', 'CRITICAL', p_detected_by,
      format('shares non-storage hardware evidence with device %s', p_device_id),
      jsonb_build_object('colliding_device', p_device_id, 'held_pending_investigation', true));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function kitluy_devices.quarantine_evidence_collisions_v1 is
  'Quarantines every OTHER non-retired device sharing this one''s non-storage hardware evidence. Which unit is the clone is not knowable from the evidence, so both are held pending investigation (trust policy §8 step 5, "require investigation and A3/A4 identity decision"). RESIDUAL RISK, recorded rather than hidden: an actor with access to an approved enrollment station can therefore quarantine a live device by enrolling a unit that presents its evidence. Enrollment is a station-authorized internal operation, and trust policy §8 step 2 ("preserve Store offline operation when safe on the previously trusted Hub") is the mitigation the runbook owes.';

create or replace function kitluy_devices.enroll_device_v1(
  p_asset_tag text,
  p_hardware_profile_id uuid,
  p_manufactured_at timestamptz,
  p_device_public_key_fingerprint text,
  p_public_key_algorithm text,
  p_key_storage_class text,
  p_enrollment_station_id text,
  p_enrollment_operator_ref text,
  p_signals jsonb,
  p_enrollment_batch_ref text default null,
  p_enrollment_reason text default 'INITIAL_MANUFACTURING_ENROLLMENT'
) returns uuid
language plpgsql
as $$
declare
  v_profile kitluy_devices.hardware_profiles;
  v_device_id uuid;
  v_manifest_id uuid;
  v_enrollment_id uuid;
  v_required kitluy_devices.hardware_signal_type;
  v_present kitluy_devices.hardware_signal_type[];
  v_duplicates integer;
begin
  select * into v_profile
  from kitluy_devices.hardware_profiles
  where id = p_hardware_profile_id;

  if not found then
    raise exception 'KLUY-DEVICE-PROFILE-MISSING: hardware profile % does not exist', p_hardware_profile_id
      using errcode = 'P0001';
  end if;

  if not v_profile.is_active or v_profile.certification_status = 'WITHDRAWN' then
    raise exception 'KLUY-DEVICE-PROFILE-INACTIVE: hardware profile % is % and cannot be enrolled against',
      v_profile.profile_key, v_profile.certification_status
      using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_signals) is distinct from 'array' or jsonb_array_length(p_signals) = 0 then
    raise exception 'KLUY-DEVICE-EVIDENCE-MISSING: enrollment requires a non-empty hardware evidence array; unregistered hardware cannot enroll (trust policy §14)'
      using errcode = 'P0001';
  end if;

  insert into kitluy_devices.devices
    (asset_tag, hardware_profile_id, device_class, lifecycle_state, manufactured_at)
  values
    (p_asset_tag, p_hardware_profile_id, v_profile.device_class, 'manufactured', p_manufactured_at)
  returning id into v_device_id;

  insert into kitluy_devices.hardware_manifests
    (device_id, captured_at, captured_by_station)
  values
    (v_device_id, now(), p_enrollment_station_id)
  returning id into v_manifest_id;

  insert into kitluy_devices.hardware_manifest_signals
    (manifest_id, signal_type, signal_value, is_storage_module)
  select
    v_manifest_id,
    (element ->> 'signal_type')::kitluy_devices.hardware_signal_type,
    kitluy_devices.normalize_hardware_signal(element ->> 'signal_value'),
    kitluy_devices.is_storage_module_signal((element ->> 'signal_type')::kitluy_devices.hardware_signal_type)
  from jsonb_array_elements(p_signals) as element;

  select array_agg(distinct s.signal_type) into v_present
  from kitluy_devices.hardware_manifest_signals s
  where s.manifest_id = v_manifest_id;

  foreach v_required in array v_profile.required_signal_types loop
    if not (v_required = any (coalesce(v_present, '{}'::kitluy_devices.hardware_signal_type[]))) then
      raise exception 'KLUY-DEVICE-EVIDENCE-INCOMPLETE: hardware profile % requires signal % which the enrollment did not present',
        v_profile.profile_key, v_required
        using errcode = 'P0001';
    end if;
  end loop;

  perform kitluy_devices.seal_hardware_manifest(v_manifest_id);

  insert into kitluy_devices.manufacturing_enrollments
    (device_id, hardware_manifest_id, enrollment_sequence, state,
     device_public_key_fingerprint, public_key_algorithm, key_storage_class,
     enrollment_station_id, enrollment_operator_ref, enrollment_batch_ref,
     enrollment_reason)
  values
    (v_device_id, v_manifest_id, 1, 'sealed',
     lower(p_device_public_key_fingerprint), p_public_key_algorithm, p_key_storage_class,
     p_enrollment_station_id, p_enrollment_operator_ref, p_enrollment_batch_ref,
     p_enrollment_reason)
  returning id into v_enrollment_id;

  update kitluy_devices.devices
  set current_enrollment_id = v_enrollment_id,
      lifecycle_state = 'enrolled',
      updated_at = now()
  where id = v_device_id;

  perform kitluy_devices.record_lifecycle_event(
    v_device_id, 'manufactured', 'enrolled', p_enrollment_reason, p_enrollment_operator_ref,
    jsonb_build_object('enrollment_id', v_enrollment_id, 'manifest_id', v_manifest_id));

  -- Duplicate detection (trust policy §8). Detected and RECORDED, never
  -- silently rejected — a clone that leaves no evidence is the failure mode.
  -- A3: BOTH identities are held, because which one is the clone is not
  -- knowable from the evidence.
  v_duplicates := kitluy_devices.quarantine_evidence_collisions_v1(
    v_device_id, p_enrollment_station_id);

  if v_duplicates > 0 then
    perform kitluy_devices.quarantine_device_v1(
      v_device_id,
      'duplicate_hardware_signal',
      'CRITICAL',
      p_enrollment_station_id,
      format('shares non-storage hardware evidence with %s other non-retired device(s)', v_duplicates),
      jsonb_build_object('colliding_device_count', v_duplicates, 'held_pending_investigation', true));
  end if;

  return v_device_id;
end;
$$;

comment on function kitluy_devices.enroll_device_v1 is
  'Manufacturing/repair-station enrollment (trust policy §4). Creates the immutable device record, captures and seals the hardware-evidence manifest, records the PUBLIC-key fingerprint, and moves manufactured -> enrolled. Enrolled is NOT active and is not even claimable-to-active: activation additionally requires a claim, an assignment and approved PKI configuration. When non-storage evidence collides with another non-retired device, BOTH identities are quarantined (group 0121) — which unit is the clone is not knowable from the evidence, so neither is trusted.';

-- ---------------------------------------------------------------------------
-- Append-only and consistency triggers for the new relations.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.enforce_claim_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-DEVICE-CLAIM-IMMUTABLE: a claim is never deleted; its outcome is recorded'
      using errcode = 'P0001';
  end if;

  if new.device_id is distinct from old.device_id
     or new.tenant_id is distinct from old.tenant_id
     or new.digital_store_id is distinct from old.digital_store_id
     or new.store_location_id is distinct from old.store_location_id
     or new.claim_token_sha256 is distinct from old.claim_token_sha256
     or new.payload_sha256 is distinct from old.payload_sha256
     or new.expires_at is distinct from old.expires_at then
    raise exception
      'KLUY-DEVICE-CLAIM-IMMUTABLE: a claim''s device, scope, token, payload and expiry are fixed at issue; only its state may close'
      using errcode = 'P0001';
  end if;

  if old.state <> 'issued' and new.state is distinct from old.state then
    raise exception 'KLUY-DEVICE-CLAIM-CLOSED: claim % is already %', old.id, old.state
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function kitluy_devices.enforce_assignment_scope_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-DEVICE-ASSIGNMENT-IMMUTABLE: assignment history is never deleted'
      using errcode = 'P0001';
  end if;

  -- The scope an assignment binds cannot be WIDENED, narrowed or moved. A
  -- different scope is a different generation.
  if new.device_id is distinct from old.device_id
     or new.tenant_id is distinct from old.tenant_id
     or new.digital_store_id is distinct from old.digital_store_id
     or new.store_location_id is distinct from old.store_location_id
     or new.assignment_generation is distinct from old.assignment_generation
     or new.claim_id is distinct from old.claim_id
     or new.supersedes_assignment_id is distinct from old.supersedes_assignment_id then
    raise exception
      'KLUY-DEVICE-ASSIGNMENT-IMMUTABLE: an assignment''s scope and generation are fixed; a scope change is a NEW generation that supersedes this one'
      using errcode = 'P0001';
  end if;

  if old.state in ('superseded', 'revoked') and new.state is distinct from old.state then
    raise exception 'KLUY-DEVICE-ASSIGNMENT-CLOSED: assignment % is already %', old.id, old.state
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function kitluy_devices.enforce_terminal_assignment_location()
returns trigger
language plpgsql
as $$
declare
  v_location uuid;
begin
  select store_location_id into v_location
  from kitluy_devices.device_assignments where id = new.assignment_id;

  if v_location is distinct from new.store_location_id then
    raise exception
      'KLUY-DEVICE-TERMINAL-WRONG-LOCATION: terminal assignment names location % but its assignment binds %',
      new.store_location_id, v_location
      using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE'
     and (new.device_id is distinct from old.device_id
       or new.assignment_id is distinct from old.assignment_id
       or new.terminal_profile_key is distinct from old.terminal_profile_key
       or new.store_location_id is distinct from old.store_location_id) then
    raise exception
      'KLUY-DEVICE-TERMINAL-IMMUTABLE: a terminal assignment''s device, assignment, profile and location are fixed; a change is a new record'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger trg_device_claims_append_only
  before update or delete on kitluy_devices.device_claims
  for each row execute function kitluy_devices.enforce_claim_append_only();

create trigger trg_device_assignments_scope_immutable
  before update or delete on kitluy_devices.device_assignments
  for each row execute function kitluy_devices.enforce_assignment_scope_immutable();

create trigger trg_device_terminal_assignments_location
  before insert or update on kitluy_devices.device_terminal_assignments
  for each row execute function kitluy_devices.enforce_terminal_assignment_location();

create trigger trg_device_terminal_assignments_no_delete
  before delete on kitluy_devices.device_terminal_assignments
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_device_claim_events_append_only
  before update or delete on kitluy_devices.device_claim_events
  for each row execute function kitluy_auth.enforce_append_only();

-- ---------------------------------------------------------------------------
-- Fleet status, extended for the claim/assignment boundary.
-- ---------------------------------------------------------------------------
-- DROP + CREATE, not CREATE OR REPLACE: the new assignment columns land in the
-- middle of the projection, and PostgreSQL refuses to replace a view whose
-- column order changes.
--
-- Scope of the destruction, stated so the marker is not a rubber stamp: this
-- view was created hours earlier in group 0120, in this same cycle. It holds no
-- data, nothing in the repository selects from it outside the assertion suite,
-- and the replacement below is a strict superset of its columns. The service
-- grant it carried IS lost by the drop and is re-granted explicitly at the end
-- of this file — that part is a real regression risk, not a formality.
-- kitluy:destructive-approved:KLD-2026-07-21-003
drop view if exists kitluy_devices.device_fleet_status;

create view kitluy_devices.device_fleet_status as
select
  d.id as device_record_id,
  d.asset_tag,
  d.device_class,
  d.lifecycle_state,
  d.assignment_generation,
  hp.profile_key,
  e.enrollment_sequence,
  e.device_public_key_fingerprint,
  e.key_storage_class,
  m.manifest_sha256,
  m.signal_count,
  a.tenant_id,
  a.digital_store_id,
  a.store_location_id,
  a.state as assignment_state,
  (select count(*) from kitluy_devices.device_terminal_assignments t
    where t.assignment_id = a.id and t.state <> 'revoked') as terminal_assignment_count,
  (select count(*) from kitluy_devices.device_trust_incidents ti
    where ti.device_id = d.id and ti.cleared_at is null
      and ti.incident_type <> 'activation_blocked') as open_incident_count,
  (select count(*) from kitluy_devices.colliding_evidence_device_ids(d.id)) as evidence_collision_count,
  (select max(o.observed_at) from kitluy_devices.device_hardware_observations o
    where o.device_id = d.id) as last_observed_at,
  (select c.status from kitluy_devices.device_certificates c
    where c.device_id = d.id and c.status = 'active' limit 1) as certificate_status,
  -- Honest about WHY a device is not active, rather than implying it could be.
  -- Order matters: the most specific true reason wins.
  case
    when d.lifecycle_state = 'active' then 'ACTIVE'
    when d.lifecycle_state in ('retired', 'replaced') then upper(d.lifecycle_state::text)
    when d.lifecycle_state = 'quarantined' then 'QUARANTINED'
    when (select count(*) from kitluy_devices.colliding_evidence_device_ids(d.id)) > 0
      then 'BLOCKED_EVIDENCE_COLLISION'
    when a.id is null then 'AWAITING_CLAIM'
    when not exists (select 1 from kitluy_devices.pki_trust_configuration p where p.is_active)
      then 'BLOCKED_PKI_UNCONFIGURED'
    else 'AWAITING_ACTIVATION'
  end as fleet_status
from kitluy_devices.devices d
join kitluy_devices.hardware_profiles hp on hp.id = d.hardware_profile_id
left join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
left join kitluy_devices.hardware_manifests m on m.id = e.hardware_manifest_id
left join kitluy_devices.device_assignments a
  on a.device_id = d.id and a.state in ('pending_trust', 'active');

comment on view kitluy_devices.device_fleet_status is
  'Fleet status read model. Reports the SPECIFIC blocker — BLOCKED_EVIDENCE_COLLISION, AWAITING_CLAIM or BLOCKED_PKI_UNCONFIGURED — rather than a generic "awaiting activation" that would make a blocked programme look merely pending.';

-- ---------------------------------------------------------------------------
-- RLS and grants.
-- ---------------------------------------------------------------------------
alter table kitluy_devices.device_claims enable row level security;
alter table kitluy_devices.device_claims force row level security;
alter table kitluy_devices.device_assignments enable row level security;
alter table kitluy_devices.device_assignments force row level security;
alter table kitluy_devices.device_terminal_assignments enable row level security;
alter table kitluy_devices.device_terminal_assignments force row level security;
alter table kitluy_devices.device_assignment_projections enable row level security;
alter table kitluy_devices.device_assignment_projections force row level security;
alter table kitluy_devices.device_claim_events enable row level security;
alter table kitluy_devices.device_claim_events force row level security;

grant select, insert, update on
  kitluy_devices.device_claims, kitluy_devices.device_assignments,
  kitluy_devices.device_terminal_assignments,
  kitluy_devices.device_assignment_projections,
  kitluy_devices.device_claim_events
  to service_role;

-- The fleet view was DROPped and re-CREATEd above, which discards the grant
-- group 0120 gave it. Re-granting is not optional cleanup: without it the
-- service path silently loses fleet visibility, which is exactly the kind of
-- regression a green migration hides.
grant select on kitluy_devices.device_fleet_status to service_role;

-- PUBLIC EXECUTE is a creation default that a later GRANT does not revoke.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'kitluy_devices'
  loop
    execute format('revoke all on function %s from public', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
end $$;

-- KLRISK-DEVICE-001: the raising activation form is NOT reachable by any
-- application role. attempt_activate_device_v1 is the only granted path, and it
-- cannot produce a refusal without producing its evidence.
revoke all on function
  kitluy_devices.activate_device_v1(uuid, text, text) from public, service_role;

commit;
