-- kitluy:hub:group:0030
-- Hub migration 0030: governed_snapshot_staging.
--
-- Authority: WS-11-T003 Step 4 §6 (B4); KLD-2026-07-31-HUB-SNAPSHOT-SIGNING-001.
--
-- ===========================================================================
-- THE LEAK THIS CLOSES
-- ===========================================================================
-- Group 0027 granted `select, insert` on `edge_config.revocation_snapshot` to
-- `kitluy_sync_worker`. The COMMENT said "it may not promote", but the GRANT
-- gave the whole INSERT capability, and nothing at the database level prevented
-- a row with `state = 'active'` from being inserted directly. A compromised or
-- buggy sync worker could fabricate an active snapshot, bypassing signature
-- verification, scope checking, sequence validation and watermark comparison.
--
-- ===========================================================================
-- WHAT CHANGES
-- ===========================================================================
-- The sync worker loses direct INSERT on the snapshot table. In its place, a
-- narrow SECURITY DEFINER function stages a snapshot with `state = 'staged'`
-- enforced, and only the governed promotion path (group 0027's
-- `applySignedSnapshot`, running as `kitluy_hub_runtime`) may flip that to
-- `active`.
--
-- The function validates every required field so a caller cannot stage a
-- structurally invalid row. It returns the staged snapshot's id so the caller
-- can correlate it with the entries it will insert into
-- `revocation_snapshot_entry`.
--
-- ADDITIVE. Groups 0000-0029 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).

