-- kitluy:hub:migration:0038
-- ===========================================================================
-- KitLuy Store Hub local database — release trust registry and artifact
-- cache.
--
-- WS-11-T006-P03 (KLD-2026-08-06-WS11-T006-001 §5). Authority: release
-- policy §9 ("Hub verifies signature, digest, channel eligibility and
-- compatibility"; "Hub reports staged, active, failed, rolled-back and
-- rejected states"); cloud group 0180 (the signed authority these rows
-- mirror); hub group 0027 (the trusted-PUBLIC-key registry pattern this
-- copies verbatim, including the no-PRIVATE-material CHECK).
--
-- WHY A NEW GROUP: a Hub must verify a release with keys IT holds and cache
-- the artifact through WAN loss and restart — durable relational state, not
-- process memory. Object-storage metadata is never authority; these rows
-- record what the Hub itself verified.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Trusted release-signing PUBLIC keys (mirror of 0027).
-- ---------------------------------------------------------------------------
create table edge_config.release_trust_key (
  key_id         text        not null,
  key_version    integer     not null,
  algorithm      text        not null,
  public_key_pem text        not null,
  state          text        not null,
  activated_at   timestamptz not null,
  retired_at     timestamptz null,
  revoked_at     timestamptz null,
  provisioned_at timestamptz not null default now(),
  constraint release_trust_key_pk primary key (key_id, key_version),
  constraint release_trust_key_algorithm_ck check (algorithm = 'ed25519'),
  constraint release_trust_key_state_ck check (state in ('current', 'next', 'revoked')),
  constraint release_trust_key_version_ck check (key_version >= 1),
  constraint release_trust_key_public_only_ck
    check (public_key_pem like '%PUBLIC KEY%' and public_key_pem not like '%PRIVATE%'),
  constraint release_trust_key_revoked_ck check ((state = 'revoked') = (revoked_at is not null))
);

comment on table edge_config.release_trust_key is
  'WS-11-T006-P03. Trusted release-manifest signing PUBLIC keys (0027 pattern; owner decision §5: Ed25519). A Hub never holds a signing private key — structurally refused by the public-only CHECK. MC: MUT (runtime provisioning, rotation via next->current).';

