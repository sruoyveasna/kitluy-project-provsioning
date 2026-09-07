-- kitluy:group:0209
-- =============================================================================
-- Group 0209 — M-2: revoking a credential revokes its certificate
-- =============================================================================
--
-- Authority: independent Store Hub credential-path review 2026-08-26, finding
-- M-2; owner remediation instruction 2026-08-26, "recommended same-pass fixes";
-- KLD-2026-07-21-003 (activation is certificate-backed).
--
-- =============================================================================
-- WHAT WAS WRONG
-- =============================================================================
-- `device_credentials` and `device_certificates` were reconciled by group 0201
-- so that activation verifies BOTH. Revocation was never taught about the second
-- one. Revoking a credential set `device_credentials.revoked_at` and left the
-- operational artifact sitting at `status = 'active'`, with its own validity
-- window, its own bytes, and nothing marking it dead.
--
-- Today that is survivable because activation re-checks the credential every
-- time. It stops being survivable at the very next milestone: Hub LAN mutual TLS
-- authorises a peer by the CERTIFICATE it presents, and a certificate whose
-- credential was revoked would still be `active`, still inside its window, and
-- still chain to the pinned root.
--
-- =============================================================================
-- WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
-- =============================================================================
-- A trigger on `device_credentials`: when `revoked_at` is set, the artifact for
-- that credential is revoked in the same transaction, carrying the credential's
-- reason. Append-only — the row is marked, never deleted, because an issued
-- certificate is history.
--
-- It does NOT invent the offline revocation signal. `pki_trust_configuration`
-- already names the mechanism (`SIGNED_REVOCATION_SNAPSHOT`) and an
-- `offline_grace_hours` of 720, but how a Store Hub with no WAN decides that a
-- peer's certificate has been revoked — snapshot cadence, signing key, failure
-- posture when the snapshot is stale — is an owner decision that does not exist
-- yet. It is recorded as `[REQUIRED: offline_mtls_revocation_signal]` rather
-- than guessed, and it BLOCKS the LAN mTLS milestone, not this one.
-- =============================================================================

begin;

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

create or replace function kitluy_devices.revoke_certificate_with_credential()
returns trigger
language plpgsql
set search_path = pg_catalog, kitluy_devices
as $fn$
begin
  -- Only the transition INTO revoked. A credential that was already revoked
  -- must not have its artifact's revocation timestamp rewritten on every later
  -- update: the first revocation is the one that happened.
  if new.revoked_at is not null and old.revoked_at is null then
    update kitluy_devices.device_certificates
       set status = 'revoked',
           revoked_at = new.revoked_at,
           revocation_reason = coalesce(
             new.revocation_reason,
             'the governed credential was revoked')
     where credential_id = new.credential_id
       and status = 'active';
  end if;
  return new;
end;
$fn$;

drop trigger if exists device_credentials_revoke_artifact on kitluy_devices.device_credentials;
create trigger device_credentials_revoke_artifact
  after update on kitluy_devices.device_credentials
  for each row
  execute function kitluy_devices.revoke_certificate_with_credential();

comment on function kitluy_devices.revoke_certificate_with_credential() is
  'Group 0209 (M-2). Revoking a governed credential revokes its operational X.509 artifact in the same transaction. Without this, a revoked credential left an active certificate that Hub LAN mTLS would still accept — the certificate chains to the pinned root and sits inside its own validity window, and nothing in the artifact said otherwise.';

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

do $guard$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'kitluy_devices.device_credentials'::regclass
       and tgname = 'device_credentials_revoke_artifact'
       and not tgisinternal) then
    raise exception 'KLUY-MIGRATION-0209: revocation does not reach the artifact'
      using errcode = 'P0001';
  end if;

  -- There must be no artifact already stranded: an active certificate whose
  -- credential is revoked. If one exists this migration has arrived after the
  -- damage and an operator needs to know, rather than the condition being
  -- quietly fixed and forgotten.
  if exists (
    select 1
      from kitluy_devices.device_certificates c
      join kitluy_devices.device_credentials cr on cr.credential_id = c.credential_id
     where c.status = 'active' and cr.revoked_at is not null) then
    raise warning 'KLUY-MIGRATION-0209: STRANDED ARTIFACTS EXIST — active certificates whose credential is already revoked. They predate this trigger and are NOT corrected here; they need an owner decision.';
  end if;

  raise notice 'KLUY-MIGRATION-0209: revoking a credential now revokes its certificate';
end
$guard$;

commit;
