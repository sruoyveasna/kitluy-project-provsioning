-- kitluy:group:0125
-- Migration group 0125: device_credential_persistence (WS-11-T003 Step 4).
--
-- Additive. Groups 0120-0124 are COMMITTED and are not edited.
--
-- ===========================================================================
-- WHAT IS PERSISTED HERE IS A KITLUY DEVELOPMENT DEVICE CREDENTIAL
-- ===========================================================================
-- NOT an X.509 certificate. A canonical to-be-signed structure with a detached
-- Ed25519 signature. `credential_kind` carries that on every row, and a CHECK
-- refuses any other kind, so a later reader cannot mistake these for X.509 nor
-- cite them as pilot/production mTLS evidence. §14 leaves both BLOCKED.
--
-- ===========================================================================
-- THE PROBLEM THIS SCHEMA EXISTS TO SOLVE
-- ===========================================================================
-- The private-key operation CANNOT participate in the database transaction.
-- Signing happens outside it, so a naive design either loses the signature or
-- issues twice. The answer is a DURABLE PRE-SIGN REQUEST carrying DETERMINISTIC
-- identifiers: serial and generation are decided BEFORE signing and recorded,
-- so a controlled recovery re-creates the same signature (Ed25519 is
-- deterministic) without ever allocating a second serial.
--
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).

begin;

create type kitluy_devices.credential_request_state as enum (
  'prepared',
  'signing',
  'signed_unpersisted',
  'issued',
  'refused'
);

create type kitluy_devices.credential_state as enum (
  'issued',
  'revoked',
  'superseded',
  'expired'
);

create type kitluy_devices.pop_verification_status as enum (
  'verified',
  'failed'
);

comment on type kitluy_devices.credential_request_state is
  'Issuance state machine. `signed_unpersisted` is the honest name for the window the owner identified: the CA signed, the final transaction failed, and a signature exists in the world that no credential row accounts for.';

-- ---------------------------------------------------------------------------
-- A NOLOGIN governor role. Only functions owned by it may write an `issued`
-- credential or advance a generation head. This is the group-0024 pattern,
-- adopted because review finding RV-001 proved a GUC marker is forgeable by
-- any role that can call set_config().
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_credential_issuer') then
    create role kitluy_credential_issuer nologin;
  end if;
end $$;