-- ---------------------------------------------------------------------------
-- 2. Release artifact cache — what THIS Hub verified and holds.
-- ---------------------------------------------------------------------------
create table edge_config.release_cache (
  id                        uuid        primary key,
  tenant_id                 uuid        not null,
  digital_store_id          uuid        not null,
  location_id               uuid        not null,
  product_key               text        not null,
  version                   text        not null,
  build_id                  text        not null,
  architecture              text        not null,
  hardware_profile          text        not null,
  environment               text        not null,
  channel                   text        not null,
  artifact_digest_sha256    char(64)    not null,
  artifact_size_bytes       bigint      not null,
  manifest_version          integer     not null,
  signing_key_id            text        not null,
  signing_key_version       integer     not null,
  signature_b64             text        not null,
  min_schema_version        integer     not null,
  max_schema_version        integer     not null,
  config_prerequisite_version bigint    not null default 0,
  rollback_release_id       uuid        null,
  state                     text        not null default 'assigned',
  refusal_code              text        null,
  bytes_downloaded          bigint      not null default 0,
  artifact_local_path       text        null,
  received_at               timestamptz not null default now(),
  verified_at               timestamptz null,
  cached_at                 timestamptz null,
  updated_at                timestamptz not null default now(),
  constraint release_cache_state_ck
    check (state in ('assigned', 'verified', 'downloading', 'cached', 'rejected')),
  constraint release_cache_channel_ck check (channel in ('internal', 'pilot', 'stable')),
  constraint release_cache_digest_ck check (artifact_digest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint release_cache_manifest_ck check (manifest_version = 1),
  constraint release_cache_size_ck check (artifact_size_bytes > 0),
  constraint release_cache_bytes_ck
    check (bytes_downloaded >= 0 and bytes_downloaded <= artifact_size_bytes),
  constraint release_cache_rejected_ck check ((state = 'rejected') = (refusal_code is not null)),
  constraint release_cache_signer_fk
    foreign key (signing_key_id, signing_key_version)
    references edge_config.release_trust_key (key_id, key_version)
);

comment on table edge_config.release_cache is
  'WS-11-T006-P03. Per-release verification and cache state: assigned -> verified -> downloading -> cached, or rejected with the exact refusal. The signer FK means an UNKNOWN key cannot even be staged; verification itself is the closed TS verifier (@kitluy/device-identity release-manifest). bytes_downloaded makes interrupted downloads resumable; nothing here trusts object-storage metadata. MC: MUT (runtime via doors).';

create index edge_config_release_cache_scope_idx
  on edge_config.release_cache (tenant_id, digital_store_id, location_id);

comment on index edge_config.edge_config_release_cache_scope_idx is
  'Schema-contract §8 scope index.';

-- Forward-only state machine backstop.
create or replace function edge_config.release_cache_forward_only()
returns trigger
language plpgsql
as $$
declare
  v_rank_old integer;
  v_rank_new integer;
begin
  if old.state = 'rejected' and new.state <> 'rejected' then
    raise exception 'KLUY-EDGE-RELEASE-REJECTED-FINAL: a rejected release does not recover; a NEW signed release supersedes it'
      using errcode = 'P0001';
  end if;
  v_rank_old := case old.state when 'assigned' then 1 when 'verified' then 2
                               when 'downloading' then 3 when 'cached' then 4
                               else 5 end;
  v_rank_new := case new.state when 'assigned' then 1 when 'verified' then 2
                               when 'downloading' then 3 when 'cached' then 4
                               else 5 end;
  if new.state <> 'rejected' and v_rank_new < v_rank_old then
    raise exception 'KLUY-EDGE-RELEASE-STATE-BACKWARDS: % -> % is not a forward cache transition', old.state, new.state
      using errcode = 'P0001';
  end if;
  if new.bytes_downloaded < old.bytes_downloaded then
    raise exception 'KLUY-EDGE-RELEASE-DOWNLOAD-BACKWARDS: resumed downloads only ever advance'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger release_cache_forward_only
  before update on edge_config.release_cache
  for each row execute function edge_config.release_cache_forward_only();

-- No hard delete: superseded releases are retained until retention policy
-- (a later operations concern) — history is evidence.
create or replace function edge_config.release_cache_no_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'KLUY-EDGE-RELEASE-NO-DELETE: cache rows are superseded, never deleted'
    using errcode = 'P0001';
end;
$$;

create trigger release_cache_no_delete
  before delete on edge_config.release_cache
  for each row execute function edge_config.release_cache_no_delete();

-- ---------------------------------------------------------------------------
-- 3. Grants — the runtime verifies/downloads; sync reads; support via views.
-- ---------------------------------------------------------------------------
grant select, insert, update on edge_config.release_trust_key to kitluy_hub_runtime;
grant select on edge_config.release_trust_key to kitluy_sync_worker;
grant select, insert, update on edge_config.release_cache to kitluy_hub_runtime;
grant select on edge_config.release_cache to kitluy_sync_worker;

-- ---------------------------------------------------------------------------
-- 4. Guard.
-- ---------------------------------------------------------------------------
do $guard$
begin
  if not exists (select 1 from pg_indexes
                  where schemaname = 'edge_config'
                    and indexname = 'edge_config_release_cache_scope_idx') then
    raise exception 'KLUY-HUB-MIGRATION-0038: the release cache scope index is missing';
  end if;
  if (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where not t.tgisinternal
         and t.tgname in ('release_cache_forward_only', 'release_cache_no_delete')) <> 2 then
    raise exception 'KLUY-HUB-MIGRATION-0038: the cache integrity triggers are missing';
  end if;
  begin
    insert into edge_config.release_trust_key
      (key_id, key_version, algorithm, public_key_pem, state, activated_at)
    -- Probe with PRIVATE material markers only (0027 house style) so the
    -- repository secret scanner never sees a contiguous key-block header.
    values ('probe', 1, 'ed25519', '-----BEGIN PUBLIC KEY----- PRIVATE probe', 'current', now());
    raise exception 'KLUY-HUB-MIGRATION-0038: a PRIVATE key was accepted into the trust registry';
  exception
    when check_violation then null;
    when raise_exception then raise;
  end;
  raise notice 'KLUY-HUB-MIGRATION-0038: release trust registry and verified artifact cache installed (public keys only, forward-only states, resumable downloads)';
end
$guard$;
