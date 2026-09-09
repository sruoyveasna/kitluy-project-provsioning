-- ===========================================================================
-- Group 0216 — DEVICE REGISTRATION SIGHTINGS
-- ===========================================================================
-- Authority: OD-EDGE-LIVENESS-001 (development liveness thresholds, 2026-08-10)
--   extended to the PRE-APPROVAL stage it did not cover; owner request
--   2026-09-08 (track liveness for approved devices; hide a pending device from
--   the approval queue once it is no longer there).
--
-- ---------------------------------------------------------------------------
-- WHAT WAS MISSING, AND WHY IT WAS INVISIBLE
-- ---------------------------------------------------------------------------
-- `device_fleet_status.last_observed_at` reads
-- `max(device_hardware_observations.observed_at)`. That table records HARDWARE
-- EVIDENCE COMPARISONS made during enrolment — it is not a heartbeat, and for a
-- board that has registered but never enrolled it is empty. So every pending
-- device reported `last_observed_at = never`, and an Admin could not tell a
-- board that had been unplugged for a day from one powering up in the next room.
--
-- Meanwhile the board WAS calling home: `bin/cloud-registration.ts` polls every
-- POLL_SECONDS = 60 while it waits for approval. The signal existed; nothing
-- recorded that it had arrived.
--
-- This records it, and deliberately does not overload the existing table:
-- "we compared this board's evidence" and "we heard from this board" are
-- different facts, and collapsing them would corrupt a governed meaning.
--
-- ---------------------------------------------------------------------------
-- WHY A SEPARATE TABLE AND NOT A COLUMN ON `devices`
-- ---------------------------------------------------------------------------
-- `kitluy_devices.devices` carries five triggers — identity immutability,
-- lifecycle transition, delete refusal, production eligibility and the
-- activation authority guard. A column updated every 60 seconds per device
-- would fire all five on every heartbeat, for a value that authorises nothing.
-- One row per device, upserted, keeps the hot write off the guarded table.
--
-- ---------------------------------------------------------------------------
-- THIS TABLE IS NOT EVIDENCE, AND IS DELIBERATELY NOT APPEND-ONLY
-- ---------------------------------------------------------------------------
-- Everything in this schema that carries an append-only trigger is EVIDENCE: a
-- claim, a containment, a credential decision. A sighting is CURRENT STATE — the
-- answer to "is it there now" — and keeping 1,440 rows per device per day to
-- answer it would be a log, not a fact. `sighting_count` preserves the only part
-- of the history worth keeping: that the board has been talking, and how much.
-- Nothing here authorises anything and no lifecycle decision may read it.
-- ===========================================================================

create table if not exists kitluy_devices.device_registration_sightings (
  device_id             uuid primary key
                          references kitluy_devices.devices(id) on delete restrict,
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  -- How many times the board has announced itself. Monotonic; a reset would
  -- lose the only durable trace that this row was ever refreshed.
  sighting_count        bigint      not null default 1,
  -- The installation the most recent sighting belonged to. A re-flashed card is
  -- a new installation of the SAME device, so a change here is how "the card was
  -- rewritten" becomes visible without inventing a second device.
  last_installation_id  uuid        null
                          references kitluy_devices.device_installations(id) on delete set null,
  updated_at            timestamptz not null default now()
);

comment on table kitluy_devices.device_registration_sightings is
  'One row per device: when the board last announced itself to the registration intake. CURRENT STATE, not evidence — deliberately mutable and deliberately not append-only. Authorises nothing; no lifecycle decision may read it. Fed by record_device_sighting_v1 from the registration edge function, whose agent polls every 60s while awaiting approval (OD-EDGE-LIVENESS-001).';

create index if not exists device_registration_sightings_last_seen_idx
  on kitluy_devices.device_registration_sightings (last_seen_at desc);

-- ---------------------------------------------------------------------------
-- The door. One statement, no reach.
-- ---------------------------------------------------------------------------
-- Takes a device id the caller has ALREADY obtained from register_device_v1 in
-- the same transaction, so it grants no ability to discover or enumerate
-- devices. It cannot create a device, cannot change a lifecycle, and returns
-- nothing a caller could use to learn about a board it did not just register.
create or replace function kitluy_devices.record_device_sighting_v1(
  p_device_id       uuid,
  p_installation_id uuid default null)
returns void
language plpgsql
security definer
set search_path = kitluy_devices, pg_catalog, pg_temp
as $sighting$
begin
  if p_device_id is null then
    return;
  end if;

  -- A sighting for a device that does not exist is silently ignored rather than
  -- raised: this is called on the success path of a registration, and a failure
  -- to record liveness must never turn a successful registration into an error
  -- the board then retries forever.
  if not exists (select 1 from kitluy_devices.devices d where d.id = p_device_id) then
    return;
  end if;

  insert into kitluy_devices.device_registration_sightings
    (device_id, first_seen_at, last_seen_at, sighting_count, last_installation_id, updated_at)
  values (p_device_id, now(), now(), 1, p_installation_id, now())
  on conflict (device_id) do update
    set last_seen_at         = now(),
        sighting_count       = kitluy_devices.device_registration_sightings.sighting_count + 1,
        last_installation_id = coalesce(excluded.last_installation_id,
                                        kitluy_devices.device_registration_sightings.last_installation_id),
        updated_at           = now();
