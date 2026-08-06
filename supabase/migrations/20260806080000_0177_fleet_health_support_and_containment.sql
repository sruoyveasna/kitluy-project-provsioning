-- kitluy:group:0177
-- Migration group 0177: fleet_health_support_and_containment.
--
-- Authority: WS-11-T005 (KLD-2026-08-06-WS11-REMAINING-TASKS-001 — Device
-- Fleet Health, Support Access and Incident Containment); master plan §WS-11
-- (fleet health, support consent, revocation/containment); Store Hub spec
-- §12.5/§16.1-16.2 (health domains and metrics; "Admin and Partner surfaces
-- consume cloud-reported health with freshness labels. The Hub retains the
-- local authoritative observation."); support-access and consent policy
-- v1.0.0 §2-§5, §7, §11; sensitive-action and four-eyes policy v1.0.0 §3/§7;
-- KLD-2026-07-28-002 §10 (controlled containment, KLRISK-DEVICE-002);
-- data dictionary read model fleet_health_read; prior groups 0110 (KLREQ-026
-- effect keys), 0120-0122 (device lifecycle, quarantine, restricted
-- investigation, stations), 0135/0154 (worker runtime and reachability),
-- 0172/0173 (composition identity + NOINHERIT gateway), 0176 (edge sync
-- ingestion identity and kh1 dedupe).
--
-- ===========================================================================
-- WHO OWNS FLEET TRUTH, AND WHAT THE CLOUD MAY SAY
-- ===========================================================================
-- The Store Hub is authoritative for CURRENT LAN-observed terminal health
-- (Hub spec §12.5). The cloud stores a PROJECTION of the Hub's last report —
-- versioned, with the Hub's observation time and the cloud's receipt time
-- kept apart — and classifies its own freshness instead of presenting stale
-- fleet data as live Store truth. The projection's ordering key is the HUB'S
-- report sequence, never a wall clock: a delayed report cannot overwrite a
-- newer observation, and a clock anomaly cannot silently mint a newer
-- authoritative observation (it is recorded, flagged, and does not advance
-- the projection).
--
-- Containment is a DECISION record here, not a second lifecycle machine: the
-- governed doors below COMPOSE the existing lifecycle authority of groups
-- 0120/0122 (quarantine_device_v1, restricted_investigation, the transition
-- trigger), so a contained device is blocked by the same state machine that
-- already guards activation, issuance and pairing — no duplicate device
-- identity and no duplicate authority is created (T005 package §5).
--
-- Support access is a distinct, scoped, time-bound session: it is not a
-- device credential and not a Store staff session; it stores no token, no
-- key and no database credential — there is nothing in these rows a support
-- operator could replay to reach the database (support policy §2, §7).
-- ===========================================================================
-- kitluy:destructive-approved:KLD-2026-08-06-WS11-REMAINING-TASKS-001 -- no
-- DROP/TRUNCATE/DELETE in this group; the marker is present so the
-- destructive-guard never reads a future edit of this file as unmarked
-- history.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. IDENTITIES
-- ---------------------------------------------------------------------------
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_fleet_governor') then
    create role kitluy_fleet_governor nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'kitluy_fleet_service') then
    create role kitluy_fleet_service nologin;
  end if;
  -- The 0173 hinge pattern: a NOINHERIT NOLOGIN gateway so `service_role`
  -- does not silently CARRY fleet-operations capability, while membership
  -- stays transitive so SET LOCAL ROLE still reaches it for one transaction.
  if not exists (select 1 from pg_roles where rolname = 'kitluy_fleet_gateway') then
    create role kitluy_fleet_gateway nologin noinherit;
  end if;
end
$roles$;

comment on role kitluy_fleet_governor is
  'Group 0177 (WS-11-T005). Owns the fleet health projection, support-access and containment tables and every door over them. NOLOGIN; current_user can equal it only inside a door.';
comment on role kitluy_fleet_service is
  'Group 0177 (WS-11-T005). The identity the admin/partner-facing fleet service ENTERS for one transaction (SET LOCAL ROLE). Holds EXECUTE on the fleet operator doors and read access to fleet_health_read, and no table reach of its own.';
comment on role kitluy_fleet_gateway is
  'Group 0177 (WS-11-T005). NOLOGIN + NOINHERIT hinge (0173 pattern): service_role reaches kitluy_fleet_service only through an explicit SET LOCAL ROLE, never by inheritance.';

grant kitluy_fleet_service to kitluy_fleet_gateway;
grant kitluy_fleet_gateway to service_role;

grant usage, create on schema kitluy_devices to kitluy_fleet_governor;
grant usage on schema extensions to kitluy_fleet_governor;
grant usage on schema kitluy_devices to kitluy_fleet_service;
-- kitluy_edge_sync_service (0176) and kitluy_worker_service (0154) already
-- hold USAGE on kitluy_devices; re-granted here so this group states its own
-- reachability (RC-028 lesson) instead of inheriting it silently.
grant usage on schema kitluy_devices to kitluy_edge_sync_service;
grant usage on schema kitluy_devices to kitluy_worker_service;

