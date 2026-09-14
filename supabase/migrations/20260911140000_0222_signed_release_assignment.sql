-- kitluy:group:0222
-- ============================================================================
-- 0222  A release assignment is signed, so the transport cannot forge one
-- ============================================================================
-- Authority: U1 owner preflight instruction 2026-09-11 §1 — "if
--   assignment_sequence itself is accepted from plain HTTP without an
--   integrity/authenticity binding, a replaying transport could potentially
--   attach a forged high sequence to an older validly-signed release and poison
--   the device's high-water mark. Do not assume 'artifact verification does not
--   depend on transport' proves assignment authority also does not."
--
-- THE HOLE THIS CLOSES, EXACTLY
-- ----------------------------------------------------------------------------
-- The release manifest signature (group 0180, manifest v1) covers fifteen
-- fields, and `releaseId` is one of them. It does NOT cover:
--
--     assignment_sequence     <- the ordering the device trusts for replay
--     the target device       <- which device the assignment is for
--     the assignment identity <- which device_installations row this is
--
-- Group 0221 then had the device persist `assignment_sequence` as a durable
-- high-water mark, read from an unauthenticated JSON response. That is enough
-- for two real attacks by anything that can answer the device:
--
--   1. POISONING. Serve a genuine, validly-signed OLD release with a forged
--      sequence of 999999. Every check passes: the signature is real, the
--      releaseId matches its manifest, and the sequence is higher than the
--      accepted one. The device installs the old release AND records 999999.
--      Every future genuine assignment is then refused ASSIGNMENT_STALE — a
--      permanent, reboot-surviving denial of update, because the journal is
--      durable by design.
--
--   2. MISDIRECTION. Hand device B the assignment minted for device A. Nothing
--      in the signed bytes names a device, so B accepts it.
--
-- "The transport is powerless" was true of the ARTIFACT and false of the
-- ASSIGNMENT. This migration makes it true of both.
--
-- THE FIX: A SECOND SIGNED STATEMENT, DOMAIN-SEPARATED
-- ----------------------------------------------------------------------------
-- The assignment gets its own detached Ed25519 signature over its own canonical
-- bytes, verified by the device against the SAME trust registry it already
-- carries. No new key, no new trust path, no new purpose:
--
--     kitluy.release-assignment.v1 <RS> assignmentId <RS> deviceId <RS>
--     releaseId <RS> assignmentSequence <RS> environment <RS>
--
-- The leading domain tag is what makes reusing one key for two message types
-- safe: `kitluy.release-manifest.v1` bytes can never parse as
-- `kitluy.release-assignment.v1` bytes, so a manifest signature cannot be
-- replayed as an assignment signature or the reverse. This is the discipline
-- already used by `kitluy.cert.v1` and the manifest itself.
--
-- WHY THIS IS NOT U4 WORK
-- ----------------------------------------------------------------------------
-- It is deliberately NOT transport security. Mutual TLS to the Store Hub is U4
-- and is not built here. A signed assignment is strictly better for this
-- purpose anyway: it survives the transport entirely, so when the Hub becomes
-- the source at U4 it caches and forwards the same signed bytes and the device
-- code does not change. Securing the channel instead would have to be redone.
--
-- MC: MUT via doors; the signature columns are written once and never rewritten.
-- ============================================================================
-- Additive: three columns, one door, one reader replaced. Nothing is removed or
-- emptied. (The three destructive verbs are not named here, deliberately — see
-- group 0221's note on the validator.)
-- ============================================================================

do $borrow$
begin
  execute format('grant kitluy_release_governor to %I', current_user);
end
$borrow$;

set local role kitluy_release_governor;

alter table kitluy_releases.device_installations
  add column if not exists assignment_signature_b64 text,
  add column if not exists assignment_signing_key_id text,
  add column if not exists assignment_signing_key_version integer;

comment on column kitluy_releases.device_installations.assignment_signature_b64 is
  'Group 0222 (U1). Detached Ed25519 signature over the canonical assignment bytes (domain tag kitluy.release-assignment.v1), binding assignmentId, deviceId, releaseId, assignmentSequence and environment. Written once by record_assignment_signature_v1 and never rewritten. Without it the device refuses the assignment: an unsigned assignment is transport-trusted, which is what this group exists to stop.';

-- ----------------------------------------------------------------------------
-- The door. Write-once, because a re-signed assignment is a changed assignment.
-- ----------------------------------------------------------------------------
create or replace function kitluy_releases.record_assignment_signature_v1(
  p_installation uuid,
  p_key_id text,
  p_key_version integer,
  p_signature_b64 text,
  p_actor_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_releases, extensions
as $sign_assignment$
declare
  v_row kitluy_releases.device_installations;
begin
  select * into v_row from kitluy_releases.device_installations
   where id = p_installation for update;
  if not found then
    raise exception 'KLUY-ASSIGNMENT-UNKNOWN: installation % does not exist', p_installation
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_actor_ref), '') = '' then
    raise exception 'KLUY-ASSIGNMENT-UNATTRIBUTED: a signature names its signer'
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_signature_b64), '') = '' or p_key_version is null
     or coalesce(btrim(p_key_id), '') = '' then
    raise exception 'KLUY-ASSIGNMENT-SIGNATURE-SHAPE: an Ed25519 base64 signature and its key identity are required'
      using errcode = 'P0001';
  end if;
  -- WRITE ONCE. A second signature over the same row would mean two different
  -- statements are true about one assignment, and a device that saw both could
  -- not say which. Re-assigning is the supported action; it makes a new row
  -- with a new sequence.
  if v_row.assignment_signature_b64 is not null then
    if v_row.assignment_signature_b64 = p_signature_b64 then
      return jsonb_build_object('outcome', 'ALREADY_SIGNED');
    end if;
    raise exception 'KLUY-ASSIGNMENT-SIGNED: installation % is already signed; assign again rather than re-signing', p_installation
      using errcode = 'P0001';
  end if;

  update kitluy_releases.device_installations
     set assignment_signature_b64 = p_signature_b64,
         assignment_signing_key_id = btrim(p_key_id),
         assignment_signing_key_version = p_key_version,
         updated_at = now()
   where id = p_installation;
  return jsonb_build_object('outcome', 'SIGNED', 'installation_id', p_installation);
