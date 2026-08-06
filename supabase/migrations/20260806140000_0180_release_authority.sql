-- kitluy:group:0180
-- Migration group 0180: release_authority.
--
-- Authority: WS-11-T006-P03 (KLD-2026-08-06-WS11-T006-001 §5 — LOCKED:
-- manifest v1, SHA-256 artifact digest, Ed25519 manifest signature,
-- Internal -> Pilot -> Stable with no skipped promotion, Pilot/Stable
-- fail-closed under BLK-005); release-channel and promotion policy v1.0.0
-- §1-§4, §11, §13; device release/update service spec §3 (table names per
-- the CANONICAL data dictionary `kitluy_releases` rows — release_artifacts,
-- release_channels, rollout_campaigns, device_installations; the spec's
-- 15-table decomposition is a recorded divergence the dictionary governs);
-- RBAC registry keys releases.promote_internal/_pilot/_stable; prior groups
-- 0120 (assert_pki_configuration_approved — the BLK-005 gate), 0173
-- (NOINHERIT gateway), 0177 (grant discipline).
--
-- ===========================================================================
-- WHAT A RELEASE IS HERE
-- ===========================================================================
-- A signed IMMUTABLE fact plus governed lifecycle state around it. Once
-- signed, the manifest columns freeze (trigger-enforced): promotion changes
-- ELIGIBILITY of the same signed bytes, never the bytes; revocation is a new
-- governed fact with its own evidence and never rewrites the manifest. A
-- channel name, file name or object-storage URL is never sufficient
-- authority — devices verify the Ed25519 signature independently
-- (@kitluy/device-identity release-manifest.ts, the same closed verifier on
-- Hub and terminal).
-- ===========================================================================
-- kitluy:destructive-approved:KLD-2026-08-06-WS11-T006-001 -- no
-- DROP/TRUNCATE/DELETE in this group; marker present so the guard never
-- reads a future edit as unmarked history.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. IDENTITIES AND SCHEMA
-- ---------------------------------------------------------------------------
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_release_governor') then
    create role kitluy_release_governor nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'kitluy_release_service') then
    create role kitluy_release_service nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'kitluy_release_gateway') then
    create role kitluy_release_gateway nologin noinherit;
  end if;
end
$roles$;

comment on role kitluy_release_governor is
  'Group 0180 (WS-11-T006-P03). Owns the release authority and every door over it. NOLOGIN.';
comment on role kitluy_release_service is
  'Group 0180. The identity the release/update service ENTERS per transaction (SET LOCAL ROLE). EXECUTE on the release doors and nothing else.';
comment on role kitluy_release_gateway is
  'Group 0180. NOLOGIN + NOINHERIT hinge (0173 pattern): service_role reaches kitluy_release_service only via explicit SET LOCAL ROLE.';

grant kitluy_release_service to kitluy_release_gateway;
grant kitluy_release_gateway to service_role;

create schema if not exists kitluy_releases;
comment on schema kitluy_releases is
  'Releases — signed artifacts, channels, rollout campaigns, installations and rollback state (data dictionary schema-ownership row).';

grant usage, create on schema kitluy_releases to kitluy_release_governor;
grant usage on schema extensions to kitluy_release_governor;
grant usage on schema kitluy_devices to kitluy_release_governor;
grant usage on schema kitluy_releases to kitluy_release_service;
-- The BLK-005 gate is the 0120 assert; the governor needs to call it.
grant execute on function kitluy_devices.assert_pki_configuration_approved(text) to kitluy_release_governor;
-- The gate is a PLAIN function: it reads the PKI table as the CALLER.
grant select on kitluy_devices.pki_trust_configuration to kitluy_release_governor;
drop policy if exists pki_release_governor on kitluy_devices.pki_trust_configuration;
create policy pki_release_governor on kitluy_devices.pki_trust_configuration
  for select to kitluy_release_governor using (true);

