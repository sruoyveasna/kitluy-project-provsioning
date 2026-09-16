-- kitluy:hub:migration:0004
-- ===========================================================================
-- KitLuy Store Hub local database — edge_core (§6.3).
--
-- Neutral Core rule: NO vertical-specific relation may live in edge_core
-- (§2; reconciliation R3). Bookings, garments and custody live in
-- edge_laundry.
--
-- ADDITIVE COLUMN (documented deviation, applies to every money group in
-- this migration set): §1 defines money as
--   amount_minor bigint + currency_code char(3) + currency_exponent smallint
-- but the §6 column lists omit currency_exponent everywhere. §6 explicitly
-- permits additive columns ("Implementations may add ... but may not remove
-- or repurpose listed columns"), so currency_exponent is ADDED next to every
-- currency_code. KHR exponent 0, USD exponent 2 (§1).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- edge_core.customer — scoped cache/projection; identity truth is CLOUD.
-- ---------------------------------------------------------------------------
create table edge_core.customer (
  id                uuid        primary key,
  tenant_id         uuid        not null,
  digital_store_id  uuid        not null,
  location_id       uuid        not null,
  cloud_customer_id uuid        null,
  display_name      text        not null,
  phone_e164        text        null,
  email_normalized  text        null,
  language_code     text        not null,
  consent_sms       boolean     not null default false,
  consent_email     boolean     not null default false,
  source            text        not null,
  record_version    bigint      not null default 1,
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  deleted_at        timestamptz null,
  constraint customer_record_version_ck check (record_version >= 1),
  constraint customer_phone_e164_ck check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$')
);

comment on table edge_core.customer is
  'Local customer projection (§6.3; maps to cloud kitluy_core.customers — reconciliation §2). "Local duplicate detection never auto-merges customer identity": a merge is a cloud decision replayed through the inbox.';
comment on column edge_core.customer.deleted_at is
  'Soft delete only. §1 forbids hard delete of finalized business records; the no-hard-delete trigger is attached in 0012.';

-- ---------------------------------------------------------------------------
-- edge_core.customer_identifier — scoped. Hashed + masked values only.
-- ---------------------------------------------------------------------------
create table edge_core.customer_identifier (
  id                    uuid        primary key,
  tenant_id             uuid        not null,
  digital_store_id      uuid        not null,
  location_id           uuid        not null,
  customer_id           uuid        not null references edge_core.customer (id),
  identifier_type       text        not null,
  normalized_value_hash char(64)    not null,
  masked_value          text        not null,
  verified_at           timestamptz null,
  created_at            timestamptz not null,
  constraint customer_identifier_uq
    unique (location_id, identifier_type, normalized_value_hash, customer_id),
  constraint customer_identifier_hash_ck check (normalized_value_hash ~ '^[0-9a-f]{64}$')
);

comment on table edge_core.customer_identifier is
  'Hashed + masked contact identifiers (§6.3; maps to cloud kitluy_core.customer_contacts). The Hub stores NO raw contact value — only a lowercase-hex SHA-256 and a display mask.';

-- ---------------------------------------------------------------------------
-- edge_core.business_sequence — Location-scoped by primary key. The canonical
-- column list defines location_id only; tenant/store are implied by the
-- Hub's single active assignment, so no additional scope columns are added.
-- ---------------------------------------------------------------------------
create table edge_core.business_sequence (
  location_id           uuid        not null,
  sequence_code         text        not null,
  business_date         date        not null,
  next_value            bigint      not null,
  allocation_generation integer     not null,
  updated_at            timestamptz not null,
  primary key (location_id, sequence_code, business_date),
  constraint business_sequence_next_value_ck check (next_value >= 1)
);

comment on table edge_core.business_sequence is
  'Display-number allocator state (§6.3). "Updated only by a serializable stored procedure" — edge_core.allocate_business_number() in 0013. Profiles: Appendix B / offline contract §14.1.';

-- ---------------------------------------------------------------------------
-- edge_core.shift — scoped.
-- ---------------------------------------------------------------------------
create table edge_core.shift (
  id                  uuid        primary key,
  tenant_id           uuid        not null,
  digital_store_id    uuid        not null,
  location_id         uuid        not null,
  terminal_device_id  uuid        not null references edge_identity.terminal_device (id),
  actor_id            uuid        not null,
  business_date       date        not null,
  opened_at           timestamptz not null,
  closed_at           timestamptz null,
  opening_float_minor bigint      not null,
  currency_code       char(3)     not null,
  currency_exponent   smallint    not null,
  expected_cash_minor bigint      null,
  counted_cash_minor  bigint      null,
  variance_minor      bigint      null,
  status              text        not null,
  close_approval_id   uuid        null,
  constraint shift_currency_ck check (currency_code ~ '^[A-Z]{3}$'),
  constraint shift_exponent_ck check (currency_exponent between 0 and 4),
  constraint shift_float_ck check (opening_float_minor >= 0),
  constraint shift_window_ck check (closed_at is null or closed_at >= opened_at),
  constraint shift_variance_ck
    check (variance_minor is null
           or (expected_cash_minor is not null and counted_cash_minor is not null
               and variance_minor = counted_cash_minor - expected_cash_minor))
);

comment on table edge_core.shift is
  'Cash shift (§6.3). Money is integer minor units + currency_code + currency_exponent (§1); no floating point anywhere (repository rule 12).';
