-- ===========================================================================
-- KitLuy Store Hub LOCAL development fixtures — SYNTHETIC DATA ONLY.
--
-- Authority: docs/source/offline/kitluy-storehub-local-database-schema-v1.0.0.md
--   (§6 catalogue, §12 acceptance tests), kitluy-offline-idempotency-and-
--   sequencing-v1.0.0.md (§2 key format, §4 acceptance algorithm, §19 errors),
--   docs/data/kitluy-storehub-local-schema-reconciliation-v1.0.0.md (G1-G8),
--   KLD-2026-07-26-002 Group 2 (canonical dotted logical profiles).
--
-- Every name, phone, code, hash and key below is FICTIONAL. No real person,
-- no real Store, no credential, no secret, no provider token. Hashes are
-- computed with sha256() over fixture-only strings so they are deterministic
-- and obviously synthetic.
--
-- IDEMPOTENT: fixed identifiers + ON CONFLICT DO NOTHING on every insert. A
-- second consecutive run changes ZERO rows.
--
-- ONE TRANSACTION: the §9 event/outbox invariant is enforced by a DEFERRED
-- constraint trigger, so a local_event and its outbox row must share a
-- transaction. Wrapping the whole file also means a failed fixture leaves
-- nothing behind.
--
-- Execution: pnpm hub:db:seed (scripts/hub/hub-db.mjs). NEVER production —
-- the guard below fails closed.
-- ===========================================================================

-- Environment guard: fail CLOSED. An unset GUC refuses seeding rather than
-- assuming local (same contract as the cloud seed, review RV-301).
do $$
declare
  v_env text := current_setting('kitluy.environment', true);
begin
  if v_env is null or v_env not in ('local', 'development', 'test') then
    raise exception
      'hub dev-fixtures REFUSED: kitluy.environment=% is not local/development/test', v_env;
  end if;
end $$;

begin;

-- ---------------------------------------------------------------------------
-- Scope identifiers.
--
-- The Hub-local schema has no Tenant/Digital Store/Location RELATION: those
-- are cloud-authoritative and reach the Hub as scope columns on every business
-- row (Appendix A). The fixtures below therefore establish the scope tuple by
-- using it consistently, and the two attacker tuples deliberately do NOT match
-- it (§12 acceptance test 9).
--
--   Tenant          e0000000-...-0001   "Demo Laundry Tenant"      (fictional)
--   Digital Store   e0000000-...-0002   "Demo Laundry Digital Store"
--   Location        e0000000-...-0003   "Demo Location PP001"
--   Attacker Tenant e0000000-...-00a1 with Location e0000000-...-00a3
--   Sibling Location (same Tenant)      e0000000-...-00a4
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Hub device, installation, assignment and credentials (§6.1).
-- ---------------------------------------------------------------------------
insert into edge_identity.hub_device
  (id, asset_number, device_kind, lifecycle_status, trust_status,
   board_serial_hash, factory_duid_hash, root_key_fingerprint,
   manufacturing_cert_serial, created_at, updated_at)
values
  ('e0000000-0000-4000-8000-000000000010', 'HET-DEMO-HUB-0001', 'store_hub',
   'deployed', 'trusted',
   encode(sha256('fixture:board-serial:hub-0001'), 'hex'),
   encode(sha256('fixture:factory-duid:hub-0001'), 'hex'),
   encode(sha256('fixture:root-key:hub-0001'), 'hex'),
   'DEMO-MFG-CERT-0001', '2026-07-01T00:00:00Z', '2026-07-27T00:00:00Z')
on conflict do nothing;

insert into edge_identity.hub_installation
  (id, hub_device_id, installation_generation, nvme_serial_hash, nvme_model,
   nvme_capacity_bytes, os_release_id, os_image_sha256, secure_boot_generation,
   storage_key_generation, installed_at, status)
values
  ('e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000010', 1,
   encode(sha256('fixture:nvme-serial:hub-0001'), 'hex'), 'Raspberry Pi SSD Kit 256 GB',
   256060514304, 'kitluy-os-demo-2026.07', encode(sha256('fixture:os-image:2026.07'), 'hex'),
   1, 1, '2026-07-01T01:00:00Z', 'active')
on conflict do nothing;

insert into edge_identity.hub_assignment
  (id, hub_device_id, tenant_id, digital_store_id, location_id,
   assignment_generation, assigned_at, ended_at, status, operational_cert_serial)
values
  ('e0000000-0000-4000-8000-000000000012', 'e0000000-0000-4000-8000-000000000010',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 1, '2026-07-01T02:00:00Z', null,
   'active', 'DEMO-OPS-CERT-0001')
on conflict do nothing;

insert into edge_identity.device_credential
  (id, device_id, credential_type, public_key_fingerprint, certificate_serial,
   issuer, issued_at, expires_at, status, revoked_at, revocation_reason,
   rotation_generation)
values
  -- Trusted Hub operational credential.
  ('e0000000-0000-4000-8000-000000000013', 'e0000000-0000-4000-8000-000000000010',
   'operational', encode(sha256('fixture:pubkey:hub-0001'), 'hex'), 'DEMO-OPS-CERT-0001',
   'KitLuy Demo Device CA', '2026-07-01T02:00:00Z', '2027-07-01T02:00:00Z',
   'active', null, null, 1),
  -- REVOKED terminal credential (persona: revoked device).
  ('e0000000-0000-4000-8000-000000000014', 'e0000000-0000-4000-8000-000000000024',
   'operational', encode(sha256('fixture:pubkey:terminal-revoked'), 'hex'),
   'DEMO-TERM-CERT-REVOKED', 'KitLuy Demo Device CA',
   '2026-07-01T03:00:00Z', '2027-07-01T03:00:00Z',
   'revoked', '2026-07-20T09:00:00Z', 'device_reported_stolen', 2)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Configuration snapshots (§6.2). One ACTIVE per Location.
-- ---------------------------------------------------------------------------
insert into edge_config.configuration_snapshot
  (id, tenant_id, digital_store_id, location_id, snapshot_version, schema_version,
   created_at, not_before, expires_at, minimum_hub_version, maximum_hub_version,
   manifest_sha256, signature_algorithm, signature, signing_key_id, state,
   downloaded_at, activated_at)
values
  ('e0000000-0000-4000-8000-000000000050',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 7, 1,
   '2026-07-26T00:00:00Z', '2026-07-26T00:00:00Z', null, '0.1.0', null,
   encode(sha256('fixture:manifest:snapshot-7'), 'hex'), 'ed25519',
   decode('c0ffee00', 'hex'), 'demo-signing-key-1', 'active',
   '2026-07-26T00:05:00Z', '2026-07-26T00:10:00Z'),
  -- Superseded snapshot, retained so a rollback never guesses (§12 test 7).
  ('e0000000-0000-4000-8000-000000000051',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 6, 1,
   '2026-07-20T00:00:00Z', '2026-07-20T00:00:00Z', null, '0.1.0', null,
   encode(sha256('fixture:manifest:snapshot-6'), 'hex'), 'ed25519',
   decode('c0ffee01', 'hex'), 'demo-signing-key-1', 'rolled_back',
   '2026-07-20T00:05:00Z', null),
  -- Attacker-scope snapshots so the attacker Bookings below are insertable.
  ('e0000000-0000-4000-8000-0000000000b1',
   'e0000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-0000000000a2',
   'e0000000-0000-4000-8000-0000000000a3', 1, 1,
   '2026-07-26T00:00:00Z', '2026-07-26T00:00:00Z', null, '0.1.0', null,
   encode(sha256('fixture:manifest:attacker-tenant'), 'hex'), 'ed25519',
   decode('c0ffee02', 'hex'), 'demo-signing-key-1', 'active',
   '2026-07-26T00:05:00Z', '2026-07-26T00:10:00Z'),
  ('e0000000-0000-4000-8000-0000000000b2',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-0000000000a4', 1, 1,
   '2026-07-26T00:00:00Z', '2026-07-26T00:00:00Z', null, '0.1.0', null,
   encode(sha256('fixture:manifest:sibling-location'), 'hex'), 'ed25519',
   decode('c0ffee03', 'hex'), 'demo-signing-key-1', 'active',
   '2026-07-26T00:05:00Z', '2026-07-26T00:10:00Z')
