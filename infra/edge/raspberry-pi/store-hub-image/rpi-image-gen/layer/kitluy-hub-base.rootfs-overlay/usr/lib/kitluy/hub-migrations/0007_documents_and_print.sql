-- kitluy:hub:migration:0007
-- ===========================================================================
-- KitLuy Store Hub local database — edge_documents (§6.6, 3 relations).
--
-- Reconciliation G5: the master build plan's `print_jobs` naming is planning
-- shorthand. The canonical contract governs: edge_documents.print_job. There
-- is NO edge_print schema — print concerns live in edge_documents (§2).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- edge_documents.receipt
-- ---------------------------------------------------------------------------
create table edge_documents.receipt (
  id               uuid        primary key,
  tenant_id        uuid        not null,
  digital_store_id uuid        not null,
  location_id      uuid        not null,
  booking_id       uuid        not null references edge_laundry.booking (id),
  payment_id       uuid        null references edge_payments.payment (id),
  receipt_number   text        not null,
  document_type    text        not null,
  template_version bigint      not null,
  content_sha256   char(64)    not null,
  render_asset_id  uuid        null,
  issued_at        timestamptz not null,
  issued_by        uuid        not null,
  reprint_of_id    uuid        null references edge_documents.receipt (id),
  reprint_reason   text        null,
  event_id         uuid        not null unique,
  constraint receipt_number_uq unique (location_id, receipt_number),
  constraint receipt_content_hash_ck check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint receipt_reprint_ck check ((reprint_of_id is null) = (reprint_reason is null))
);

comment on table edge_documents.receipt is
  'Issued document (§6.6). Display profile KLR-{LOCATION_CODE}-{YYMMDD}-{SEQ6} (Appendix B) — an operational reference, NOT a Cambodia statutory fiscal-number declaration. An intentional reprint is a NEW row carrying reprint_of_id, actor and reason (offline contract §11.2); a retry is not a reprint. render_asset_id references edge_files.asset; the FK is added in 0012 (§4 order).';

-- ---------------------------------------------------------------------------
-- edge_documents.print_job
-- ---------------------------------------------------------------------------
create table edge_documents.print_job (
  id                       uuid                        primary key,
  tenant_id                uuid                        not null,
  digital_store_id         uuid                        not null,
  location_id              uuid                        not null,
  document_type            text                        not null,
  document_id              uuid                        not null,
  printer_binding_id       uuid                        not null references edge_config.peripheral_binding (id),
  template_version         bigint                      not null,
  payload_sha256           char(64)                    not null,
  copies                   smallint                    not null default 1,
  duplicate_suppression_key text                       not null unique,
  state                    edge_documents.print_state  not null,
  priority                 smallint                    not null default 0,
  created_at               timestamptz                 not null,
  next_attempt_at          timestamptz                 not null,
  attempt_count            integer                     not null default 0,
  last_error_code          text                        null,
  created_by               uuid                        not null,
  terminal_device_id       uuid                        not null references edge_identity.terminal_device (id),
  constraint print_job_copies_ck check (copies >= 1),
  constraint print_job_attempts_ck check (attempt_count >= 0),
  constraint print_job_payload_hash_ck check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  -- Offline contract §11.1:
  --   print1.{document_id}.{document_version}.{printer_binding_id}.{copy_index}
  constraint print_job_suppression_key_ck
    check (edge_documents.is_canonical_suppression_key(duplicate_suppression_key))
);

comment on table edge_documents.print_job is
  'Durable deduplicated print job (§6.6, §7). Retrying a failed job reuses the SAME job id and suppression key; an intentional reprint creates a new job id and a new key (offline contract §11).';

-- ---------------------------------------------------------------------------
-- edge_documents.print_attempt — job-scoped (no separate scope columns in the
-- canonical column list; scope is inherited from print_job_id).
-- ---------------------------------------------------------------------------
create table edge_documents.print_attempt (
  id                     uuid        primary key,
  print_job_id           uuid        not null references edge_documents.print_job (id),
  attempt_number         integer     not null,
  started_at             timestamptz not null,
  completed_at           timestamptz null,
  adapter_version        text        not null,
  printer_observation_id uuid        null,
  result                 text        not null,
  error_code             text        null,
  bytes_sent             bigint      null,
  constraint print_attempt_number_uq unique (print_job_id, attempt_number),
  constraint print_attempt_number_ck check (attempt_number >= 1),
  constraint print_attempt_window_ck check (completed_at is null or completed_at >= started_at),
  constraint print_attempt_bytes_ck check (bytes_sent is null or bytes_sent >= 0)
);

comment on table edge_documents.print_attempt is
  'One dispatch attempt of a print job (§6.6). printer_observation_id references edge_hardware.peripheral_observation; the FK is added in 0012 (§4 order).';
