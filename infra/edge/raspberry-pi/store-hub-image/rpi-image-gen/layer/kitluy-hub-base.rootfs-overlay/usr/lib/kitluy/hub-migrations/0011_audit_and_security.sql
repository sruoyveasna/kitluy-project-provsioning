-- kitluy:hub:migration:0011
-- ===========================================================================
-- KitLuy Store Hub local database — edge_audit (§6.10, 3 relations).
--
-- Mapping: cloud kitluy_audit.audit_logs <-> edge_audit.audit_event; both
-- immutable (reconciliation §2). Retention: entire active Location retention;
-- archive only through signed policy (§10).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- edge_audit.audit_event — IMMUTABLE (§6.10).
-- ---------------------------------------------------------------------------
create table edge_audit.audit_event (
  id                 uuid        primary key,
  tenant_id          uuid        not null,
  digital_store_id   uuid        not null,
  location_id        uuid        not null,
  event_code         text        not null,
  actor_type         text        not null,
  actor_id           uuid        null,
  requester_id       uuid        null,
  approver_id        uuid        null,
  terminal_device_id uuid        null references edge_identity.terminal_device (id),
  hub_device_id      uuid        not null references edge_identity.hub_device (id),
  profile_code       text        null,
  resource_type      text        not null,
  resource_id        uuid        null,
  reason_code        text        null,
  correlation_id     uuid        not null,
  occurred_at        timestamptz not null,
  payload_sha256     char(64)    not null,
  details_json       jsonb       not null default '{}'::jsonb,
  local_sequence     bigint      not null unique,
  constraint audit_event_sequence_ck check (local_sequence >= 1),
  constraint audit_event_payload_hash_ck check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  -- Four-eyes evidence can never name one person as both sides (@kitluy/approvals
  -- rule; repository rule 7 forbids relaxing it).
  constraint audit_event_four_eyes_ck
    check (requester_id is null or approver_id is null or requester_id <> approver_id)
);

comment on table edge_audit.audit_event is
  'Immutable privileged/business audit journal (§6.10). UPDATE/DELETE rejected by the trigger in 0012. details_json carries redacted evidence only — never a raw secret, credential or unmasked contact value.';

-- ---------------------------------------------------------------------------
-- edge_audit.security_event — scope columns NULLABLE for pre-assignment
-- events (§6.10 verbatim: "scope columns nullable for pre-assignment
-- events"). A security event can occur before a Hub is assigned to a
-- Location, so a NOT NULL scope would make it unrecordable.
-- ---------------------------------------------------------------------------
create table edge_audit.security_event (
  id                 uuid        primary key,
  tenant_id          uuid        null,
  digital_store_id   uuid        null,
  location_id        uuid        null,
  event_code         text        not null,
  severity           text        not null,
  device_id          uuid        null,
  certificate_serial text        null,
  source_ip          inet        null,
  detected_at        timestamptz not null,
  details_json       jsonb       not null default '{}'::jsonb,
  acknowledged_by    uuid        null,
  acknowledged_at    timestamptz null,
  cloud_synced_at    timestamptz null,
  constraint security_event_ack_ck check ((acknowledged_at is null) = (acknowledged_by is null))
);

comment on table edge_audit.security_event is
  'Security/integrity incidents (§6.10). Scope columns are NULLABLE by contract: an unpaired or pre-assignment device still emits security evidence. Sources include EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH (offline contract §3), restored-event hash mismatch (§19) and clock anomalies (§16).';

-- ---------------------------------------------------------------------------
-- edge_audit.support_session
-- ---------------------------------------------------------------------------
create table edge_audit.support_session (
  id                  uuid        primary key,
  tenant_id           uuid        not null,
  digital_store_id    uuid        not null,
  location_id         uuid        not null,
  support_actor_id    uuid        not null,
  approved_by         uuid        not null,
  reason              text        not null,
  scopes              text[]      not null default '{}',
  started_at          timestamptz not null,
  expires_at          timestamptz not null,
  revoked_at          timestamptz null,
  status              text        not null,
  consent_evidence_id uuid        not null,
  session_public_key  bytea       not null,
  last_activity_at    timestamptz null,
  constraint support_session_window_ck check (expires_at > started_at),
  constraint support_session_four_eyes_ck check (support_actor_id <> approved_by)
);

comment on table edge_audit.support_session is
  'Consent-bound diagnostic session (§6.10; role kitluy_support_ro, §3 "redacted views only; no business writes"). Four-eyes: the support actor can never be their own approver. session_public_key is a PUBLIC key only — no private key or secret is ever stored (repository rule 4).';
