-- kitluy:hub:migration:0014
-- ===========================================================================
-- KitLuy Store Hub local database — canonical reference profiles.
--
-- Authority: kitluy-hardware-compatibility-matrix-phase1-v1.0.0.md §2
-- (baseline model matrix). These are CONTRACT-NAMED models, not invented
-- values, and they are reference data rather than business data — the same
-- rows exist on every Hub, which is why the identifiers are deterministic
-- rather than application-generated UUIDv7 (§1).
--
-- TRUTH LABELS (matrix §1 and its integrity rule):
--   certification_status = 'target_certification' — the exact model selected
--   for the Phase 1 certification campaign. It is NOT 'kitluy_certified':
--   no model becomes certified until a KitLuy hardware evidence record holds
--   the tested revision, firmware, driver, OS image, results and approver.
--   certification_evidence_id is therefore NULL, not a placeholder.
--
-- Values that are genuinely unknown stay marked and are NEVER guessed
-- (repository rule 9): driver_id, driver_version and minimum_hub_version are
-- pinned by the certification campaign, so they carry an explicit
-- [REQUIRED: ...] marker until that evidence exists.
--
-- Idempotent: fixed identifiers + ON CONFLICT DO NOTHING, so re-running this
-- migration on an already-provisioned Hub changes zero rows.
-- ===========================================================================

insert into edge_config.hardware_profile
  (id, profile_code, device_class, manufacturer, model, hardware_revision,
   interface_type, driver_id, driver_version, capabilities_json,
   certification_status, certification_evidence_id, minimum_hub_version, created_at)
values
  ('10000000-0000-4000-8000-000000000001', 'hw.compute.store_hub',
   'store_hub_compute', 'Raspberry Pi', 'Raspberry Pi 5 8GB', 'rev-baseline',
   'arm64_ethernet', '[REQUIRED: certified driver id]', '[REQUIRED: certified driver version]',
   '{"ram_gb": 8, "pcie_mode": "gen2", "active_cooling_required": true}'::jsonb,
   'target_certification', null, '[REQUIRED: minimum Hub release]', '2026-07-27T00:00:00Z'),

  ('10000000-0000-4000-8000-000000000002', 'hw.compute.terminal',
   'terminal_compute', 'Raspberry Pi', 'Raspberry Pi 5 4GB', 'rev-baseline',
   'arm64_hdmi_usb', '[REQUIRED: certified driver id]', '[REQUIRED: certified driver version]',
   '{"ram_gb": 4}'::jsonb,
   'target_certification', null, '[REQUIRED: minimum Hub release]', '2026-07-27T00:00:00Z'),

  ('10000000-0000-4000-8000-000000000003', 'hw.display.t1_touchscreen',
   'operator_display', 'Waveshare', '15.6inch HDMI LCD (H)', 'rev-baseline',
   'hdmi_usb_touch', '[REQUIRED: certified driver id]', '[REQUIRED: certified driver version]',
   '{"resolution": "1920x1080", "touch": "capacitive_10_point"}'::jsonb,
   'target_certification', null, '[REQUIRED: minimum Hub release]', '2026-07-27T00:00:00Z'),

  ('10000000-0000-4000-8000-000000000004', 'hw.display.t2_customer',
   'customer_display', 'Waveshare', '10.1inch HDMI LCD (B)', 'rev-baseline',
   'hdmi_usb_touch', '[REQUIRED: certified driver id]', '[REQUIRED: certified driver version]',
   '{"resolution": "1280x800", "touch": "capacitive"}'::jsonb,
   'target_certification', null, '[REQUIRED: minimum Hub release]', '2026-07-27T00:00:00Z'),

  ('10000000-0000-4000-8000-000000000005', 'hw.printer.receipt',
   'receipt_printer', 'Epson', 'TM-T20III', 'rev-baseline',
   'ethernet_usb', '[REQUIRED: certified driver id]', '[REQUIRED: certified driver version]',
   '{"command_language": "esc_pos", "paper_mm": 80, "drawer_kick": true}'::jsonb,
   'target_certification', null, '[REQUIRED: minimum Hub release]', '2026-07-27T00:00:00Z'),

  ('10000000-0000-4000-8000-000000000006', 'hw.printer.tag',
   'tag_printer', 'TSC', 'TE210', 'rev-baseline',
   'ethernet_usb_serial', '[REQUIRED: certified driver id]', '[REQUIRED: certified driver version]',
   '{"dpi": 203, "media_inch": 4}'::jsonb,
   'target_certification', null, '[REQUIRED: minimum Hub release]', '2026-07-27T00:00:00Z'),

  ('10000000-0000-4000-8000-000000000007', 'hw.scanner.handheld',
   'scanner', 'Zebra', 'DS2208-SR', 'rev-baseline',
   'usb_hid', '[REQUIRED: certified driver id]', '[REQUIRED: certified driver version]',
   '{"symbologies": ["code128", "qr"], "corded": true}'::jsonb,
   'target_certification', null, '[REQUIRED: minimum Hub release]', '2026-07-27T00:00:00Z'),

  ('10000000-0000-4000-8000-000000000008', 'hw.scale.intake',
   'scale', 'Adam Equipment', 'GBK-S 32', 'rev-baseline',
   'rs232', '[REQUIRED: certified driver id]', '[REQUIRED: certified driver version]',
   '{"capacity_kg": 32, "readability_g": 1}'::jsonb,
   'target_certification', null, '[REQUIRED: minimum Hub release]', '2026-07-27T00:00:00Z'),

  ('10000000-0000-4000-8000-000000000009', 'hw.cash_drawer.t1',
   'cash_drawer', 'APG', 'Vasario VB320-1-BL1616-B5', 'rev-baseline',
   'printer_multipro_320', '[REQUIRED: certified driver id]', '[REQUIRED: certified driver version]',
   '{"bill_slots": 4, "coin_slots": 8, "voltage": 24}'::jsonb,
   'target_certification', null, '[REQUIRED: minimum Hub release]', '2026-07-27T00:00:00Z')
on conflict (id) do nothing;

comment on column edge_config.hardware_profile.certification_status is
  'Matrix §1 labels. `target_certification` means SELECTED FOR the campaign; only a KitLuy hardware evidence record may promote a row to `kitluy_certified`. Generic "ESC/POS compatible" or "ZPL compatible" substitutes are never equivalent (matrix §3.4).';