do $borrow$
begin
  execute format('grant kitluy_release_governor to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 2. TABLES (data dictionary kitluy_releases rows + append-only events)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_releases.release_channels (
  id uuid primary key default extensions.gen_random_uuid(),
  channel_key text not null,
  product_key text not null,
  policy_version text not null default 'v1.0.0',
  status text not null default 'active',
  constraint release_channels_key_chk check (channel_key in ('internal', 'pilot', 'stable')),
  constraint release_channels_status_chk check (status in ('active', 'suspended')),
  constraint release_channels_uq unique (product_key, channel_key)
);

comment on table kitluy_releases.release_channels is
  'Group 0180 (WS-11-T006-P03). Auditable channel states per product (policy §1: "channels are auditable release states, not mutable folders"). MC: MUT (governor only).';

create table if not exists kitluy_releases.release_artifacts (
  id uuid primary key default extensions.gen_random_uuid(),
  product_key text not null,
  version text not null,
  build_id text not null,
  architecture text not null,
  hardware_profile text not null,
  environment text not null,
  channel text not null default 'internal',
  artifact_file_ref text,
  artifact_digest_sha256 char(64) not null,
  artifact_size_bytes bigint not null,
  manifest_version integer not null default 1,
  signing_key_id text,
  signing_key_version integer,
  signature_b64 text,
  min_schema_version integer not null,
  max_schema_version integer not null,
  config_prerequisite_version bigint not null default 0,
  rollback_release_id uuid references kitluy_releases.release_artifacts (id),
  state text not null default 'draft',
  created_by_ref text not null,
  promotion_approver_ref text,
  revocation_reason text,
  created_at timestamptz not null default now(),
  signed_at timestamptz,
  published_at timestamptz,
  paused_at timestamptz,
  revoked_at timestamptz,
  correlation_id uuid not null,
  updated_at timestamptz not null default now(),
  constraint release_artifacts_state_chk
    check (state in ('draft', 'signed', 'internal', 'pilot', 'stable', 'paused', 'revoked')),
  constraint release_artifacts_channel_chk
    check (channel in ('internal', 'pilot', 'stable')),
  constraint release_artifacts_env_chk
    check (environment in ('development', 'pilot', 'production')),
  constraint release_artifacts_digest_chk check (artifact_digest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint release_artifacts_size_chk check (artifact_size_bytes > 0),
  constraint release_artifacts_manifest_chk check (manifest_version = 1),
  constraint release_artifacts_schema_chk
    check (min_schema_version >= 0 and max_schema_version >= min_schema_version),
  constraint release_artifacts_signed_shape_chk
    check (state = 'draft'
           or (signing_key_id is not null and signing_key_version is not null
               and signature_b64 is not null and signed_at is not null)),
  constraint release_artifacts_revoked_shape_chk
    check ((state = 'revoked') = (revoked_at is not null)),
  constraint release_artifacts_uq unique (product_key, version, architecture, environment)
);

comment on table kitluy_releases.release_artifacts is
  'Group 0180 (WS-11-T006-P03). The release authority (DD release_artifacts). Once SIGNED the manifest columns freeze (trigger): promotion moves state/channel eligibility of the same signed bytes; revocation is a new fact (state + reason + timestamp + event), never a rewrite. MC: MUT via doors; manifest columns A/O after signing.';

create table if not exists kitluy_releases.rollout_campaigns (
  id uuid primary key default extensions.gen_random_uuid(),
  artifact_id uuid not null references kitluy_releases.release_artifacts (id),
  channel text not null,
  tenant_id uuid not null,
  digital_store_id uuid not null,
  store_location_id uuid not null,
  environment text not null,
  status text not null default 'active',
  approval_ref text,
  idempotency_key text not null unique,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint rollout_campaigns_status_chk
    check (status in ('active', 'paused', 'completed', 'cancelled')),
  constraint rollout_campaigns_channel_chk check (channel in ('internal', 'pilot', 'stable'))
);

comment on table kitluy_releases.rollout_campaigns is
  'Group 0180 (WS-11-T006-P03). Explicit release targeting per Tenant/Store/Location scope (DD rollout_campaigns). MC: MUT (governor only).';

create table if not exists kitluy_releases.device_installations (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references kitluy_releases.rollout_campaigns (id),
  device_id uuid not null references kitluy_devices.devices (id),
  desired_version text not null,
  downloaded_version text,
  installed_version text,
  active_version text,
  rollback_version text,
  status text not null default 'assigned',
  health_result text,
  updated_at timestamptz not null default now(),
  constraint device_installations_status_chk
    check (status in ('assigned', 'downloading', 'verified', 'staged',
                      'installing_inactive_slot', 'pending_restart',
                      'health_checking', 'current', 'failed', 'rolling_back',
                      'failed_rolled_back', 'cancelled')),
  constraint device_installations_uq unique (campaign_id, device_id)
);

comment on table kitluy_releases.device_installations is
  'Group 0180 (WS-11-T006-P03). Cloud projection of per-device installation state (DD device_installations); the DEVICE-side durable authority is Hub group 0039. Current, candidate and rollback versions tracked separately. MC: MUT (governor only).';

create table if not exists kitluy_releases.release_events (
  id uuid primary key default extensions.gen_random_uuid(),
  artifact_id uuid not null references kitluy_releases.release_artifacts (id),
  event_type text not null,
  from_state text,
  to_state text,
  actor_ref text not null,
  approver_ref text,
  detail jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  occurred_at timestamptz not null default now(),
  constraint release_events_detail_chk check (pg_column_size(detail) <= 8192)
);

comment on table kitluy_releases.release_events is
  'Group 0180 (WS-11-T006-P03). Append-only release audit (created/signed/promoted/paused/revoked/assigned) — a DD-beyond addition recorded in the P03 handoff: revocation and promotion need immutable evidence the four DD rows cannot carry. MC: A/O.';

-- ---------------------------------------------------------------------------
-- 3. INTEGRITY TRIGGERS
-- ---------------------------------------------------------------------------
create or replace function kitluy_releases.enforce_release_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'KLUY-RELEASE-EVENT-IMMUTABLE: release events are append-only'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_release_events_append_only on kitluy_releases.release_events;
create trigger trg_release_events_append_only
  before update or delete on kitluy_releases.release_events
  for each row execute function kitluy_releases.enforce_release_events_append_only();

create or replace function kitluy_releases.enforce_release_governed()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-RELEASE-IMMUTABLE: release rows are revoked or superseded, never deleted'
      using errcode = 'P0001';
  end if;
  if current_user <> 'kitluy_release_governor' then
    raise exception 'KLUY-RELEASE-GOVERNED: release authority changes only through governed doors (group 0180)'
      using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'release_artifacts'
     and (to_jsonb(old) ->> 'state') <> 'draft' then
    -- The signed manifest is IMMUTABLE (owner decision §5): after signing,
    -- only lifecycle columns may move.
    if new.product_key <> old.product_key or new.version <> old.version
       or new.build_id <> old.build_id or new.architecture <> old.architecture
       or new.hardware_profile <> old.hardware_profile
       or new.environment <> old.environment
       or new.artifact_digest_sha256 <> old.artifact_digest_sha256
       or new.artifact_size_bytes <> old.artifact_size_bytes
       or new.manifest_version <> old.manifest_version
       or new.signing_key_id is distinct from old.signing_key_id
       or new.signing_key_version is distinct from old.signing_key_version
       or new.signature_b64 is distinct from old.signature_b64
       or new.min_schema_version <> old.min_schema_version
       or new.max_schema_version <> old.max_schema_version
       or new.config_prerequisite_version <> old.config_prerequisite_version
       or new.rollback_release_id is distinct from old.rollback_release_id then
      raise exception 'KLUY-RELEASE-MANIFEST-IMMUTABLE: a signed manifest is never rewritten; revoke and publish a NEW release'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

do $trg$
declare
  v_table text;
begin
  foreach v_table in array array['release_channels', 'release_artifacts',
                                 'rollout_campaigns', 'device_installations'] loop
    execute format('drop trigger if exists trg_%s_governed on kitluy_releases.%I', v_table, v_table);
    execute format('create trigger trg_%s_governed before insert or update or delete on kitluy_releases.%I for each row execute function kitluy_releases.enforce_release_governed()', v_table, v_table);
  end loop;
end
$trg$;

-- ---------------------------------------------------------------------------
-- 4. DOORS
-- ---------------------------------------------------------------------------
create or replace function kitluy_releases.record_release_event(
  p_artifact uuid, p_type text, p_from text, p_to text,
  p_actor text, p_approver text, p_detail jsonb, p_corr uuid
) returns void
language sql
security definer
set search_path = pg_catalog, kitluy_releases, extensions
as $$
  insert into kitluy_releases.release_events
    (artifact_id, event_type, from_state, to_state, actor_ref, approver_ref, detail, correlation_id)
  values (p_artifact, p_type, p_from, p_to, p_actor, p_approver, coalesce(p_detail, '{}'::jsonb), p_corr);
$$;

create or replace function kitluy_releases.create_release_draft_v1(
  p_product_key text,
  p_version text,
  p_build_id text,
  p_architecture text,
  p_hardware_profile text,
  p_environment text,
  p_artifact_file_ref text,
  p_artifact_digest_sha256 text,
  p_artifact_size_bytes bigint,
  p_min_schema_version integer,
  p_max_schema_version integer,
  p_config_prerequisite_version bigint,
  p_rollback_release_id uuid,
  p_actor_ref text,
  p_correlation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_releases, kitluy_devices, extensions
as $draft$
declare
  v_id uuid;
begin
  if coalesce(btrim(p_actor_ref), '') = '' then
    raise exception 'KLUY-RELEASE-UNATTRIBUTED: a release names its creator' using errcode = 'P0001';
  end if;
  if p_correlation_id is null then
    raise exception 'KLUY-RELEASE-CORRELATION: a release carries a correlation id' using errcode = 'P0001';
  end if;
  if p_rollback_release_id is not null
     and not exists (select 1 from kitluy_releases.release_artifacts
                      where id = p_rollback_release_id and state <> 'revoked') then
    raise exception 'KLUY-RELEASE-ROLLBACK-UNKNOWN: the rollback release must exist and not be revoked'
      using errcode = 'P0001';
  end if;
  insert into kitluy_releases.release_artifacts
    (product_key, version, build_id, architecture, hardware_profile,
     environment, artifact_file_ref, artifact_digest_sha256,
     artifact_size_bytes, min_schema_version, max_schema_version,
     config_prerequisite_version, rollback_release_id, created_by_ref,
     correlation_id)
  values
    (p_product_key, p_version, p_build_id, p_architecture, p_hardware_profile,
     p_environment, p_artifact_file_ref, lower(p_artifact_digest_sha256),
     p_artifact_size_bytes, p_min_schema_version, p_max_schema_version,
     coalesce(p_config_prerequisite_version, 0), p_rollback_release_id,
     btrim(p_actor_ref), p_correlation_id)
  returning id into v_id;
  perform kitluy_releases.record_release_event(
    v_id, 'RELEASE_CREATED', null, 'draft', btrim(p_actor_ref), null, '{}', p_correlation_id);
  return jsonb_build_object('outcome', 'CREATED', 'release_id', v_id);
end;
$draft$;

create or replace function kitluy_releases.sign_release_v1(
  p_release uuid,
  p_signing_key_id text,
  p_signing_key_version integer,
  p_signature_b64 text,
  p_actor_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_releases, extensions
as $sign$
declare
  v_rel kitluy_releases.release_artifacts;
begin
  select * into v_rel from kitluy_releases.release_artifacts
   where id = p_release for update;
  if not found then
    raise exception 'KLUY-RELEASE-UNKNOWN: release % does not exist', p_release using errcode = 'P0001';
  end if;
  if v_rel.state = 'signed' and v_rel.signature_b64 = p_signature_b64 then
    return jsonb_build_object('outcome', 'ALREADY_SIGNED');
  end if;
  if v_rel.state <> 'draft' then
    raise exception 'KLUY-RELEASE-STATE: signing applies to a draft, not %', v_rel.state
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_signing_key_id), '') = '' or p_signing_key_version is null
     or p_signature_b64 !~ '^[A-Za-z0-9+/=]{80,120}$' then
    raise exception 'KLUY-RELEASE-SIGNATURE-SHAPE: an Ed25519 base64 signature and its key identity are required'
      using errcode = 'P0001';
  end if;
  update kitluy_releases.release_artifacts
  set state = 'signed', signing_key_id = btrim(p_signing_key_id),
      signing_key_version = p_signing_key_version,
      signature_b64 = p_signature_b64, signed_at = now(), updated_at = now()
  where id = p_release;
  perform kitluy_releases.record_release_event(
    p_release, 'RELEASE_SIGNED', 'draft', 'signed', btrim(p_actor_ref), null,
    jsonb_build_object('signing_key_id', btrim(p_signing_key_id),
                       'signing_key_version', p_signing_key_version),
    v_rel.correlation_id);
  return jsonb_build_object('outcome', 'SIGNED');
end;
$sign$;

create or replace function kitluy_releases.promote_release_v1(
  p_release uuid,
  p_target_channel text,
  p_actor_ref text,
  p_approver_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_releases, kitluy_devices, extensions
as $promote$
declare
  v_rel kitluy_releases.release_artifacts;
  v_expected_from text;
begin
  select * into v_rel from kitluy_releases.release_artifacts
   where id = p_release for update;
  if not found then
    raise exception 'KLUY-RELEASE-UNKNOWN: release % does not exist', p_release using errcode = 'P0001';
  end if;
  if p_target_channel not in ('internal', 'pilot', 'stable') then
    raise exception 'KLUY-RELEASE-CHANNEL: % is not a release channel', p_target_channel
      using errcode = 'P0001';
  end if;
  if v_rel.state = p_target_channel then
    return jsonb_build_object('outcome', 'ALREADY_PROMOTED', 'channel', p_target_channel);
  end if;
  if v_rel.state in ('revoked', 'paused') then
    raise exception 'KLUY-RELEASE-STATE: a % release is not promotable', v_rel.state
      using errcode = 'P0001';
  end if;

  -- The FIXED order (owner decision §5): signed -> internal -> pilot ->
  -- stable. No skips: the required predecessor is exact.
  v_expected_from := case p_target_channel
    when 'internal' then 'signed'
    when 'pilot' then 'internal'
    when 'stable' then 'pilot'
  end;
  if v_rel.state <> v_expected_from then
    raise exception 'KLUY-RELEASE-PROMOTION-ORDER: % is reached only from %, not % (Internal -> Pilot -> Stable, no skips)',
      p_target_channel, v_expected_from, v_rel.state
      using errcode = 'P0001';
  end if;

  -- Pilot and Stable are independent-approver promotions (policy §2) and
  -- BLK-005 fail-closed: the 0120 owner gate refuses until the approved PKI
  -- configuration for that environment exists.
  if p_target_channel in ('pilot', 'stable') then
    if coalesce(btrim(p_approver_ref), '') = '' then
      raise exception 'KLUY-RELEASE-UNAPPROVED: % promotion requires an independent approver', p_target_channel
        using errcode = 'P0001';
    end if;
    if btrim(p_approver_ref) = btrim(p_actor_ref) then
      raise exception 'KLUY-RELEASE-SELF-APPROVAL: the requester can never approve their own promotion'
        using errcode = 'P0001';
    end if;
    perform kitluy_devices.assert_pki_configuration_approved(
      case p_target_channel when 'pilot' then 'pilot' else 'production' end);
  end if;

  update kitluy_releases.release_artifacts
  set state = p_target_channel, channel = p_target_channel,
      promotion_approver_ref = nullif(btrim(coalesce(p_approver_ref, '')), ''),
      published_at = coalesce(published_at, now()), updated_at = now()
  where id = p_release;
  perform kitluy_releases.record_release_event(
    p_release, 'RELEASE_PROMOTED', v_rel.state, p_target_channel,
    btrim(p_actor_ref), nullif(btrim(coalesce(p_approver_ref, '')), ''), '{}',
    v_rel.correlation_id);
  return jsonb_build_object('outcome', 'PROMOTED', 'channel', p_target_channel);
end;
$promote$;

create or replace function kitluy_releases.pause_release_v1(
  p_release uuid, p_actor_ref text, p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_releases, extensions
as $pause$
declare
  v_rel kitluy_releases.release_artifacts;
begin
  select * into v_rel from kitluy_releases.release_artifacts
   where id = p_release for update;
  if not found then
    raise exception 'KLUY-RELEASE-UNKNOWN: release % does not exist', p_release using errcode = 'P0001';
  end if;
  if v_rel.state = 'paused' then
    return jsonb_build_object('outcome', 'ALREADY_PAUSED');
  end if;
  if v_rel.state not in ('internal', 'pilot', 'stable') then
    raise exception 'KLUY-RELEASE-STATE: only a published release pauses, not %', v_rel.state
      using errcode = 'P0001';
  end if;
  update kitluy_releases.release_artifacts
  set state = 'paused', paused_at = now(), updated_at = now() where id = p_release;
  perform kitluy_releases.record_release_event(
    p_release, 'RELEASE_PAUSED', v_rel.state, 'paused', btrim(p_actor_ref), null,
    jsonb_build_object('reason', p_reason), v_rel.correlation_id);
  return jsonb_build_object('outcome', 'PAUSED');
end;
$pause$;

create or replace function kitluy_releases.revoke_release_v1(
  p_release uuid, p_actor_ref text, p_approver_ref text, p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_releases, extensions
as $revoke$
declare
  v_rel kitluy_releases.release_artifacts;
begin
  select * into v_rel from kitluy_releases.release_artifacts
   where id = p_release for update;
  if not found then
    raise exception 'KLUY-RELEASE-UNKNOWN: release % does not exist', p_release using errcode = 'P0001';
  end if;
  if v_rel.state = 'revoked' then
    return jsonb_build_object('outcome', 'ALREADY_REVOKED');
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'KLUY-RELEASE-UNATTRIBUTED: revocation records its reason' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_approver_ref), '') = '' or btrim(p_approver_ref) = btrim(p_actor_ref) then
    raise exception 'KLUY-RELEASE-SELF-APPROVAL: revocation requires an independent approver'
      using errcode = 'P0001';
  end if;
  -- A NEW fact: the signed manifest columns are untouched (trigger-enforced).
  update kitluy_releases.release_artifacts
  set state = 'revoked', revocation_reason = p_reason, revoked_at = now(), updated_at = now()
  where id = p_release;
  perform kitluy_releases.record_release_event(
    p_release, 'RELEASE_REVOKED', v_rel.state, 'revoked', btrim(p_actor_ref),
    btrim(p_approver_ref), jsonb_build_object('reason', p_reason), v_rel.correlation_id);
  return jsonb_build_object('outcome', 'REVOKED');
end;
$revoke$;

create or replace function kitluy_releases.assign_release_v1(
  p_release uuid,
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_environment text,
  p_device_id uuid,
  p_idempotency_key text,
  p_actor_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_releases, kitluy_devices, extensions
as $assign$
declare
  v_rel kitluy_releases.release_artifacts;
  v_campaign uuid;
  v_existing kitluy_releases.rollout_campaigns;
begin
  select * into v_rel from kitluy_releases.release_artifacts where id = p_release;
  if not found then
    raise exception 'KLUY-RELEASE-UNKNOWN: release % does not exist', p_release using errcode = 'P0001';
  end if;
  if v_rel.state not in ('internal', 'pilot', 'stable') then
    raise exception 'KLUY-RELEASE-NOT-ELIGIBLE: a % release is not assignable', v_rel.state
      using errcode = 'P0001';
  end if;
  if v_rel.environment <> p_environment then
    raise exception 'KLUY-RELEASE-WRONG-ENVIRONMENT: release targets %, not %', v_rel.environment, p_environment
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_idempotency_key), '') = '' then
    raise exception 'KLUY-RELEASE-IDENTITY-REQUIRED: assignment carries an idempotency key'
      using errcode = 'P0001';
  end if;
  select * into v_existing from kitluy_releases.rollout_campaigns
   where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.artifact_id = p_release then
      return jsonb_build_object('outcome', 'EXISTING', 'campaign_id', v_existing.id);
    end if;
    raise exception 'KLUY-RELEASE-IDEMPOTENCY-CONFLICT: key % was used for a different assignment', p_idempotency_key
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from kitluy_devices.device_assignments a
                  where a.device_id = p_device_id
                    and a.state in ('pending_trust', 'active')
                    and a.tenant_id = p_tenant_id
                    and a.digital_store_id = p_digital_store_id) then
    raise exception 'KLUY-RELEASE-WRONG-STORE: device % is not assigned to the named Tenant and Store', p_device_id
      using errcode = 'P0001';
  end if;
  insert into kitluy_releases.rollout_campaigns
    (artifact_id, channel, tenant_id, digital_store_id, store_location_id,
     environment, idempotency_key)
  values
    (p_release, v_rel.channel, p_tenant_id, p_digital_store_id,
     p_store_location_id, p_environment, p_idempotency_key)
  returning id into v_campaign;
  insert into kitluy_releases.device_installations
    (campaign_id, device_id, desired_version)
  values (v_campaign, p_device_id, v_rel.version);
  perform kitluy_releases.record_release_event(
    p_release, 'RELEASE_ASSIGNED', v_rel.state, v_rel.state, btrim(p_actor_ref), null,
    jsonb_build_object('campaign_id', v_campaign, 'device_id', p_device_id),
    v_rel.correlation_id);
  return jsonb_build_object('outcome', 'ASSIGNED', 'campaign_id', v_campaign);