-- ---------------------------------------------------------------------------
-- 1. GOVERNED STAGING FUNCTION
-- ---------------------------------------------------------------------------
create or replace function edge_config.stage_revocation_snapshot_v1(
  p_id uuid,
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_environment text,
  p_hub_device_id uuid,
  p_schema_version integer,
  p_snapshot_version bigint,
  p_sequence_no bigint,
  p_revocation_watermark text,
  p_generated_at timestamptz,
  p_effective_at timestamptz,
  p_canonical_sha256 char(64),
  p_signing_key_id text,
  p_signing_key_version integer,
  p_signature_b64 text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, edge_config
as $stage$
declare
  v_key_exists boolean;
begin
  -- Structural validation: every field the promotion path depends on must be
  -- present and well-formed before the row is staged.
  if p_id is null then
    raise exception 'KLUY-SNAPSHOT-STAGE-ID-REQUIRED: a staged snapshot needs an id'
      using errcode = 'P0001';
  end if;
  if p_tenant_id is null or p_digital_store_id is null or p_store_location_id is null then
    raise exception 'KLUY-SNAPSHOT-STAGE-SCOPE-INCOMPLETE: scope is required'
      using errcode = 'P0001';
  end if;
  if coalesce(p_environment, '') = '' then
    raise exception 'KLUY-SNAPSHOT-STAGE-ENVIRONMENT-REQUIRED: environment is required'
      using errcode = 'P0001';
  end if;
  if p_hub_device_id is null then
    raise exception 'KLUY-SNAPSHOT-STAGE-HUB-DEVICE-REQUIRED: hub_device_id is required'
      using errcode = 'P0001';
  end if;
  if p_schema_version is null or p_schema_version < 1 then
    raise exception 'KLUY-SNAPSHOT-STAGE-SCHEMA-INVALID: schema_version must be >= 1'
      using errcode = 'P0001';
  end if;
  if p_snapshot_version is null or p_snapshot_version < 1 then
    raise exception 'KLUY-SNAPSHOT-STAGE-VERSION-INVALID: snapshot_version must be >= 1'
      using errcode = 'P0001';
  end if;
  if p_sequence_no is null or p_sequence_no < 0 then
    raise exception 'KLUY-SNAPSHOT-STAGE-SEQUENCE-INVALID: sequence_no must be >= 0'
      using errcode = 'P0001';
  end if;
  if coalesce(p_revocation_watermark, '') = '' then
    raise exception 'KLUY-SNAPSHOT-STAGE-WATERMARK-REQUIRED: revocation_watermark is required'
      using errcode = 'P0001';
  end if;
  if p_generated_at is null or p_effective_at is null then
    raise exception 'KLUY-SNAPSHOT-STAGE-DATES-REQUIRED: generated_at and effective_at are required'
      using errcode = 'P0001';
  end if;
  if p_canonical_sha256 is null or p_canonical_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'KLUY-SNAPSHOT-STAGE-DIGEST-INVALID: canonical_sha256 must be a 64-hex sha256'
      using errcode = 'P0001';
  end if;
  if coalesce(p_signing_key_id, '') = '' then
    raise exception 'KLUY-SNAPSHOT-STAGE-KEY-ID-REQUIRED: signing_key_id is required'
      using errcode = 'P0001';
  end if;
  if p_signing_key_version is null or p_signing_key_version < 1 then
    raise exception 'KLUY-SNAPSHOT-STAGE-KEY-VERSION-INVALID: signing_key_version must be >= 1'
      using errcode = 'P0001';
  end if;
  if coalesce(p_signature_b64, '') = '' then
    raise exception 'KLUY-SNAPSHOT-STAGE-SIGNATURE-REQUIRED: signature_b64 is required'
      using errcode = 'P0001';
  end if;

  -- The signing key must exist in the trust registry. Staging a snapshot for a
  -- key this Hub has never heard of is not "staging"; it is injecting bytes.
  select exists (
    select 1 from edge_config.revocation_trust_key
     where key_id = p_signing_key_id and key_version = p_signing_key_version
  ) into v_key_exists;
  if not v_key_exists then
    raise exception 'KLUY-SNAPSHOT-STAGE-KEY-UNKNOWN: signing key %:% is not in the trust registry',
      p_signing_key_id, p_signing_key_version
      using errcode = 'P0001';
  end if;

  -- STAGED, never active. The state is enforced by this function, not by the
  -- caller's INSERT statement.
  insert into edge_config.revocation_snapshot (
    id, tenant_id, digital_store_id, store_location_id, environment, hub_device_id,
    schema_version, snapshot_version, sequence_no, revocation_watermark,
    generated_at, effective_at, canonical_sha256,
    signing_key_id, signing_key_version, signature_b64, state
  ) values (
    p_id, p_tenant_id, p_digital_store_id, p_store_location_id, p_environment, p_hub_device_id,
    p_schema_version, p_snapshot_version, p_sequence_no, p_revocation_watermark,
    p_generated_at, p_effective_at, p_canonical_sha256,
    p_signing_key_id, p_signing_key_version, p_signature_b64, 'staged'
  );

  return p_id;
end
$stage$;

comment on function edge_config.stage_revocation_snapshot_v1 is
  'Group 0030. SECURITY DEFINER staging function for revocation snapshots. The sync worker calls this instead of INSERT-ing directly. Enforces state=staged, validates every required field, and verifies the signing key exists in the trust registry. Only the governed promotion path (applySignedSnapshot / kitluy_hub_runtime) may advance staged -> active.';

-- ---------------------------------------------------------------------------
-- 2. REVOKE DIRECT TABLE INSERT FROM SYNC WORKER
-- ---------------------------------------------------------------------------
revoke insert on edge_config.revocation_snapshot from kitluy_sync_worker;

-- The sync worker still needs to insert the entry rows that belong to the staged
-- snapshot. Entries have no state column and cannot bypass promotion.
-- (select, insert on revocation_snapshot_entry is preserved from group 0027.)

-- ---------------------------------------------------------------------------
-- 3. GRANT THE GOVERNED FUNCTION TO THE SYNC WORKER
-- ---------------------------------------------------------------------------
revoke all on function edge_config.stage_revocation_snapshot_v1(
  uuid, uuid, uuid, uuid, text, uuid, integer, bigint, bigint, text, timestamptz,
  timestamptz, char(64), text, integer, text
) from public;
grant execute on function edge_config.stage_revocation_snapshot_v1(
  uuid, uuid, uuid, uuid, text, uuid, integer, bigint, bigint, text, timestamptz,
  timestamptz, char(64), text, integer, text
) to kitluy_sync_worker;

-- ---------------------------------------------------------------------------
-- 4. PROVE THE BOUNDARY HOLDS
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_can_insert boolean;
  v_can_stage boolean;
  v_public_can_stage boolean;
begin
  -- 1. The sync worker can no longer INSERT directly into revocation_snapshot.
  select has_table_privilege('kitluy_sync_worker', 'edge_config.revocation_snapshot', 'INSERT')
    into v_can_insert;
  if v_can_insert then
    raise exception 'KLUY-HUB-MIGRATION-0030: kitluy_sync_worker still has INSERT on revocation_snapshot'
      using errcode = 'P0001';
  end if;

  -- 2. The sync worker CAN call the staging function.
  select has_function_privilege('kitluy_sync_worker',
    'edge_config.stage_revocation_snapshot_v1(uuid, uuid, uuid, uuid, text, uuid, integer, bigint, bigint, text, timestamptz, timestamptz, char(64), text, integer, text)',
    'EXECUTE')
    into v_can_stage;
  if not v_can_stage then
    raise exception 'KLUY-HUB-MIGRATION-0030: kitluy_sync_worker cannot execute stage_revocation_snapshot_v1'
      using errcode = 'P0001';
  end if;

  -- 3. PUBLIC cannot call the staging function.
  select has_function_privilege('public',
    'edge_config.stage_revocation_snapshot_v1(uuid, uuid, uuid, uuid, text, uuid, integer, bigint, bigint, text, timestamptz, timestamptz, char(64), text, integer, text)',
    'EXECUTE')
    into v_public_can_stage;
  if v_public_can_stage then
    raise exception 'KLUY-HUB-MIGRATION-0030: stage_revocation_snapshot_v1 is still EXECUTE-able by PUBLIC'
      using errcode = 'P0001';
  end if;

  raise notice 'KLUY-HUB-MIGRATION-0030: sync worker INSERT revoked; governed staging function installed';
end
$guard$;