-- Ownership borrow, same as groups 0125-0176: the applying role is not a
-- member of the NOLOGIN definer owner, so `alter ... owner to` would fail
-- `42501 must be member of role`. Handed back at the end of this file.
do $borrow$
begin
  execute format('grant kitluy_fleet_governor to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1b. COMPOSING THE 0120/0122 LIFECYCLE AUTHORITY
-- ---------------------------------------------------------------------------
-- The containment doors below COMPOSE quarantine_device_v1,
-- escalate_incumbent_containment_v1 and record_lifecycle_event rather than
-- duplicating them. Those group-0120/0122 functions are PLAIN (not definer)
-- and execute-granted to service_role only, and their tables are FORCE-RLS
-- with zero policies — so the fleet governor is given exactly the reach the
-- composition needs, and nothing else (the 0155 over-grant lesson: minimal,
-- named, recorded).
grant execute on function kitluy_devices.quarantine_device_v1(uuid, kitluy_devices.trust_incident_type, text, text, text, jsonb) to kitluy_fleet_governor;
grant execute on function kitluy_devices.escalate_incumbent_containment_v1(uuid, text, text, text, text) to kitluy_fleet_governor;
grant execute on function kitluy_devices.record_lifecycle_event(uuid, kitluy_devices.device_lifecycle_state, kitluy_devices.device_lifecycle_state, text, text, jsonb) to kitluy_fleet_governor;

grant select, update on kitluy_devices.devices to kitluy_fleet_governor;
grant select, insert, update on kitluy_devices.device_trust_incidents to kitluy_fleet_governor;
grant select, insert on kitluy_devices.device_lifecycle_events to kitluy_fleet_governor;
grant select on kitluy_devices.device_assignments to kitluy_fleet_governor;
grant select on kitluy_devices.device_fleet_status to kitluy_fleet_governor;

drop policy if exists devices_fleet_governor on kitluy_devices.devices;
create policy devices_fleet_governor on kitluy_devices.devices
  for all to kitluy_fleet_governor using (true) with check (true);
drop policy if exists dti_fleet_governor on kitluy_devices.device_trust_incidents;
create policy dti_fleet_governor on kitluy_devices.device_trust_incidents
  for all to kitluy_fleet_governor using (true) with check (true);
drop policy if exists dle_fleet_governor on kitluy_devices.device_lifecycle_events;
create policy dle_fleet_governor on kitluy_devices.device_lifecycle_events
  for all to kitluy_fleet_governor using (true) with check (true);
drop policy if exists da_fleet_governor on kitluy_devices.device_assignments;
create policy da_fleet_governor on kitluy_devices.device_assignments
  for all to kitluy_fleet_governor using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 2. FLEET HEALTH POLICY — configurable thresholds, never hardcoded policy
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.fleet_health_policy (
  environment text primary key,
  -- Development defaults below are DEVELOPMENT VALUES, recorded in the
  -- open-decisions register as [REQUIRED: approved monitoring thresholds]
  -- (Hub spec §16.2 closing line). The configuration owner is the fleet
  -- security owner. They are columns, not constants, precisely so approving
  -- real values is a data change, not a migration.
  heartbeat_interval_seconds integer not null,
  projection_stale_after_seconds integer not null,
  allowed_clock_skew_seconds integer not null,
  support_session_max_minutes integer not null,
  decision_ref text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fleet_health_policy_env_chk
    check (environment in ('development', 'pilot', 'production')),
  constraint fleet_health_policy_positive_chk
    check (heartbeat_interval_seconds > 0
       and projection_stale_after_seconds > 0
       and allowed_clock_skew_seconds >= 0
       and support_session_max_minutes > 0),
  constraint fleet_health_policy_ordering_chk
    check (projection_stale_after_seconds >= heartbeat_interval_seconds)
);

comment on table kitluy_devices.fleet_health_policy is
  'Group 0177 (WS-11-T005). Governed fleet health/freshness/support thresholds per environment. Development row seeded below; pilot/production rows are REFUSED by trigger until they arrive through signed configuration with an owner decision (0123 trust_policy discipline; BLK-005/BLK-006). MC: MUT (governor only).';

create or replace function kitluy_devices.enforce_fleet_policy_governed()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-FLEET-POLICY-IMMUTABLE: fleet health policy rows are corrected, never deleted'
      using errcode = 'P0001';
  end if;
  if current_user <> 'kitluy_fleet_governor' then
    raise exception 'KLUY-FLEET-POLICY-GOVERNED: fleet health policy changes only through governed doors (group 0177)'
      using errcode = 'P0001';
  end if;
  if new.environment in ('pilot', 'production') then
    -- Owner ruling 2026-07-28 (0123 precedent): pilot and production values
    -- must come from signed configuration; no code default may silently
    -- authorize them. The signed-configuration producer is BLK-006-gated, so
    -- today this refusal is total — and honest.
    raise exception 'KLUY-FLEET-POLICY-UNSIGNED: a % fleet policy must come from signed configuration; [REQUIRED: approved monitoring thresholds] - BLK-006 open', new.environment
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fleet_health_policy_governed on kitluy_devices.fleet_health_policy;
create trigger trg_fleet_health_policy_governed
  before insert or update or delete on kitluy_devices.fleet_health_policy
  for each row execute function kitluy_devices.enforce_fleet_policy_governed();

revoke all on function kitluy_devices.enforce_fleet_policy_governed() from public;
alter function kitluy_devices.enforce_fleet_policy_governed() owner to kitluy_fleet_governor;

-- ---------------------------------------------------------------------------
-- 3. HEALTH REPORTS (append-only) AND THE CURRENT PROJECTION
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_health_reports (
  id uuid primary key default extensions.gen_random_uuid(),
  -- KLREQ-026: a Hub-originated fact carries the kh1 effect key; dedupe is
  -- the key itself, exactly as group 0176 rules for pairing receipts.
  effect_key text not null unique,
  reporting_hub_device_id uuid not null references kitluy_devices.devices (id),
  observed_device_id uuid not null references kitluy_devices.devices (id),
  tenant_id uuid not null,
  digital_store_id uuid not null,
  store_location_id uuid not null,
  environment text not null,
  assignment_id uuid not null references kitluy_devices.device_assignments (id),
  assignment_generation integer not null,
  report_sequence bigint not null,
  terminal_profile_key text,
  software_version text,
  configuration_version text,
  release_version text,
  health_classification text not null,
  health_reasons text[] not null default '{}',
  last_local_contact_at timestamptz,
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  accepted boolean not null,
  refusal_code text,
  clock_anomaly boolean not null default false,
  correlation_id uuid,
  constraint dhr_env_chk check (environment in ('development', 'pilot', 'production')),
  constraint dhr_classification_chk
    check (health_classification in ('healthy', 'degraded', 'offline_local', 'unknown')),
  constraint dhr_generation_chk check (assignment_generation >= 1),
  constraint dhr_sequence_chk check (report_sequence >= 1),
  constraint dhr_refusal_consistency_chk check (accepted = (refusal_code is null)),
  constraint dhr_reasons_bounded_chk check (cardinality(health_reasons) <= 32)
);

comment on table kitluy_devices.device_health_reports is
  'Group 0177 (WS-11-T005). Every Hub health report the cloud ever received, accepted or not — append-only history so reconnection reconciles in order without duplicating or rewriting events. Ordering authority is report_sequence (Hub-issued); observed_at is the Hub''s CLAIM of when it looked, never an ordering key. MC: A/O.';

create index if not exists dhr_device_sequence_idx
  on kitluy_devices.device_health_reports (observed_device_id, report_sequence desc);

create table if not exists kitluy_devices.device_health_projections (
  observed_device_id uuid primary key references kitluy_devices.devices (id),
  reporting_hub_device_id uuid not null references kitluy_devices.devices (id),
  tenant_id uuid not null,
  digital_store_id uuid not null,
  store_location_id uuid not null,
  environment text not null,
  assignment_id uuid not null references kitluy_devices.device_assignments (id),
  assignment_generation integer not null,
  projection_version bigint not null,
  terminal_profile_key text,
  software_version text,
  configuration_version text,
  release_version text,
  health_classification text not null,
  health_reasons text[] not null default '{}',
  last_local_contact_at timestamptz,
  observed_at timestamptz not null,
  received_at timestamptz not null,
  correlation_id uuid,
  updated_at timestamptz not null default now(),
  constraint dhp_env_chk check (environment in ('development', 'pilot', 'production')),
  constraint dhp_classification_chk
    check (health_classification in ('healthy', 'degraded', 'offline_local', 'unknown')),
  constraint dhp_generation_chk check (assignment_generation >= 1),
  constraint dhp_version_chk check (projection_version >= 1)
);

comment on table kitluy_devices.device_health_projections is
  'Group 0177 (WS-11-T005). The CURRENT cloud projection of each device''s last reported health — one row per device, advanced idempotently and only forward (projection_version = the accepted report_sequence). This is a projection of Hub authority, never live Store truth: freshness is classified at read time in fleet_health_read. MC: MUT (governor only, via the ingestion door).';

create index if not exists device_health_projections_scope_idx
  on kitluy_devices.device_health_projections (tenant_id, digital_store_id, store_location_id);

create or replace function kitluy_devices.enforce_health_reports_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'KLUY-FLEET-REPORT-IMMUTABLE: device health reports are append-only'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_device_health_reports_append_only on kitluy_devices.device_health_reports;
create trigger trg_device_health_reports_append_only
  before update or delete on kitluy_devices.device_health_reports
  for each row execute function kitluy_devices.enforce_health_reports_append_only();

revoke all on function kitluy_devices.enforce_health_reports_append_only() from public;
alter function kitluy_devices.enforce_health_reports_append_only() owner to kitluy_fleet_governor;

create or replace function kitluy_devices.enforce_health_projection_governed()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-FLEET-PROJECTION-IMMUTABLE: a health projection is superseded, never deleted'
      using errcode = 'P0001';
  end if;
  if current_user <> 'kitluy_fleet_governor' then
    raise exception 'KLUY-FLEET-PROJECTION-GOVERNED: projections change only through the ingestion door (group 0177)'
      using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.projection_version <= old.projection_version then
    -- The door already refuses; this is the schema saying it TOO, so a future
    -- door defect cannot silently move the projection backwards.
    raise exception 'KLUY-FLEET-PROJECTION-BACKWARDS: projection_version % does not advance %', new.projection_version, old.projection_version
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_device_health_projection_governed on kitluy_devices.device_health_projections;
create trigger trg_device_health_projection_governed
  before insert or update or delete on kitluy_devices.device_health_projections
  for each row execute function kitluy_devices.enforce_health_projection_governed();

revoke all on function kitluy_devices.enforce_health_projection_governed() from public;
alter function kitluy_devices.enforce_health_projection_governed() owner to kitluy_fleet_governor;

-- ---------------------------------------------------------------------------
-- 4. THE INGESTION DOOR
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.ingest_device_health_report_v1(
  p_effect_key text,
  p_reporting_hub_device_id uuid,
  p_observed_device_id uuid,
  p_environment text,
  p_assignment_generation integer,
  p_report_sequence bigint,
  p_health_classification text,
  p_health_reasons text[],
  p_terminal_profile_key text,
  p_software_version text,
  p_configuration_version text,
  p_release_version text,
  p_last_local_contact_at timestamptz,
  p_observed_at timestamptz,
  p_correlation_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $ingest$
declare
  v_hub kitluy_devices.devices;
  v_hub_assignment kitluy_devices.device_assignments;
  v_assignment kitluy_devices.device_assignments;
  v_policy kitluy_devices.fleet_health_policy;
  v_existing kitluy_devices.device_health_reports;
  v_projection kitluy_devices.device_health_projections;
  v_anomaly boolean := false;
  v_refusal text;
begin
  if p_effect_key !~ '^kh1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9]+$' then
    raise exception 'KLUY-FLEET-REPORT-REJECTED-SCHEMA: the effect key is not the canonical kh1 shape (KLREQ-026)'
      using errcode = 'P0001';
  end if;

  -- Idempotency FIRST: a redelivered report has exactly one business effect.
  select * into v_existing from kitluy_devices.device_health_reports
   where effect_key = p_effect_key;
  if found then
    return jsonb_build_object('outcome', 'DUPLICATE_IGNORED',
                              'report_id', v_existing.id,
                              'accepted', v_existing.accepted);
  end if;

  select * into v_hub from kitluy_devices.devices
   where id = p_reporting_hub_device_id;
  if not found or v_hub.device_class <> 'store_hub' then
    raise exception 'KLUY-FLEET-REPORT-NOT-HUB: health reports enter only through an enrolled Store Hub identity'
      using errcode = 'P0001';
  end if;

  select * into v_hub_assignment from kitluy_devices.device_assignments
   where device_id = p_reporting_hub_device_id
     and state in ('pending_trust', 'active');
  if not found then
    raise exception 'KLUY-FLEET-REPORT-HUB-UNASSIGNED: the reporting Hub has no live assignment'
      using errcode = 'P0001';
  end if;

  select * into v_assignment from kitluy_devices.device_assignments
   where device_id = p_observed_device_id
     and state in ('pending_trust', 'active');
  if not found then
    raise exception 'KLUY-FLEET-REPORT-DEVICE-UNASSIGNED: the observed device has no live assignment'
      using errcode = 'P0001';
  end if;

  -- Another Hub cannot claim the terminal: the observed device must live in
  -- the SAME Digital Store and Location as the reporting Hub.
  if v_assignment.digital_store_id <> v_hub_assignment.digital_store_id
     or v_assignment.store_location_id <> v_hub_assignment.store_location_id
     or v_assignment.tenant_id <> v_hub_assignment.tenant_id then
    raise exception 'KLUY-FLEET-REPORT-WRONG-HUB: Hub % is not the assigned Hub for device %', p_reporting_hub_device_id, p_observed_device_id
      using errcode = 'P0001';
  end if;

  -- A stale assignment generation is refused, not tolerated (0121 rule).
  if p_assignment_generation <> v_assignment.assignment_generation then
    raise exception 'KLUY-FLEET-REPORT-STALE-GENERATION: reported generation % is not the live generation %', p_assignment_generation, v_assignment.assignment_generation
      using errcode = 'P0001';
  end if;

  if p_environment not in ('development', 'pilot', 'production') then
    raise exception 'KLUY-FLEET-REPORT-ENVIRONMENT: % is not a known environment', p_environment
      using errcode = 'P0001';
  end if;

  if p_health_classification not in ('healthy', 'degraded', 'offline_local', 'unknown') then
    raise exception 'KLUY-FLEET-REPORT-CLASSIFICATION: % is not a known health classification', p_health_classification
      using errcode = 'P0001';
  end if;

  if p_report_sequence is null or p_report_sequence < 1 then
    raise exception 'KLUY-FLEET-REPORT-SEQUENCE: a report must carry the Hub''s positive report sequence'
      using errcode = 'P0001';
  end if;

  select * into v_policy from kitluy_devices.fleet_health_policy
   where environment = p_environment;

  -- Clock anomaly: an observation claimed from the future beyond the allowed
  -- skew is RECORDED and FLAGGED, and does not advance the projection. It is
  -- never silently trusted as the newest observation (T005 package §6).
  if found and p_observed_at > clock_timestamp() + make_interval(secs => v_policy.allowed_clock_skew_seconds) then
    v_anomaly := true;
    v_refusal := 'KLUY-FLEET-REPORT-CLOCK-ANOMALY';
  elsif not found and p_observed_at > clock_timestamp() then
    -- No policy row for this environment: fail closed on any future claim.
    v_anomaly := true;
    v_refusal := 'KLUY-FLEET-REPORT-CLOCK-ANOMALY';
  end if;

  select * into v_projection from kitluy_devices.device_health_projections
   where observed_device_id = p_observed_device_id
   for update;

  if found and p_report_sequence <= v_projection.projection_version then
    -- Delayed delivery: the history keeps the report; the projection does not
    -- move backwards.
    v_refusal := coalesce(v_refusal, 'KLUY-FLEET-REPORT-STALE-SEQUENCE');
  end if;

  insert into kitluy_devices.device_health_reports
    (effect_key, reporting_hub_device_id, observed_device_id, tenant_id,
     digital_store_id, store_location_id, environment, assignment_id,
     assignment_generation, report_sequence, terminal_profile_key,
     software_version, configuration_version, release_version,
     health_classification, health_reasons, last_local_contact_at,
     observed_at, accepted, refusal_code, clock_anomaly, correlation_id)
  values
    (p_effect_key, p_reporting_hub_device_id, p_observed_device_id,
     v_assignment.tenant_id, v_assignment.digital_store_id,
     v_assignment.store_location_id, p_environment, v_assignment.id,
     p_assignment_generation, p_report_sequence, p_terminal_profile_key,
     p_software_version, p_configuration_version, p_release_version,
     p_health_classification, coalesce(p_health_reasons, '{}'), p_last_local_contact_at,
     p_observed_at, v_refusal is null, v_refusal, v_anomaly, p_correlation_id);

  if v_refusal is not null then
    return jsonb_build_object('outcome',
             case when v_anomaly then 'ANOMALY_RECORDED' else 'STALE_IGNORED' end,
             'refusal_code', v_refusal,
             'projection_version',
             coalesce(v_projection.projection_version, 0));
  end if;

  if v_projection.observed_device_id is null then
    insert into kitluy_devices.device_health_projections
      (observed_device_id, reporting_hub_device_id, tenant_id, digital_store_id,
       store_location_id, environment, assignment_id, assignment_generation,
       projection_version, terminal_profile_key, software_version,
       configuration_version, release_version, health_classification,
       health_reasons, last_local_contact_at, observed_at, received_at,
       correlation_id)
    values
      (p_observed_device_id, p_reporting_hub_device_id, v_assignment.tenant_id,
       v_assignment.digital_store_id, v_assignment.store_location_id,
       p_environment, v_assignment.id, p_assignment_generation,
       p_report_sequence, p_terminal_profile_key, p_software_version,
       p_configuration_version, p_release_version, p_health_classification,
       coalesce(p_health_reasons, '{}'), p_last_local_contact_at, p_observed_at,
       now(), p_correlation_id);
  else
    update kitluy_devices.device_health_projections
    set reporting_hub_device_id = p_reporting_hub_device_id,
        assignment_id = v_assignment.id,
        assignment_generation = p_assignment_generation,
        projection_version = p_report_sequence,
        terminal_profile_key = p_terminal_profile_key,
        software_version = p_software_version,
        configuration_version = p_configuration_version,
        release_version = p_release_version,
        health_classification = p_health_classification,
        health_reasons = coalesce(p_health_reasons, '{}'),
        last_local_contact_at = p_last_local_contact_at,
        observed_at = p_observed_at,
        received_at = now(),
        correlation_id = p_correlation_id,
        updated_at = now()
    where observed_device_id = p_observed_device_id;
  end if;

  return jsonb_build_object('outcome', 'PROJECTED',
                            'projection_version', p_report_sequence);
end;
$ingest$;

comment on function kitluy_devices.ingest_device_health_report_v1(text, uuid, uuid, text, integer, bigint, text, text[], text, text, text, text, timestamptz, timestamptz, uuid) is
  'Group 0177 (WS-11-T005). The one door through which Hub health reports enter the cloud. Idempotent on the kh1 effect key; refuses a non-Hub reporter, a foreign Hub, a stale assignment generation; records but never projects a delayed or clock-anomalous report. Executed by kitluy_edge_sync_service only.';

-- ---------------------------------------------------------------------------
-- 5. FRESHNESS CLASSIFICATION AND THE fleet_health_read READ MODEL
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.classify_fleet_freshness_v1(
  p_environment text,
  p_received_at timestamptz
) returns text
language sql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $$
  -- Cloud freshness ONLY. The truth labels the T005 authority model demands
  -- stay separate columns in fleet_health_read: lifecycle (revoked /
  -- quarantined / restricted), containment, and the Hub's reported LOCAL
  -- status are never collapsed into this value.
  select case
    when p_received_at is null then 'UNKNOWN_NO_OBSERVATION'
    when exists (select 1 from kitluy_devices.fleet_health_policy p
                  where p.environment = p_environment
                    and p_received_at >= clock_timestamp()
                        - make_interval(secs => p.projection_stale_after_seconds))
      then 'CURRENT_CLOUD_PROJECTION'
    -- Missing policy row falls through here deliberately: with no governed
    -- threshold the cloud may never claim currency (fail closed).
    else 'STALE_CLOUD_PROJECTION'
  end;
$$;

comment on function kitluy_devices.classify_fleet_freshness_v1(text, timestamptz) is
  'Group 0177 (WS-11-T005). Cloud-projection freshness against the governed per-environment threshold. NULL receipt is UNKNOWN_NO_OBSERVATION; a missing policy row can never yield CURRENT (fail closed).';

-- ---------------------------------------------------------------------------
-- 6. CONTAINMENT STATE AND EVENTS
-- ---------------------------------------------------------------------------
-- Additive trust-incident vocabulary for operator-initiated restriction.
-- Safe under the wrapping transaction: the value is referenced only from
-- plpgsql bodies (parsed at call time), the 0122 discipline.
alter type kitluy_devices.trust_incident_type add value if not exists 'manual_restriction';

create table if not exists kitluy_devices.device_containment_states (
  device_id uuid primary key references kitluy_devices.devices (id),
  containment_state text not null default 'none',
  reason text,
  actor_ref text,
  approved_by_ref text,
  evidence_ref text,
  command_ref text,
  correlation_id uuid,
  prior_lifecycle_state kitluy_devices.device_lifecycle_state,
  incident_id uuid,
  applied_at timestamptz,
  cleared_at timestamptz,
  cleared_by_ref text,
  clearance_approved_by_ref text,
  disposition text,
  clearance_reason text,
  updated_at timestamptz not null default now(),
  constraint dcs_state_chk
    check (containment_state in ('none', 'investigation_flagged', 'operations_restricted', 'suspended', 'quarantined')),
  constraint dcs_active_fields_chk
    check ((containment_state = 'none') or (reason is not null and actor_ref is not null and applied_at is not null)),
  constraint dcs_four_eyes_chk
    check (approved_by_ref is null or actor_ref is null or approved_by_ref <> actor_ref),
  constraint dcs_clearance_four_eyes_chk
    check (clearance_approved_by_ref is null or cleared_by_ref is null or clearance_approved_by_ref <> cleared_by_ref),
  constraint dcs_disposition_chk
    check (disposition is null or disposition in
      ('device_cloning', 'refurbished_hardware', 'approved_board_replacement',
       'approved_nvme_replacement', 'data_entry_or_enrollment_error',
       'malicious_enrollment', 'enrollment_station_compromise', 'operator_recovery'))
);

comment on table kitluy_devices.device_containment_states is
  'Group 0177 (WS-11-T005). The CURRENT containment decision per device — a decision record composing the 0120/0122 lifecycle authority, never a second lifecycle machine. Dispositions are the seven KLD-2026-07-28-002 §10 runbook classes plus operator_recovery for containments unrelated to duplicate evidence. MC: MUT (governor only).';

create table if not exists kitluy_devices.device_containment_events (
  id uuid primary key default extensions.gen_random_uuid(),
  device_id uuid not null references kitluy_devices.devices (id),
  event_type text not null,
  containment_state text not null,
  reason text not null,
  actor_ref text not null,
  approved_by_ref text,
  evidence_ref text,
  command_ref text,
  correlation_id uuid,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint dce_type_chk
    check (event_type in ('CONTAINMENT_APPLIED', 'CONTAINMENT_ESCALATED', 'CONTAINMENT_CLEARED')),
  constraint dce_detail_bounded_chk check (pg_column_size(detail) <= 8192)
);

comment on table kitluy_devices.device_containment_events is
  'Group 0177 (WS-11-T005). Append-only containment history: every apply, escalate and clear with actor, reason, scope, approval and correlation. Recovery is an explicit audited action — clearing NEVER deletes these rows. MC: A/O.';

create unique index if not exists dce_command_ref_uidx
  on kitluy_devices.device_containment_events (command_ref)
  where command_ref is not null;

create or replace function kitluy_devices.enforce_containment_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'KLUY-FLEET-CONTAINMENT-EVENT-IMMUTABLE: containment events are append-only'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_device_containment_events_append_only on kitluy_devices.device_containment_events;
create trigger trg_device_containment_events_append_only
  before update or delete on kitluy_devices.device_containment_events
  for each row execute function kitluy_devices.enforce_containment_events_append_only();

revoke all on function kitluy_devices.enforce_containment_events_append_only() from public;
alter function kitluy_devices.enforce_containment_events_append_only() owner to kitluy_fleet_governor;

create or replace function kitluy_devices.enforce_containment_state_governed()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-FLEET-CONTAINMENT-IMMUTABLE: a containment record is cleared through the recovery door, never deleted'
      using errcode = 'P0001';
  end if;
  if current_user <> 'kitluy_fleet_governor' then
    raise exception 'KLUY-FLEET-CONTAINMENT-GOVERNED: containment changes only through governed doors (group 0177)'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_device_containment_state_governed on kitluy_devices.device_containment_states;
create trigger trg_device_containment_state_governed
  before insert or update or delete on kitluy_devices.device_containment_states
  for each row execute function kitluy_devices.enforce_containment_state_governed();

revoke all on function kitluy_devices.enforce_containment_state_governed() from public;
alter function kitluy_devices.enforce_containment_state_governed() owner to kitluy_fleet_governor;

-- ---------------------------------------------------------------------------
-- 7. CONTAINMENT DOORS
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.apply_device_containment_v1(
  p_device_id uuid,
  p_containment_state text,
  p_reason text,
  p_actor_ref text,
  p_approved_by_ref text default null,
  p_evidence_ref text default null,
  p_command_ref text default null,
  p_expected_digital_store_id uuid default null,
  p_expected_assignment_generation integer default null,
  p_correlation_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $contain$
declare
  v_device kitluy_devices.devices;
  v_assignment kitluy_devices.device_assignments;
  v_current kitluy_devices.device_containment_states;
  v_incident uuid;
  v_prior kitluy_devices.device_lifecycle_state;
  v_replayed kitluy_devices.device_containment_events;
begin
  if p_containment_state not in ('investigation_flagged', 'operations_restricted', 'suspended', 'quarantined') then
    raise exception 'KLUY-FLEET-CONTAINMENT-STATE: % is not an applicable containment state', p_containment_state
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' or coalesce(btrim(p_actor_ref), '') = '' then
    raise exception 'KLUY-FLEET-CONTAINMENT-UNATTRIBUTED: containment requires a reason and a named actor'
      using errcode = 'P0001';
  end if;

  -- Suspension and quarantine are the operational containments the four-eyes
  -- policy §3 treats as device-level sensitive actions: an independent
  -- approver is mandatory, and self-approval is refused. No narrower RBAC key
  -- exists for containment (recorded, T005) — so the STRICTER control holds
  -- for every caller, the group-0136 discipline.
  if p_containment_state in ('suspended', 'quarantined') then
    if coalesce(btrim(p_approved_by_ref), '') = '' then
      raise exception 'KLUY-FLEET-CONTAINMENT-UNAPPROVED: % requires an independent approver (four-eyes)', p_containment_state
        using errcode = 'P0001';
    end if;
    if btrim(p_approved_by_ref) = btrim(p_actor_ref) then
      raise exception 'KLUY-FLEET-CONTAINMENT-SELF-APPROVAL: the requester can never approve their own containment'
        using errcode = 'P0001';
    end if;
  end if;

  -- Replayed command with a DIFFERENT payload is a conflict, not idempotency
  -- (the 0176 conflicting-replay rule).
  if p_command_ref is not null then
    select * into v_replayed from kitluy_devices.device_containment_events
     where command_ref = p_command_ref;
    if found then
      if v_replayed.device_id = p_device_id
         and v_replayed.containment_state = p_containment_state then
        return jsonb_build_object('outcome', 'DUPLICATE_IGNORED',
                                  'containment_state', p_containment_state);
      end if;
      raise exception 'KLUY-FLEET-CONTAINMENT-REPLAY-CONFLICT: command % was already used for a different containment', p_command_ref
        using errcode = 'P0001';
    end if;
  end if;

  select * into v_device from kitluy_devices.devices
   where id = p_device_id for update;
  if not found then
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;
  if v_device.lifecycle_state in ('retired', 'replaced') then
    raise exception 'KLUY-DEVICE-TERMINAL: device % is % and cannot be contained', p_device_id, v_device.lifecycle_state
      using errcode = 'P0001';
  end if;

  select * into v_assignment from kitluy_devices.device_assignments
   where device_id = p_device_id and state in ('pending_trust', 'active');

  -- Wrong-Store and stale-generation containment commands fail (§10 tests).
  if p_expected_digital_store_id is not null then
    if v_assignment.id is null or v_assignment.digital_store_id <> p_expected_digital_store_id then
      raise exception 'KLUY-FLEET-CONTAINMENT-WRONG-STORE: device % is not assigned to the named Digital Store', p_device_id
        using errcode = 'P0001';
    end if;
  end if;
  if p_expected_assignment_generation is not null then
    if v_assignment.id is null or v_assignment.assignment_generation <> p_expected_assignment_generation then
      raise exception 'KLUY-FLEET-CONTAINMENT-STALE-GENERATION: generation % is not the live assignment generation', p_expected_assignment_generation
        using errcode = 'P0001';
    end if;
  end if;

  select * into v_current from kitluy_devices.device_containment_states
   where device_id = p_device_id for update;

  -- Duplicate containment is idempotent: same state, one business effect.
  if found and v_current.containment_state = p_containment_state then
    return jsonb_build_object('outcome', 'ALREADY_CONTAINED',
                              'containment_state', v_current.containment_state);
  end if;

  v_prior := v_device.lifecycle_state;

  -- Compose the EXISTING lifecycle authority — never a parallel state machine.
  if p_containment_state = 'quarantined' then
    if v_device.lifecycle_state <> 'quarantined' then
      v_incident := kitluy_devices.quarantine_device_v1(
        p_device_id, 'manual_quarantine', 'CRITICAL', p_actor_ref, p_reason,
        jsonb_build_object('containment', 'quarantined',
                           'approved_by', p_approved_by_ref,
                           'evidence_ref', p_evidence_ref,
                           'command_ref', p_command_ref));
    end if;
  elsif p_containment_state = 'operations_restricted' then
    if v_device.lifecycle_state = 'quarantined' then
      raise exception 'KLUY-FLEET-CONTAINMENT-STEP-DOWN: containment never steps down from quarantine; use the recovery door'
        using errcode = 'P0001';
    end if;
    if v_device.lifecycle_state <> 'restricted_investigation' then
      insert into kitluy_devices.device_trust_incidents
        (device_id, incident_type, severity, detected_by, detail)
      values
        (p_device_id, 'manual_restriction', 'WARNING', p_actor_ref,
         jsonb_build_object('reason', p_reason, 'containment', 'operations_restricted',
                            'evidence_ref', p_evidence_ref))
      returning id into v_incident;

      update kitluy_devices.devices
      set restricted_from_state = v_device.lifecycle_state,
          lifecycle_state = 'restricted_investigation',
          restriction_reason = p_reason,
          restricted_at = now(),
          updated_at = now()
      where id = p_device_id;

      perform kitluy_devices.record_lifecycle_event(
        p_device_id, v_device.lifecycle_state, 'restricted_investigation',
        'FLEET_OPERATIONS_RESTRICTED', p_actor_ref,
        jsonb_build_object('incident_id', v_incident, 'reason', p_reason));
    end if;
  elsif p_containment_state = 'suspended' then
    if v_device.lifecycle_state in ('quarantined', 'restricted_investigation') then
      raise exception 'KLUY-FLEET-CONTAINMENT-STEP-DOWN: % is already under a stronger or investigative containment', p_device_id
        using errcode = 'P0001';
    end if;
    if v_device.lifecycle_state <> 'suspended' then
      update kitluy_devices.devices
      set lifecycle_state = 'suspended', updated_at = now()
      where id = p_device_id;
      perform kitluy_devices.record_lifecycle_event(
        p_device_id, v_device.lifecycle_state, 'suspended',
        'FLEET_ASSIGNMENT_SUSPENDED', p_actor_ref,
        jsonb_build_object('reason', p_reason, 'approved_by', p_approved_by_ref));
    end if;
  end if;
  -- investigation_flagged: a decision flag only; the lifecycle state is
  -- deliberately untouched — flagging a device for investigation must not
  -- interrupt Store operations by itself.

  insert into kitluy_devices.device_containment_states as s
    (device_id, containment_state, reason, actor_ref, approved_by_ref,
     evidence_ref, command_ref, correlation_id, prior_lifecycle_state,
     incident_id, applied_at, cleared_at, cleared_by_ref,
     clearance_approved_by_ref, disposition, clearance_reason, updated_at)
  values
    (p_device_id, p_containment_state, p_reason, p_actor_ref, p_approved_by_ref,
     p_evidence_ref, p_command_ref, p_correlation_id, v_prior, v_incident,
     now(), null, null, null, null, null, now())
  on conflict (device_id) do update
  set containment_state = excluded.containment_state,
      reason = excluded.reason,
      actor_ref = excluded.actor_ref,
      approved_by_ref = excluded.approved_by_ref,
      evidence_ref = excluded.evidence_ref,
      command_ref = excluded.command_ref,
      correlation_id = excluded.correlation_id,
      prior_lifecycle_state = case when s.containment_state = 'none'
                                   then excluded.prior_lifecycle_state
                                   else s.prior_lifecycle_state end,
      incident_id = coalesce(excluded.incident_id, s.incident_id),
      applied_at = excluded.applied_at,
      cleared_at = null,
      cleared_by_ref = null,
      clearance_approved_by_ref = null,
      disposition = null,
      clearance_reason = null,
      updated_at = now();

  insert into kitluy_devices.device_containment_events
    (device_id, event_type, containment_state, reason, actor_ref,
     approved_by_ref, evidence_ref, command_ref, correlation_id, detail)
  values
    (p_device_id, 'CONTAINMENT_APPLIED', p_containment_state, p_reason,
     p_actor_ref, p_approved_by_ref, p_evidence_ref, p_command_ref,
     p_correlation_id,
     jsonb_build_object('prior_lifecycle_state', v_prior::text,
                        'incident_id', v_incident));

  return jsonb_build_object('outcome', 'CONTAINED',
                            'containment_state', p_containment_state,
                            'prior_lifecycle_state', v_prior::text,
                            'incident_id', v_incident);
end;
$contain$;

comment on function kitluy_devices.apply_device_containment_v1(uuid, text, text, text, text, text, text, uuid, integer, uuid) is
  'Group 0177 (WS-11-T005). Governed containment: flags, restricts, suspends or quarantines a device by COMPOSING the 0120/0122 lifecycle doors. Four-eyes for suspension and quarantine; wrong-Store, stale-generation and conflicting-replay commands refused; duplicate containment idempotent. Never touches financial, custody or audit records — this schema has no reach into them.';

create or replace function kitluy_devices.clear_device_containment_v1(
  p_device_id uuid,
  p_disposition text,
  p_reason text,
  p_actor_ref text,
  p_approved_by_ref text,
  p_evidence_ref text default null,
  p_command_ref text default null,
  p_correlation_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $recover$
declare
  v_device kitluy_devices.devices;
  v_current kitluy_devices.device_containment_states;
  v_restore kitluy_devices.device_lifecycle_state;
  v_replayed kitluy_devices.device_containment_events;
begin
  if coalesce(btrim(p_reason), '') = '' or coalesce(btrim(p_actor_ref), '') = '' then
    raise exception 'KLUY-FLEET-RECOVERY-UNATTRIBUTED: recovery requires a reason and a named actor'
      using errcode = 'P0001';
  end if;
  -- Recovery is ALWAYS four-eyes: it restores operational trust.
  if coalesce(btrim(p_approved_by_ref), '') = '' then
    raise exception 'KLUY-FLEET-RECOVERY-UNAPPROVED: clearing containment requires an independent approver'
      using errcode = 'P0001';
  end if;
  if btrim(p_approved_by_ref) = btrim(p_actor_ref) then
    raise exception 'KLUY-FLEET-RECOVERY-SELF-APPROVAL: the requester can never approve their own recovery'
      using errcode = 'P0001';
  end if;
  if p_disposition not in
      ('device_cloning', 'refurbished_hardware', 'approved_board_replacement',
       'approved_nvme_replacement', 'data_entry_or_enrollment_error',
       'malicious_enrollment', 'enrollment_station_compromise', 'operator_recovery') then
    raise exception 'KLUY-FLEET-RECOVERY-DISPOSITION: % is not a KLD-2026-07-28-002 §10 runbook classification', p_disposition
      using errcode = 'P0001';
  end if;

  if p_command_ref is not null then
    select * into v_replayed from kitluy_devices.device_containment_events
     where command_ref = p_command_ref;
    if found then
      if v_replayed.device_id = p_device_id
         and v_replayed.event_type = 'CONTAINMENT_CLEARED' then
        return jsonb_build_object('outcome', 'DUPLICATE_IGNORED');
      end if;
      raise exception 'KLUY-FLEET-CONTAINMENT-REPLAY-CONFLICT: command % was already used for a different containment', p_command_ref
        using errcode = 'P0001';
    end if;
  end if;

  select * into v_current from kitluy_devices.device_containment_states
   where device_id = p_device_id for update;
  if not found or v_current.containment_state = 'none' then
    return jsonb_build_object('outcome', 'NOT_CONTAINED');
  end if;

  select * into v_device from kitluy_devices.devices
   where id = p_device_id for update;

  -- Restore the lifecycle through the LEGAL transition matrix only. A cleared
  -- quarantine lands in `enrolled` — full re-trust runs the normal claim and
  -- activation flow again; clearance never silently returns a device to
  -- service (0120 incident discipline).
  if v_device.lifecycle_state = 'restricted_investigation' then
    v_restore := coalesce(v_device.restricted_from_state, 'enrolled');
    if v_restore not in ('active', 'awaiting_trust', 'enrolled') then
      v_restore := 'enrolled';
    end if;
    update kitluy_devices.devices
    set lifecycle_state = v_restore,
        restricted_from_state = null,
        restriction_reason = null,
        restricted_at = null,
        updated_at = now()
    where id = p_device_id;
    perform kitluy_devices.record_lifecycle_event(
      p_device_id, 'restricted_investigation', v_restore,
      'CONTAINMENT_CLEARED', p_actor_ref,
      jsonb_build_object('disposition', p_disposition, 'reason', p_reason));
  elsif v_device.lifecycle_state = 'quarantined' then
    v_restore := 'enrolled';
    update kitluy_devices.devices
    set lifecycle_state = 'enrolled',
        quarantined_at = null,
        quarantine_reason = null,
        updated_at = now()
    where id = p_device_id;
    perform kitluy_devices.record_lifecycle_event(
      p_device_id, 'quarantined', 'enrolled',
      'CONTAINMENT_CLEARED', p_actor_ref,
      jsonb_build_object('disposition', p_disposition, 'reason', p_reason));
  elsif v_device.lifecycle_state = 'suspended' then
    v_restore := case when v_current.prior_lifecycle_state in ('awaiting_trust', 'enrolled')
                      then v_current.prior_lifecycle_state
                      else 'enrolled' end;
    update kitluy_devices.devices
    set lifecycle_state = v_restore, updated_at = now()
    where id = p_device_id;
    perform kitluy_devices.record_lifecycle_event(
      p_device_id, 'suspended', v_restore,
      'CONTAINMENT_CLEARED', p_actor_ref,
      jsonb_build_object('disposition', p_disposition, 'reason', p_reason));
  else
    v_restore := v_device.lifecycle_state;
  end if;

  -- Clear exactly the incident this containment opened — never someone
  -- else's investigation.
  if v_current.incident_id is not null then
    update kitluy_devices.device_trust_incidents
    set cleared_at = now(),
        cleared_by_operator_ref = p_actor_ref,
        clearance_reason = format('%s: %s', p_disposition, p_reason)
    where id = v_current.incident_id and cleared_at is null;
  end if;

  update kitluy_devices.device_containment_states
  set containment_state = 'none',
      cleared_at = now(),
      cleared_by_ref = p_actor_ref,
      clearance_approved_by_ref = p_approved_by_ref,
      disposition = p_disposition,
      clearance_reason = p_reason,
      updated_at = now()
  where device_id = p_device_id;

  insert into kitluy_devices.device_containment_events
    (device_id, event_type, containment_state, reason, actor_ref,
     approved_by_ref, evidence_ref, command_ref, correlation_id, detail)
  values
    (p_device_id, 'CONTAINMENT_CLEARED', 'none', p_reason, p_actor_ref,
     p_approved_by_ref, p_evidence_ref, p_command_ref, p_correlation_id,
     jsonb_build_object('disposition', p_disposition,
                        'restored_lifecycle_state', v_restore::text));

  return jsonb_build_object('outcome', 'CLEARED',
                            'disposition', p_disposition,
                            'restored_lifecycle_state', v_restore::text);
end;
$recover$;

comment on function kitluy_devices.clear_device_containment_v1(uuid, text, text, text, text, text, text, uuid) is
  'Group 0177 (WS-11-T005). The governed recovery decision: four-eyes always, disposition restricted to the KLD-2026-07-28-002 §10 runbook classifications, lifecycle restored only along legal transitions (a cleared quarantine lands in enrolled and re-earns trust). Clears exactly the incident this containment opened; deletes nothing.';

create or replace function kitluy_devices.approve_incumbent_quarantine_v1(
  p_device_id uuid,
  p_reason text,
  p_actor_ref text,
  p_approved_by_ref text,
  p_evidence_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $escalate$
declare
  v_incident uuid;
begin
  -- KLD-2026-07-28-002 §10 escalation condition 4 — the only condition that
  -- rests on a human decision, now behind a door that VERIFIES the four-eyes
  -- split instead of trusting a free-text approval reference.
  if coalesce(btrim(p_reason), '') = '' or coalesce(btrim(p_actor_ref), '') = ''
     or coalesce(btrim(p_evidence_ref), '') = '' then
    raise exception 'KLUY-FLEET-ESCALATION-UNATTRIBUTED: escalation requires a reason, a named actor and an evidence reference'
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_approved_by_ref), '') = '' then
    raise exception 'KLUY-FLEET-ESCALATION-UNAPPROVED: A3/A4 containment requires an independent approver'
      using errcode = 'P0001';
  end if;
  if btrim(p_approved_by_ref) = btrim(p_actor_ref) then
    raise exception 'KLUY-FLEET-ESCALATION-SELF-APPROVAL: the requester can never approve their own escalation'
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from kitluy_devices.devices
                  where id = p_device_id
                    and lifecycle_state = 'restricted_investigation') then
    raise exception 'KLUY-FLEET-ESCALATION-NOT-RESTRICTED: only a restricted_investigation incumbent is escalated by approval'
      using errcode = 'P0001';
  end if;

  v_incident := kitluy_devices.escalate_incumbent_containment_v1(
    p_device_id, 'a3_a4_approved_containment', p_evidence_ref, p_actor_ref,
    format('approved_by=%s; reason=%s', p_approved_by_ref, p_reason));

  insert into kitluy_devices.device_containment_states as s
    (device_id, containment_state, reason, actor_ref, approved_by_ref,
     evidence_ref, prior_lifecycle_state, incident_id, applied_at, updated_at)
  values
    (p_device_id, 'quarantined', p_reason, p_actor_ref, p_approved_by_ref,
     p_evidence_ref, 'restricted_investigation', v_incident, now(), now())
  on conflict (device_id) do update
  set containment_state = 'quarantined',
      reason = excluded.reason,
      actor_ref = excluded.actor_ref,
      approved_by_ref = excluded.approved_by_ref,
      evidence_ref = excluded.evidence_ref,
      incident_id = coalesce(excluded.incident_id, s.incident_id),
      applied_at = excluded.applied_at,
      cleared_at = null,
      cleared_by_ref = null,
      clearance_approved_by_ref = null,
      disposition = null,
      clearance_reason = null,
      updated_at = now();

  insert into kitluy_devices.device_containment_events
    (device_id, event_type, containment_state, reason, actor_ref,
     approved_by_ref, evidence_ref, detail)
  values
    (p_device_id, 'CONTAINMENT_ESCALATED', 'quarantined', p_reason,
     p_actor_ref, p_approved_by_ref, p_evidence_ref,
     jsonb_build_object('escalation_condition', 'a3_a4_approved_containment',
                        'incident_id', v_incident));

  return jsonb_build_object('outcome', 'ESCALATED', 'incident_id', v_incident);
end;
$escalate$;

comment on function kitluy_devices.approve_incumbent_quarantine_v1(uuid, text, text, text, text) is
  'Group 0177 (WS-11-T005, KLRISK-DEVICE-002). The governed §10 condition-4 door: escalates a restricted_investigation incumbent to full quarantine under a VERIFIED four-eyes approval — requester and approver distinct, evidence named, immutable containment event emitted.';

create or replace function kitluy_devices.assert_device_not_contained_v1(
  p_device_id uuid
) returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $assert$
declare
  v_lifecycle kitluy_devices.device_lifecycle_state;
  v_containment text;
begin
  select d.lifecycle_state, coalesce(c.containment_state, 'none')
    into v_lifecycle, v_containment
  from kitluy_devices.devices d
  left join kitluy_devices.device_containment_states c on c.device_id = d.id
  where d.id = p_device_id;
  if not found then
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;
  if v_lifecycle in ('quarantined', 'restricted_investigation', 'suspended', 'retired', 'replaced')
     or v_containment <> 'none' then
    raise exception 'KLUY-FLEET-CONTAINED: device % is contained (lifecycle %, containment %)', p_device_id, v_lifecycle, v_containment
      using errcode = 'P0001';
  end if;
end;
$assert$;

comment on function kitluy_devices.assert_device_not_contained_v1(uuid) is
  'Group 0177 (WS-11-T005). Fail-closed containment gate for governed operations: raises for any contained, investigative, suspended or terminal device. Distinct states stay distinct in the refusal text — offline and stale are NOT containment and never trip this gate.';

create or replace function kitluy_devices.read_fleet_containment_projection_v1(
  p_environment text,
  p_digital_store_id uuid
) returns table (
  device_id uuid,
  containment_state text,
  applied_at timestamptz,
  correlation_id uuid
)
language sql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $$
  -- The Store-scoped containment set the (BLK-006-gated) signed-configuration
  -- producer will carry to the Hub. Scope is taken as ARGUMENTS and filtered
  -- INSIDE the definer (group 0156 rule): a NULL scope returns the EMPTY set,
  -- never the fleet.
  select c.device_id, c.containment_state, c.applied_at, c.correlation_id
  from kitluy_devices.device_containment_states c
  join kitluy_devices.device_assignments a
    on a.device_id = c.device_id and a.state in ('pending_trust', 'active')
  where p_environment is not null
    and p_digital_store_id is not null
    and a.digital_store_id = p_digital_store_id
    and c.containment_state <> 'none';
$$;

comment on function kitluy_devices.read_fleet_containment_projection_v1(text, uuid) is
  'Group 0177 (WS-11-T005). Store-scoped containment directives for Hub delivery through the signed configuration authority. The PRODUCER that signs and transports this set is BLK-006-gated and NOT built here — the Hub-side consumer and enforcement are (Hub group 0035).';

-- ---------------------------------------------------------------------------
-- 8. SUPPORT ACCESS SESSIONS
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.support_access_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null,
  digital_store_id uuid not null,
  store_location_id uuid,
  device_id uuid references kitluy_devices.devices (id),
  support_actor_ref text not null,
  approved_by_ref text,
  reason text not null,
  ticket_ref text not null,
  consent_class text not null,
  consent_ref text,
  environment text not null,
  status text not null default 'active',
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by_ref text,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sas_env_chk check (environment in ('development', 'pilot', 'production')),
  constraint sas_status_chk check (status in ('active', 'expired', 'revoked')),
  constraint sas_window_chk check (expires_at > starts_at),
  constraint sas_class_chk check (consent_class in
    ('C1_METADATA', 'C2_SENSITIVE_READ', 'C3_IMPERSONATED_VIEW',
     'C4_WRITE_INTERVENTION', 'C5_PLATFORM_SAFETY_LEGAL')),
  -- Support policy §3: C2+ requires partner consent evidence; C3+ requires an
  -- independent approver. C5 may bypass consent only where legally permitted,
  -- so it demands the approver, not the consent.
  constraint sas_consent_chk check (
    consent_class in ('C1_METADATA', 'C5_PLATFORM_SAFETY_LEGAL')
    or consent_ref is not null),
  constraint sas_approval_chk check (
    consent_class in ('C1_METADATA', 'C2_SENSITIVE_READ')
    or approved_by_ref is not null),
  constraint sas_four_eyes_chk check (
    approved_by_ref is null or approved_by_ref <> support_actor_ref),
  constraint sas_revocation_chk check ((status = 'revoked') = (revoked_at is not null))
);

comment on table kitluy_devices.support_access_sessions is
  'Group 0177 (WS-11-T005). Scoped, time-bound support access (support policy §2-§5). DISTINCT from device credentials and Store staff sessions; carries NO token, key, password or database credential — there is nothing here to replay. Expiry is automatic (sweeper) and checked at assertion time, so an expired-but-unswept session already fails closed. MC: MUT (governor only).';

create index if not exists support_access_sessions_scope_idx
  on kitluy_devices.support_access_sessions (tenant_id, digital_store_id, status);

create table if not exists kitluy_devices.support_access_events (
  id uuid primary key default extensions.gen_random_uuid(),
  session_id uuid not null references kitluy_devices.support_access_sessions (id),
  event_type text not null,
  actor_ref text not null,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint sae_type_chk check (event_type in
    ('SESSION_OPENED', 'SESSION_EXPIRED', 'SESSION_REVOKED')),
  constraint sae_detail_bounded_chk check (pg_column_size(detail) <= 8192)
);

comment on table kitluy_devices.support_access_events is
  'Group 0177 (WS-11-T005). Append-only support-access audit: open, expire, revoke — actor, scope and correlation on every row. MC: A/O.';

create or replace function kitluy_devices.enforce_support_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'KLUY-SUPPORT-EVENT-IMMUTABLE: support access events are append-only'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_support_access_events_append_only on kitluy_devices.support_access_events;
create trigger trg_support_access_events_append_only
  before update or delete on kitluy_devices.support_access_events
  for each row execute function kitluy_devices.enforce_support_events_append_only();

revoke all on function kitluy_devices.enforce_support_events_append_only() from public;
alter function kitluy_devices.enforce_support_events_append_only() owner to kitluy_fleet_governor;

create or replace function kitluy_devices.enforce_support_sessions_governed()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-SUPPORT-SESSION-IMMUTABLE: support sessions are ended, never deleted'
      using errcode = 'P0001';
  end if;
  if current_user <> 'kitluy_fleet_governor' then
    raise exception 'KLUY-SUPPORT-SESSION-GOVERNED: support sessions change only through governed doors (group 0177)'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_support_access_sessions_governed on kitluy_devices.support_access_sessions;
create trigger trg_support_access_sessions_governed
  before insert or update or delete on kitluy_devices.support_access_sessions
  for each row execute function kitluy_devices.enforce_support_sessions_governed();

revoke all on function kitluy_devices.enforce_support_sessions_governed() from public;
alter function kitluy_devices.enforce_support_sessions_governed() owner to kitluy_fleet_governor;

create or replace function kitluy_devices.open_support_access_session_v1(
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_device_id uuid,
  p_support_actor_ref text,
  p_approved_by_ref text,
  p_reason text,
  p_ticket_ref text,
  p_consent_class text,
  p_consent_ref text,
  p_environment text,
  p_requested_minutes integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $support$
declare
  v_policy kitluy_devices.fleet_health_policy;
  v_assignment kitluy_devices.device_assignments;
  v_session_id uuid;
  v_minutes integer;
  v_expires timestamptz;
begin
  if coalesce(btrim(p_support_actor_ref), '') = '' then
    raise exception 'KLUY-SUPPORT-UNATTRIBUTED: a support session names its authenticated operator'
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'KLUY-SUPPORT-REASON-REQUIRED: a support session records its reason'
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_ticket_ref), '') = '' then
    raise exception 'KLUY-SUPPORT-TICKET-REQUIRED: a support session cites its ticket (support policy §3)'
      using errcode = 'P0001';
  end if;
  if p_consent_class not in
      ('C1_METADATA', 'C2_SENSITIVE_READ', 'C3_IMPERSONATED_VIEW',
       'C4_WRITE_INTERVENTION', 'C5_PLATFORM_SAFETY_LEGAL') then
    raise exception 'KLUY-SUPPORT-CLASS: % is not a support policy §3 consent class', p_consent_class
      using errcode = 'P0001';
  end if;
  if p_consent_class not in ('C1_METADATA', 'C5_PLATFORM_SAFETY_LEGAL')
     and coalesce(btrim(p_consent_ref), '') = '' then
    raise exception 'KLUY-SUPPORT-CONSENT-REQUIRED: % requires partner consent evidence', p_consent_class
      using errcode = 'P0001';
  end if;
  if p_consent_class not in ('C1_METADATA', 'C2_SENSITIVE_READ') then
    if coalesce(btrim(p_approved_by_ref), '') = '' then
      raise exception 'KLUY-SUPPORT-UNAPPROVED: % requires an independent approver', p_consent_class
        using errcode = 'P0001';
    end if;
    if btrim(p_approved_by_ref) = btrim(p_support_actor_ref) then
      raise exception 'KLUY-SUPPORT-SELF-APPROVAL: the support actor can never be their own approver'
        using errcode = 'P0001';
    end if;
  end if;
  if p_tenant_id is null or p_digital_store_id is null then
    raise exception 'KLUY-SUPPORT-SCOPE-REQUIRED: a support session is Tenant- and Store-scoped'
      using errcode = 'P0001';
  end if;
  if p_environment not in ('development', 'pilot', 'production') then
    raise exception 'KLUY-SUPPORT-ENVIRONMENT: % is not a known environment', p_environment
      using errcode = 'P0001';
  end if;

  -- Device scope, when named, must actually belong to the named Tenant and
  -- Store — cross-Tenant support access fails here, not in a frontend.
  if p_device_id is not null then
    select * into v_assignment from kitluy_devices.device_assignments
     where device_id = p_device_id and state in ('pending_trust', 'active');
    if not found
       or v_assignment.tenant_id <> p_tenant_id
       or v_assignment.digital_store_id <> p_digital_store_id then
      raise exception 'KLUY-SUPPORT-SCOPE-MISMATCH: device % is not assigned to the named Tenant and Store', p_device_id
        using errcode = 'P0001';
    end if;
  end if;

  select * into v_policy from kitluy_devices.fleet_health_policy
   where environment = p_environment;
  if not found then
    raise exception 'KLUY-SUPPORT-POLICY-MISSING: no fleet policy exists for %; support sessions fail closed', p_environment
      using errcode = 'P0001';
  end if;

  v_minutes := least(coalesce(p_requested_minutes, v_policy.support_session_max_minutes),
                     v_policy.support_session_max_minutes);
  if v_minutes < 1 then
    raise exception 'KLUY-SUPPORT-WINDOW: a support session needs a positive duration'
      using errcode = 'P0001';
  end if;
  v_expires := now() + make_interval(mins => v_minutes);

  insert into kitluy_devices.support_access_sessions
    (tenant_id, digital_store_id, store_location_id, device_id,
     support_actor_ref, approved_by_ref, reason, ticket_ref, consent_class,
     consent_ref, environment, status, starts_at, expires_at)
  values
    (p_tenant_id, p_digital_store_id, p_store_location_id, p_device_id,
     btrim(p_support_actor_ref), nullif(btrim(coalesce(p_approved_by_ref, '')), ''),
     p_reason, p_ticket_ref, p_consent_class,
     nullif(btrim(coalesce(p_consent_ref, '')), ''), p_environment, 'active',
     now(), v_expires)
  returning id into v_session_id;

  insert into kitluy_devices.support_access_events
    (session_id, event_type, actor_ref, detail)
  values
    (v_session_id, 'SESSION_OPENED', btrim(p_support_actor_ref),
     jsonb_build_object('consent_class', p_consent_class,
                        'ticket_ref', p_ticket_ref,
                        'device_id', p_device_id,
                        'expires_at', v_expires));

  return jsonb_build_object('outcome', 'OPENED',
                            'session_id', v_session_id,
                            'expires_at', v_expires,
                            'granted_minutes', v_minutes);