end;
$assign$;

create or replace function kitluy_releases.read_release_manifest_v1(
  p_release uuid
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, kitluy_releases
as $$
  select jsonb_build_object(
    'release_id', r.id, 'product_key', r.product_key, 'version', r.version,
    'build_id', r.build_id, 'architecture', r.architecture,
    'hardware_profile', r.hardware_profile, 'environment', r.environment,
    'channel', r.channel, 'artifact_digest_sha256', r.artifact_digest_sha256,
    'artifact_size_bytes', r.artifact_size_bytes,
    'manifest_version', r.manifest_version,
    'signing_key_id', r.signing_key_id,
    'signing_key_version', r.signing_key_version,
    'signature_b64', r.signature_b64,
    'min_schema_version', r.min_schema_version,
    'max_schema_version', r.max_schema_version,
    'config_prerequisite_version', r.config_prerequisite_version,
    'rollback_release_id', r.rollback_release_id,
    'state', r.state)
  from kitluy_releases.release_artifacts r where r.id = p_release;
$$;

-- ---------------------------------------------------------------------------
-- 6. OWNERSHIP, RLS, GRANTS
-- ---------------------------------------------------------------------------
do $own$
declare
  v_table text;
  v_fn text;
begin
  foreach v_table in array array['release_channels', 'release_artifacts',
                                 'rollout_campaigns', 'device_installations',
                                 'release_events'] loop
    execute format('alter table kitluy_releases.%I owner to kitluy_release_governor', v_table);
    execute format('alter table kitluy_releases.%I enable row level security', v_table);
    execute format('alter table kitluy_releases.%I force row level security', v_table);
    execute format('revoke all on table kitluy_releases.%I from public, anon, authenticated, service_role', v_table);
    execute format('drop policy if exists %s_governor on kitluy_releases.%I', v_table, v_table);
    execute format('create policy %s_governor on kitluy_releases.%I for all to kitluy_release_governor using (true) with check (true)', v_table, v_table);
  end loop;
  foreach v_fn in array array[
    'kitluy_releases.enforce_release_events_append_only()',
    'kitluy_releases.enforce_release_governed()',
    'kitluy_releases.record_release_event(uuid, text, text, text, text, text, jsonb, uuid)',
    'kitluy_releases.create_release_draft_v1(text, text, text, text, text, text, text, text, bigint, integer, integer, bigint, uuid, text, uuid)',
    'kitluy_releases.sign_release_v1(uuid, text, integer, text, text)',
    'kitluy_releases.promote_release_v1(uuid, text, text, text)',
    'kitluy_releases.pause_release_v1(uuid, text, text)',
    'kitluy_releases.revoke_release_v1(uuid, text, text, text)',
    'kitluy_releases.assign_release_v1(uuid, uuid, uuid, uuid, text, uuid, text, text)',
    'kitluy_releases.read_release_manifest_v1(uuid)'] loop
    execute format('alter function %s owner to kitluy_release_governor', v_fn);
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
  foreach v_fn in array array[
    'kitluy_releases.create_release_draft_v1(text, text, text, text, text, text, text, text, bigint, integer, integer, bigint, uuid, text, uuid)',
    'kitluy_releases.sign_release_v1(uuid, text, integer, text, text)',
    'kitluy_releases.promote_release_v1(uuid, text, text, text)',
    'kitluy_releases.pause_release_v1(uuid, text, text)',
    'kitluy_releases.revoke_release_v1(uuid, text, text, text)',
    'kitluy_releases.assign_release_v1(uuid, uuid, uuid, uuid, text, uuid, text, text)',
    'kitluy_releases.read_release_manifest_v1(uuid)'] loop
    execute format('grant execute on function %s to kitluy_release_service, kitluy_test_harness', v_fn);
  end loop;
end
$own$;

-- The assignment door reads device assignments (scope validation).
grant select on kitluy_devices.device_assignments to kitluy_release_governor;
drop policy if exists da_release_governor on kitluy_devices.device_assignments;
create policy da_release_governor on kitluy_devices.device_assignments
  for select to kitluy_release_governor using (true);

-- ---------------------------------------------------------------------------
-- 5. SEED (development channels for the two Phase 1 products)
-- ---------------------------------------------------------------------------
do $seed$
begin
  set local role kitluy_release_governor;
  insert into kitluy_releases.release_channels (product_key, channel_key)
  values ('kitluy-hub-agent', 'internal'), ('kitluy-hub-agent', 'pilot'),
         ('kitluy-hub-agent', 'stable'), ('kitluy-terminal', 'internal'),
         ('kitluy-terminal', 'pilot'), ('kitluy-terminal', 'stable')
  on conflict (product_key, channel_key) do nothing;
  reset role;
end
$seed$;

-- ---------------------------------------------------------------------------
-- 7. PROVE THE BOUNDARY ON APPLY
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'kitluy_releases.promote_release_v1(uuid, text, text, text)',
    'kitluy_releases.assign_release_v1(uuid, uuid, uuid, uuid, text, uuid, text, text)'] loop
    if has_function_privilege('service_role', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'KLUY-MIGRATION-0180: a runtime identity reaches % directly', v_fn;
    end if;
    if not has_function_privilege('kitluy_release_service', v_fn, 'execute') then
      raise exception 'KLUY-MIGRATION-0180: the release service cannot reach %', v_fn;
    end if;
  end loop;
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kitluy_releases' and c.relkind = 'r'
      and not (c.relrowsecurity and c.relforcerowsecurity)) then
    raise exception 'KLUY-MIGRATION-0180: a release table is missing ENABLE+FORCE RLS';
  end if;
  if not exists (select 1 from pg_roles
                  where rolname = 'kitluy_release_gateway'
                    and not rolcanlogin and not rolinherit) then
    raise exception 'KLUY-MIGRATION-0180: the release gateway is missing or mis-postured';
  end if;
  if (select count(*) from kitluy_releases.release_channels) < 6 then
    raise exception 'KLUY-MIGRATION-0180: the development channel seed is missing';
  end if;
  raise notice 'KLUY-MIGRATION-0180: signed release authority installed (manifest v1 immutable after signing, Internal -> Pilot -> Stable with no skips, Pilot/Stable behind the BLK-005 gate, revocation a new fact)';
end
$guard$;

do $hand_back$
begin
  execute format('revoke kitluy_release_governor from %I', current_user);
end
$hand_back$;