on conflict do nothing;

insert into edge_config.configuration_section
  (id, snapshot_id, section_code, section_version, content_sha256, content_json,
   required, validation_state, validation_error)
values
  ('e0000000-0000-4000-8000-000000000052', 'e0000000-0000-4000-8000-000000000050',
   'pricing', 7, encode(sha256('fixture:section:pricing:7'), 'hex'),
   '{"currency_code": "USD", "currency_exponent": 2}'::jsonb, true, 'valid', null),
  ('e0000000-0000-4000-8000-000000000053', 'e0000000-0000-4000-8000-000000000050',
   'terminal_profiles', 7, encode(sha256('fixture:section:profiles:7'), 'hex'),
   '{"profiles": ["laundry.t1.intake_cashier", "laundry.t2.customer_display", "laundry.t3.ready_scan_in", "laundry.t4.pickup_scan_out"]}'::jsonb,
   true, 'valid', null)
on conflict do nothing;

insert into edge_config.configuration_activation
  (id, tenant_id, digital_store_id, location_id, snapshot_id, previous_snapshot_id,
   started_at, completed_at, result, health_check_json, rollback_reason,
   actor_type, actor_id)
values
  ('e0000000-0000-4000-8000-000000000054',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000050',
   'e0000000-0000-4000-8000-000000000051',
   '2026-07-26T00:09:00Z', '2026-07-26T00:10:00Z', 'activated',
   '{"peripherals": "ready", "clock_offset_seconds": 1}'::jsonb, null, 'service', null)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. T1-T4 terminal devices + one REVOKED device (§6.1).
--    hardware_profile_id references the certified baseline seeded by
--    migration 0014 (hw.compute.terminal).
-- ---------------------------------------------------------------------------
insert into edge_identity.terminal_device
  (id, tenant_id, digital_store_id, location_id, terminal_name, hardware_profile_id,
   installation_id, certificate_serial, assignment_generation, lifecycle_status,
   last_client_sequence, last_seen_at, created_at, updated_at)
values
  ('e0000000-0000-4000-8000-000000000020',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'demo-t1-front-counter',
   '10000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000011',
   'DEMO-TERM-CERT-T1', 1, 'active', 1002,
   '2026-07-27T08:00:00Z', '2026-07-01T04:00:00Z', '2026-07-27T08:00:00Z'),
  ('e0000000-0000-4000-8000-000000000021',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'demo-t2-customer-display',
   '10000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000011',
   'DEMO-TERM-CERT-T2', 1, 'active', 0,
   '2026-07-27T08:00:00Z', '2026-07-01T04:00:00Z', '2026-07-27T08:00:00Z'),
  ('e0000000-0000-4000-8000-000000000022',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'demo-t3-ready-station',
   '10000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000011',
   'DEMO-TERM-CERT-T3', 1, 'active', 3001,
   '2026-07-27T08:00:00Z', '2026-07-01T04:00:00Z', '2026-07-27T08:00:00Z'),
  ('e0000000-0000-4000-8000-000000000023',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'demo-t4-pickup-station',
   '10000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000011',
   'DEMO-TERM-CERT-T4', 1, 'active', 4001,
   '2026-07-27T08:00:00Z', '2026-07-01T04:00:00Z', '2026-07-27T08:00:00Z'),
  -- PERSONA: revoked device. Its credential is revoked (section 1) and its
  -- lifecycle status blocks the shared profile gate (terminal profile
  -- contract §3.9 "no security quarantine or read-only safety state").
  ('e0000000-0000-4000-8000-000000000024',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'demo-t1-revoked',
   '10000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000011',
   'DEMO-TERM-CERT-REVOKED', 1, 'revoked', 55,
   '2026-07-20T08:59:00Z', '2026-07-01T04:00:00Z', '2026-07-20T09:00:00Z')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Actors (§6.1 staff_cache). Authorized actors carry the CANONICAL dotted
--    logical profiles; the unauthorized actor carries none and is disabled.
--
--    `offline_valid_until` IS RELATIVE, AND THAT IS DELIBERATE.
--
--    It read '2026-08-27T00:00:00Z' until BRINGUP-003, which meant these
--    fixtures silently stopped working on 27 August: every command by an
--    authorized actor refused with EDGE_PERMISSION_DENIED "permission
--    projection expired". Nobody noticed, because the suites that use them
--    skip whenever no Hub database is reachable — and none was, until now.
--
--    Every OTHER timestamp in this file is deliberately fixed: they record
--    events that happened, and a fixture whose history moves is a fixture that
--    cannot be reasoned about. This one is different in kind. It expresses "a
--    projection that is currently valid", which is a statement about now, so
--    pinning it to a date was always going to expire.
-- ---------------------------------------------------------------------------
insert into edge_identity.staff_cache
  (actor_id, tenant_id, digital_store_id, location_id, display_name,
   credential_verifier, permission_snapshot_version, profile_codes,
   offline_valid_until, disabled, last_synced_at)
values
  ('e0000000-0000-4000-8000-000000000040',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'Demo Cashier Sokha',
   decode('a1a1a1a1', 'hex'), 7, array['laundry.t1.intake_cashier'],
   now() + interval '30 days', false, '2026-07-27T00:00:00Z'),
  ('e0000000-0000-4000-8000-000000000041',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'Demo Ready Staff Dara',
   decode('a2a2a2a2', 'hex'), 7, array['laundry.t3.ready_scan_in'],
   now() + interval '30 days', false, '2026-07-27T00:00:00Z'),
  ('e0000000-0000-4000-8000-000000000042',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'Demo Pickup Staff Chanda',
   decode('a3a3a3a3', 'hex'), 7, array['laundry.t4.pickup_scan_out'],
   now() + interval '30 days', false, '2026-07-27T00:00:00Z'),
  ('e0000000-0000-4000-8000-000000000043',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'Demo Store Manager Vuthy',
   decode('a4a4a4a4', 'hex'), 7,
   array['laundry.t1.intake_cashier', 'laundry.t3.ready_scan_in', 'laundry.t4.pickup_scan_out'],
   now() + interval '30 days', false, '2026-07-27T00:00:00Z'),
  -- PERSONA: unauthorized actor — disabled, no logical profile at all.
  ('e0000000-0000-4000-8000-000000000044',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'Demo Unauthorized Actor',
   decode('a5a5a5a5', 'hex'), 7, array[]::text[],
   '2026-07-01T00:00:00Z', true, '2026-07-27T00:00:00Z')
on conflict do nothing;

insert into edge_identity.terminal_session
  (id, tenant_id, digital_store_id, location_id, terminal_device_id, actor_id,
   profile_code, opened_at, expires_at, closed_at, session_generation,
   last_event_sequence, status)
