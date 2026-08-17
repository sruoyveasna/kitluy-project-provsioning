-- kitluy:hub:migration:0031
-- ===========================================================================
-- KitLuy Store Hub local database — Hub-terminal pairing authority.
--
-- WS-11-T004-P03B. Authority: kitluy-device-discovery-and-pairing-protocol
-- v1.0.0 §8 (handshake), §9 (Hub-signed receipt), §15 (rogue-device
-- protections), §18 (PAIR_* refusals); master build plan WS-11 ("normal
-- operation remains LAN-only capable"); ownership classification A — the
-- STORE HUB is the local operational authority for pairing sessions, nonce
-- consumption and receipts. Cloud acknowledgement is NEVER part of the LAN
-- handshake's commit path.
--
-- WHAT THIS GROUP RECORDS AND WHAT IT DOES NOT
--   A pairing session binds one cloud-authored terminal projection to THIS
--   Hub's identity for one mutual-proof handshake, and a paired session owns
--   exactly one immutable Hub-signed receipt. Nothing here claims the
--   receipt reached the terminal, survived a restart, or that either side is
--   reachable — durable persistence and recovery are P03C.
--
-- AUTHORIZATION INPUTS are the EXISTING cloud-authored projections the Hub
-- already holds (§6.2 "Installer cannot self-select profiles"):
--   edge_identity.terminal_device        — terminal registration
--   edge_config.terminal_profile_assignment — cloud-assigned profile grants
--   edge_identity.device_credential      — credential metadata + revocation
--   edge_identity.hub_assignment         — this Hub's scope + generation
-- The Hub AUTHORS none of these. The cloud activation record id (cloud group
-- 0174) is NOT projected to the Hub today; the Hub-local activation truth is
-- the registration + enabled profile grant + active credential, and the
-- missing projection is RECORDED in the P03B handoff, not invented here.
--
-- TIME: local commit time is authoritative (0001 §1). No trusted-time table
-- exists in this database and this group does not add one.
--
-- CRYPTOGRAPHY: Ed25519 verification lives in @kitluy/device-identity
-- (OPTION B, cloud group 0127). The doors below record ATTESTATIONS of
-- verification and enforce every relational prerequisite; no signature is
-- verified in SQL (house rule: configuration/revocation snapshots store
-- signatures, the command layer verifies them).
--
-- GOVERNANCE: mutations happen only through SECURITY DEFINER doors owned by
-- the NOLOGIN, granted-to-nobody kitluy_pairing_governor (the 0024 RV-001
-- pattern: the gate is the EXECUTING IDENTITY, not a settable GUC).
-- kitluy_hub_runtime holds SELECT on the tables and EXECUTE on the doors —
-- and nothing else. Terminals hold no database identity at all.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. GOVERNOR ROLE (0024 pattern)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_pairing_governor') then
    create role kitluy_pairing_governor nologin;
  end if;
end $$;

comment on role kitluy_pairing_governor is
  'Pairing authority (group 0031). NOLOGIN and granted to nobody, so current_user can only equal this role INSIDE the pairing doors it owns. The pairing-session and receipt triggers recognise this identity and nothing else (0024 RV-001 pattern).';

-- ---------------------------------------------------------------------------
-- 2. edge_identity.pairing_session — scoped.
-- ---------------------------------------------------------------------------
create table edge_identity.pairing_session (
  id                               uuid        primary key,
  protocol_version                 text        not null,
  purpose                          text        not null,
  tenant_id                        uuid        not null,
  digital_store_id                 uuid        not null,
  location_id                      uuid        not null,
  environment                      text        not null,
  hub_device_id                    uuid        not null references edge_identity.hub_device (id),
  hub_assignment_id                uuid        not null references edge_identity.hub_assignment (id),
  hub_assignment_generation        integer     not null,
  hub_credential_id                uuid        not null references edge_identity.device_credential (id),
  hub_certificate_serial           text        not null,
  hub_certificate_fingerprint      char(64)    not null,
  terminal_device_id               uuid        not null references edge_identity.terminal_device (id),
  terminal_assignment_generation   integer     not null,
  terminal_profile_code            text        not null,
  terminal_credential_id           uuid        not null references edge_identity.device_credential (id),
  terminal_certificate_serial      text        not null,
  terminal_certificate_fingerprint char(64)    not null,
  terminal_nonce                   char(64)    not null,
  hub_nonce                        char(64)    not null,
  state                            text        not null,
  refusal_code                     text        null,
  transcript_hash                  char(64)    null,
  correlation_id                   uuid        not null,
  created_at                       timestamptz not null default now(),
  expires_at                       timestamptz not null,
  terminal_proof_verified_at       timestamptz null,
  paired_at                        timestamptz null,
  constraint pairing_session_version_ck check (protocol_version = '1.0'),
  constraint pairing_session_purpose_ck check (purpose = 'hub_terminal_pairing'),
  constraint pairing_session_environment_ck
    check (environment in ('development', 'pilot', 'production')),
  constraint pairing_session_profile_ck
    check (terminal_profile_code ~ '^laundry\.t[1-4]\.[a-z_]+$'),
  constraint pairing_session_hub_fp_ck check (hub_certificate_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint pairing_session_term_fp_ck
    check (terminal_certificate_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint pairing_session_terminal_nonce_ck check (terminal_nonce ~ '^[0-9a-f]{64}$'),
  constraint pairing_session_hub_nonce_ck check (hub_nonce ~ '^[0-9a-f]{64}$'),
  constraint pairing_session_nonce_distinct_ck check (terminal_nonce <> hub_nonce),
  constraint pairing_session_state_ck
    check (state in ('challenge_issued', 'terminal_proof_verified', 'paired', 'expired', 'refused')),
  constraint pairing_session_window_ck check (expires_at > created_at),
  constraint pairing_session_transcript_ck
    check (transcript_hash is null or transcript_hash ~ '^[0-9a-f]{64}$'),
  -- Receipt cannot precede mutual proof; PAIRED cannot precede the receipt's
  -- own timestamps; a refusal carries its code and a success never does.
  constraint pairing_session_proof_state_ck
    check ((terminal_proof_verified_at is not null)
           = (state in ('terminal_proof_verified', 'paired'))),
  constraint pairing_session_paired_state_ck
    check ((state = 'paired') = (paired_at is not null and transcript_hash is not null)),
  constraint pairing_session_refusal_ck
    check ((state = 'refused') = (refusal_code is not null)),
  constraint pairing_session_order_ck
    check (paired_at is null or terminal_proof_verified_at is null
           or paired_at >= terminal_proof_verified_at)
);

comment on table edge_identity.pairing_session is
  'One Hub-terminal mutual-proof handshake (pairing protocol §8; group 0031). Bindings are immutable for the life of the session; only the state machine fields move, forward-only, through governor doors. Nonces are 32-byte lowercase hex, directionally distinct, single-use across ALL sessions (unique indexes below). Local commit time is authoritative (0001 §1).';
comment on column edge_identity.pairing_session.terminal_nonce is
  'The nonce the TERMINAL contributed in its hello (§8.1). Bound at creation, immutable, globally single-use. Never logged, never in ordinary events — it is signed material.';
comment on column edge_identity.pairing_session.hub_nonce is
  'The nonce the HUB service generated for its challenge (§8.2) from the sanctioned random authority (node:crypto; this database has no pgcrypto). Same discipline as terminal_nonce.';

create index edge_identity_pairing_session_scope_idx
  on edge_identity.pairing_session (tenant_id, digital_store_id, location_id);
create unique index pairing_session_terminal_nonce_uq
  on edge_identity.pairing_session (terminal_nonce);
create unique index pairing_session_hub_nonce_uq
  on edge_identity.pairing_session (hub_nonce);
-- At most ONE live handshake per terminal.
create unique index pairing_session_active_uq
  on edge_identity.pairing_session (terminal_device_id)
  where state in ('challenge_issued', 'terminal_proof_verified');
create index pairing_session_terminal_idx
  on edge_identity.pairing_session (terminal_device_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. edge_identity.pairing_receipt — scoped, append-only.
-- ---------------------------------------------------------------------------
create table edge_identity.pairing_receipt (
  id                               uuid        primary key,
  receipt_version                  text        not null,
  pairing_session_id               uuid        not null references edge_identity.pairing_session (id),
  transcript_hash                  char(64)    not null,
  hub_device_id                    uuid        not null references edge_identity.hub_device (id),
  hub_certificate_fingerprint      char(64)    not null,
  terminal_device_id               uuid        not null references edge_identity.terminal_device (id),
  terminal_certificate_fingerprint char(64)    not null,
  tenant_id                        uuid        not null,
  digital_store_id                 uuid        not null,
  location_id                      uuid        not null,
  environment                      text        not null,
  terminal_assignment_generation   integer     not null,
  terminal_profile_code            text        not null,
  paired_at                        timestamptz not null,
  valid_until                      timestamptz null,
  signature_b64                    text        not null,
  signing_certificate_serial       text        not null,
  correlation_id                   uuid        not null,
  created_at                       timestamptz not null default now(),
  constraint pairing_receipt_version_ck check (receipt_version = '1.0'),
  constraint pairing_receipt_session_uq unique (pairing_session_id),
  constraint pairing_receipt_transcript_ck check (transcript_hash ~ '^[0-9a-f]{64}$'),
  constraint pairing_receipt_hub_fp_ck check (hub_certificate_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint pairing_receipt_term_fp_ck
    check (terminal_certificate_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint pairing_receipt_environment_ck
    check (environment in ('development', 'pilot', 'production')),
  constraint pairing_receipt_profile_ck
    check (terminal_profile_code ~ '^laundry\.t[1-4]\.[a-z_]+$'),
  constraint pairing_receipt_window_ck check (valid_until is null or valid_until > paired_at),
  constraint pairing_receipt_signature_ck check (length(signature_b64) between 1 and 512)
);

comment on table edge_identity.pairing_receipt is
  'The immutable Hub-signed pairing receipt (§9; group 0031). One per paired session (unique). The signature is Hub-signed over the kitluy.pairing-receipt.v1 canonical bytes and is STORED here, verified in the command layer (house rule; no signature verification in SQL). The receipt proves the handshake at paired_at — it does NOT prove delivery to the terminal, persistence across restart, future reachability, configuration download or first sync (P03C).';

create index edge_identity_pairing_receipt_scope_idx
  on edge_identity.pairing_receipt (tenant_id, digital_store_id, location_id);
create index pairing_receipt_terminal_idx
  on edge_identity.pairing_receipt (terminal_device_id, paired_at desc);

-- ---------------------------------------------------------------------------
-- 4. GOVERNANCE TRIGGERS (0024 RV-001 executing-identity pattern)
-- ---------------------------------------------------------------------------
create function edge_identity.enforce_pairing_session_governance()
returns trigger
language plpgsql
as $gov$
begin
  if current_user <> 'kitluy_pairing_governor' then
    raise exception
      'KLUY-EDGE-PAIRING-GOVERNED: pairing_session rows change only through the governed pairing doors (group 0031)'
      using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'KLUY-EDGE-NO-HARD-DELETE: pairing_session is history, not state'
      using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if new.id <> old.id
       or new.protocol_version <> old.protocol_version
       or new.purpose <> old.purpose
       or new.tenant_id <> old.tenant_id
       or new.digital_store_id <> old.digital_store_id
       or new.location_id <> old.location_id
       or new.environment <> old.environment
       or new.hub_device_id <> old.hub_device_id
       or new.hub_assignment_id <> old.hub_assignment_id
       or new.hub_assignment_generation <> old.hub_assignment_generation
       or new.hub_credential_id <> old.hub_credential_id
       or new.hub_certificate_serial <> old.hub_certificate_serial
       or new.hub_certificate_fingerprint <> old.hub_certificate_fingerprint
       or new.terminal_device_id <> old.terminal_device_id
       or new.terminal_assignment_generation <> old.terminal_assignment_generation
       or new.terminal_profile_code <> old.terminal_profile_code
       or new.terminal_credential_id <> old.terminal_credential_id
       or new.terminal_certificate_serial <> old.terminal_certificate_serial
       or new.terminal_certificate_fingerprint <> old.terminal_certificate_fingerprint
       or new.terminal_nonce <> old.terminal_nonce
       or new.hub_nonce <> old.hub_nonce
       or new.correlation_id <> old.correlation_id
       or new.created_at <> old.created_at
       or new.expires_at <> old.expires_at then
      raise exception
        'KLUY-EDGE-PAIRING-IMMUTABLE: pairing_session bindings cannot change during a session'
        using errcode = 'P0001';
    end if;
    -- Forward-only: a terminal state is terminal, and replay cannot rewrite
    -- original timestamps.
    if old.state in ('paired', 'expired', 'refused') then
      raise exception 'KLUY-EDGE-PAIRING-CONSUMED: session % is already %', old.id, old.state
        using errcode = 'P0001';
    end if;
    if old.state = 'terminal_proof_verified' and new.state = 'challenge_issued' then
      raise exception 'KLUY-EDGE-PAIRING-IMMUTABLE: proof verification cannot be unwound'
        using errcode = 'P0001';
    end if;
    if old.terminal_proof_verified_at is not null
       and new.terminal_proof_verified_at is distinct from old.terminal_proof_verified_at then
      raise exception 'KLUY-EDGE-PAIRING-IMMUTABLE: the proof timestamp is written once'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$gov$;

create trigger pairing_session_governance
  before insert or update or delete on edge_identity.pairing_session
  for each row execute function edge_identity.enforce_pairing_session_governance();

create function edge_identity.enforce_pairing_receipt_governance()
returns trigger
language plpgsql
as $gov$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'KLUY-EDGE-APPEND-ONLY: % rejected on edge_identity.pairing_receipt', tg_op
      using errcode = 'P0001';
  end if;
  if current_user <> 'kitluy_pairing_governor' then
    raise exception
      'KLUY-EDGE-PAIRING-GOVERNED: pairing_receipt rows are issued only by the completion door (group 0031)'
      using errcode = 'P0001';
  end if;
  return new;
end
$gov$;

create trigger pairing_receipt_governance
  before insert or update or delete on edge_identity.pairing_receipt
  for each row execute function edge_identity.enforce_pairing_receipt_governance();

-- ---------------------------------------------------------------------------
-- 5. PREREQUISITE REVALIDATION (shared by every door; races D and E)
-- ---------------------------------------------------------------------------
-- Re-derives every relational prerequisite from the AUTHORITATIVE projections
-- at call time. Raises the FIRST failed prerequisite as its §18 family.
create function edge_identity.assert_pairing_prerequisites_v1(
  p_session edge_identity.pairing_session
) returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, edge_identity, edge_config
as $req$
declare
  v_hub edge_identity.hub_device;
  v_assignment edge_identity.hub_assignment;
  v_hub_cred edge_identity.device_credential;
  v_terminal edge_identity.terminal_device;
  v_term_cred edge_identity.device_credential;
begin
  select h.* into v_hub from edge_identity.hub_device h where h.id = p_session.hub_device_id;
  if not found or v_hub.trust_status <> 'trusted' or v_hub.lifecycle_status <> 'deployed' then
    raise exception 'KLUY-EDGE-PAIRING-HUB-NOT-ACTIVE: the Store Hub is not trusted and deployed'
      using errcode = 'P0001';
  end if;

  select a.* into v_assignment from edge_identity.hub_assignment a
   where a.id = p_session.hub_assignment_id;
  if not found or v_assignment.status <> 'active' or v_assignment.ended_at is not null
     or v_assignment.assignment_generation <> p_session.hub_assignment_generation
     or v_assignment.tenant_id <> p_session.tenant_id
     or v_assignment.digital_store_id <> p_session.digital_store_id
     or v_assignment.location_id <> p_session.location_id then
    raise exception 'KLUY-EDGE-PAIRING-HUB-NOT-ACTIVE: the Hub assignment is not the active one for this scope'
      using errcode = 'P0001';
  end if;

  select c.* into v_hub_cred from edge_identity.device_credential c
   where c.id = p_session.hub_credential_id;
  if not found or v_hub_cred.status <> 'active' or v_hub_cred.revoked_at is not null
     or v_hub_cred.expires_at <= now()
     or v_hub_cred.certificate_serial <> p_session.hub_certificate_serial
     or v_hub_cred.public_key_fingerprint <> p_session.hub_certificate_fingerprint
     or v_hub_cred.certificate_serial <> v_assignment.operational_cert_serial then
    raise exception 'KLUY-EDGE-PAIRING-CERT-INVALID: the Hub operational credential is not current'
      using errcode = 'P0001';
  end if;
  if edge_config.is_certificate_revoked_offline_v1(
       p_session.tenant_id, p_session.digital_store_id, p_session.location_id,
       p_session.environment, v_hub_cred.certificate_serial) then
    raise exception 'KLUY-EDGE-PAIRING-CERT-INVALID: the Hub credential is revoked in the offline snapshot'
      using errcode = 'P0001';
  end if;

  select t.* into v_terminal from edge_identity.terminal_device t
   where t.id = p_session.terminal_device_id;
  if not found or v_terminal.lifecycle_status <> 'active' then
    raise exception 'KLUY-EDGE-PAIRING-DEVICE-NOT-ELIGIBLE: the terminal registration is not active'
      using errcode = 'P0001';
  end if;
  if v_terminal.tenant_id <> p_session.tenant_id
     or v_terminal.digital_store_id <> p_session.digital_store_id
     or v_terminal.location_id <> p_session.location_id
     or v_terminal.assignment_generation <> p_session.terminal_assignment_generation then
    raise exception 'KLUY-EDGE-PAIRING-ASSIGNMENT-MISMATCH: the terminal is not assigned to this Hub scope'
      using errcode = 'P0001';
  end if;

  -- Cloud-assigned profile grant, sourced from the ACTIVE snapshot.
  if not exists (
    select 1
      from edge_config.terminal_profile_assignment tpa
      join edge_config.configuration_snapshot cs on cs.id = tpa.source_snapshot_id
     where tpa.terminal_device_id = p_session.terminal_device_id
       and tpa.profile_code = p_session.terminal_profile_code
       and tpa.enabled
       and tpa.effective_from <= now()
       and (tpa.effective_until is null or tpa.effective_until > now())
       and tpa.tenant_id = p_session.tenant_id
       and tpa.digital_store_id = p_session.digital_store_id
       and tpa.location_id = p_session.location_id
       and cs.state = 'active') then
    raise exception 'KLUY-EDGE-PAIRING-PROFILE-FORBIDDEN: no active cloud-assigned grant for profile %',
      p_session.terminal_profile_code using errcode = 'P0001';
  end if;

  select c.* into v_term_cred from edge_identity.device_credential c
   where c.id = p_session.terminal_credential_id;
  if not found or v_term_cred.status <> 'active' or v_term_cred.revoked_at is not null
     or v_term_cred.expires_at <= now()
     or v_term_cred.device_id <> p_session.terminal_device_id
     or v_term_cred.certificate_serial <> p_session.terminal_certificate_serial
     or v_term_cred.public_key_fingerprint <> p_session.terminal_certificate_fingerprint
     or v_term_cred.certificate_serial <> v_terminal.certificate_serial then
    raise exception 'KLUY-EDGE-PAIRING-CERT-INVALID: the terminal credential is not current'
      using errcode = 'P0001';
  end if;
  if edge_config.is_certificate_revoked_offline_v1(
       p_session.tenant_id, p_session.digital_store_id, p_session.location_id,
       p_session.environment, v_term_cred.certificate_serial)
     or edge_config.is_device_revoked_offline_v1(
       p_session.tenant_id, p_session.digital_store_id, p_session.location_id,
       p_session.environment, p_session.terminal_device_id) then
    raise exception 'KLUY-EDGE-PAIRING-CERT-INVALID: the terminal is revoked in the offline snapshot'
      using errcode = 'P0001';
  end if;
end
$req$;

comment on function edge_identity.assert_pairing_prerequisites_v1(edge_identity.pairing_session) is
  'Group 0031. Re-derives EVERY pairing prerequisite from the authoritative projections at call time — Hub trust and assignment, both credentials (status, expiry, revocation, offline snapshot), terminal registration, scope and the cloud-assigned profile grant. Called by every door so a withdrawal or revocation that commits mid-handshake fails the handshake closed (races D and E). Internal helper: EXECUTE stays with the governor only.';

-- ---------------------------------------------------------------------------
-- 6. DOOR: begin_terminal_pairing_v1
-- ---------------------------------------------------------------------------
create function edge_identity.begin_terminal_pairing_v1(
  p_session_id uuid,
  p_terminal_device_id uuid,
  p_requested_profile_code text,
  p_terminal_nonce text,
  p_hub_nonce text,
  p_protocol_version text,
  p_environment text,
  p_expires_at timestamptz,
  p_correlation_id uuid
) returns edge_identity.pairing_session
language plpgsql
security definer
set search_path = pg_catalog, edge_identity, edge_config
as $begin$
declare
  v_hub edge_identity.hub_device;
  v_assignment edge_identity.hub_assignment;
  v_hub_cred edge_identity.device_credential;
  v_terminal edge_identity.terminal_device;
  v_term_cred edge_identity.device_credential;
  v_existing edge_identity.pairing_session;
  v_session edge_identity.pairing_session;
begin
  if p_session_id is null or p_terminal_device_id is null or p_correlation_id is null then
    raise exception 'KLUY-EDGE-PAIRING-REQUEST: session, terminal and correlation ids are required'
      using errcode = 'P0001';
  end if;
  if p_protocol_version is distinct from '1.0' then
    raise exception 'KLUY-EDGE-PAIRING-VERSION-INCOMPATIBLE: protocol % is not 1.0',
      coalesce(p_protocol_version, '<null>') using errcode = 'P0001';
  end if;
  if p_terminal_nonce !~ '^[0-9a-f]{64}$' or p_hub_nonce !~ '^[0-9a-f]{64}$'
     or p_terminal_nonce = p_hub_nonce then
    raise exception 'KLUY-EDGE-PAIRING-NONCE: both nonces must be distinct 32-byte lowercase hex'
      using errcode = 'P0001';
  end if;
  if p_environment not in ('development', 'pilot', 'production') then
    raise exception 'KLUY-EDGE-PAIRING-REQUEST: environment % is not a trust environment',
      coalesce(p_environment, '<null>') using errcode = 'P0001';
  end if;

  -- No lock on the terminal registration: the governor holds SELECT only.
  -- The one-live-handshake invariant is enforced STRUCTURALLY by the partial
  -- unique index pairing_session_active_uq; a racing insert surfaces as a
  -- unique violation handled below.
  select t.* into v_terminal from edge_identity.terminal_device t
   where t.id = p_terminal_device_id;
  if not found then
    raise exception 'KLUY-EDGE-PAIRING-DEVICE-NOT-ELIGIBLE: unknown terminal'
      using errcode = 'P0001';
  end if;
  -- Registration eligibility precedes every credential judgement: a revoked
  -- terminal is refused as the device it is, whatever its credential says.
  if v_terminal.lifecycle_status <> 'active' then
    raise exception 'KLUY-EDGE-PAIRING-DEVICE-NOT-ELIGIBLE: the terminal registration is %',
      v_terminal.lifecycle_status using errcode = 'P0001';
  end if;

  -- Replay: the same hello (same terminal nonce) returns the same live
  -- session — no new nonce is consumed and no second session appears.
  select s.* into v_existing from edge_identity.pairing_session s
   where s.terminal_nonce = p_terminal_nonce;
  if found then
    if v_existing.terminal_device_id = p_terminal_device_id
       and v_existing.terminal_profile_code = p_requested_profile_code
       and v_existing.environment = p_environment
       and v_existing.state in ('challenge_issued', 'terminal_proof_verified') then
      return v_existing;
    end if;
    raise exception 'KLUY-EDGE-PAIRING-NONCE: the hello nonce was already consumed by another handshake'
      using errcode = 'P0001';
  end if;

  -- An outstanding live handshake blocks a second one — unless it has
  -- already expired against local authoritative time, in which case it is
  -- transitioned once and the new handshake proceeds.
  select s.* into v_existing from edge_identity.pairing_session s
   where s.terminal_device_id = p_terminal_device_id
     and s.state in ('challenge_issued', 'terminal_proof_verified')
   for update;
  if found then
    if v_existing.expires_at <= now() then
      update edge_identity.pairing_session
         set state = 'expired'
       where id = v_existing.id;
    else
      raise exception 'KLUY-EDGE-PAIRING-SESSION-OUTSTANDING: a live handshake already exists for this terminal'
        using errcode = 'P0001';
    end if;
  end if;

  -- The Hub side of the transcript comes from THIS Hub's authoritative rows;
  -- the caller cannot choose any of it.
  select h.* into v_hub from edge_identity.hub_device h
   where h.device_kind = 'store_hub' and h.trust_status = 'trusted'
     and h.lifecycle_status = 'deployed'
   order by h.created_at limit 1;
  if not found then
    raise exception 'KLUY-EDGE-PAIRING-HUB-NOT-ACTIVE: no trusted deployed Store Hub identity'
      using errcode = 'P0001';
  end if;
  select a.* into v_assignment from edge_identity.hub_assignment a
   where a.hub_device_id = v_hub.id and a.status = 'active' and a.ended_at is null;
  if not found then
    raise exception 'KLUY-EDGE-PAIRING-HUB-NOT-ACTIVE: the Hub has no active Location assignment'
      using errcode = 'P0001';
  end if;
  select c.* into v_hub_cred from edge_identity.device_credential c
   where c.certificate_serial = v_assignment.operational_cert_serial;
  if not found then
    raise exception 'KLUY-EDGE-PAIRING-CERT-INVALID: the Hub operational credential is not on record'
      using errcode = 'P0001';
  end if;

  select c.* into v_term_cred from edge_identity.device_credential c
   where c.certificate_serial = v_terminal.certificate_serial;
  if not found then
    raise exception 'KLUY-EDGE-PAIRING-CERT-INVALID: the terminal credential is not on record'
      using errcode = 'P0001';
  end if;

  -- Credential CURRENCY is judged before any window arithmetic, so an
  -- expired or revoked credential refuses as what it is — a credential
  -- failure — rather than as a malformed expiry.
  if v_hub_cred.status <> 'active' or v_hub_cred.revoked_at is not null
     or v_hub_cred.expires_at <= now() then
    raise exception 'KLUY-EDGE-PAIRING-CERT-INVALID: the Hub operational credential is not current'
      using errcode = 'P0001';
  end if;
  if v_term_cred.status <> 'active' or v_term_cred.revoked_at is not null
     or v_term_cred.expires_at <= now() then
    raise exception 'KLUY-EDGE-PAIRING-CERT-INVALID: the terminal credential is not current'
      using errcode = 'P0001';
  end if;

  -- Challenge lifetime: the protocol defines no duration, so the caller
  -- supplies one — bounded above by BOTH credentials' expiry (the 0174
  -- inheritance discipline). The production default stays
  -- [REQUIRED: pairing_challenge_lifetime] and is recorded, not invented.
  if p_expires_at is null or p_expires_at <= now()
     or p_expires_at > least(v_hub_cred.expires_at, v_term_cred.expires_at) then
    raise exception 'KLUY-EDGE-PAIRING-EXPIRY: expiry must be future and within both credentials'
      using errcode = 'P0001';
  end if;

  begin
    insert into edge_identity.pairing_session
      (id, protocol_version, purpose, tenant_id, digital_store_id, location_id,
       environment, hub_device_id, hub_assignment_id, hub_assignment_generation,
       hub_credential_id, hub_certificate_serial, hub_certificate_fingerprint,
       terminal_device_id, terminal_assignment_generation, terminal_profile_code,
       terminal_credential_id, terminal_certificate_serial,
       terminal_certificate_fingerprint, terminal_nonce, hub_nonce, state,
       correlation_id, expires_at)
    values
      (p_session_id, '1.0', 'hub_terminal_pairing', v_assignment.tenant_id,
       v_assignment.digital_store_id, v_assignment.location_id, p_environment,
       v_hub.id, v_assignment.id, v_assignment.assignment_generation,
       v_hub_cred.id, v_hub_cred.certificate_serial, v_hub_cred.public_key_fingerprint,
       v_terminal.id, v_terminal.assignment_generation, p_requested_profile_code,
       v_term_cred.id, v_term_cred.certificate_serial, v_term_cred.public_key_fingerprint,
       p_terminal_nonce, p_hub_nonce, 'challenge_issued', p_correlation_id, p_expires_at)
    returning * into v_session;
  exception when unique_violation then
    -- A racing hello won the structural invariant. The identical hello is a
    -- replay of the winner's live session; anything else is refused.
    select s.* into v_existing from edge_identity.pairing_session s
     where s.terminal_nonce = p_terminal_nonce
       and s.terminal_device_id = p_terminal_device_id
       and s.terminal_profile_code = p_requested_profile_code
       and s.environment = p_environment
       and s.state in ('challenge_issued', 'terminal_proof_verified');
    if found then
      return v_existing;
    end if;
    raise exception 'KLUY-EDGE-PAIRING-SESSION-OUTSTANDING: a live handshake already exists for this terminal'
      using errcode = 'P0001';
  end;

  -- Every prerequisite, revalidated against what was just bound.
  perform edge_identity.assert_pairing_prerequisites_v1(v_session);
  return v_session;
end
$begin$;

-- ---------------------------------------------------------------------------
-- 7. DOOR: record_terminal_pairing_proof_v1 (OPTION B attestation)
-- ---------------------------------------------------------------------------
create function edge_identity.record_terminal_pairing_proof_v1(
  p_session_id uuid,
  p_attested_signature_verified boolean,
  p_correlation_id uuid
) returns edge_identity.pairing_session
language plpgsql
security definer
set search_path = pg_catalog, edge_identity, edge_config
as $proof$
declare
  v_session edge_identity.pairing_session;
begin
  select s.* into v_session from edge_identity.pairing_session s
   where s.id = p_session_id for update;
  if not found then
    raise exception 'KLUY-EDGE-PAIRING-SESSION-UNKNOWN: no pairing session %', p_session_id
      using errcode = 'P0001';
  end if;
  if v_session.state = 'terminal_proof_verified' then
    return v_session; -- idempotent replay of the same recorded fact
  end if;
  if v_session.state <> 'challenge_issued' then
    raise exception 'KLUY-EDGE-PAIRING-CONSUMED: session % is already %', p_session_id, v_session.state
      using errcode = 'P0001';
  end if;
  if v_session.expires_at <= now() then
    update edge_identity.pairing_session set state = 'expired' where id = v_session.id;
    raise exception 'KLUY-EDGE-PAIRING-EXPIRED: the pairing session expired before the proof'
      using errcode = 'P0001';
  end if;
  perform edge_identity.assert_pairing_prerequisites_v1(v_session);
  if p_attested_signature_verified is distinct from true then
    -- Refusal is evidence, never silent success; the caller records the
    -- security event in its own transaction because this one aborts.
    raise exception 'KLUY-EDGE-PAIRING-PROOF-INVALID: the terminal proof did not verify'
      using errcode = 'P0001';
  end if;

  update edge_identity.pairing_session
     set state = 'terminal_proof_verified',
         terminal_proof_verified_at = now()
   where id = v_session.id
  returning * into v_session;
  return v_session;
end
$proof$;

-- ---------------------------------------------------------------------------
-- 8. DOOR: complete_terminal_pairing_v1 — mutual proof -> ONE receipt.
-- ---------------------------------------------------------------------------
create function edge_identity.complete_terminal_pairing_v1(
  p_session_id uuid,
  p_transcript_hash text,
  p_receipt_id uuid,
  p_receipt_signature_b64 text,
  p_signing_certificate_serial text,
  p_valid_until timestamptz,
  p_correlation_id uuid
) returns edge_identity.pairing_receipt
language plpgsql
security definer
set search_path = pg_catalog, edge_identity, edge_config
as $complete$
declare
  v_session edge_identity.pairing_session;
  v_receipt edge_identity.pairing_receipt;
begin
  select s.* into v_session from edge_identity.pairing_session s
   where s.id = p_session_id for update;
  if not found then
    raise exception 'KLUY-EDGE-PAIRING-SESSION-UNKNOWN: no pairing session %', p_session_id
      using errcode = 'P0001';
  end if;

  -- Replay: an already-paired session answers with its ORIGINAL receipt —
  -- same id, same transcript, same paired_at — for the same transcript.
  if v_session.state = 'paired' then
    if v_session.transcript_hash = p_transcript_hash then
      select r.* into v_receipt from edge_identity.pairing_receipt r
       where r.pairing_session_id = v_session.id;
      return v_receipt;
    end if;
    raise exception 'KLUY-EDGE-PAIRING-TRANSCRIPT-CONFLICT: session % paired under a different transcript',
      p_session_id using errcode = 'P0001';
  end if;
  if v_session.state <> 'terminal_proof_verified' then
    raise exception 'KLUY-EDGE-PAIRING-PROOF-REQUIRED: session % has no verified terminal proof (%)',
      p_session_id, v_session.state using errcode = 'P0001';
  end if;
  if v_session.expires_at <= now() then
    update edge_identity.pairing_session set state = 'expired' where id = v_session.id;
    raise exception 'KLUY-EDGE-PAIRING-EXPIRED: the pairing session expired before completion'
      using errcode = 'P0001';
  end if;
  if p_transcript_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'KLUY-EDGE-PAIRING-REQUEST: a sha256 transcript hash is required'
      using errcode = 'P0001';
  end if;
  if p_receipt_id is null or p_receipt_signature_b64 is null
     or length(p_receipt_signature_b64) not between 1 and 512 then
    raise exception 'KLUY-EDGE-PAIRING-REQUEST: a receipt id and bounded signature are required'
      using errcode = 'P0001';
  end if;
  -- The receipt may only be signed by THIS session's Hub operational
  -- credential — the one the terminal verified in the Hub proof.
  if p_signing_certificate_serial is distinct from v_session.hub_certificate_serial then
    raise exception 'KLUY-EDGE-PAIRING-CERT-INVALID: the receipt signer is not this session''s Hub credential'
      using errcode = 'P0001';
  end if;
  perform edge_identity.assert_pairing_prerequisites_v1(v_session);

  insert into edge_identity.pairing_receipt
    (id, receipt_version, pairing_session_id, transcript_hash, hub_device_id,
     hub_certificate_fingerprint, terminal_device_id,
     terminal_certificate_fingerprint, tenant_id, digital_store_id, location_id,
     environment, terminal_assignment_generation, terminal_profile_code,
     paired_at, valid_until, signature_b64, signing_certificate_serial,
     correlation_id)
  values
    (p_receipt_id, '1.0', v_session.id, p_transcript_hash, v_session.hub_device_id,
     v_session.hub_certificate_fingerprint, v_session.terminal_device_id,
     v_session.terminal_certificate_fingerprint, v_session.tenant_id,
     v_session.digital_store_id, v_session.location_id, v_session.environment,
     v_session.terminal_assignment_generation, v_session.terminal_profile_code,
     now(), p_valid_until, p_receipt_signature_b64, p_signing_certificate_serial,
     p_correlation_id)
  returning * into v_receipt;

  update edge_identity.pairing_session
     set state = 'paired',
         paired_at = v_receipt.paired_at,
         transcript_hash = p_transcript_hash
   where id = v_session.id;

  return v_receipt;
end
$complete$;

-- ---------------------------------------------------------------------------
-- 9. OWNERSHIP, GRANTS AND THE PUBLIC BOUNDARY
-- ---------------------------------------------------------------------------
-- USAGE for reads; CREATE on edge_identity is required for
-- `ALTER FUNCTION ... OWNER TO` (the 0024 precedent records the same need).
grant usage, create on schema edge_identity to kitluy_pairing_governor;
grant usage on schema edge_config to kitluy_pairing_governor;
grant select, insert, update on edge_identity.pairing_session to kitluy_pairing_governor;
grant select, insert on edge_identity.pairing_receipt to kitluy_pairing_governor;
grant select on edge_identity.hub_device, edge_identity.hub_assignment,
  edge_identity.device_credential, edge_identity.terminal_device
  to kitluy_pairing_governor;
grant select on edge_config.terminal_profile_assignment,
  edge_config.configuration_snapshot to kitluy_pairing_governor;
grant execute on function
  edge_config.is_certificate_revoked_offline_v1(uuid, uuid, uuid, text, text),
  edge_config.is_device_revoked_offline_v1(uuid, uuid, uuid, text, uuid)
  to kitluy_pairing_governor;

-- HAZARD KLRISK-HUB-001: the grantee is resolved and quoted explicitly.
-- `GRANT ... TO current_user` SEGFAULTS the PostgreSQL 15.8 development
-- server and restarts the whole cluster into crash recovery.
do $$
declare
  v_migrator text := current_user;
begin
  execute format('grant kitluy_pairing_governor to %I', v_migrator);
  alter function edge_identity.assert_pairing_prerequisites_v1(edge_identity.pairing_session)
    owner to kitluy_pairing_governor;
  alter function edge_identity.begin_terminal_pairing_v1(uuid, uuid, text, text, text, text, text, timestamptz, uuid)
    owner to kitluy_pairing_governor;
  alter function edge_identity.record_terminal_pairing_proof_v1(uuid, boolean, uuid)
    owner to kitluy_pairing_governor;
  alter function edge_identity.complete_terminal_pairing_v1(uuid, text, uuid, text, text, timestamptz, uuid)
    owner to kitluy_pairing_governor;
end $$;

revoke all on function
  edge_identity.assert_pairing_prerequisites_v1(edge_identity.pairing_session),
  edge_identity.begin_terminal_pairing_v1(uuid, uuid, text, text, text, text, text, timestamptz, uuid),
  edge_identity.record_terminal_pairing_proof_v1(uuid, boolean, uuid),
  edge_identity.complete_terminal_pairing_v1(uuid, text, uuid, text, text, timestamptz, uuid),
  edge_identity.enforce_pairing_session_governance(),
  edge_identity.enforce_pairing_receipt_governance()
  from public;

grant execute on function
  edge_identity.begin_terminal_pairing_v1(uuid, uuid, text, text, text, text, text, timestamptz, uuid),
  edge_identity.record_terminal_pairing_proof_v1(uuid, boolean, uuid),
  edge_identity.complete_terminal_pairing_v1(uuid, text, uuid, text, text, timestamptz, uuid)
  to kitluy_hub_runtime;

-- Read access follows the 0012 posture; mutation stays door-only.
grant select on edge_identity.pairing_session, edge_identity.pairing_receipt
  to kitluy_hub_runtime, kitluy_backup;

comment on function edge_identity.begin_terminal_pairing_v1(uuid, uuid, text, text, text, text, text, timestamptz, uuid) is
  'Group 0031. Opens ONE pairing handshake (§8.1-8.2): validates every prerequisite, binds the transcript from THIS Hub''s authoritative rows (the caller chooses no identity, scope, profile or generation), consumes both directional nonces, and returns the session. An identical hello replays the live session; a conflicting one is refused. Runtime EXECUTE only.';
comment on function edge_identity.record_terminal_pairing_proof_v1(uuid, boolean, uuid) is
  'Group 0031. Records the command layer''s attestation that the terminal proof verified (OPTION B) after re-locking the session and re-deriving every prerequisite. A false attestation aborts — refusal evidence is the caller''s separate-transaction security event. Idempotent once verified. Runtime EXECUTE only.';
comment on function edge_identity.complete_terminal_pairing_v1(uuid, text, uuid, text, text, timestamptz, uuid) is
  'Group 0031. Completes mutual pairing (§8.3-§9): requires the verified terminal proof, revalidates every prerequisite, and issues the ONE immutable Hub-signed receipt while marking the session paired in the SAME transaction. A replay with the same transcript returns the original receipt; a different transcript is refused. Runtime EXECUTE only.';

-- The migrator hands the governor membership back only after every
-- owner-requiring statement above (REVOKE, GRANT, COMMENT) has run: a
-- migrator that stayed a member could SET ROLE to the governor and forge the
-- executing identity the triggers gate on.
do $$
declare
  v_migrator text := current_user;
begin
  execute format('revoke kitluy_pairing_governor from %I', v_migrator);
end $$;

-- ---------------------------------------------------------------------------
-- 10. PROVE THE BOUNDARY HOLDS
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_bool boolean;
begin
  -- 1. The governor exists, cannot log in, and nobody is a member of it.
  if not exists (select 1 from pg_roles where rolname = 'kitluy_pairing_governor' and not rolcanlogin) then
    raise exception 'KLUY-HUB-MIGRATION-0031: the pairing governor is missing or can log in'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from pg_auth_members
     where roleid = (select oid from pg_roles where rolname = 'kitluy_pairing_governor')) then
    raise exception 'KLUY-HUB-MIGRATION-0031: somebody is a member of the pairing governor'
      using errcode = 'P0001';
  end if;

  -- 2. The runtime can call the three doors...
  select bool_and(has_function_privilege('kitluy_hub_runtime', p.oid, 'execute')) into v_bool
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'edge_identity'
     and p.proname in ('begin_terminal_pairing_v1', 'record_terminal_pairing_proof_v1',
                       'complete_terminal_pairing_v1');
  if v_bool is distinct from true then
    raise exception 'KLUY-HUB-MIGRATION-0031: kitluy_hub_runtime cannot execute a pairing door'
      using errcode = 'P0001';
  end if;

  -- 3. ...but PUBLIC can call none of the six new functions (assertions §29c).
  select bool_or(has_function_privilege('public', p.oid, 'execute')) into v_bool
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'edge_identity'
     and p.proname in ('begin_terminal_pairing_v1', 'record_terminal_pairing_proof_v1',
                       'complete_terminal_pairing_v1', 'assert_pairing_prerequisites_v1',
                       'enforce_pairing_session_governance', 'enforce_pairing_receipt_governance');
  if v_bool then
    raise exception 'KLUY-HUB-MIGRATION-0031: a pairing function is EXECUTE-able by PUBLIC'
      using errcode = 'P0001';
  end if;

  -- 4. No runtime identity can write the pairing tables directly; the
  --    internal prerequisite helper stays governor-only.
  if has_table_privilege('kitluy_hub_runtime', 'edge_identity.pairing_session', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_hub_runtime', 'edge_identity.pairing_receipt', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_sync_worker', 'edge_identity.pairing_session', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_support_ro', 'edge_identity.pairing_session', 'SELECT')
     or has_function_privilege('kitluy_hub_runtime',
          'edge_identity.assert_pairing_prerequisites_v1(edge_identity.pairing_session)', 'execute') then
    raise exception 'KLUY-HUB-MIGRATION-0031: the pairing privilege boundary leaks'
      using errcode = 'P0001';
  end if;

  -- 5. The doors are owned by the governor (the trigger gate identity).
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'edge_identity'
       and p.proname in ('begin_terminal_pairing_v1', 'record_terminal_pairing_proof_v1',
                         'complete_terminal_pairing_v1', 'assert_pairing_prerequisites_v1')
       and p.proowner <> (select oid from pg_roles where rolname = 'kitluy_pairing_governor')) then
    raise exception 'KLUY-HUB-MIGRATION-0031: a pairing door is not owned by the governor'
      using errcode = 'P0001';
  end if;

  -- 6. No secret-shaped column exists: no private key, no raw provisioning
  --    code, no password. The only signature column is the receipt''s own.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'edge_identity'
       and table_name in ('pairing_session', 'pairing_receipt')
       and (column_name like '%private%' or column_name like '%password%'
            or column_name like '%secret%' or column_name like '%provisioning_code%')) then
    raise exception 'KLUY-HUB-MIGRATION-0031: a secret-shaped column exists on a pairing relation'
      using errcode = 'P0001';
  end if;

  raise notice 'KLUY-HUB-MIGRATION-0031: hub-terminal pairing authority installed (governed sessions, single-use directional nonces, one immutable Hub-signed receipt per handshake; delivery, persistence and recovery remain P03C)';
end
$guard$;
