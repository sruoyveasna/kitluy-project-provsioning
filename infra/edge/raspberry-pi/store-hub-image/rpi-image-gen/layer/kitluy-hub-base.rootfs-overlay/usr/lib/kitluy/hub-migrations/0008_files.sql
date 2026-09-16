-- kitluy:hub:migration:0008
-- ===========================================================================
-- KitLuy Store Hub local database — edge_files (§6.7, 3 relations).
--
-- Companion contract: kitluy-storehub-file-cache-and-transfer-protocol-v1.0.0.
-- Chunk identity is (asset_id, chunk_number, chunk_sha256): a re-sent matching
-- chunk succeeds, a re-sent chunk number with a DIFFERENT hash is rejected
-- (offline contract §13).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- edge_files.asset
-- ---------------------------------------------------------------------------
create table edge_files.asset (
  id                       uuid                       primary key,
  tenant_id                uuid                       not null,
  digital_store_id         uuid                       not null,
  location_id              uuid                       not null,
  asset_class              text                       not null,
  owner_type               text                       not null,
  owner_id                 uuid                       not null,
  mime_type                text                       not null,
  size_bytes               bigint                     not null,
  sha256                   char(64)                   not null,
  local_relative_path      text                       not null,
  encryption_key_generation integer                   not null,
  retention_class          text                       not null,
  state                    edge_files.transfer_state  not null,
  cloud_object_key         text                       null,
  cloud_etag               text                       null,
  created_at               timestamptz                not null,
  uploaded_at              timestamptz                null,
  verified_at              timestamptz                null,
  evicted_at               timestamptz                null,
  constraint asset_dedupe_uq unique (location_id, sha256, owner_type, owner_id, asset_class),
  constraint asset_size_ck check (size_bytes >= 0),
  constraint asset_sha256_ck check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint asset_local_path_ck check (local_relative_path !~ '^/' and local_relative_path !~ '\.\.')
);

comment on table edge_files.asset is
  'Local asset metadata (§6.7). The dedupe unique key applies "where policy permits dedupe"; local_relative_path is constrained to a relative, traversal-free path so a cached asset can never escape the Hub asset root.';

-- ---------------------------------------------------------------------------
-- edge_files.asset_chunk — asset-scoped by primary key (canonical column list
-- defines no scope columns; scope is inherited from asset_id).
-- ---------------------------------------------------------------------------
create table edge_files.asset_chunk (
  asset_id     uuid        not null references edge_files.asset (id),
  chunk_number integer     not null,
  offset_bytes bigint      not null,
  size_bytes   integer     not null,
  sha256       char(64)    not null,
  received     boolean     not null default false,
  uploaded     boolean     not null default false,
  updated_at   timestamptz not null,
  primary key (asset_id, chunk_number),
  constraint asset_chunk_number_ck check (chunk_number >= 0),
  constraint asset_chunk_offset_ck check (offset_bytes >= 0),
  constraint asset_chunk_size_ck check (size_bytes > 0),
  constraint asset_chunk_sha256_ck check (sha256 ~ '^[0-9a-f]{64}$')
);

comment on table edge_files.asset_chunk is
  'Resumable transfer chunk state (§6.7). Offline contract §13: chunk identity is (asset_id, chunk_number, chunk_sha256) — a re-sent matching chunk is a success, a differing hash for the same chunk number is a rejection.';

-- ---------------------------------------------------------------------------
-- edge_files.file_transfer_job
-- ---------------------------------------------------------------------------
create table edge_files.file_transfer_job (
  id                uuid                       primary key,
  tenant_id         uuid                       not null,
  digital_store_id  uuid                       not null,
  location_id       uuid                       not null,
  asset_id          uuid                       not null references edge_files.asset (id),
  direction         text                       not null,
  state             edge_files.transfer_state  not null,
  remote_session_id text                       null,
  next_chunk_number integer                    not null default 0,
  attempt_count     integer                    not null default 0,
  next_attempt_at   timestamptz                not null,
  last_error_code   text                       null,
  created_at        timestamptz                not null,
  updated_at        timestamptz                not null,
  constraint file_transfer_job_direction_ck check (direction in ('upload', 'download')),
  constraint file_transfer_job_chunk_ck check (next_chunk_number >= 0),
  constraint file_transfer_job_attempts_ck check (attempt_count >= 0)
);

comment on table edge_files.file_transfer_job is
  'Resumable upload/download job (§6.7). The upload queue index (state, next_attempt_at) is created in 0012 (§8).';