values
  ('e0000000-0000-4000-8000-000000000030',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000020',
   'e0000000-0000-4000-8000-000000000040', 'laundry.t1.intake_cashier',
   '2026-07-27T08:00:00Z', '2026-07-27T20:00:00Z', null, 1, 12, 'open'),
  ('e0000000-0000-4000-8000-000000000031',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000021',
   'e0000000-0000-4000-8000-000000000040', 'laundry.t2.customer_display',
   '2026-07-27T08:00:00Z', '2026-07-27T20:00:00Z', null, 1, 3, 'open'),
  ('e0000000-0000-4000-8000-000000000032',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000022',
   'e0000000-0000-4000-8000-000000000041', 'laundry.t3.ready_scan_in',
   '2026-07-27T08:00:00Z', '2026-07-27T20:00:00Z', null, 1, 5, 'open'),
  ('e0000000-0000-4000-8000-000000000033',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000023',
   'e0000000-0000-4000-8000-000000000042', 'laundry.t4.pickup_scan_out',
   '2026-07-27T08:00:00Z', '2026-07-27T20:00:00Z', null, 1, 2, 'open')
on conflict do nothing;

insert into edge_config.terminal_profile_assignment
  (id, tenant_id, digital_store_id, location_id, terminal_device_id, profile_code,
   assignment_version, enabled, effective_from, effective_until, source_snapshot_id)
values
  ('e0000000-0000-4000-8000-000000000055',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000020',
   'laundry.t1.intake_cashier', 7, true, '2026-07-26T00:10:00Z', null,
   'e0000000-0000-4000-8000-000000000050'),
  ('e0000000-0000-4000-8000-000000000056',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000021',
   'laundry.t2.customer_display', 7, true, '2026-07-26T00:10:00Z', null,
   'e0000000-0000-4000-8000-000000000050'),
  ('e0000000-0000-4000-8000-000000000057',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000022',
   'laundry.t3.ready_scan_in', 7, true, '2026-07-26T00:10:00Z', null,
   'e0000000-0000-4000-8000-000000000050'),
  ('e0000000-0000-4000-8000-000000000058',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000023',
   'laundry.t4.pickup_scan_out', 7, true, '2026-07-26T00:10:00Z', null,
   'e0000000-0000-4000-8000-000000000050')
on conflict do nothing;

insert into edge_config.peripheral_binding
  (id, tenant_id, digital_store_id, location_id, hardware_profile_id, logical_role,
   connection_uri, terminal_device_id, fallback_priority, enabled,
   source_snapshot_id, last_validated_at)
values
  ('e0000000-0000-4000-8000-000000000059',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000005',
   'receipt_printer', 'tcp://192.0.2.20:9100', 'e0000000-0000-4000-8000-000000000020',
   0, true, 'e0000000-0000-4000-8000-000000000050', '2026-07-27T08:00:00Z'),
  ('e0000000-0000-4000-8000-00000000005a',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000006',
   'tag_printer', 'tcp://192.0.2.21:9100', 'e0000000-0000-4000-8000-000000000020',
   0, true, 'e0000000-0000-4000-8000-000000000050', '2026-07-27T08:00:00Z'),
  ('e0000000-0000-4000-8000-00000000005b',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000007',
   'scanner', 'usb://hid/demo-scanner-t3', 'e0000000-0000-4000-8000-000000000022',
   0, true, 'e0000000-0000-4000-8000-000000000050', '2026-07-27T08:00:00Z')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 5. Customer projection (§6.3) — hashed + masked identifiers only.
-- ---------------------------------------------------------------------------
insert into edge_core.customer
  (id, tenant_id, digital_store_id, location_id, cloud_customer_id, display_name,
   phone_e164, email_normalized, language_code, consent_sms, consent_email,
   source, record_version, created_at, updated_at, deleted_at)
values
  ('e0000000-0000-4000-8000-000000000060',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', null, 'Demo Customer Sreymom',
   '+85512000001', 'demo.customer@kitluy.example', 'km', true, false,
   'pos_t1', 1, '2026-07-27T08:05:00Z', '2026-07-27T08:05:00Z', null)
on conflict do nothing;

insert into edge_core.customer_identifier
  (id, tenant_id, digital_store_id, location_id, customer_id, identifier_type,
   normalized_value_hash, masked_value, verified_at, created_at)
values
  ('e0000000-0000-4000-8000-000000000061',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000060',
   'phone', encode(sha256('fixture:phone:+85512000001'), 'hex'), '+8551200****',
   '2026-07-27T08:05:00Z', '2026-07-27T08:05:00Z')
on conflict do nothing;

insert into edge_core.business_sequence
  (location_id, sequence_code, business_date, next_value, allocation_generation, updated_at)
values
  ('e0000000-0000-4000-8000-000000000003', 'booking', '2026-07-27', 2, 1, '2026-07-27T08:05:00Z'),
  ('e0000000-0000-4000-8000-000000000003', 'receipt', '2026-07-27', 2, 1, '2026-07-27T08:20:00Z')
on conflict do nothing;

insert into edge_core.shift
  (id, tenant_id, digital_store_id, location_id, terminal_device_id, actor_id,
   business_date, opened_at, closed_at, opening_float_minor, currency_code,
   currency_exponent, expected_cash_minor, counted_cash_minor, variance_minor,
   status, close_approval_id)
values
  ('e0000000-0000-4000-8000-000000000065',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000020',
   'e0000000-0000-4000-8000-000000000040', '2026-07-27', '2026-07-27T08:00:00Z', null,
   10000, 'USD', 2, null, null, null, 'open', null)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 6. File assets (§6.7) — inserted before edge_laundry.exception, which
--    references an evidence asset.
-- ---------------------------------------------------------------------------
insert into edge_files.asset
  (id, tenant_id, digital_store_id, location_id, asset_class, owner_type, owner_id,
   mime_type, size_bytes, sha256, local_relative_path, encryption_key_generation,
   retention_class, state, cloud_object_key, cloud_etag, created_at, uploaded_at,
   verified_at, evicted_at)
values
  ('e0000000-0000-4000-8000-0000000000c0',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'garment_evidence', 'booking',
   'e0000000-0000-4000-8000-000000000070', 'image/jpeg', 184320,
   encode(sha256('fixture:asset:stain-evidence'), 'hex'),
   'assets/2026/07/27/demo-stain-evidence.jpg', 1, 'evidence_180d', 'queued',
   null, null, '2026-07-27T08:07:00Z', null, null, null)
on conflict do nothing;

insert into edge_files.asset_chunk
  (asset_id, chunk_number, offset_bytes, size_bytes, sha256, received, uploaded, updated_at)
values
  ('e0000000-0000-4000-8000-0000000000c0', 0, 0, 131072,
   encode(sha256('fixture:chunk:0'), 'hex'), true, false, '2026-07-27T08:07:00Z'),
  ('e0000000-0000-4000-8000-0000000000c0', 1, 131072, 53248,
   encode(sha256('fixture:chunk:1'), 'hex'), true, false, '2026-07-27T08:07:00Z')
on conflict do nothing;

insert into edge_files.file_transfer_job
  (id, tenant_id, digital_store_id, location_id, asset_id, direction, state,
   remote_session_id, next_chunk_number, attempt_count, next_attempt_at,
   last_error_code, created_at, updated_at)
values
  ('e0000000-0000-4000-8000-0000000000c1',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-0000000000c0',
   'upload', 'queued', null, 0, 0, '2026-07-27T08:10:00Z', null,
   '2026-07-27T08:07:00Z', '2026-07-27T08:07:00Z')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 7. Booking aggregate (§6.4).