-- ===========================================================================
-- Requests
-- ===========================================================================
create table if not exists kitluy_devices.device_credential_requests (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  idempotency_key text not null,
  canonical_payload_hash text not null,
  device_record_id uuid not null references kitluy_devices.devices (id),
  environment text not null,
  purpose text not null,
  assignment_generation integer not null,
  activation_attempt_id text,
  public_key text not null,
  public_key_fingerprint text not null,
  hardware_trust_level kitluy_devices.hardware_trust_level not null,
  trusted_time_evaluation_id uuid,
  state kitluy_devices.credential_request_state not null default 'prepared',
  refusal_code text,
  created_at timestamptz not null default now(),

  -- The SAME idempotency key with a DIFFERENT payload is refused: the key is
  -- unique per environment, so the second insert collides rather than being
  -- quietly treated as a replay of something it is not.
  constraint device_credential_requests_idem_key
    unique (environment, idempotency_key),
  constraint device_credential_requests_env_chk
    check (environment in ('development', 'pilot', 'production')),
  constraint device_credential_requests_purpose_chk
    check (purpose = 'device_identity'),
  constraint device_credential_requests_hash_chk
    check (canonical_payload_hash ~ '^[0-9a-f]{64}$'),
  constraint device_credential_requests_fingerprint_chk
    check (public_key_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint device_credential_requests_generation_chk
    check (assignment_generation >= 1),
  constraint device_credential_requests_refusal_chk
    check ((state = 'refused') = (refusal_code is not null))
);

comment on table kitluy_devices.device_credential_requests is
  'Owner: Fleet. DURABLE PRE-SIGN request. Written BEFORE the CA is asked to sign, carrying the deterministic identifiers, so a signature that outlives a failed transaction can be reconciled instead of lost or duplicated. MC: MUT (state machine only).';

create index device_credential_requests_device_idx
  on kitluy_devices.device_credential_requests (device_record_id, created_at desc);

-- ===========================================================================
-- Proof of possession — the RESULT, not a boolean
-- ===========================================================================
create table if not exists kitluy_devices.device_proof_of_possession_results (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique
    references kitluy_devices.device_credential_requests (request_id),
  algorithm text not null,
  signed_preimage_hash text not null,
  signature bytea not null,
  verification_status kitluy_devices.pop_verification_status not null,
  verified_key_fingerprint text,
  verified_at_trusted_time timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  constraint device_pop_preimage_chk check (signed_preimage_hash ~ '^[0-9a-f]{64}$'),
  -- A verified result carries what it verified; a failed one carries why.
  constraint device_pop_verified_chk
    check ((verification_status = 'verified')
           = (verified_key_fingerprint is not null and verified_at_trusted_time is not null)),
  constraint device_pop_failed_chk
    check ((verification_status = 'failed') = (failure_code is not null))
);

comment on table kitluy_devices.device_proof_of_possession_results is
  'Owner: Fleet. The proof-of-possession RESULT — algorithm, preimage hash, signature, verdict and the trusted time it was judged at. Append-only and UNIQUE per request, so a FAILED proof can never be reused by a later request: the request id is spent. MC: A/O.';

create trigger trg_device_pop_append_only
  before update or delete on kitluy_devices.device_proof_of_possession_results
  for each row execute function kitluy_auth.enforce_append_only();

-- ===========================================================================
-- Credentials
-- ===========================================================================
create table if not exists kitluy_devices.device_credentials (
  credential_id uuid primary key default gen_random_uuid(),
  credential_kind text not null default 'kitluy.development-device-credential.v1',
  serial_number text not null,
  device_record_id uuid not null references kitluy_devices.devices (id),
  environment text not null,
  purpose text not null,
  public_key text not null,
  public_key_fingerprint text not null,
  issuer_key_id text not null,
  intermediate_credential_id uuid,
  root_credential_id uuid,
  certificate_generation integer not null,
  assignment_generation integer not null,
  not_before timestamptz not null,
  not_after timestamptz not null,
  hardware_trust_level kitluy_devices.hardware_trust_level not null,
  production_eligible boolean not null default false,
  state kitluy_devices.credential_state not null default 'issued',
  canonical_tbs text not null,
  detached_signature bytea not null,
  created_from_request_id text not null unique
    references kitluy_devices.device_credential_requests (request_id),
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),

  constraint device_credentials_serial_key unique (environment, serial_number),
  constraint device_credentials_generation_key
    unique (device_record_id, environment, purpose, certificate_generation),

  -- The KIND is fixed. A later X.509 credential is a DIFFERENT kind and a
  -- different table decision, not a value slipped into this column.
  constraint device_credentials_kind_chk
    check (credential_kind = 'kitluy.development-device-credential.v1'),
  -- §4: this credential kind is NEVER production-eligible. Refused by the
  -- database, so no service, migration or operator can set it true.
  constraint device_credentials_not_production_eligible_chk
    check (production_eligible = false),
  -- Development-only, matching the kind. A pilot/production credential needs a
  -- different kind and a later owner decision.
  constraint device_credentials_env_chk check (environment = 'development'),
  constraint device_credentials_purpose_chk check (purpose = 'device_identity'),
  constraint device_credentials_window_chk check (not_after > not_before),
  -- §5 development lifetime: 30 days, enforced rather than trusted.
  constraint device_credentials_lifetime_chk
    check (not_after - not_before <= interval '30 days'),
  constraint device_credentials_generation_chk check (certificate_generation >= 1),
  constraint device_credentials_fingerprint_chk
    check (public_key_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint device_credentials_revoked_chk
    check ((state = 'revoked') = (revoked_at is not null))
);

comment on table kitluy_devices.device_credentials is
  'Owner: Fleet. Issued KITLUY DEVELOPMENT DEVICE CREDENTIAL — NOT an X.509 certificate, and never evidence of pilot or production mTLS compatibility. production_eligible is pinned false by CHECK (§4). The canonical TBS and detached signature are stored so a credential can be re-verified from the row alone. MC: MUT (state machine only).';

create index device_credentials_device_idx
  on kitluy_devices.device_credentials (device_record_id, certificate_generation desc);

-- ===========================================================================
-- Chain links
-- ===========================================================================
create table if not exists kitluy_devices.device_credential_chain_links (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid not null references kitluy_devices.device_credentials (credential_id),
  link_position integer not null,
  role text not null,
  subject_fingerprint text not null,
  issuer_key_id text not null,
  environment text not null,
  purpose text not null,
  canonical_tbs text not null,
  detached_signature bytea not null,
  created_at timestamptz not null default now(),
  unique (credential_id, link_position),
  constraint device_chain_links_role_chk check (role in ('root', 'intermediate', 'device')),
  constraint device_chain_links_position_chk check (link_position between 0 and 2)
);

comment on table kitluy_devices.device_credential_chain_links is
  'Owner: Fleet. The chain a credential was issued under, stored link by link so verification does not depend on a CA still being reachable. Environment and purpose are checked against the credential by trigger — a link from another environment or purpose is refused. MC: A/O.';

create or replace function kitluy_devices.enforce_chain_link_consistency()
returns trigger
language plpgsql
as $$
declare
  v_env text;
  v_purpose text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'KLUY-CRED-CHAIN-IMMUTABLE: a chain link is never edited or deleted'
      using errcode = 'P0001';
  end if;

  select environment, purpose into v_env, v_purpose
  from kitluy_devices.device_credentials where credential_id = new.credential_id;

  if new.environment <> v_env then
    raise exception
      'KLUY-CRED-CHAIN-ENVIRONMENT: link environment % does not match the credential environment %',
      new.environment, v_env using errcode = 'P0001';
  end if;
  if new.purpose <> v_purpose then
    raise exception
      'KLUY-CRED-CHAIN-PURPOSE: link purpose % does not match the credential purpose %',
      new.purpose, v_purpose using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_device_chain_links_consistency
  before insert or update or delete on kitluy_devices.device_credential_chain_links
  for each row execute function kitluy_devices.enforce_chain_link_consistency();

-- ===========================================================================
-- Issuance attempts (audit) and orphan incidents
-- ===========================================================================
create table if not exists kitluy_devices.device_credential_issuance_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id text not null
    references kitluy_devices.device_credential_requests (request_id),
  device_record_id uuid not null references kitluy_devices.devices (id),
  from_state kitluy_devices.credential_request_state,
  to_state kitluy_devices.credential_request_state not null,
  credential_id uuid references kitluy_devices.device_credentials (credential_id),
  actor_ref text not null,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

comment on table kitluy_devices.device_credential_issuance_attempts is
  'Owner: Fleet. Append-only issuance audit. A credential does not become `issued` unless its audit row committed in the same transaction — enforced by trigger, not by convention. MC: A/O.';

create trigger trg_device_issuance_attempts_append_only
  before update or delete on kitluy_devices.device_credential_issuance_attempts
  for each row execute function kitluy_auth.enforce_append_only();

create table if not exists kitluy_devices.device_credential_orphan_incidents (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique
    references kitluy_devices.device_credential_requests (request_id),
  device_record_id uuid not null references kitluy_devices.devices (id),
  serial_number text not null,
  idempotency_key text not null,
  signature_sha256 text not null,
  detail text not null,
  resolved_at timestamptz,
  resolved_by_operator_ref text,
  resolution text,
  created_at timestamptz not null default now(),
  constraint device_orphan_signature_chk check (signature_sha256 ~ '^[0-9a-f]{64}$'),
  constraint device_orphan_resolution_chk
    check ((resolved_at is null) = (resolved_by_operator_ref is null))
);

comment on table kitluy_devices.device_credential_orphan_incidents is
  'Owner: Fleet/Security. Records that a signature EXISTS which no credential row accounts for. UNIQUE per request, so a recovery reconciles the one incident rather than creating a second request. Resolution names an operator and is never a delete. MC: A/O + governed resolution.';

-- ===========================================================================
-- Generation heads — the renewal concurrency control
-- ===========================================================================
-- "One active credential" is the WRONG constraint: §5 permits a three-day
-- overlap, so two generations are legitimately usable at once. The authority is
-- therefore a separate pointer row with a version for compare-and-swap.
-- ===========================================================================
create table if not exists kitluy_devices.device_credential_heads (
  device_record_id uuid not null references kitluy_devices.devices (id),
  environment text not null,
  purpose text not null,
  current_generation integer not null,
  previous_generation integer,
  overlap_ends_at timestamptz,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (device_record_id, environment, purpose),
  constraint device_heads_env_chk check (environment = 'development'),
  constraint device_heads_purpose_chk check (purpose = 'device_identity'),
  constraint device_heads_generation_chk check (current_generation >= 1),
  constraint device_heads_previous_chk
    check (previous_generation is null or previous_generation < current_generation),
  -- The overlap pointer and its expiry travel together.
  constraint device_heads_overlap_chk
    check ((previous_generation is null) = (overlap_ends_at is null)),
  constraint device_heads_version_chk check (version >= 1)
);

comment on table kitluy_devices.device_credential_heads is
  'Owner: Fleet. The AUTHORITATIVE current generation per device/environment/purpose, with a version for compare-and-swap. Renewal locks this row; two concurrent renewals produce one success and one KLUY-CRED-RENEWAL-GENERATION-CONFLICT. A plain "one active credential" unique index would have been wrong — the approved three-day overlap makes two generations legitimately usable.';

-- The 3-day maximum overlap, enforced at write time against the credential.
create or replace function kitluy_devices.enforce_overlap_window()
returns trigger
language plpgsql
as $$
declare
  v_prev_not_after timestamptz;
begin
  if new.previous_generation is null then
    return new;
  end if;

  select not_after into v_prev_not_after
  from kitluy_devices.device_credentials
  where device_record_id = new.device_record_id
    and environment = new.environment
    and purpose = new.purpose
    and certificate_generation = new.previous_generation;

  if v_prev_not_after is not null and new.overlap_ends_at > v_prev_not_after then
    raise exception
      'KLUY-CRED-OVERLAP-BEYOND-EXPIRY: overlap ends % but the previous credential expires %',
      new.overlap_ends_at, v_prev_not_after using errcode = 'P0001';
  end if;

  -- §5: development maximum overlap is 3 days, measured from the moment the
  -- new generation took the head.
  if new.overlap_ends_at > new.updated_at + interval '3 days' then
    raise exception
      'KLUY-CRED-OVERLAP-EXCEEDED: an overlap ending % exceeds the 3-day development maximum from %',
      new.overlap_ends_at, new.updated_at using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger trg_device_heads_overlap
  before insert or update on kitluy_devices.device_credential_heads
  for each row execute function kitluy_devices.enforce_overlap_window();

create table if not exists kitluy_devices.device_credential_renewal_attempts (
  id uuid primary key default gen_random_uuid(),
  device_record_id uuid not null references kitluy_devices.devices (id),
  environment text not null,
  from_generation integer,
  to_generation integer,
  outcome text not null,
  refusal_code text,
  head_version_seen bigint,
  actor_ref text not null,
  occurred_at timestamptz not null default now(),
  constraint device_renewal_outcome_chk check (outcome in ('RENEWED', 'REFUSED')),
  constraint device_renewal_refusal_chk
    check ((outcome = 'REFUSED') = (refusal_code is not null))
);

comment on table kitluy_devices.device_credential_renewal_attempts is
  'Owner: Fleet. Append-only renewal audit including REFUSED attempts and the head version each attempt saw — which is what makes a lost compare-and-swap race legible afterwards. MC: A/O.';

create trigger trg_device_renewal_attempts_append_only
  before update or delete on kitluy_devices.device_credential_renewal_attempts
  for each row execute function kitluy_auth.enforce_append_only();

-- ===========================================================================
-- The guards that make `issued` mean something
-- ===========================================================================
create or replace function kitluy_devices.enforce_credential_issuance_integrity()
returns trigger
language plpgsql
as $$
declare
  v_pop kitluy_devices.pop_verification_status;
  v_request kitluy_devices.device_credential_requests;
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-CRED-IMMUTABLE: an issued credential is revoked or superseded, never deleted'
      using errcode = 'P0001';
  end if;

  -- Only the governor may create or keep a credential in `issued`. An
  -- application role writing this row directly is the attack this blocks, and
  -- the check is on the EXECUTING IDENTITY, not a settable GUC (RV-001).
  if new.state = 'issued' and current_user <> 'kitluy_credential_issuer' then
    raise exception
      'KLUY-CRED-UNAUTHORIZED-ISSUE: only the governed issuance path may write an issued credential (current_user %)', current_user
      using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    select verification_status into v_pop
    from kitluy_devices.device_proof_of_possession_results
    where request_id = new.created_from_request_id;

    if v_pop is distinct from 'verified' then
      raise exception
        'KLUY-CRED-NO-PROOF-OF-POSSESSION: request % has no VERIFIED proof of possession', new.created_from_request_id
        using errcode = 'P0001';
    end if;

    select * into v_request
    from kitluy_devices.device_credential_requests
    where request_id = new.created_from_request_id;

    -- The assignment generation must STILL be current at commit. A request
    -- prepared before a reassignment must not issue afterwards.
    if v_request.assignment_generation <> new.assignment_generation
       or new.assignment_generation
          <> (select assignment_generation from kitluy_devices.devices where id = new.device_record_id) then
      raise exception
        'KLUY-CRED-STALE-ASSIGNMENT: assignment generation moved between request and issuance'
        using errcode = 'P0001';
    end if;

    if v_request.public_key_fingerprint <> new.public_key_fingerprint then
      raise exception
        'KLUY-CRED-FINGERPRINT-MISMATCH: the credential attests to a key the request did not present'
        using errcode = 'P0001';
    end if;

    -- The audit row must ALREADY exist in this transaction. An issuance whose
    -- audit failed cannot become issued (the owner's atomicity requirement).
    if not exists (
      select 1 from kitluy_devices.device_credential_issuance_attempts
      where request_id = new.created_from_request_id and to_state = 'issued'
    ) then
      raise exception
        'KLUY-CRED-NO-AUDIT: no issuance audit event for request %; a credential does not become issued without one', new.created_from_request_id
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

comment on function kitluy_devices.enforce_credential_issuance_integrity() is
  'Makes `issued` mean something. A credential row is refused unless the executing identity is the governed issuer, a VERIFIED proof of possession exists, the assignment generation is still current, the fingerprint matches the request, and the issuance audit event is already present in this transaction. Deletion is refused outright.';

create trigger trg_device_credentials_issuance_integrity
  before insert or update or delete on kitluy_devices.device_credentials
  for each row execute function kitluy_devices.enforce_credential_issuance_integrity();

create or replace function kitluy_devices.enforce_head_authority()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-CRED-HEAD-IMMUTABLE: a generation head is advanced, never deleted'
      using errcode = 'P0001';
  end if;
  if current_user <> 'kitluy_credential_issuer' then
    raise exception
      'KLUY-CRED-UNAUTHORIZED-HEAD: only the governed issuance path may advance a generation head (current_user %)', current_user
      using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    -- Monotonic, and the version must advance by exactly one so a
    -- compare-and-swap cannot be satisfied by a stale read.
    if new.current_generation < old.current_generation then
      raise exception 'KLUY-CRED-HEAD-ROLLBACK: a generation head never moves backwards'
        using errcode = 'P0001';
    end if;
    if new.version <> old.version + 1 then
      raise exception
        'KLUY-CRED-HEAD-VERSION: head version must advance by exactly one (% -> %)', old.version, new.version
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_device_heads_authority
  before insert or update or delete on kitluy_devices.device_credential_heads
  for each row execute function kitluy_devices.enforce_head_authority();

-- ---------------------------------------------------------------------------
-- Ownership transfer so the governor owns the SECURITY DEFINER surface.
-- ---------------------------------------------------------------------------
grant usage, create on schema kitluy_devices to kitluy_credential_issuer;

-- `GRANT <role> TO current_user` SEGFAULTS PostgreSQL 15.8 — it crashed the
-- server the first time this migration ran. The membership must be granted to
-- the RESOLVED, QUOTED role name instead. Same defect the WS-10 Hub harness hit.
do $grant_membership$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$grant_membership$;

alter table kitluy_devices.device_credentials owner to kitluy_credential_issuer;
alter table kitluy_devices.device_credential_heads owner to kitluy_credential_issuer;

-- ---------------------------------------------------------------------------
-- RLS and grants. Application roles get SELECT only; every write goes through
-- the governed path.
-- ---------------------------------------------------------------------------
alter table kitluy_devices.device_credential_requests enable row level security;
alter table kitluy_devices.device_credential_requests force row level security;
alter table kitluy_devices.device_proof_of_possession_results enable row level security;
alter table kitluy_devices.device_proof_of_possession_results force row level security;
alter table kitluy_devices.device_credentials enable row level security;
alter table kitluy_devices.device_credentials force row level security;
alter table kitluy_devices.device_credential_chain_links enable row level security;
alter table kitluy_devices.device_credential_chain_links force row level security;
alter table kitluy_devices.device_credential_issuance_attempts enable row level security;
alter table kitluy_devices.device_credential_issuance_attempts force row level security;
alter table kitluy_devices.device_credential_orphan_incidents enable row level security;
alter table kitluy_devices.device_credential_orphan_incidents force row level security;
alter table kitluy_devices.device_credential_heads enable row level security;
alter table kitluy_devices.device_credential_heads force row level security;
alter table kitluy_devices.device_credential_renewal_attempts enable row level security;
alter table kitluy_devices.device_credential_renewal_attempts force row level security;

-- RLS ENABLE+FORCE binds the table OWNER too, so the governor needs an
-- explicit, named policy. Kept as a policy rather than dropping FORCE: a named
-- policy is auditable and says WHO may write, whereas `no force` would silently
-- exempt whoever happens to own the table next.
create policy device_credentials_governed_write on kitluy_devices.device_credentials
  for all to kitluy_credential_issuer using (true) with check (true);

create policy device_credential_heads_governed_write on kitluy_devices.device_credential_heads
  for all to kitluy_credential_issuer using (true) with check (true);

-- Read-only visibility for the service path.
create policy device_credentials_service_read on kitluy_devices.device_credentials
  for select to service_role using (true);

create policy device_credential_heads_service_read on kitluy_devices.device_credential_heads
  for select to service_role using (true);

grant select, insert, update on
  kitluy_devices.device_credential_requests,
  kitluy_devices.device_proof_of_possession_results,
  kitluy_devices.device_credential_chain_links,
  kitluy_devices.device_credential_issuance_attempts,
  kitluy_devices.device_credential_orphan_incidents,
  kitluy_devices.device_credential_renewal_attempts
  to service_role;

-- Credentials and heads are SELECT-only for the service role. Writing them is
-- the governed path's job, and that is the point of this whole migration.
grant select on
  kitluy_devices.device_credentials,
  kitluy_devices.device_credential_heads
  to service_role;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'kitluy_devices'
  loop
    execute format('revoke all on function %s from public', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
end $$;

revoke all on function
  kitluy_devices.activate_device_v1(uuid, text, text) from public, service_role;

commit;
