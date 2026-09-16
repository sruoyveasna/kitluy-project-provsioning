-- kitluy:hub:migration:0027
-- ===========================================================================
-- Store Hub local database — trusted snapshot signing keys, and durable
-- persistence of signed revocation snapshots.
--
-- Authority: KLD-2026-07-31-HUB-SNAPSHOT-SIGNING-001 (owner-locked);
-- KLD-2026-07-28-002 §6.1 (a locally known revocation is enforced immediately)
-- and §6.7 (no stale snapshot may be represented as current);
-- WS-11-T003 Step 4 §6/§7.
--
-- ===========================================================================
-- WHAT THIS CLOSES
-- ===========================================================================
-- The cloud now produces scope-isolated, Ed25519-signed snapshots (cloud groups
-- 0156 and the registry service's signer). Nothing on the Hub could hold one.
-- Offline containment was therefore still absent: a Hub that lost connectivity
-- enforced nothing, because there was nowhere for a revocation to have been
-- written down.
--
-- ===========================================================================
-- PUBLIC HALVES ONLY
-- ===========================================================================
-- `revocation_trust_key.public_key_pem` is a PUBLIC key. The Hub never holds a
-- signing private key, and there is deliberately no column that could carry one:
-- a Hub is a physically reachable device in a shop, and a private key on it is a
-- private key an attacker can walk out with.
--
-- ===========================================================================
-- LAST-KNOWN-GOOD IS A ROW, NOT A BACKUP
-- ===========================================================================
-- A rejected update must not disturb what the Hub already enforces. That is
-- modelled structurally: an arriving snapshot is written `staged`, verified, and
-- only then PROMOTED. A partial unique index keeps at most one `active` snapshot
-- per scope, so promotion is a single atomic statement pair inside one
-- transaction, and a failure anywhere leaves the previous `active` row exactly
-- where it was. Nothing is deleted; superseded rows become history.

-- ---------------------------------------------------------------------------
-- 1. TRUSTED SIGNING KEYS
-- ---------------------------------------------------------------------------
create table edge_config.revocation_trust_key (
  key_id            text        not null,
  key_version       integer     not null,
  algorithm         text        not null,
  public_key_pem    text        not null,
  -- `current` signs today; `next` is pre-provisioned so a rotation needs no Hub
  -- visit; `revoked` is refused outright even when its signature is good.
  state             text        not null,
  activated_at      timestamptz not null,
  retired_at        timestamptz null,
  revoked_at        timestamptz null,
  provisioned_at    timestamptz not null default now(),

  constraint revocation_trust_key_pk primary key (key_id, key_version),
  -- Owner-locked algorithm. A second algorithm is a decision, not a config value.
  constraint revocation_trust_key_algorithm_ck check (algorithm = 'ed25519'),
  constraint revocation_trust_key_state_ck
    check (state in ('current', 'next', 'revoked')),
  constraint revocation_trust_key_version_ck check (key_version >= 1),
  -- A PUBLIC key, and the shape is checked so a private key cannot be pasted in
  -- by mistake. This is a guard against an operator error, not against an
  -- attacker who already has write access.
  constraint revocation_trust_key_public_only_ck
    check (public_key_pem like '%PUBLIC KEY%' and public_key_pem not like '%PRIVATE%'),
  constraint revocation_trust_key_revoked_ck
    check ((state = 'revoked') = (revoked_at is not null)),
  constraint revocation_trust_key_retirement_ck
    check (retired_at is null or retired_at > activated_at)
);

comment on table edge_config.revocation_trust_key is
  'Trusted PUBLIC keys for revocation-snapshot signatures (KLD-2026-07-31-HUB-SNAPSHOT-SIGNING-001). current/next support bounded rotation without a Hub visit; revoked is refused even when the signature verifies. The Hub never holds a private signing key and has no column for one.';

-- ---------------------------------------------------------------------------
-- 2. PERSISTED SNAPSHOTS
-- ---------------------------------------------------------------------------
create table edge_config.revocation_snapshot (
  id                  uuid        primary key,
  tenant_id           uuid        not null,
  digital_store_id    uuid        not null,
  store_location_id   uuid        not null,
  environment         text        not null,
  hub_device_id       uuid        not null,
  schema_version      integer     not null,
  snapshot_version    bigint      not null,
  sequence_no         bigint      not null,
  revocation_watermark text       not null,
  generated_at        timestamptz not null,
  effective_at        timestamptz not null,
  -- The exact bytes that were verified, kept so a restart re-verifies rather
  -- than trusting a parse from last time.
  canonical_sha256    char(64)    not null,
  signing_key_id      text        not null,
  signing_key_version integer     not null,
  signature_b64       text        not null,
  state               text        not null,
  applied_at          timestamptz null,
  superseded_at       timestamptz null,
  received_at         timestamptz not null default now(),

  constraint revocation_snapshot_state_ck
    check (state in ('staged', 'active', 'superseded', 'rejected')),
  constraint revocation_snapshot_sequence_ck check (sequence_no >= 0),
  constraint revocation_snapshot_version_ck check (snapshot_version >= 1),
  constraint revocation_snapshot_digest_ck check (canonical_sha256 ~ '^[0-9a-f]{64}$'),
  -- `applied_at` records that the row WAS promoted, so a superseded row keeps
  -- it: it was active once, and an incident asks when. The first version of this
  -- constraint was an equality, which made demotion impossible — the row became
  -- `superseded` while `applied_at` was still set and the check refused.
  constraint revocation_snapshot_applied_ck
    check (
      (state in ('staged', 'rejected') and applied_at is null)
      or (state in ('active', 'superseded') and applied_at is not null)
    ),
  constraint revocation_snapshot_superseded_ck
    check ((state = 'superseded') = (superseded_at is not null)),
  constraint revocation_snapshot_key_fk
    foreign key (signing_key_id, signing_key_version)
    references edge_config.revocation_trust_key (key_id, key_version)
);

-- AT MOST ONE ACTIVE SNAPSHOT PER SCOPE. This is what makes promotion atomic and
-- last-known-good automatic: the previous row must be demoted in the same
-- statement pair, inside one transaction, or the index refuses.
create unique index revocation_snapshot_one_active
  on edge_config.revocation_snapshot
     (tenant_id, digital_store_id, store_location_id, environment)
  where state = 'active';

-- A delivery is identified by its scope and sequence, so a duplicate arrival is
-- a conflict rather than a second row.
create unique index revocation_snapshot_scope_sequence
  on edge_config.revocation_snapshot
     (tenant_id, digital_store_id, store_location_id, environment, sequence_no);

comment on table edge_config.revocation_snapshot is
  'Signed revocation snapshots as received. staged -> active on verification; the previous active becomes superseded in the same transaction. A rejected or failed update never removes the last-known-good row, which is why nothing is deleted here.';

-- ---------------------------------------------------------------------------
-- 3. THE REVOKED IDENTIFIERS
-- ---------------------------------------------------------------------------
create table edge_config.revocation_snapshot_entry (
  snapshot_id   uuid  not null references edge_config.revocation_snapshot (id),
  entry_kind    text  not null,
  identifier    text  not null,
  constraint revocation_snapshot_entry_pk primary key (snapshot_id, entry_kind, identifier),
  constraint revocation_snapshot_entry_kind_ck
    check (entry_kind in ('certificate_serial', 'device_record'))
);

comment on table edge_config.revocation_snapshot_entry is
  'The revoked identifiers carried by one snapshot. Scoped by its parent, so a lookup can never see another scope entries.';

-- ---------------------------------------------------------------------------
-- 4. THE OFFLINE LOOKUP
-- ---------------------------------------------------------------------------
-- What the credential verifier asks while the Hub is offline. Reads the ACTIVE
-- snapshot for the Hub own scope and nothing else.
--
-- Returns TRUE when the serial is revoked. A Hub with NO snapshot returns FALSE
-- here, and that is not a silent fail-open: the caller must consult
-- `edge_config.revocation_state_v1` first, which reports whether any snapshot is
-- held at all. Splitting the two keeps "not revoked" and "we do not know"
-- distinguishable, which a single boolean cannot express.
--
-- ===========================================================================
-- THE ENFORCED SET ONLY EVER GROWS
-- ===========================================================================
-- `state in ('active','superseded')`, NOT `active` alone.
--
-- Reading only the active snapshot was the first version and it was wrong in the
-- one way that matters: a newer, correctly signed, correctly scoped, sequence-
-- advancing snapshot that simply OMITS a serial would silently un-revoke it. That
-- is precisely the "cloud reconnection restores a revoked credential" failure the
-- offline design exists to prevent, and it would have arrived through the
-- legitimate update path rather than an attack.
--
-- Decision §2.4 RULING 3 makes revocation IRREVERSIBLE. A Hub that has once been
-- told a credential is revoked has learned something that cannot later become
-- untrue, so every snapshot it has ACCEPTED keeps contributing. `staged` and
-- `rejected` are excluded because they were never accepted.
--
-- The cost is accepted and is the correct direction to fail: a serial revoked in
-- error stays refused at this Hub until the credential is replaced.
create or replace function edge_config.is_certificate_revoked_offline_v1(
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_environment text,
  p_serial_number text
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, edge_config
as $offline_revoked$
  select exists (
    select 1
      from edge_config.revocation_snapshot s
      join edge_config.revocation_snapshot_entry e on e.snapshot_id = s.id
     where s.state in ('active', 'superseded')
       and s.tenant_id = p_tenant_id
       and s.digital_store_id = p_digital_store_id
       and s.store_location_id = p_store_location_id
       and s.environment = p_environment
       and e.entry_kind = 'certificate_serial'
       and e.identifier = p_serial_number);
$offline_revoked$;

comment on function edge_config.is_certificate_revoked_offline_v1(uuid, uuid, uuid, text, text) is
  'Offline revocation answer for ONE scope across every ACCEPTED snapshot (active and superseded), because decision §2.4 RULING 3 makes revocation irreversible and a newer snapshot that omitted a serial would otherwise un-revoke it. FALSE means not listed, NOT "no snapshot" — callers must read revocation_state_v1 to tell those apart.';

-- Whether the Hub holds anything, and how old it is. Lets a caller report stale
-- state honestly instead of presenting an old snapshot as current cloud truth.
create or replace function edge_config.revocation_state_v1(
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_environment text
) returns table (
  has_snapshot boolean,
  sequence_no bigint,
  snapshot_version bigint,
  generated_at timestamptz,
  revocation_watermark text,
  entry_count bigint
)
language sql
stable
security definer
set search_path = pg_catalog, edge_config
as $state$
  select s.id is not null,
         s.sequence_no,
         s.snapshot_version,
         s.generated_at,
         s.revocation_watermark,
         (select count(*) from edge_config.revocation_snapshot_entry e
           where e.snapshot_id = s.id and e.entry_kind = 'certificate_serial')
    from edge_config.revocation_snapshot s
   where s.state = 'active'
     and s.tenant_id = p_tenant_id
     and s.digital_store_id = p_digital_store_id
     and s.store_location_id = p_store_location_id
     and s.environment = p_environment;
$state$;

comment on function edge_config.revocation_state_v1(uuid, uuid, uuid, text) is
  'What the Hub currently holds for one scope: sequence, version, generation time and watermark. Returns NO ROWS when nothing is held, which is how a caller distinguishes "not revoked" from "we have never been told".';

-- ---------------------------------------------------------------------------
-- 5. GRANTS
-- ---------------------------------------------------------------------------
grant select, insert, update on edge_config.revocation_trust_key to kitluy_hub_runtime;
grant select, insert, update on edge_config.revocation_snapshot to kitluy_hub_runtime;
grant select, insert on edge_config.revocation_snapshot_entry to kitluy_hub_runtime;
grant execute on function
  edge_config.is_certificate_revoked_offline_v1(uuid, uuid, uuid, text, text)
  to kitluy_hub_runtime;
grant execute on function
  edge_config.revocation_state_v1(uuid, uuid, uuid, text)
  to kitluy_hub_runtime;

-- The sync worker DELIVERS snapshots and must be able to stage one, but it may
-- not promote: promotion happens only after signature and scope verification in
-- the command layer, and a worker that could flip `state` directly could make an
-- unverified snapshot active.
grant select, insert on edge_config.revocation_snapshot to kitluy_sync_worker;
grant select, insert on edge_config.revocation_snapshot_entry to kitluy_sync_worker;
grant select on edge_config.revocation_trust_key to kitluy_sync_worker;