--    subtotal 4500 - discount 500 = total 4000; paid 3000; refunded 500;
--    balance 4000 - 3000 + 500 = 1500 (§6.4 balance CHECK, incl. the R4
--    additive refunded_minor column).
-- ---------------------------------------------------------------------------
insert into edge_laundry.booking
  (id, tenant_id, digital_store_id, location_id, booking_number, customer_id,
   status, business_date, currency_code, currency_exponent, subtotal_minor,
   discount_minor, tax_minor, total_minor, paid_minor, refunded_minor,
   balance_minor, due_at, pickup_method, config_snapshot_id, aggregate_version,
   created_at, updated_at)
values
  ('e0000000-0000-4000-8000-000000000070',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'KLB-PP001-260727-000001',
   'e0000000-0000-4000-8000-000000000060', 'ready', '2026-07-27', 'USD', 2,
   4500, 500, 0, 4000, 3000, 500, 1500, '2026-07-29T10:00:00Z', 'store_pickup',
   'e0000000-0000-4000-8000-000000000050', 4,
   '2026-07-27T08:06:00Z', '2026-07-27T09:30:00Z'),
  -- PERSONA: cross-Tenant attacker row. Scope tuple belongs to a DIFFERENT
  -- Tenant; the database accepts it, the procedures and tests reject it
  -- (§12 acceptance test 9).
  ('e0000000-0000-4000-8000-0000000000a5',
   'e0000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-0000000000a2',
   'e0000000-0000-4000-8000-0000000000a3', 'KLB-XX999-260727-000001', null,
   'draft', '2026-07-27', 'USD', 2, 1000, 0, 0, 1000, 0, 0, 1000, null,
   'store_pickup', 'e0000000-0000-4000-8000-0000000000b1', 1,
   '2026-07-27T08:00:00Z', '2026-07-27T08:00:00Z'),
  -- PERSONA: cross-Location attacker row. SAME Tenant and Digital Store, a
  -- DIFFERENT Location — the case a naive tenant-only check would miss.
  ('e0000000-0000-4000-8000-0000000000a6',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-0000000000a4', 'KLB-PP002-260727-000001', null,
   'draft', '2026-07-27', 'USD', 2, 2000, 0, 0, 2000, 0, 0, 2000, null,
   'store_pickup', 'e0000000-0000-4000-8000-0000000000b2', 1,
   '2026-07-27T08:00:00Z', '2026-07-27T08:00:00Z')
on conflict do nothing;

insert into edge_laundry.booking_line
  (id, tenant_id, digital_store_id, location_id, booking_id, service_id,
   service_version, display_name, pricing_method, unit_price_minor, currency_code,
   currency_exponent, quantity, unit_code, line_subtotal_minor, discount_minor,
   tax_minor, line_total_minor, addon_snapshot_json, source_config_version, created_at)
values
  ('e0000000-0000-4000-8000-000000000071',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   'e0000000-0000-4000-8000-000000000f01', 3, 'Demo Wash & Fold (per piece)',
   'per_piece', 1000, 'USD', 2, 3.0000, 'piece', 3000, 500, 0, 2500,
   '{"addons": []}'::jsonb, 7, '2026-07-27T08:06:00Z'),
  ('e0000000-0000-4000-8000-000000000072',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   'e0000000-0000-4000-8000-000000000f02', 2, 'Demo Wash (per kg)',
   'per_weight', 1000, 'USD', 2, 1.5000, 'kg', 1500, 0, 0, 1500,
   '{"addons": ["fabric_softener"]}'::jsonb, 7, '2026-07-27T08:06:00Z')
on conflict do nothing;

insert into edge_laundry.garment
  (id, tenant_id, digital_store_id, location_id, booking_id, booking_line_id,
   garment_code, garment_type, color, condition_code, special_handling,
   current_custody_state, created_at)
values
  ('e0000000-0000-4000-8000-000000000073',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   'e0000000-0000-4000-8000-000000000071', 'DEMO-G-0001', 'shirt', 'white',
   'stained_collar', 'no_bleach', 'in_ready_storage', '2026-07-27T08:06:00Z'),
  ('e0000000-0000-4000-8000-000000000074',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   'e0000000-0000-4000-8000-000000000071', 'DEMO-G-0002', 'trousers', 'navy',
   'good', null, 'in_ready_storage', '2026-07-27T08:06:00Z')
on conflict do nothing;

insert into edge_laundry.bag
  (id, tenant_id, digital_store_id, location_id, booking_id, bag_code,
   expected_piece_count, current_piece_count, current_custody_state, created_at)
values
  ('e0000000-0000-4000-8000-000000000075',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   'DEMO-B-0001', 5, 5, 'in_ready_storage', '2026-07-27T08:06:00Z')
on conflict do nothing;

insert into edge_laundry.tag
  (id, tenant_id, digital_store_id, location_id, booking_id, garment_id, bag_id,
   tag_code, tag_type, issued_at, voided_at, void_reason)
values
  ('e0000000-0000-4000-8000-000000000076',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   'e0000000-0000-4000-8000-000000000073', null, 'KLT-PP001-7J5M2KD9QX',
   'garment', '2026-07-27T08:06:30Z', null, null),
  ('e0000000-0000-4000-8000-000000000077',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   null, 'e0000000-0000-4000-8000-000000000075', 'KLT-PP001-4B8N6QX2VR',
   'bag', '2026-07-27T08:06:31Z', null, null),
  -- A VOIDED tag: voiding is a lifecycle state, never a delete (§1).
  ('e0000000-0000-4000-8000-000000000078',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   'e0000000-0000-4000-8000-000000000074', null, 'KLT-PP001-9Z3K5MT7WQ',
   'garment', '2026-07-27T08:06:32Z', '2026-07-27T08:08:00Z', 'misprint')
on conflict do nothing;

insert into edge_laundry.storage_position
  (id, tenant_id, digital_store_id, location_id, position_code, position_type,
   zone_code, capacity, status, record_version, source_snapshot_id, updated_at)
values
  ('e0000000-0000-4000-8000-000000000079',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'RACK-A-01', 'hanging_rail', 'A',
   1, 'available', 1, 'e0000000-0000-4000-8000-000000000050', '2026-07-27T09:00:00Z'),
  ('e0000000-0000-4000-8000-00000000007a',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'SHELF-B-02', 'shelf', 'B',
   4, 'available', 1, 'e0000000-0000-4000-8000-000000000050', '2026-07-27T09:00:00Z')
on conflict do nothing;

insert into edge_laundry.storage_assignment
  (id, tenant_id, digital_store_id, location_id, booking_id, garment_id, bag_id,
   storage_position_id, assigned_at, assigned_by, terminal_device_id,
   cleared_at, cleared_by, clear_reason, assignment_event_id)
values
  ('e0000000-0000-4000-8000-00000000007b',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   'e0000000-0000-4000-8000-000000000073', null, 'e0000000-0000-4000-8000-000000000079',
   '2026-07-27T09:20:00Z', 'e0000000-0000-4000-8000-000000000041',
   'e0000000-0000-4000-8000-000000000022', null, null, null,
   'e0000000-0000-4000-8000-0000000000d5'),
  ('e0000000-0000-4000-8000-00000000007c',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   null, 'e0000000-0000-4000-8000-000000000075', 'e0000000-0000-4000-8000-00000000007a',
   '2026-07-27T09:21:00Z', 'e0000000-0000-4000-8000-000000000041',
   'e0000000-0000-4000-8000-000000000022', null, null, null,
   'e0000000-0000-4000-8000-0000000000d6')
on conflict do nothing;