end;
$sighting$;

comment on function kitluy_devices.record_device_sighting_v1 is
  'Records that a device announced itself. Called on the success path of the registration intake with a device id that call just produced. Creates nothing, decides nothing, and never raises — a liveness write must not fail a registration.';

revoke all on function kitluy_devices.record_device_sighting_v1(uuid, uuid) from public;
revoke all on function kitluy_devices.record_device_sighting_v1(uuid, uuid) from anon;
revoke all on function kitluy_devices.record_device_sighting_v1(uuid, uuid) from authenticated;
grant execute on function kitluy_devices.record_device_sighting_v1(uuid, uuid)
  to kitluy_device_registration_service;

alter table kitluy_devices.device_registration_sightings enable row level security;
alter table kitluy_devices.device_registration_sightings force row level security;

-- ---------------------------------------------------------------------------
-- The fleet read model gains last_seen_at / sighting_count.
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE, and it must be: `kitluy_devices.fleet_health_read` is
-- defined on top of this view, so dropping it is refused (and dropping it with
-- CASCADE would silently take that dependent view with it).
--
-- Replace only permits APPENDING columns with every existing one unchanged,
-- which is exactly this change: 0122's body verbatim, two columns added at the
-- end. Any edit above them would be a change to 0122's meaning and does not
-- belong in this group — and would be rejected here anyway.
create or replace view kitluy_devices.device_fleet_status as
select
  d.id as device_record_id,
  d.asset_tag,
  d.device_class,
  d.lifecycle_state,
  d.hardware_trust_level,
  d.production_eligible,
  d.assignment_generation,
  hp.profile_key,
  e.enrollment_sequence,
  e.device_public_key_fingerprint,
  e.key_storage_class,
  m.manifest_sha256,
  m.signal_count,
  a.tenant_id,
  a.digital_store_id,
  a.store_location_id,
  a.state as assignment_state,
  (select count(*) from kitluy_devices.device_terminal_assignments t
    where t.assignment_id = a.id and t.state <> 'revoked') as terminal_assignment_count,
  (select count(*) from kitluy_devices.device_trust_incidents ti
    where ti.device_id = d.id and ti.cleared_at is null
      and ti.incident_type <> 'activation_blocked') as open_incident_count,
  (select count(*) from kitluy_devices.colliding_evidence_device_ids(d.id)) as evidence_collision_count,
  (select max(o.observed_at) from kitluy_devices.device_hardware_observations o
    where o.device_id = d.id) as last_observed_at,
  (select c.status from kitluy_devices.device_certificates c
    where c.device_id = d.id and c.status = 'active' limit 1) as certificate_status,
  -- The most specific TRUE reason wins. A fleet view that reports a generic
  -- "awaiting activation" while four different gates are shut is how a blocked
  -- programme comes to look merely pending.
  case
    when d.lifecycle_state = 'active' then 'ACTIVE'
    when d.lifecycle_state in ('retired', 'replaced') then upper(d.lifecycle_state::text)
    when d.lifecycle_state = 'quarantined' then 'QUARANTINED'
    -- Compared as TEXT deliberately. The migration runner wraps this file in a
    -- transaction, and PostgreSQL refuses to resolve an enum value added in the
    -- same transaction; a view body is parsed at creation, unlike a function
    -- body. Casting sidesteps that without splitting the migration.
    when d.lifecycle_state::text = 'restricted_investigation' then 'RESTRICTED_INVESTIGATION'
    when (select count(*) from kitluy_devices.colliding_evidence_device_ids(d.id)) > 0
      then 'BLOCKED_EVIDENCE_COLLISION'
    when a.id is null then 'AWAITING_CLAIM'
    when not d.production_eligible then 'BLOCKED_PRODUCTION_INELIGIBLE'
    when not exists (select 1 from kitluy_devices.pki_trust_configuration p where p.is_active)
      then 'BLOCKED_PKI_UNCONFIGURED'
    else 'AWAITING_ACTIVATION'
  end as fleet_status,
  -- ADDED BY 0216. Liveness for a board that has not enrolled yet.
  --
  -- `last_observed_at` above is the last hardware-evidence COMPARISON — an
  -- enrolment-time fact, and null for every pending device. This is the last time
  -- the board ANNOUNCED ITSELF to the registration intake: the signal its own
  -- agent has been sending every 60 seconds all along, previously discarded.
  -- Two different questions, two columns; neither replaces the other.
  (select s.last_seen_at from kitluy_devices.device_registration_sightings s
    where s.device_id = d.id) as last_seen_at,
  (select s.sighting_count from kitluy_devices.device_registration_sightings s
    where s.device_id = d.id) as sighting_count
from kitluy_devices.devices d
join kitluy_devices.hardware_profiles hp on hp.id = d.hardware_profile_id
left join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
left join kitluy_devices.hardware_manifests m on m.id = e.hardware_manifest_id
left join kitluy_devices.device_assignments a
  on a.device_id = d.id and a.state in ('pending_trust', 'active');

comment on view kitluy_devices.device_fleet_status is
  'Fleet status read model. Reports the most specific TRUE blocker. Extended by 0216 with last_seen_at / sighting_count: registration-intake liveness, which is the only liveness a device has before it enrols.';

grant select on kitluy_devices.device_fleet_status to service_role;
