-- kitluy:group:0223
-- ============================================================================
-- 0223  The newest assignment, or nothing — never a silent older one
-- ============================================================================
-- Authority: U1 owner Phase 4 hardening instruction 2026-09-11 §2 —
--   "older assignment exists and is validly signed; newer authoritative
--    assignment row exists; newer assignment has not yet received its
--    assignment signature. The governed current-assignment reader must return
--    NO installable assignment. It must not silently expose the older signed
--    assignment as current. This must remain true if assignment signing crashes
--    between assign and sign."
--
-- THE DEFECT IN GROUP 0222, REPRODUCED BEFORE FIXING
-- ----------------------------------------------------------------------------
-- 0222 put the signature test in the WHERE clause and then ordered by sequence:
--
--     where ... and i.assignment_signature_b64 is not null
--     order by i.assignment_sequence desc limit 1
--
-- which SKIPS an unsigned newest row and returns the next signed one down. So a
-- publisher that crashed between `assign_release_v1` and
-- `record_assignment_signature_v1` left the device being told about the
-- PREVIOUS release, while the operator believed the new one was assigned.
--
-- Nothing errors, nothing logs, and the two sides simply disagree about what
-- the terminal is running. That is the worst shape a fault can take, and it is
-- reachable by an ordinary crash rather than by an attack.
--
-- THE RULE, STATED ONCE
-- ----------------------------------------------------------------------------
--   The device is told about its NEWEST assignment row, or about nothing.
--
-- The newest row is chosen FIRST, by sequence alone. Only then is it tested for
-- installability. If it fails any test the answer is NULL — there is no second
-- choice and no fallback, because every fallback is a silent disagreement
-- waiting to happen.
--
-- This also gives revocation a clear meaning: revoking the newest assignment's
-- release withdraws the assignment, rather than quietly promoting an older one
-- the operator did not just choose. Returning a device to an earlier release is
-- ROLLBACK, which is a device-local recovery path and not something the cloud
-- reader performs by omission.
--
-- WHAT "INSTALLABLE" MEANS
-- ----------------------------------------------------------------------------
--   the campaign is active                     an operator has not stopped it
--   the release is internal / pilot / stable    published, not draft or revoked
--   the release manifest is signed              group 0180
--   the ASSIGNMENT is signed                    group 0222
--
-- MC: read-only. No table changes in this group.
-- ============================================================================

do $borrow$
begin
  execute format('grant kitluy_release_governor to %I', current_user);
end
$borrow$;

set local role kitluy_release_governor;

create or replace function kitluy_releases.current_device_assignment_v1(
  p_device_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, kitluy_releases, kitluy_devices, extensions
as $current$
  -- The newest row for this device, chosen by SEQUENCE ALONE. Nothing about
  -- signatures, states or campaigns participates in this choice — that is the
  -- whole correction, and putting any of it here would reintroduce the skip.
  with newest as (
    select i.*
      from kitluy_releases.device_installations i
     where i.device_id = p_device_id
     order by i.assignment_sequence desc
     limit 1
  )
  select jsonb_build_object(
    'assignmentId',       n.id,
    'deviceId',           n.device_id,
    'releaseId',          r.id,
    'assignmentSequence', n.assignment_sequence,
    'environment',        c.environment,
    'status',             n.status,
    'assignmentEnvelope', jsonb_build_object(
      'keyId',      n.assignment_signing_key_id,
      'keyVersion', n.assignment_signing_key_version,
      'algorithm',  'ed25519',
      'signature',  n.assignment_signature_b64
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
  from newest n
  join kitluy_releases.rollout_campaigns c on c.id = n.campaign_id
  join kitluy_releases.release_artifacts r on r.id = c.artifact_id
  -- Applied to the NEWEST row only. A failure here yields no row, and therefore
  -- NULL — never the row below it.
  where c.status = 'active'
    and r.state in ('internal', 'pilot', 'stable')
    and r.signature_b64 is not null
    and n.assignment_signature_b64 is not null;
$current$;

comment on function kitluy_releases.current_device_assignment_v1(uuid) is
  'Group 0223 (U1, replacing 0222). THE governed answer to "what release is this device assigned?". The NEWEST assignment row is chosen by sequence alone, then tested for installability; if it fails any test the answer is NULL. There is deliberately NO fallback to an older signed assignment: a publisher that crashed between assign and sign would otherwise leave the device being told about the previous release while the operator believed the new one was assigned. Returning a device to an earlier release is ROLLBACK, a device-local recovery path, not something this reader does by omission.';

grant execute on function kitluy_releases.current_device_assignment_v1(uuid)
  to kitluy_release_governor, kitluy_release_service;

reset role;