-- Append-only lifecycle history (§6.4). ON CONFLICT DO NOTHING never fires the
-- append-only trigger: it suppresses the INSERT, it does not become an UPDATE.
insert into edge_laundry.status_event
  (id, tenant_id, digital_store_id, location_id, booking_id, from_status, to_status,
   reason_code, actor_id, terminal_device_id, occurred_at, local_sequence, event_id)
values
  ('e0000000-0000-4000-8000-000000000081',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   'draft', 'intake_confirmed', null, 'e0000000-0000-4000-8000-000000000040',
   'e0000000-0000-4000-8000-000000000020', '2026-07-27T08:06:00Z', 1,
   'e0000000-0000-4000-8000-0000000000d1'),
  ('e0000000-0000-4000-8000-000000000082',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   'intake_confirmed', 'ready', null, 'e0000000-0000-4000-8000-000000000041',
   'e0000000-0000-4000-8000-000000000022', '2026-07-27T09:22:00Z', 2,
   'e0000000-0000-4000-8000-0000000000da')
on conflict do nothing;

-- Append-only custody chain (§6.4): unit, from->to state, actor, device,
-- session, Booking, event time, local sequence, reason and payload hash.
insert into edge_laundry.custody_event
  (id, tenant_id, digital_store_id, location_id, booking_id, garment_id, bag_id,
   event_type, from_custody_state, to_custody_state, storage_position_id, actor_id,
   terminal_device_id, session_id, occurred_at, local_sequence, reason_code,
   payload_sha256, event_id)
values
  ('e0000000-0000-4000-8000-000000000083',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   'e0000000-0000-4000-8000-000000000073', null, 'intake_received', null,
   'in_processing', null, 'e0000000-0000-4000-8000-000000000040',
   'e0000000-0000-4000-8000-000000000020', 'e0000000-0000-4000-8000-000000000030',
   '2026-07-27T08:06:10Z', 1, null,
   encode(sha256('fixture:custody:intake'), 'hex'),
   'e0000000-0000-4000-8000-0000000000db'),
  ('e0000000-0000-4000-8000-000000000084',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   'e0000000-0000-4000-8000-000000000073', null, 'ready_scan_in', 'in_processing',
   'in_ready_storage', 'e0000000-0000-4000-8000-000000000079',
   'e0000000-0000-4000-8000-000000000041', 'e0000000-0000-4000-8000-000000000022',
   'e0000000-0000-4000-8000-00000000007e', '2026-07-27T09:20:00Z', 2, null,
   encode(sha256('fixture:custody:ready-scan-in'), 'hex'),
   'e0000000-0000-4000-8000-0000000000d4')
on conflict do nothing;

insert into edge_laundry.exception
  (id, tenant_id, digital_store_id, location_id, booking_id, garment_id, bag_id,
   exception_type, severity, blocking, status, note, evidence_asset_id,
   created_by, created_at, resolved_by, resolved_at, resolution_code)
values
  ('e0000000-0000-4000-8000-00000000007d',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   'e0000000-0000-4000-8000-000000000073', null, 'stain', 'medium', false,
   'resolved', 'Demo collar stain noted at intake.',
   'e0000000-0000-4000-8000-0000000000c0', 'e0000000-0000-4000-8000-000000000040',
   '2026-07-27T08:07:00Z', 'e0000000-0000-4000-8000-000000000041',
   '2026-07-27T09:15:00Z', 'treated_and_accepted')
on conflict do nothing;

insert into edge_laundry.ready_scan_session
  (id, tenant_id, digital_store_id, location_id, booking_id, terminal_device_id,
   actor_id, started_at, completed_at, expected_count, scanned_count, qa_state,
   storage_state, status, idempotency_key)
values
  ('e0000000-0000-4000-8000-00000000007e',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   'e0000000-0000-4000-8000-000000000022', 'e0000000-0000-4000-8000-000000000041',
   '2026-07-27T09:10:00Z', '2026-07-27T09:22:00Z', 2, 2, 'passed', 'assigned',
   'completed', 'kl1.e0000000-0000-4000-8000-000000000022.3001')
on conflict do nothing;

insert into edge_laundry.pickup_session
  (id, tenant_id, digital_store_id, location_id, booking_id, terminal_device_id,
   actor_id, started_at, collector_verification_method, collector_verified_at,
   expected_count, scanned_count, payment_gate_state, completed_at, status,
   idempotency_key)
values
  ('e0000000-0000-4000-8000-00000000007f',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   'e0000000-0000-4000-8000-000000000023', 'e0000000-0000-4000-8000-000000000042',
   '2026-07-27T09:40:00Z', null, null, 2, 0, 'blocked_balance_due', null,
   'in_progress', 'kl1.e0000000-0000-4000-8000-000000000023.4001')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 8. Payments and cash (§6.5, §6.3).
--    One PENDING payment (KLD-2026-07-26-002 Group 5: non-terminal, HTTP 202),
--    one CONFIRMED payment, and one refund adjustment.
-- ---------------------------------------------------------------------------
insert into edge_payments.payment
  (id, tenant_id, digital_store_id, location_id, booking_id, payment_number,
   payment_type, amount_minor, currency_code, currency_exponent, state,
   provider_code, provider_reference, requested_at, confirmed_at, reversed_at,
   actor_id, terminal_device_id, event_id, idempotency_key)
values
  -- CONFIRMED cash payment.
  ('e0000000-0000-4000-8000-000000000090',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   'KLP-PP001-260727-000001', 'cash', 3000, 'USD', 2, 'confirmed',
   null, null, '2026-07-27T08:15:00Z', '2026-07-27T08:15:02Z', null,
   'e0000000-0000-4000-8000-000000000040', 'e0000000-0000-4000-8000-000000000020',
   'e0000000-0000-4000-8000-0000000000d2',
   'kl1.e0000000-0000-4000-8000-000000000020.1001'),
  -- PENDING KHQR payment: never becomes paid without authoritative
  -- confirmation (KHQR remains simulator-only, PAY-OD-001/BLK-006).
  ('e0000000-0000-4000-8000-000000000091',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   'KLP-PP001-260727-000002', 'khqr', 1000, 'USD', 2, 'pending',
   'demo_khqr_simulator', 'DEMO-KHQR-REF-0002', '2026-07-27T09:45:00Z', null, null,
   'e0000000-0000-4000-8000-000000000040', 'e0000000-0000-4000-8000-000000000020',
   'e0000000-0000-4000-8000-0000000000d7',
   'kl1.e0000000-0000-4000-8000-000000000020.1002')
on conflict do nothing;

insert into edge_payments.payment_attempt
  (id, tenant_id, digital_store_id, location_id, payment_id, attempt_number,
   request_sha256, provider_state, provider_reference, requested_at, responded_at,
   error_code, response_metadata)
values
  ('e0000000-0000-4000-8000-000000000092',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000091', 1,
   encode(sha256('fixture:request:khqr-create'), 'hex'), 'awaiting_customer',
   'DEMO-KHQR-REF-0002', '2026-07-27T09:45:00Z', '2026-07-27T09:45:01Z', null,
   '{"simulator": true}'::jsonb)
on conflict do nothing;

insert into edge_payments.tender_leg
  (id, tenant_id, digital_store_id, location_id, payment_id, tender_type,
   amount_minor, currency_code, currency_exponent, state, provider_reference, event_id)
values
  ('e0000000-0000-4000-8000-000000000093',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000090',
   'cash', 3000, 'USD', 2, 'settled', null, 'e0000000-0000-4000-8000-0000000000d8')
on conflict do nothing;

