-- kitluy:hub:migration:0032
-- ===========================================================================
-- KitLuy Store Hub local database — locked pairing lifetime and the LAN
-- transport's authorization reads.
--
-- WS-11-T004-P04B. Authority: the P04B owner package §6 (locked pairing
-- challenge lifetime: 300 seconds; Hub-authoritative trusted time; no skew
-- grace; retry never extends expiry) and §3 (every LAN request revalidates
-- terminal, credential and lifecycle — which requires the runtime identity
-- that serves the transport to READ the projections it authorizes against).
--
-- TWO narrow changes; nothing else:
--
-- 1. `begin_terminal_pairing_v1` is replaced (0031's file untouched) with
--    ONE added statement: the stored expiry is CLAMPED to
--    now() + interval '300 seconds' of HUB-AUTHORITATIVE time. The caller
--    may still shorten the window (the P03B/P03C expiry proofs depend on
--    that) but can never exceed 300 seconds whatever its own clock says —
--    the [REQUIRED: pairing_challenge_lifetime] placeholder this door
--    recorded is now an owner-locked value. Every refusal, the same-hello
--    replay (which returns the EXISTING session with its ORIGINAL expiry —
--    retry extends nothing), the credential caps and the one-live-handshake
--    invariant are inherited verbatim.
--
-- 2. MEASURED, NOT GRANTED: the LAN transport must map an authenticated
--    mTLS peer (certificate serial) onto the projected terminal and
--    credential before any door is called (§3), which needs runtime SELECT
--    on `edge_identity.terminal_device` and `edge_identity.device_credential`.
--    Live inspection during this migration's authoring showed
--    `kitluy_hub_runtime` ALREADY holds SELECT (and INSERT/UPDATE — it is
--    the sync projection writer) on both tables, so NO grant is added; the
--    guard ASSERTS the read posture the transport depends on instead, so a
--    future revocation fails here rather than silently breaking the LAN
--    authorization gate.
-- ===========================================================================

-- Ownership borrow (0031 §"migrator hands membership back"): the pairing
-- doors are owned by the NOLOGIN, granted-to-nobody kitluy_pairing_governor,
-- and replacing one requires ownership. Explicit literal grantee — never
-- `current_user` (KLRISK-HUB-001: GRANT ... TO current_user segfaults the
-- PG 15.8 dev server).
do $$
declare
  v_migrator text := current_user;
begin
  execute format('grant kitluy_pairing_governor to %I', v_migrator);
end $$;

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
  if v_term_cred.status <> 'active' or v_term_cred.revoked_at is not null
     or v_term_cred.expires_at <= now() then
    raise exception 'KLUY-EDGE-PAIRING-CERT-INVALID: the terminal credential is not current'
      using errcode = 'P0001';
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

comment on function edge_identity.begin_terminal_pairing_v1(uuid, uuid, text, text, text, text, text, timestamptz, uuid) is
  'Group 0031, lifetime LOCKED by group 0032 (WS-11-T004-P04B). Opens ONE pairing handshake (§8.1-8.2): validates every prerequisite, binds the transcript from THIS Hub''s authoritative rows (the caller chooses no identity, scope, profile or generation), consumes both directional nonces, and returns the session. The stored expiry is clamped to now() + 300 seconds of Hub-authoritative time (owner-locked pairing_challenge_lifetime; caller may shorten, never lengthen), still capped by both credentials'' expiry. An identical hello replays the live session WITH ITS ORIGINAL EXPIRY; a conflicting one is refused. Runtime EXECUTE only.';

-- Hand the governor membership back BEFORE the guard (0031 discipline).
do $$
declare
  v_migrator text := current_user;
begin
  execute format('revoke kitluy_pairing_governor from %I', v_migrator);
end $$;

-- ---------------------------------------------------------------------------
-- PROVE THE BOUNDARY HELD
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_owner text;
  v_def text;
begin
  select pg_get_userbyid(p.proowner) into v_owner
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'edge_identity' and p.proname = 'begin_terminal_pairing_v1';
  if v_owner is distinct from 'kitluy_pairing_governor' then
    raise exception 'KLUY-HUB-MIGRATION-0032: the begin door owner changed to %', v_owner;
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'edge_identity' and p.proname = 'begin_terminal_pairing_v1';
  if v_def not like '%interval ''300 seconds''%' then
    raise exception 'KLUY-HUB-MIGRATION-0032: the 300-second clamp is missing';
  end if;
  if v_def not like '%KLUY-EDGE-PAIRING-EXPIRY%'
     or v_def not like '%KLUY-EDGE-PAIRING-SESSION-OUTSTANDING%'
     or v_def not like '%KLUY-EDGE-PAIRING-NONCE%'
     or v_def not like '%KLUY-EDGE-PAIRING-DEVICE-NOT-ELIGIBLE%'
     or v_def not like '%KLUY-EDGE-PAIRING-CERT-INVALID%'
     or v_def not like '%KLUY-EDGE-PAIRING-HUB-NOT-ACTIVE%' then
    raise exception 'KLUY-HUB-MIGRATION-0032: an inherited refusal was lost';
  end if;
  -- THE PREREQUISITE RE-VALIDATION. Without this call the door binds a
  -- session without re-deriving the cloud-assigned profile grant, the Hub's
  -- trust or either credential's offline-snapshot revocation — the exact
  -- regression an earlier draft of this migration introduced and the P04B
  -- lifecycle tests caught. Asserted structurally so it cannot recur.
  if v_def not like '%assert_pairing_prerequisites_v1(v_session)%' then
    raise exception 'KLUY-HUB-MIGRATION-0032: the begin door no longer revalidates every pairing prerequisite';
  end if;

  if not has_function_privilege('kitluy_hub_runtime',
       'edge_identity.begin_terminal_pairing_v1(uuid, uuid, text, text, text, text, text, timestamptz, uuid)',
       'EXECUTE') then
    raise exception 'KLUY-HUB-MIGRATION-0032: the runtime lost EXECUTE on the begin door';
  end if;
  -- The transport's authorization reads are PRE-EXISTING (the runtime is the
  -- sync projection writer); assert they hold so a future revocation fails
  -- HERE instead of silently breaking the LAN gate.
  if not has_table_privilege('kitluy_hub_runtime', 'edge_identity.terminal_device', 'SELECT')
     or not has_table_privilege('kitluy_hub_runtime', 'edge_identity.device_credential', 'SELECT') then
    raise exception 'KLUY-HUB-MIGRATION-0032: the transport authorization reads are missing';
  end if;

  raise notice 'KLUY-HUB-MIGRATION-0032: pairing lifetime locked at 300 s (Hub-authoritative clamp); transport authorization reads asserted; ownership and every inherited refusal preserved';
end
$guard$;