end;
$support$;

comment on function kitluy_devices.open_support_access_session_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer) is
  'Group 0177 (WS-11-T005). Opens a scoped, time-bound support session under support policy §3: ticket always; consent for C2+; independent approver for C3+; duration clamped to the governed maximum ([REQUIRED: maximum session duration by class] - the per-environment cap is the development posture). Returns metadata only - no token, credential or key exists to return.';

create or replace function kitluy_devices.revoke_support_access_session_v1(
  p_session_id uuid,
  p_actor_ref text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $revoke$
declare
  v_session kitluy_devices.support_access_sessions;
begin
  if coalesce(btrim(p_actor_ref), '') = '' or coalesce(btrim(p_reason), '') = '' then
    raise exception 'KLUY-SUPPORT-UNATTRIBUTED: revocation names its actor and reason'
      using errcode = 'P0001';
  end if;
  select * into v_session from kitluy_devices.support_access_sessions
   where id = p_session_id for update;
  if not found then
    raise exception 'KLUY-SUPPORT-SESSION-MISSING: session % does not exist', p_session_id
      using errcode = 'P0001';
  end if;
  if v_session.status = 'revoked' then
    return jsonb_build_object('outcome', 'ALREADY_REVOKED');
  end if;

  update kitluy_devices.support_access_sessions
  set status = 'revoked',
      revoked_at = now(),
      revoked_by_ref = btrim(p_actor_ref),
      revocation_reason = p_reason,
      updated_at = now()
  where id = p_session_id;

  insert into kitluy_devices.support_access_events
    (session_id, event_type, actor_ref, detail)
  values
    (p_session_id, 'SESSION_REVOKED', btrim(p_actor_ref),
     jsonb_build_object('reason', p_reason));

  return jsonb_build_object('outcome', 'REVOKED');
end;
$revoke$;

comment on function kitluy_devices.revoke_support_access_session_v1(uuid, text, text) is
  'Group 0177 (WS-11-T005). Immediate support-session revocation (support policy §2: "Partner can revoke consent immediately"). Idempotent; the session row survives as evidence.';

create or replace function kitluy_devices.expire_support_access_sessions_v1(
  p_environment text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $expire$
declare
  v_count integer := 0;
  v_row record;
begin
  if p_environment not in ('development', 'pilot', 'production') then
    raise exception 'KLUY-SUPPORT-ENVIRONMENT: % is not a known environment', p_environment
      using errcode = 'P0001';
  end if;
  for v_row in
    select id from kitluy_devices.support_access_sessions
     where environment = p_environment
       and status = 'active'
       and expires_at <= now()
     for update
  loop
    update kitluy_devices.support_access_sessions
    set status = 'expired', updated_at = now()
    where id = v_row.id;
    insert into kitluy_devices.support_access_events
      (session_id, event_type, actor_ref, detail)
    values
      (v_row.id, 'SESSION_EXPIRED', 'kitluy_worker_service',
       jsonb_build_object('swept_at', now()));
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('outcome', 'SWEPT', 'expired_count', v_count);
end;
$expire$;

comment on function kitluy_devices.expire_support_access_sessions_v1(text) is
  'Group 0177 (WS-11-T005). Worker sweeper converting past-expiry active sessions to expired, with an audit event each. Environment-scoped. Idempotent. assert_support_session_active_v1 already fails an expired-but-unswept session closed, so the sweeper is bookkeeping, not the security boundary.';

create or replace function kitluy_devices.assert_support_session_active_v1(
  p_session_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $assert$
declare
  v_session kitluy_devices.support_access_sessions;
begin
  select * into v_session from kitluy_devices.support_access_sessions
   where id = p_session_id;
  if not found then
    raise exception 'KLUY-SUPPORT-SESSION-MISSING: session % does not exist', p_session_id
      using errcode = 'P0001';
  end if;
  -- Fail closed on the CLOCK, not on the sweeper: an expired session that the
  -- sweeper has not reached yet is still expired.
  if v_session.status <> 'active' or v_session.expires_at <= now() then
    raise exception 'KLUY-SUPPORT-SESSION-INACTIVE: session % is % (expires %)', p_session_id, v_session.status, v_session.expires_at
      using errcode = 'P0001';
  end if;
  return jsonb_build_object('session_id', v_session.id,
                            'tenant_id', v_session.tenant_id,
                            'digital_store_id', v_session.digital_store_id,
                            'device_id', v_session.device_id,
                            'consent_class', v_session.consent_class,
                            'expires_at', v_session.expires_at);
end;
$assert$;

comment on function kitluy_devices.assert_support_session_active_v1(uuid) is
  'Group 0177 (WS-11-T005). Fail-closed support-session gate: raises for missing, revoked, expired, or past-expiry-but-unswept sessions. Returns scope metadata only.';

-- ---------------------------------------------------------------------------
-- 9. THE fleet_health_read READ MODEL (data dictionary name)
-- ---------------------------------------------------------------------------
create view kitluy_devices.fleet_health_read as
select
  fs.device_record_id,
  fs.asset_tag,
  fs.device_class,
  -- TRUTH LABELS, kept as SEPARATE columns (T005 authority model): lifecycle,
  -- containment, the Hub's reported LOCAL status, and cloud freshness are
  -- four different facts. Offline, stale, revoked, quarantined, unknown and
  -- cloud-unreachable are never collapsed into one value.
  fs.lifecycle_state,
  fs.fleet_status,
  coalesce(cs.containment_state, 'none') as containment_state,
  fs.tenant_id,
  fs.digital_store_id,
  fs.store_location_id,
  fs.assignment_state,
  fs.certificate_status,
  hp.reporting_hub_device_id,
  hp.assignment_generation as reported_assignment_generation,
  hp.terminal_profile_key,
  hp.software_version,
  hp.configuration_version,
  hp.release_version,
  hp.health_classification as reported_local_status,
  hp.health_reasons as reported_health_reasons,
  hp.last_local_contact_at,
  hp.observed_at as hub_observed_at,
  hp.received_at as cloud_received_at,
  hp.projection_version,
  kitluy_devices.classify_fleet_freshness_v1(hp.environment, hp.received_at) as cloud_freshness
from kitluy_devices.device_fleet_status fs
left join kitluy_devices.device_health_projections hp
  on hp.observed_device_id = fs.device_record_id
left join kitluy_devices.device_containment_states cs
  on cs.device_id = fs.device_record_id;

comment on view kitluy_devices.fleet_health_read is
  'Group 0177 (WS-11-T005). The data dictionary''s fleet_health_read read model: device status, last reported Hub observation, cloud freshness classification and containment — as separate truth labels, never one collapsed value. A device with no projection reads UNKNOWN_NO_OBSERVATION, which is not offline and not revoked.';

-- ---------------------------------------------------------------------------
-- 10. OWNERSHIP AND LEAST PRIVILEGE
-- ---------------------------------------------------------------------------
alter table kitluy_devices.fleet_health_policy owner to kitluy_fleet_governor;
alter table kitluy_devices.device_health_reports owner to kitluy_fleet_governor;
alter table kitluy_devices.device_health_projections owner to kitluy_fleet_governor;
alter table kitluy_devices.device_containment_states owner to kitluy_fleet_governor;
alter table kitluy_devices.device_containment_events owner to kitluy_fleet_governor;
alter table kitluy_devices.support_access_sessions owner to kitluy_fleet_governor;
alter table kitluy_devices.support_access_events owner to kitluy_fleet_governor;
alter view kitluy_devices.fleet_health_read owner to kitluy_fleet_governor;

do $rls$
declare
  v_table text;
begin
  foreach v_table in array array[
    'kitluy_devices.fleet_health_policy',
    'kitluy_devices.device_health_reports',
    'kitluy_devices.device_health_projections',
    'kitluy_devices.device_containment_states',
    'kitluy_devices.device_containment_events',
    'kitluy_devices.support_access_sessions',
    'kitluy_devices.support_access_events'] loop
    execute format('alter table %s enable row level security', v_table);
    execute format('alter table %s force row level security', v_table);
    execute format('revoke all on table %s from public, anon, authenticated, service_role', v_table);
  end loop;
end
$rls$;

-- Deny-by-absence with the 0126/0163/0174 governor-policy pattern (FORCE RLS
-- with zero policies would block the NOLOGIN definer owner itself).
drop policy if exists fhp_governor on kitluy_devices.fleet_health_policy;
create policy fhp_governor on kitluy_devices.fleet_health_policy
  for all to kitluy_fleet_governor using (true) with check (true);
drop policy if exists dhr_governor on kitluy_devices.device_health_reports;
create policy dhr_governor on kitluy_devices.device_health_reports
  for all to kitluy_fleet_governor using (true) with check (true);
drop policy if exists dhp_governor on kitluy_devices.device_health_projections;
create policy dhp_governor on kitluy_devices.device_health_projections
  for all to kitluy_fleet_governor using (true) with check (true);
drop policy if exists dcs_governor on kitluy_devices.device_containment_states;
create policy dcs_governor on kitluy_devices.device_containment_states
  for all to kitluy_fleet_governor using (true) with check (true);
drop policy if exists dce_governor on kitluy_devices.device_containment_events;
create policy dce_governor on kitluy_devices.device_containment_events
  for all to kitluy_fleet_governor using (true) with check (true);
drop policy if exists sas_governor on kitluy_devices.support_access_sessions;
create policy sas_governor on kitluy_devices.support_access_sessions
  for all to kitluy_fleet_governor using (true) with check (true);
drop policy if exists sae_governor on kitluy_devices.support_access_events;
create policy sae_governor on kitluy_devices.support_access_events
  for all to kitluy_fleet_governor using (true) with check (true);

-- The seeded development policy row (governed trigger requires the governor).
do $seed$
begin
  set local role kitluy_fleet_governor;
  insert into kitluy_devices.fleet_health_policy
    (environment, heartbeat_interval_seconds, projection_stale_after_seconds,
     allowed_clock_skew_seconds, support_session_max_minutes, decision_ref)
  values
    ('development', 60, 300, 300, 60,
     'KLD-2026-08-06-WS11-REMAINING-TASKS-001 development defaults; [REQUIRED: approved monitoring thresholds] and [REQUIRED: maximum session duration by class] remain open owner values')
  on conflict (environment) do nothing;
  reset role;
end
$seed$;

do $own_fn$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'kitluy_devices.ingest_device_health_report_v1(text, uuid, uuid, text, integer, bigint, text, text[], text, text, text, text, timestamptz, timestamptz, uuid)',
    'kitluy_devices.classify_fleet_freshness_v1(text, timestamptz)',
    'kitluy_devices.apply_device_containment_v1(uuid, text, text, text, text, text, text, uuid, integer, uuid)',
    'kitluy_devices.clear_device_containment_v1(uuid, text, text, text, text, text, text, uuid)',
    'kitluy_devices.approve_incumbent_quarantine_v1(uuid, text, text, text, text)',
    'kitluy_devices.assert_device_not_contained_v1(uuid)',
    'kitluy_devices.read_fleet_containment_projection_v1(text, uuid)',
    'kitluy_devices.open_support_access_session_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer)',
    'kitluy_devices.revoke_support_access_session_v1(uuid, text, text)',
    'kitluy_devices.expire_support_access_sessions_v1(text)',
    'kitluy_devices.assert_support_session_active_v1(uuid)'] loop
    execute format('alter function %s owner to kitluy_fleet_governor', v_fn);
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;

  -- Ingestion is the Edge-sync identity's door and nobody else's.
  execute 'grant execute on function kitluy_devices.ingest_device_health_report_v1(text, uuid, uuid, text, integer, bigint, text, text[], text, text, text, text, timestamptz, timestamptz, uuid) to kitluy_edge_sync_service, kitluy_test_harness';
  -- Operator doors belong to the fleet service.
  foreach v_fn in array array[
    'kitluy_devices.apply_device_containment_v1(uuid, text, text, text, text, text, text, uuid, integer, uuid)',
    'kitluy_devices.clear_device_containment_v1(uuid, text, text, text, text, text, text, uuid)',
    'kitluy_devices.approve_incumbent_quarantine_v1(uuid, text, text, text, text)',
    'kitluy_devices.open_support_access_session_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer)',
    'kitluy_devices.revoke_support_access_session_v1(uuid, text, text)',
    'kitluy_devices.assert_support_session_active_v1(uuid)',
    'kitluy_devices.read_fleet_containment_projection_v1(text, uuid)'] loop
    execute format('grant execute on function %s to kitluy_fleet_service, kitluy_test_harness', v_fn);
  end loop;
  -- The freshness classifier and the containment gate are shared read
  -- primitives for governed compositions. The gate is deliberately NOT
  -- granted to the issuance or provisioning services yet: their capability
  -- censuses are exact (WS11-N18/N19), and a grant no composition calls is
  -- the 0155 over-grant mistake. The wiring lands with the composition that
  -- uses it.
  execute 'grant execute on function kitluy_devices.classify_fleet_freshness_v1(text, timestamptz) to kitluy_fleet_service, kitluy_edge_sync_service, kitluy_test_harness';
  execute 'grant execute on function kitluy_devices.assert_device_not_contained_v1(uuid) to kitluy_fleet_service, kitluy_test_harness';
  -- The sweeper is the worker's and only the worker's.
  execute 'grant execute on function kitluy_devices.expire_support_access_sessions_v1(text) to kitluy_worker_service, kitluy_test_harness';
end
$own_fn$;

revoke all on kitluy_devices.fleet_health_read from public, anon, authenticated, service_role;
grant select on kitluy_devices.fleet_health_read to kitluy_fleet_service, kitluy_test_harness;

-- ---------------------------------------------------------------------------
-- 11. PROVE THE BOUNDARY ON APPLY
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_fn text;
  v_rec record;
  v_count integer;
begin
  -- Every door is SECURITY DEFINER, governor-owned, with a pinned search_path.
  for v_rec in
    select p.oid::regprocedure::text as signature, p.prosecdef, p.proconfig,
           pg_get_userbyid(p.proowner) as owner_name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'kitluy_devices'
      and p.proname in ('ingest_device_health_report_v1',
                        'apply_device_containment_v1',
                        'clear_device_containment_v1',
                        'approve_incumbent_quarantine_v1',
                        'assert_device_not_contained_v1',
                        'read_fleet_containment_projection_v1',
                        'open_support_access_session_v1',
                        'revoke_support_access_session_v1',
                        'expire_support_access_sessions_v1',
                        'assert_support_session_active_v1',
                        'classify_fleet_freshness_v1')
  loop
    if not v_rec.prosecdef then
      raise exception 'KLUY-MIGRATION-0177: % is not SECURITY DEFINER', v_rec.signature;
    end if;
    if v_rec.owner_name <> 'kitluy_fleet_governor' then
      raise exception 'KLUY-MIGRATION-0177: % is owned by %, not the fleet governor', v_rec.signature, v_rec.owner_name;
    end if;
    if v_rec.proconfig is null or not exists (
        select 1 from unnest(v_rec.proconfig) c where c like 'search_path=%') then
      raise exception 'KLUY-MIGRATION-0177: % has no pinned search_path', v_rec.signature;
    end if;
  end loop;

  -- Effective privilege: service_role must NOT reach the fleet or edge-sync
  -- doors (the 0173 NOINHERIT property holds through both gateways). The
  -- worker sweeper is deliberately NOT in this list: kitluy_worker_service
  -- membership is INHERITED by service_role (the 0135 posture, which predates
  -- the 0173 hinge and is not this group's to change) — recorded, and the
  -- sweeper is bookkeeping, not the security boundary (the active-session
  -- gate fails closed on the clock).
  foreach v_fn in array array[
    'kitluy_devices.ingest_device_health_report_v1(text, uuid, uuid, text, integer, bigint, text, text[], text, text, text, text, timestamptz, timestamptz, uuid)',
    'kitluy_devices.apply_device_containment_v1(uuid, text, text, text, text, text, text, uuid, integer, uuid)',
    'kitluy_devices.clear_device_containment_v1(uuid, text, text, text, text, text, text, uuid)',
    'kitluy_devices.approve_incumbent_quarantine_v1(uuid, text, text, text, text)',
    'kitluy_devices.open_support_access_session_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer)'] loop
    if has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'KLUY-MIGRATION-0177: service_role effectively holds EXECUTE on %', v_fn;
    end if;
    if has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'KLUY-MIGRATION-0177: authenticated holds EXECUTE on %', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'KLUY-MIGRATION-0177: anon holds EXECUTE on %', v_fn;
    end if;
  end loop;

  if not has_function_privilege('kitluy_edge_sync_service',
      'kitluy_devices.ingest_device_health_report_v1(text, uuid, uuid, text, integer, bigint, text, text[], text, text, text, text, timestamptz, timestamptz, uuid)', 'execute') then
    raise exception 'KLUY-MIGRATION-0177: the edge sync identity cannot reach the ingestion door';
  end if;
  if not has_function_privilege('kitluy_fleet_service',
      'kitluy_devices.apply_device_containment_v1(uuid, text, text, text, text, text, text, uuid, integer, uuid)', 'execute') then
    raise exception 'KLUY-MIGRATION-0177: the fleet service cannot reach the containment door';
  end if;
  if not has_function_privilege('kitluy_worker_service',
      'kitluy_devices.expire_support_access_sessions_v1(text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0177: the worker cannot reach the expiry sweeper';
  end if;

  -- The gateway hinge: NOLOGIN + NOINHERIT.
  if not exists (select 1 from pg_roles
                  where rolname = 'kitluy_fleet_gateway'
                    and not rolcanlogin and not rolinherit) then
    raise exception 'KLUY-MIGRATION-0177: the fleet gateway is missing or mis-postured';
  end if;

  -- Zero direct table reach for every runtime identity.
  for v_rec in
    select t.relname, r.rolname
    from (values ('fleet_health_policy'), ('device_health_reports'),
                 ('device_health_projections'), ('device_containment_states'),
                 ('device_containment_events'), ('support_access_sessions'),
                 ('support_access_events')) as t(relname)
    cross join (values ('kitluy_fleet_service'), ('kitluy_edge_sync_service'),
                       ('kitluy_worker_service'), ('authenticated'), ('anon')) as r(rolname)
  loop
    if has_table_privilege(v_rec.rolname, 'kitluy_devices.' || v_rec.relname, 'select')
       or has_table_privilege(v_rec.rolname, 'kitluy_devices.' || v_rec.relname, 'insert')
       or has_table_privilege(v_rec.rolname, 'kitluy_devices.' || v_rec.relname, 'update')
       or has_table_privilege(v_rec.rolname, 'kitluy_devices.' || v_rec.relname, 'delete') then
      raise exception 'KLUY-MIGRATION-0177: % holds direct table privilege on %', v_rec.rolname, v_rec.relname;
    end if;
  end loop;

  -- RLS forced everywhere.
  select count(*) into v_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'kitluy_devices'
    and c.relname in ('fleet_health_policy', 'device_health_reports',
                      'device_health_projections', 'device_containment_states',
                      'device_containment_events', 'support_access_sessions',
                      'support_access_events')
    and c.relrowsecurity and c.relforcerowsecurity;
  if v_count <> 7 then
    raise exception 'KLUY-MIGRATION-0177: only % of 7 fleet tables carry ENABLE+FORCE RLS', v_count;
  end if;

  -- The development policy row exists; pilot/production rows cannot.
  if not exists (select 1 from kitluy_devices.fleet_health_policy
                  where environment = 'development') then
    raise exception 'KLUY-MIGRATION-0177: the development fleet policy row is missing';
  end if;
  begin
    set local role kitluy_fleet_governor;
    insert into kitluy_devices.fleet_health_policy
      (environment, heartbeat_interval_seconds, projection_stale_after_seconds,
       allowed_clock_skew_seconds, support_session_max_minutes, decision_ref)
    values ('production', 60, 300, 300, 60, 'probe');
    reset role;
    raise exception 'KLUY-MIGRATION-0177: a production fleet policy row was accepted without signed configuration';
  exception
    when raise_exception then
      reset role;
      if sqlerrm not like 'KLUY-FLEET-POLICY-UNSIGNED%' then
        raise;
      end if;
  end;

  raise notice 'KLUY-MIGRATION-0177: fleet health projection, freshness policy, support access and governed containment installed; governor-owned, RLS-forced, service_role effectively excluded, worker sweeper reachable, development thresholds recorded as [REQUIRED]-pending owner values';
end
$guard$;

do $hand_back$
begin
  execute format('revoke kitluy_fleet_governor from %I', current_user);
end
$hand_back$;