insert into edge_payments.refund_adjustment
  (id, tenant_id, digital_store_id, location_id, booking_id, original_payment_id,
   adjustment_type, amount_minor, currency_code, currency_exponent, reason_code,
   approval_id, state, created_at, event_id)
values
  ('e0000000-0000-4000-8000-000000000094',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   'e0000000-0000-4000-8000-000000000090', 'refund', 500, 'USD', 2,
   'service_not_delivered', 'e0000000-0000-4000-8000-000000000f10', 'approved',
   '2026-07-27T09:30:00Z', 'e0000000-0000-4000-8000-0000000000d3')
on conflict do nothing;

insert into edge_core.cash_movement
  (id, tenant_id, digital_store_id, location_id, shift_id, movement_type,
   amount_minor, currency_code, currency_exponent, reason_code, related_payment_id,
   actor_id, terminal_device_id, occurred_at, event_id)
values
  ('e0000000-0000-4000-8000-000000000095',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000065',
   'payment_received', 3000, 'USD', 2, null, 'e0000000-0000-4000-8000-000000000090',
   'e0000000-0000-4000-8000-000000000040', 'e0000000-0000-4000-8000-000000000020',
   '2026-07-27T08:15:02Z', 'e0000000-0000-4000-8000-0000000000d2'),
  -- Compensating movement for the refund: signed ledger, never an overwrite.
  ('e0000000-0000-4000-8000-000000000096',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000065',
   'refund_paid_out', -500, 'USD', 2, 'service_not_delivered',
   'e0000000-0000-4000-8000-000000000090',
   'e0000000-0000-4000-8000-000000000043', 'e0000000-0000-4000-8000-000000000020',
   '2026-07-27T09:30:00Z', 'e0000000-0000-4000-8000-0000000000d3')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 9. Hardware observations (§6.9) — before print_attempt, which references one.
-- ---------------------------------------------------------------------------
insert into edge_hardware.peripheral_observation
  (id, tenant_id, digital_store_id, location_id, peripheral_binding_id, observed_at,
   health_state, firmware_version, driver_version, connection_state,
   capabilities_hash, details_json, terminal_device_id)
values
  ('e0000000-0000-4000-8000-0000000000e0',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000059',
   '2026-07-27T08:00:30Z', 'ready', 'demo-fw-1.2', 'demo-drv-0.9', 'connected',
   encode(sha256('fixture:capabilities:receipt-printer'), 'hex'),
   '{"paper": "ok"}'::jsonb, 'e0000000-0000-4000-8000-000000000020')
on conflict do nothing;

insert into edge_hardware.device_heartbeat
  (id, tenant_id, digital_store_id, location_id, device_id, device_kind, observed_at,
   application_version, config_snapshot_version, uptime_seconds, cpu_temperature_c,
   disk_free_bytes, lan_state, wan_state, last_hub_sequence, health_state, details_json)
values
  ('e0000000-0000-4000-8000-0000000000e1',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000010',
   'store_hub', '2026-07-27T09:00:00Z', '0.1.0', 7, 259200, 47.50,
   180000000000, 'connected', 'degraded', 4, 'ready',
   '{"ntp_offset_seconds": 1}'::jsonb)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 10. Documents (§6.6).
-- ---------------------------------------------------------------------------
insert into edge_documents.receipt
  (id, tenant_id, digital_store_id, location_id, booking_id, payment_id,
   receipt_number, document_type, template_version, content_sha256, render_asset_id,
   issued_at, issued_by, reprint_of_id, reprint_reason, event_id)
values
  ('e0000000-0000-4000-8000-0000000000a0',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000070',
   'e0000000-0000-4000-8000-000000000090', 'KLR-PP001-260727-000001', 'payment_receipt',
   3, encode(sha256('fixture:receipt:content'), 'hex'), null,
   '2026-07-27T08:15:05Z', 'e0000000-0000-4000-8000-000000000040', null, null,
   'e0000000-0000-4000-8000-0000000000d9')
on conflict do nothing;

insert into edge_documents.print_job
  (id, tenant_id, digital_store_id, location_id, document_type, document_id,
   printer_binding_id, template_version, payload_sha256, copies,
   duplicate_suppression_key, state, priority, created_at, next_attempt_at,
   attempt_count, last_error_code, created_by, terminal_device_id)
values
  ('e0000000-0000-4000-8000-0000000000a1',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'payment_receipt',
   'e0000000-0000-4000-8000-0000000000a0', 'e0000000-0000-4000-8000-000000000059',
   3, encode(sha256('fixture:print:payload'), 'hex'), 1,
   'print1.e0000000-0000-4000-8000-0000000000a0.3.e0000000-0000-4000-8000-000000000059.1',
   'printed', 0, '2026-07-27T08:15:05Z', '2026-07-27T08:15:05Z', 1, null,
   'e0000000-0000-4000-8000-000000000040', 'e0000000-0000-4000-8000-000000000020')
on conflict do nothing;

insert into edge_documents.print_attempt
  (id, print_job_id, attempt_number, started_at, completed_at, adapter_version,
   printer_observation_id, result, error_code, bytes_sent)
values
  ('e0000000-0000-4000-8000-0000000000a2', 'e0000000-0000-4000-8000-0000000000a1', 1,
   '2026-07-27T08:15:05Z', '2026-07-27T08:15:07Z', 'demo-escpos-0.9',
   'e0000000-0000-4000-8000-0000000000e0', 'printed', null, 1024)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 11. Sync journals (§6.8, §9).
--     Every local_event is inserted WITH its outbox row: the deferred
--     constraint trigger would refuse this transaction otherwise.
-- ---------------------------------------------------------------------------
insert into edge_sync.local_event
  (id, tenant_id, digital_store_id, location_id, hub_device_id, origin_device_id,
   actor_id, aggregate_type, aggregate_id, aggregate_version, event_type,
   schema_version, business_date, occurred_at, hub_sequence, origin_sequence,
   assignment_generation, idempotency_key, payload_sha256, payload, created_at)
values
  ('e0000000-0000-4000-8000-0000000000d1',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000010',
   'e0000000-0000-4000-8000-000000000020', 'e0000000-0000-4000-8000-000000000040',
   'booking', 'e0000000-0000-4000-8000-000000000070', 1, 'booking_intake_confirmed',
   1, '2026-07-27', '2026-07-27T08:06:00Z', 1, 1000, 1,
   'kl1.e0000000-0000-4000-8000-000000000020.1000',
   encode(sha256('fixture:event:intake-confirmed'), 'hex'),
   '{"booking_number": "KLB-PP001-260727-000001"}'::jsonb, '2026-07-27T08:06:00Z'),
  ('e0000000-0000-4000-8000-0000000000d2',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000010',
   'e0000000-0000-4000-8000-000000000020', 'e0000000-0000-4000-8000-000000000040',
   'payment', 'e0000000-0000-4000-8000-000000000090', 1, 'payment_confirmed',
   1, '2026-07-27', '2026-07-27T08:15:02Z', 2, 1001, 1,
   'kl1.e0000000-0000-4000-8000-000000000020.1001',
   encode(sha256('fixture:event:payment-confirmed'), 'hex'),
   '{"amount_minor": 3000, "currency_code": "USD", "currency_exponent": 2}'::jsonb,
   '2026-07-27T08:15:02Z'),
  ('e0000000-0000-4000-8000-0000000000d3',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000010',
   'e0000000-0000-4000-8000-000000000020', 'e0000000-0000-4000-8000-000000000043',
   'payment', 'e0000000-0000-4000-8000-000000000090', 2, 'payment_refund_recorded',
   1, '2026-07-27', '2026-07-27T09:30:00Z', 3, 1003, 1,
   'kl1.e0000000-0000-4000-8000-000000000020.1003',
   encode(sha256('fixture:event:refund-recorded'), 'hex'),
   '{"amount_minor": 500, "currency_code": "USD", "currency_exponent": 2}'::jsonb,
   '2026-07-27T09:30:00Z'),
  ('e0000000-0000-4000-8000-0000000000d4',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000010',
   'e0000000-0000-4000-8000-000000000022', 'e0000000-0000-4000-8000-000000000041',
   'booking', 'e0000000-0000-4000-8000-000000000070', 3, 'custody_ready_scan_in',
   1, '2026-07-27', '2026-07-27T09:20:00Z', 4, 3001, 1,
   'kl1.e0000000-0000-4000-8000-000000000022.3001',
   encode(sha256('fixture:event:ready-scan-in'), 'hex'),
   '{"scanned_count": 2}'::jsonb, '2026-07-27T09:20:00Z')
