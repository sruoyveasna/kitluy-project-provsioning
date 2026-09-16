-- kitluy:hub:migration:0042
-- ===========================================================================
-- KitLuy Store Hub local database -- the terminal pairing transcript binds the
-- SIGNING credential, not the transport one.
--
-- A Pi Terminal holds two keys and they do different jobs: an RSA-2048
-- OPERATIONAL key whose certificate carries the mutual TLS session, and an
-- Ed25519 DEVICE IDENTITY key created by kitluy-firstboot.service and
-- fingerprinted by the cloud at registration.
--
-- begin_terminal_pairing_v1 recorded the OPERATIONAL credential in the pairing
-- transcript, which made the handshake unsatisfiable from either side. This
-- replaces it so the transcript binds the credential the terminal signs with.
-- Nothing else moves: the operational credential is still resolved, still gates
-- the handshake on currency, and still carries the TLS session; the route
-- signature bound is untouched.
--
-- Authority: WS-11-T004-P04B pairing transcript; owner decision 2026-09-11
-- (an Ed25519 pairing credential, in preference to relaxing the bound).
-- ===========================================================================

create or replace function edge_identity.begin_terminal_pairing_v1(
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
  v_hub_sign edge_identity.device_credential;
  v_term_sign edge_identity.device_credential;
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
  -- session — no new nonce is consumed, no second session appears, and the
  -- ORIGINAL expiry stands (retry never extends the window).
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

  -- THE HUB SIGNS WITH ITS IDENTITY KEY TOO, and for the same reason.
  --
  -- composeDevelopmentListener builds the pairing signer from the Hub Ed25519
  -- DEVICE IDENTITY key, not from the RSA operational key -- discovery records
  -- are ed25519 and verifyDetachedSignature uses crypto.verify(null, ...),
  -- which an RSA key cannot satisfy. Binding the transcript to the Hub
  -- operational credential therefore broke the Hub half of the handshake in
  -- exactly the way it broke the terminal half: the terminal proof verified and
  -- `complete` then refused CERT-INVALID (hardware, 2026-09-11).
  select c.* into v_hub_sign
    from edge_identity.device_credential c
   where c.device_id = v_hub.id
     and c.credential_type = 'device_identity'
     and c.status = 'active'
     and c.revoked_at is null
     and c.expires_at > now()
   order by c.rotation_generation desc
   limit 1;
  if not found then
    v_hub_sign := v_hub_cred;
  end if;
  if v_term_cred.status <> 'active' or v_term_cred.revoked_at is not null
     or v_term_cred.expires_at <= now() then
    raise exception 'KLUY-EDGE-PAIRING-CERT-INVALID: the terminal credential is not current'
      using errcode = 'P0001';
  end if;

  -- THE CREDENTIAL A TERMINAL SIGNS WITH IS NOT THE ONE IT CONNECTS WITH.
  --
  -- `v_term_cred` above is the OPERATIONAL credential: it carries the mutual
  -- TLS session and its currency still gates this handshake. But the pairing
  -- proof is a detached signature, and a KitLuy terminal signs it with its
  -- Ed25519 DEVICE IDENTITY key -- the key kitluy-firstboot.service creates and
  -- the cloud fingerprints at registration -- not with the RSA-2048 operational
  -- key.
  --
  -- Recording the operational credential in the transcript made the handshake
  -- unsatisfiable from either side. verifyTerminalPairingProof demands
  --   fingerprint(presented key) = transcript.terminalCertificateFingerprint
  -- so a terminal signing with its identity key was refused
  -- PAIR_CHALLENGE_FAILED, and one signing with its operational key produces a
  -- 342-character RSA signature that the route 120-character bound rejects
  -- before verification. Observed on hardware 2026-09-10 and again, from a
  -- clean slate, on 2026-09-11.
  --
  -- So the transcript binds the SIGNING credential. Ed25519 signatures are 86
  -- base64url characters and sit inside the existing bound, which is left
  -- exactly where it is: a limit that still limits something.
  --
  -- The fallback keeps a Hub holding no device-identity projection behaving as
  -- it did before this migration rather than refusing every pairing outright.
  select c.* into v_term_sign
    from edge_identity.device_credential c
   where c.device_id = v_terminal.id
     and c.credential_type = 'device_identity'
     and c.status = 'active'
     and c.revoked_at is null
     and c.expires_at > now()
   order by c.rotation_generation desc
   limit 1;
  if not found then
    v_term_sign := v_term_cred;
  end if;

  -- Challenge window: still future, still within BOTH credentials (the 0174
  -- inheritance discipline, refusals unchanged) — and then LOCKED
  -- (WS-11-T004-P04B owner package §6): the stored lifetime never exceeds
  -- 300 seconds of HUB-AUTHORITATIVE time, whatever the caller's clock
  -- says. The caller may shorten the window; nothing can lengthen it.
  if p_expires_at is null or p_expires_at <= now()
     or p_expires_at > least(v_hub_cred.expires_at, v_term_cred.expires_at) then
    raise exception 'KLUY-EDGE-PAIRING-EXPIRY: expiry must be future and within both credentials'
      using errcode = 'P0001';
  end if;
  p_expires_at := least(p_expires_at, now() + interval '300 seconds');

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
       v_hub_sign.id, v_hub_sign.certificate_serial, v_hub_sign.public_key_fingerprint,
       v_terminal.id, v_terminal.assignment_generation, p_requested_profile_code,
       v_term_sign.id, v_term_sign.certificate_serial, v_term_sign.public_key_fingerprint,
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

  -- Every prerequisite, revalidated against what was just bound. INHERITED
  -- VERBATIM from 0031 and asserted by this group's guard: this is where the
  -- cloud-assigned profile grant, the Hub's trust and both credentials'
  -- offline-snapshot revocation are re-derived. An earlier draft of this
  -- replacement omitted the call and the P04B lifecycle tests caught it —
  -- a wrong-profile hello opened a session it must never have opened.
  perform edge_identity.assert_pairing_prerequisites_v1(v_session);
  return v_session;
end
$begin$;


-- ---------------------------------------------------------------------------
-- The prerequisite re-validation has to learn the same distinction.
--
-- `assert_pairing_prerequisites_v1` re-derives every prerequisite against the
-- session row at each step of the handshake, and one of its checks demanded
-- that the session's terminal credential carry the terminal's transport
-- serial. With the transcript now bound to the signing credential that is never
-- true, so the whole handshake refused CERT-INVALID until this was replaced.
-- ---------------------------------------------------------------------------
create or replace function edge_identity.assert_pairing_prerequisites_v1(
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
     -- Same distinction as the terminal: a signing credential carries no
     -- operational certificate serial, so this equality applies only to an
     -- operational credential. Device ownership and the recorded serial and
     -- fingerprint are still checked above, for both kinds.
     or (v_hub_cred.credential_type <> 'device_identity'
         and v_hub_cred.certificate_serial <> v_assignment.operational_cert_serial) then
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
     -- A SIGNING CREDENTIAL HAS NO X.509 SERIAL OF ITS OWN.
     --
     -- Migration 0042 binds the transcript to the credential the terminal
     -- SIGNS with, its Ed25519 device identity. That credential is not a
     -- certificate, so demanding its serial equal the terminal's transport
     -- serial refused every pairing with KLUY-EDGE-PAIRING-CERT-INVALID
     -- (hardware, 2026-09-11). The equality still holds for an operational
     -- credential, which is what it was written to protect: a session must not
     -- be re-validated against a credential belonging to a different
     -- certificate. Device ownership and the recorded serial/fingerprint are
     -- still checked above, for both kinds.
     or (v_term_cred.credential_type <> 'device_identity'
         and v_term_cred.certificate_serial <> v_terminal.certificate_serial) then
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

-- ---------------------------------------------------------------------------
-- A SESSION THAT VERIFIED A PROOF AND THEN EXPIRED MUST STILL BE ABLE TO EXPIRE.
--
-- `pairing_session_proof_state_ck` asserted EQUALITY:
--
--     (terminal_proof_verified_at is not null) = (state in ('terminal_proof_verified','paired'))
--
-- so the expiry sweep in begin_terminal_pairing_v1 -- `set state = 'expired'` --
-- violated it for any session that had already recorded a terminal proof. The
-- sweep therefore threw, `preparePairing` returned INTERNAL_ERROR, and because
-- the sweep is the only thing that clears an outstanding handshake, that
-- terminal could never open another session on this Hub. Not a slow path: a
-- permanent one. Hand-editing the row is refused too (the governance trigger),
-- so there was no way out at all. Observed on hardware 2026-09-11.
--
-- The equality was stronger than the fact it protected. What matters is:
--   * a session at 'terminal_proof_verified' or 'paired' HAS the timestamp;
--   * a session still at 'challenge_issued' has NOT got one yet.
-- A terminal state keeping the timestamp as HISTORY breaks neither. Expressed
-- as two implications instead of an equality, both of those still hold and an
-- expired-after-proof session can be swept.
-- ---------------------------------------------------------------------------
alter table edge_identity.pairing_session
  drop constraint if exists pairing_session_proof_state_ck;

alter table edge_identity.pairing_session
  add constraint pairing_session_proof_state_ck
  check (
    (state not in ('terminal_proof_verified', 'paired') or terminal_proof_verified_at is not null)
    and
    (state <> 'challenge_issued' or terminal_proof_verified_at is null)
  );

comment on constraint pairing_session_proof_state_ck on edge_identity.pairing_session is
  'Proof timestamp discipline (group 0031, corrected by 0042). A session at terminal_proof_verified or paired HAS recorded its terminal proof; a session still at challenge_issued has not. A TERMINAL state (expired, refused) may keep the timestamp as history -- the original equality forbade that and made an expired-after-proof session unsweepable, permanently blocking the terminal.';