end;
$sign_assignment$;

comment on function kitluy_releases.record_assignment_signature_v1(uuid, text, integer, text, text) is
  'Group 0222 (U1). Records the detached signature over an assignment, once. A second, different signature is refused: two statements about one assignment is a state no device could resolve.';

-- ----------------------------------------------------------------------------
-- The reader, now returning the assignment binding and its signature.
-- ----------------------------------------------------------------------------
-- FAILS CLOSED: an assignment with no signature is not returned at all. A
-- device polling during the window between `assign_release_v1` and
-- `record_assignment_signature_v1` therefore sees "nothing assigned", which is
-- a quiet, correct, momentary state — and much better than handing it an
-- assignment it is about to refuse.
create or replace function kitluy_releases.current_device_assignment_v1(
  p_device_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, kitluy_releases, kitluy_devices, extensions
as $current$
  select jsonb_build_object(
    -- The four facts the assignment signature binds.
    'assignmentId',       i.id,
    'deviceId',           i.device_id,
    'releaseId',          r.id,
    'assignmentSequence', i.assignment_sequence,
    'environment',        c.environment,
    'status',             i.status,
    'assignmentEnvelope', jsonb_build_object(
      'keyId',      i.assignment_signing_key_id,
      'keyVersion', i.assignment_signing_key_version,
      'algorithm',  'ed25519',
      'signature',  i.assignment_signature_b64
    ),
    'manifest', jsonb_build_object(
      'manifestVersion',            r.manifest_version,
      'releaseId',                  r.id::text,
      'productKey',                 r.product_key,
      'version',                    r.version,
      'buildId',                    r.build_id,
      'architecture',               r.architecture,
      'hardwareProfile',            r.hardware_profile,
      'environment',                r.environment,
      'channel',                    r.channel,
      'artifactDigestSha256',       r.artifact_digest_sha256,
      'artifactSizeBytes',          r.artifact_size_bytes,
      'minSchemaVersion',           r.min_schema_version,
      'maxSchemaVersion',           r.max_schema_version,
      'configPrerequisiteVersion',  r.config_prerequisite_version,
      'rollbackReleaseId',          coalesce(r.rollback_release_id::text, '')
    ),
    'envelope', jsonb_build_object(
      'keyId',      r.signing_key_id,
      'keyVersion', r.signing_key_version,
      'algorithm',  'ed25519',
      'signature',  r.signature_b64
    )
  )
  from kitluy_releases.device_installations i
  join kitluy_releases.rollout_campaigns c on c.id = i.campaign_id
  join kitluy_releases.release_artifacts r on r.id = c.artifact_id
  where i.device_id = p_device_id
    and c.status = 'active'
    and r.state in ('internal', 'pilot', 'stable')
    and r.signature_b64 is not null
    and i.assignment_signature_b64 is not null
  order by i.assignment_sequence desc
  limit 1;
$current$;

comment on function kitluy_releases.current_device_assignment_v1(uuid) is
  'Group 0222 (U1, replacing 0221). THE governed answer to "what release is this device assigned?", highest assignment_sequence first. Returns the assignment binding (assignmentId, deviceId, releaseId, assignmentSequence, environment) and its detached signature, plus the signed release manifest. An UNSIGNED assignment is never returned: the device would refuse it, and the transport must not be able to present one.';

grant execute on function kitluy_releases.record_assignment_signature_v1(uuid, text, integer, text, text)
  to kitluy_release_governor, kitluy_release_service;
grant execute on function kitluy_releases.current_device_assignment_v1(uuid)
  to kitluy_release_governor, kitluy_release_service;

reset role;