on conflict do nothing;

insert into edge_sync.outbox
  (event_id, tenant_id, digital_store_id, location_id, hub_sequence,
   assignment_generation, delivery_state, attempt_count, next_attempt_at,
   last_attempt_at, last_error_code, cloud_ack_id, acknowledged_at, dead_letter_reason)
values
  -- ACKNOWLEDGED rows carry a REAL cloud ack id; WS-09 never fabricates one.
  ('e0000000-0000-4000-8000-0000000000d1',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 1, 1, 'acknowledged', 1,
   '2026-07-27T08:06:05Z', '2026-07-27T08:06:05Z', null, 'DEMO-CLOUD-ACK-0001',
   '2026-07-27T08:06:06Z', null),
  ('e0000000-0000-4000-8000-0000000000d2',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 2, 1, 'pending', 0,
   '2026-07-27T09:50:00Z', null, null, null, null, null),
  ('e0000000-0000-4000-8000-0000000000d3',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 3, 1, 'retry_wait', 2,
   '2026-07-27T09:55:00Z', '2026-07-27T09:52:00Z', 'EDGE_WAN_UNAVAILABLE',
   null, null, null),
  ('e0000000-0000-4000-8000-0000000000d4',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 4, 1, 'pending', 0,
   '2026-07-27T09:50:00Z', null, null, null, null, null)
on conflict do nothing;

-- Keep the sequence allocator ahead of the fixture events (offline §5).
select setval('edge_sync.hub_sequence_seq', greatest(4, last_value)) from edge_sync.hub_sequence_seq;

insert into edge_sync.sync_cursor
  (location_id, stream_code, last_pushed_hub_sequence, last_acked_hub_sequence,
   last_pulled_cloud_sequence, last_applied_cloud_sequence, updated_at)
values
  ('e0000000-0000-4000-8000-000000000003', 'domain_events', 1, 1, 0, 0, '2026-07-27T08:06:06Z'),
  ('e0000000-0000-4000-8000-000000000003', 'control', 0, 0, 12, 12, '2026-07-27T08:00:00Z')
on conflict do nothing;

-- `verified_at` added by hub migration 0021: offline contract §8 requires
-- verification BEFORE application, so an applied message carries the moment its
-- CLOUD signature verified. The rejected fixture carries none — it never
-- reached verification, which is exactly the point of recording it as rejected.
insert into edge_sync.inbox
  (message_id, tenant_id, digital_store_id, location_id, message_type, schema_version,
   cloud_sequence, issued_at, expires_at, payload_sha256, payload, signature,
   signing_key_id, state, received_at, verified_at, applied_at, error_code)
values
  ('e0000000-0000-4000-8000-0000000000e5',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'configuration_snapshot_available', 1, 12,
   '2026-07-26T00:04:00Z', null, encode(sha256('fixture:inbox:snapshot-7'), 'hex'),
   '{"snapshot_version": 7}'::jsonb, decode('beef0001', 'hex'), 'demo-signing-key-1',
   'applied', '2026-07-26T00:04:30Z', '2026-07-26T00:05:00Z', '2026-07-26T00:10:00Z', null),
  -- Expired command recorded as REJECTED, never silently skipped (offline §8).
  ('e0000000-0000-4000-8000-0000000000e6',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'support_session_grant', 1, 13,
   '2026-07-26T01:00:00Z', '2026-07-26T02:00:00Z',
   encode(sha256('fixture:inbox:expired-grant'), 'hex'),
   '{"reason": "expired"}'::jsonb, decode('beef0002', 'hex'), 'demo-signing-key-1',
   'rejected', '2026-07-26T03:00:00Z', null, null, 'EDGE_INBOX_MESSAGE_EXPIRED')
on conflict do nothing;

insert into edge_sync.sync_conflict
  (id, tenant_id, digital_store_id, location_id, conflict_type, data_class,
   local_event_id, cloud_reference, detected_at, state, severity, local_summary,
   cloud_summary, resolution_code, resolved_by, resolved_at, resolution_event_id)
values
  ('e0000000-0000-4000-8000-0000000000e7',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'customer_projection_divergence',
   'customer', 'e0000000-0000-4000-8000-0000000000d1', 'cloud-customer-ref-demo',
   '2026-07-27T09:55:00Z', 'operator_required', 'medium',
   '{"display_name": "Demo Customer Sreymom"}'::jsonb,
   '{"display_name": "Demo Customer Sreymom (cloud)"}'::jsonb,
   null, null, null, null)
on conflict do nothing;

insert into edge_sync.dead_letter_item
  (id, tenant_id, digital_store_id, location_id, source_kind, source_id, error_code,
   error_message, payload_sha256, first_failed_at, last_failed_at, attempt_count,
   operator_action_required, resolved_at, resolution_note)
values
  ('e0000000-0000-4000-8000-0000000000e8',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'file_transfer',
   'e0000000-0000-4000-8000-0000000000c1', 'EDGE_ASSET_CHUNK_HASH_MISMATCH',
   'Demo chunk hash mismatch on retry.',
   encode(sha256('fixture:deadletter:chunk'), 'hex'),
   '2026-07-27T09:00:00Z', '2026-07-27T09:30:00Z', 3, true, null, null)
on conflict do nothing;

-- ADDITIVE EXTENSION fixture (gap G3): a hub_sequence burnt by a rolled-back
-- transaction. It is a KNOWN gap, not a missing event (offline §5).
insert into edge_sync.sequence_gap
  (id, tenant_id, digital_store_id, location_id, assignment_generation, hub_sequence,
   gap_reason, detected_at, recorded_by, note)
values
  ('e0000000-0000-4000-8000-0000000000e9',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 1, 5, 'transaction_rollback',
   '2026-07-27T09:35:00Z', 'kitluy-hub-agent',
   'Demo rollback after a validation failure; the value is never reused.')
on conflict do nothing;

-- ADDITIVE EXTENSION fixtures (gap G3): the immutable command-result ledger.
insert into edge_sync.command_result
  (id, tenant_id, digital_store_id, location_id, idempotency_key, request_hash,
   command_type, actor_id, terminal_device_id, origin_sequence, assignment_generation,
   aggregate_type, aggregate_id, aggregate_version, request_id, event_ids,
   hub_sequence_first, hub_sequence_last, sync_state, commit_status, error_code,
   result_json, created_at, completed_at)
