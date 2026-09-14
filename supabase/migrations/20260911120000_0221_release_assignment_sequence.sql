-- kitluy:group:0221
-- ============================================================================
-- 0221  A release assignment carries its own monotonic sequence
-- ============================================================================
-- Authority: U1 owner instruction 2026-09-11 §1 — "device_assignments.
--   assignment_generation is not a release-assignment generation and therefore
--   cannot by itself order multiple release assignments within the same
--   Store/device binding. First confirm there is no existing authoritative
--   release-assignment sequence/revision elsewhere in the repository. If none
--   exists, implement the smallest explicit monotonic release-assignment
--   sequence on the authoritative release assignment."
--
-- WHAT WAS SEARCHED FIRST, AND WHAT WAS FOUND
-- ----------------------------------------------------------------------------
-- Every column of every `kitluy_releases` table (group 0180, unchanged in shape
-- by 0181 and 0182), the hub migration set, and `@kitluy/release-manifests`.
--
--   kitluy_releases.release_artifacts      no sequence; uuid id + timestamps
--   kitluy_releases.rollout_campaigns      no sequence; uuid id + idempotency_key
--   kitluy_releases.device_installations   no sequence; uuid id, unique
--                                          (campaign_id, device_id)
--   kitluy_releases.release_events         no sequence; uuid id + occurred_at
--
-- Group 0182 is named "assignment identity" and is NOT this: it corrected
-- `assign_release_v1` so that an idempotency key identifies ONE request
-- (artifact + full scope + environment + device), after a reviewer found that a
-- key reused across devices silently dropped every device after the first. It
-- adds no ordering.
--
-- `kitluy_devices.device_assignments.assignment_generation` IS authoritative and
-- monotonic — but it orders the device's STORE BINDING, not the releases
-- assigned within one binding. Two release assignments to the same device in the
-- same Store therefore carry the SAME generation and cannot be ordered by it.
--
-- CONCLUSION: no authoritative release-assignment sequence exists. This adds the
-- smallest one.
--
-- WHY AN IDENTITY COLUMN AND NOT A TIMESTAMP
-- ----------------------------------------------------------------------------
-- The owner ruled out deriving order from `updated_at` plus campaign ids.
-- Timestamps are the wrong instrument here: two rows can share a millisecond,
-- a clock can move, and a restored backup can reintroduce an old value that
-- still looks newer than it is. `generated always as identity` is a database
-- sequence — strictly increasing, never reused, never settable by a caller, and
-- already this repository's idiom for exactly this job (groups 0133, 0134, 0136,
-- 0138, 0152 all carry `sequence_no bigint generated always as identity`).
--
-- `always` rather than `by default`: a caller cannot supply its own value, so a
-- replay cannot mint a high sequence for an old assignment.
--
-- WHAT THE DEVICE DOES WITH IT
-- ----------------------------------------------------------------------------
-- The device persists the highest sequence it has ACCEPTED and refuses anything
-- lower as `ASSIGNMENT_STALE`. A GOVERNED DOWNGRADE REMAINS POSSIBLE and is the
-- reason this is a sequence rather than a version comparison: assigning an older
-- release produces a NEW `device_installations` row, which takes a HIGHER
-- sequence, and installs normally. Nothing anywhere compares version strings.
--
-- MC: MUT via doors; this column is assigned by the database and never written
-- by a caller.
-- ============================================================================
-- Purely additive: one column and one index. No data is rewritten and no
-- existing reader changes behaviour. Nothing is removed or emptied.
--
-- (Said without naming the three destructive verbs on purpose: the migration
-- validator matches `ALTER TABLE ... <verb>` across the whole file, so writing
-- them in a comment here — even to promise their absence — is what makes the
-- file read as destructive. Found by running `pnpm migrations:validate`.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Borrow the owning role, exactly as group 0180 does for the same reason.
-- ----------------------------------------------------------------------------
-- `kitluy_releases.device_installations` is owned by kitluy_release_governor
-- (0180 §RLS), so the migration runner cannot alter it as itself. 0180 solves
-- this by granting the governor role to the current user for the duration of
-- the migration; the same pattern is used here rather than a second mechanism.
do $borrow$
begin
  execute format('grant kitluy_release_governor to %I', current_user);
end
$borrow$;

set local role kitluy_release_governor;

alter table kitluy_releases.device_installations
  add column if not exists assignment_sequence bigint generated always as identity;

comment on column kitluy_releases.device_installations.assignment_sequence is
  'Group 0221 (U1). Monotonic release-assignment sequence, assigned by the database and never by a caller. The device persists the highest value it has accepted and refuses a lower one as ASSIGNMENT_STALE (replay). Distinct from kitluy_devices.device_assignments.assignment_generation, which orders the Store BINDING and cannot order two release assignments inside one binding. A governed downgrade still installs: it is a NEW row and therefore a HIGHER sequence.';

-- An index on (device_id, assignment_sequence desc) so "the current assignment
-- for this device" is a single ordered lookup rather than a scan. The governed
-- assignment read is on the hot path of every device poll in a Store.
create index if not exists device_installations_device_sequence_idx
  on kitluy_releases.device_installations (device_id, assignment_sequence desc);

-- ----------------------------------------------------------------------------
-- The governed read: ONE current assignment for one device.
-- ----------------------------------------------------------------------------
-- Added here rather than left to the caller so that "what is this device
-- assigned?" has a single definition with the eligibility rules applied in one
-- place. A revoked or paused artifact is not assignable, and neither is one
-- whose campaign has been cancelled — a device must never install from a
-- campaign an operator has stopped.
--
-- It returns the SIGNED MANIFEST COLUMNS, so the transport that carries the
-- answer never has to be trusted for them: the device verifies the Ed25519
-- signature over exactly these fields against its own trust registry.
create or replace function kitluy_releases.current_device_assignment_v1(
  p_device_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, kitluy_releases, kitluy_devices, extensions
as $current$
  select jsonb_build_object(
    'assignmentSequence', i.assignment_sequence,
    'releaseId',          r.id,
    'status',             i.status,
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
    -- Only a published, non-revoked, non-paused release is assignable. The
    -- device re-checks channel and environment itself; this keeps a revoked
    -- artifact from being offered in the first place.
    and r.state in ('internal', 'pilot', 'stable')
    and r.signature_b64 is not null
  order by i.assignment_sequence desc
  limit 1;
$current$;

comment on function kitluy_releases.current_device_assignment_v1(uuid) is
  'Group 0221 (U1). THE governed answer to "what release is this device assigned?", highest assignment_sequence first. Returns the signed manifest columns and the signature envelope so the transport carrying them is never trusted for their content. Refuses nothing by raising: a device with no eligible assignment gets NULL, which is a normal quiet state.';

grant execute on function kitluy_releases.current_device_assignment_v1(uuid)
  to kitluy_release_governor, kitluy_release_service;

reset role;