values
  -- PERSONA: duplicate-command fixture. A retry of this key with the SAME
  -- request hash must return THIS stored result and create no new events
  -- (offline §19 row 1; §12 acceptance test 2).
  ('e0000000-0000-4000-8000-0000000000f0',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003',
   'kl1.e0000000-0000-4000-8000-000000000020.1001',
   encode(sha256('fixture:request-hash:cash-payment-3000'), 'hex'),
   'payments.record_cash_payment', 'e0000000-0000-4000-8000-000000000040',
   'e0000000-0000-4000-8000-000000000020', 1001, 1, 'payment',
   'e0000000-0000-4000-8000-000000000090', 1,
   'e0000000-0000-4000-8000-0000000000f5',
   array['e0000000-0000-4000-8000-0000000000d2']::uuid[], 2, 2,
   'committed_locally', 'committed', null,
   '{"payment_number": "KLP-PP001-260727-000001"}'::jsonb,
   '2026-07-27T08:15:00Z', '2026-07-27T08:15:02Z'),
  -- PERSONA: stale-command fixture. A lower terminal sequence arrived after
  -- 1001 was accepted: replay rejected, nothing written (offline §19 row 4).
  ('e0000000-0000-4000-8000-0000000000f1',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003',
   'kl1.e0000000-0000-4000-8000-000000000020.999',
   encode(sha256('fixture:request-hash:stale-intake'), 'hex'),
   'laundry.confirm_intake', 'e0000000-0000-4000-8000-000000000040',
   'e0000000-0000-4000-8000-000000000020', 999, 1, 'booking',
   null, null, 'e0000000-0000-4000-8000-0000000000f6',
   array[]::uuid[], null, null,
   'reconciliation_required', 'rejected', 'EDGE_SEQUENCE_REPLAY_REJECTED',
   '{"expected_origin_sequence": 1002}'::jsonb,
   '2026-07-27T08:16:00Z', '2026-07-27T08:16:00Z'),
  -- A stale AGGREGATE version: rejected before any business effect (offline §6).
  ('e0000000-0000-4000-8000-0000000000f2',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003',
   'kl1.e0000000-0000-4000-8000-000000000023.4000',
   encode(sha256('fixture:request-hash:stale-pickup'), 'hex'),
   'laundry.complete_pickup', 'e0000000-0000-4000-8000-000000000042',
   'e0000000-0000-4000-8000-000000000023', 4000, 1, 'booking',
   'e0000000-0000-4000-8000-000000000070', 2,
   'e0000000-0000-4000-8000-0000000000f7', array[]::uuid[], null, null,
   'reconciliation_required', 'rejected', 'EDGE_AGGREGATE_VERSION_CONFLICT',
   '{"expected_version": 2, "actual_version": 4}'::jsonb,
   '2026-07-27T09:41:00Z', '2026-07-27T09:41:00Z')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 12. Audit and security (§6.10).
-- ---------------------------------------------------------------------------
insert into edge_audit.audit_event
  (id, tenant_id, digital_store_id, location_id, event_code, actor_type, actor_id,
   requester_id, approver_id, terminal_device_id, hub_device_id, profile_code,
   resource_type, resource_id, reason_code, correlation_id, occurred_at,
   payload_sha256, details_json, local_sequence)
values
  ('e0000000-0000-4000-8000-0000000000f8',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'booking.intake_confirmed', 'staff',
   'e0000000-0000-4000-8000-000000000040', null, null,
   'e0000000-0000-4000-8000-000000000020', 'e0000000-0000-4000-8000-000000000010',
   'laundry.t1.intake_cashier', 'booking', 'e0000000-0000-4000-8000-000000000070',
   null, 'e0000000-0000-4000-8000-0000000000f5', '2026-07-27T08:06:00Z',
   encode(sha256('fixture:audit:intake'), 'hex'), '{}'::jsonb, 1),
  -- Four-eyes evidence: requester and approver are DIFFERENT people.
  ('e0000000-0000-4000-8000-0000000000f9',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'payment.refund_approved', 'staff',
   'e0000000-0000-4000-8000-000000000043', 'e0000000-0000-4000-8000-000000000040',
   'e0000000-0000-4000-8000-000000000043', 'e0000000-0000-4000-8000-000000000020',
   'e0000000-0000-4000-8000-000000000010', 'laundry.t1.intake_cashier',
   'refund_adjustment', 'e0000000-0000-4000-8000-000000000094',
   'service_not_delivered', 'e0000000-0000-4000-8000-0000000000fa',
   '2026-07-27T09:30:00Z', encode(sha256('fixture:audit:refund'), 'hex'),
   '{}'::jsonb, 2),
  -- The unauthorized actor's blocked attempt is EVIDENCE, not a silent drop.
  ('e0000000-0000-4000-8000-0000000000fb',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'authorization.denied', 'staff',
   'e0000000-0000-4000-8000-000000000044', null, null,
   'e0000000-0000-4000-8000-000000000020', 'e0000000-0000-4000-8000-000000000010',
   null, 'booking', 'e0000000-0000-4000-8000-000000000070', 'no_profile_grant',
   'e0000000-0000-4000-8000-0000000000fc', '2026-07-27T08:30:00Z',
   encode(sha256('fixture:audit:denied'), 'hex'),
   '{"reason": "actor holds no logical profile and is disabled"}'::jsonb, 3)
on conflict do nothing;

insert into edge_audit.security_event
  (id, tenant_id, digital_store_id, location_id, event_code, severity, device_id,
   certificate_serial, source_ip, detected_at, details_json, acknowledged_by,
   acknowledged_at, cloud_synced_at)
values
  -- Reused idempotency key with a DIFFERENT request hash (offline §3, §19 row 3).
  ('e0000000-0000-4000-8000-0000000000fd',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH',
   'high', 'e0000000-0000-4000-8000-000000000020', 'DEMO-TERM-CERT-T1',
   '192.0.2.31'::inet, '2026-07-27T08:17:00Z',
   '{"idempotency_key": "kl1.e0000000-0000-4000-8000-000000000020.1001"}'::jsonb,
   null, null, null),
  -- PRE-ASSIGNMENT security event: scope columns are NULL by contract (§6.10).
  ('e0000000-0000-4000-8000-0000000000fe',
   null, null, null, 'EDGE_UNPAIRED_DEVICE_CONNECT_ATTEMPT', 'medium',
   'e0000000-0000-4000-8000-000000000024', 'DEMO-TERM-CERT-REVOKED',
   '192.0.2.99'::inet, '2026-07-20T09:05:00Z',
   '{"reason": "revoked certificate presented"}'::jsonb, null, null, null)
on conflict do nothing;

insert into edge_audit.support_session
  (id, tenant_id, digital_store_id, location_id, support_actor_id, approved_by,
   reason, scopes, started_at, expires_at, revoked_at, status, consent_evidence_id,
   session_public_key, last_activity_at)
values
  ('e0000000-0000-4000-8000-0000000000ff',
   'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000f20',
   'e0000000-0000-4000-8000-000000000043', 'Demo sync backlog diagnosis',
   array['support.read.sync_health'], '2026-07-27T10:00:00Z', '2026-07-27T12:00:00Z',
   null, 'active', 'e0000000-0000-4000-8000-000000000f21',
   decode('5075626c69634b6579', 'hex'), '2026-07-27T10:05:00Z')
on conflict do nothing;

commit;

-- Fixture summary (visible in the seed output).
do $$
declare
  v_events   bigint;
  v_outbox   bigint;
  v_bookings bigint;
begin
  select count(*) into v_events from edge_sync.local_event;
  select count(*) into v_outbox from edge_sync.outbox;
  select count(*) into v_bookings from edge_laundry.booking;
  raise notice 'hub dev-fixtures: % local_event(s), % outbox row(s), % booking(s) (1 in-scope + 2 attacker personas).',
    v_events, v_outbox, v_bookings;
end $$;
