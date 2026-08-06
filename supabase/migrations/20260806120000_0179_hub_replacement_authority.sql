-- kitluy:group:0179
-- Migration group 0179: hub_replacement_authority.
--
-- Authority: WS-11-T006-P01 (KLD-2026-08-06-WS11-T006-001 §1-§3 — LOCKED
-- replacement identity, approval and recovery-truth rules); the owner-fixed
-- NVMe replacement order (000_ACTIVE_PHASE.md §10); trust policy v1.0.0 §11;
-- prior groups 0120 (devices, retire/replacement doors, certificates),
-- 0121 (assignments, generations), 0177 (fleet governor/service identities).
--
-- ===========================================================================
-- WHAT A REPLACEMENT IS, AND WHAT IT IS NOT
-- ===========================================================================
-- A governed, four-eyes, idempotent OPERATION over existing identities —
-- never a second identity machine. Same-Pi NVMe replacement keeps the Hub
-- UUID and records the mandatory new-key/certificate rotation; full-Pi
-- replacement moves the Location's operational authority to a NEW Hub UUID
-- through an atomic cutover that revokes the old assignment and marks the
-- old device replaced (replaced_by set), composing the 0120/0121 doors and
-- state machine. History is never rewritten; an unreachable old Hub is
-- RECORDED as unreachable, not claimed cleaned.
--
-- One-active-Hub-per-Location (§1) is enforced AT THE CUTOVER DOOR, not by a
-- retroactive schema constraint: the shipped development fixtures create
-- several store_hub devices with live assignments in one Location, so a
-- structural partial-unique would rewrite history this group must not touch.
-- Recorded honestly; T007 owns the adversarial sweep of that boundary.
-- ===========================================================================
-- kitluy:destructive-approved:KLD-2026-08-06-WS11-T006-001 -- no
-- DROP/TRUNCATE/DELETE in this group; marker present so the guard never
-- reads a future edit as unmarked history.
-- ===========================================================================

do $borrow$
begin
  execute format('grant kitluy_fleet_governor to %I', current_user);
end
$borrow$;

-- Composition reach this group adds to the fleet governor (0177 discipline:
-- minimal, named, recorded): assignment revocation, certificate metadata the
-- 0120 replacement door touches, and the replacement/retire doors.
grant update on kitluy_devices.device_assignments to kitluy_fleet_governor;
grant select, update on kitluy_devices.device_terminal_assignments to kitluy_fleet_governor;
grant select, update on kitluy_devices.device_claims to kitluy_fleet_governor;
grant select, delete on kitluy_devices.device_assignment_projections to kitluy_fleet_governor;
grant select, update on kitluy_devices.manufacturing_enrollments to kitluy_fleet_governor;
grant select, insert, update on kitluy_devices.device_certificates to kitluy_fleet_governor;
grant select, insert, update on kitluy_devices.device_replacements to kitluy_fleet_governor;
grant execute on function kitluy_devices.retire_device_v1(uuid, text, text) to kitluy_fleet_governor;
grant execute on function kitluy_devices.revoke_device_assignment_v1(uuid, text, text) to kitluy_fleet_governor;
grant execute on function kitluy_devices.record_claim_event(uuid, uuid, uuid, text, text, jsonb) to kitluy_fleet_governor;
grant select, insert on kitluy_devices.device_claim_events to kitluy_fleet_governor;
grant execute on function kitluy_devices.record_device_replacement_v1(uuid, kitluy_devices.replacement_kind, text, text, text, uuid) to kitluy_fleet_governor;

drop policy if exists dc_fleet_governor on kitluy_devices.device_certificates;
create policy dc_fleet_governor on kitluy_devices.device_certificates
  for all to kitluy_fleet_governor using (true) with check (true);
drop policy if exists dr_fleet_governor on kitluy_devices.device_replacements;
create policy dr_fleet_governor on kitluy_devices.device_replacements
  for all to kitluy_fleet_governor using (true) with check (true);
drop policy if exists dta_fleet_governor on kitluy_devices.device_terminal_assignments;
create policy dta_fleet_governor on kitluy_devices.device_terminal_assignments
  for all to kitluy_fleet_governor using (true) with check (true);
drop policy if exists dcl_fleet_governor on kitluy_devices.device_claims;
create policy dcl_fleet_governor on kitluy_devices.device_claims
  for all to kitluy_fleet_governor using (true) with check (true);
drop policy if exists dap_fleet_governor on kitluy_devices.device_assignment_projections;
create policy dap_fleet_governor on kitluy_devices.device_assignment_projections
  for all to kitluy_fleet_governor using (true) with check (true);
drop policy if exists me_fleet_governor on kitluy_devices.manufacturing_enrollments;
create policy me_fleet_governor on kitluy_devices.manufacturing_enrollments
  for all to kitluy_fleet_governor using (true) with check (true);
drop policy if exists dce2_fleet_governor on kitluy_devices.device_claim_events;
create policy dce2_fleet_governor on kitluy_devices.device_claim_events
  for all to kitluy_fleet_governor using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 1. THE OPERATION AND ITS EVENTS
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.hub_replacement_operations (
  id uuid primary key default extensions.gen_random_uuid(),
  replacement_type text not null,
  old_hub_device_id uuid not null references kitluy_devices.devices (id),
  replacement_hub_device_id uuid references kitluy_devices.devices (id),
  tenant_id uuid not null,
  digital_store_id uuid not null,
  store_location_id uuid not null,
  environment text not null,
  state text not null default 'requested',
  reason text not null,
  requester_ref text not null,
  requester_reauth_ref text not null,
  approver_ref text,
  idempotency_key text not null unique,
  expected_assignment_generation integer not null,
  backup_ref uuid,
  old_credential_revocation_ref text,
  new_credential_activation_ref text,
  terminal_repair_required boolean not null default true,
  old_hub_unreachable boolean not null default false,
  correlation_id uuid not null,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  cutover_committed_at timestamptz,
  completed_at timestamptz,
  failure_reason text,
  updated_at timestamptz not null default now(),
  constraint hro_type_chk
    check (replacement_type in ('nvme_same_pi', 'full_pi', 'compromised_loss')),
  constraint hro_state_chk
    check (state in ('requested', 'approved', 'replacement_provisioned',
                     'restore_ready', 'cutover_ready', 'cutover_committed',
                     'old_hub_retired', 'completed', 'cancelled', 'failed')),
  constraint hro_env_chk check (environment in ('development', 'pilot', 'production')),
  constraint hro_generation_chk check (expected_assignment_generation >= 1),
  constraint hro_four_eyes_chk
    check (approver_ref is null or approver_ref <> requester_ref),
  constraint hro_same_pi_identity_chk
    check (replacement_type <> 'nvme_same_pi'
           or replacement_hub_device_id is null
           or replacement_hub_device_id = old_hub_device_id),
  constraint hro_new_pi_identity_chk
    check (replacement_type = 'nvme_same_pi'
           or replacement_hub_device_id is null
           or replacement_hub_device_id <> old_hub_device_id)
);

comment on table kitluy_devices.hub_replacement_operations is
  'Group 0179 (WS-11-T006-P01). Governed Hub replacement/cutover operations (KLD-2026-08-06-WS11-T006-001 §1-§2). Relational authority — every fact a column, none only JSON. Same-Pi NVMe keeps the UUID (replacement = old device, new key/cert MANDATORY, ref recorded); full-Pi/compromised move authority to a NEW UUID atomically at cutover. MC: MUT (governor only, via doors).';

create table if not exists kitluy_devices.hub_replacement_events (
  id uuid primary key default extensions.gen_random_uuid(),
  operation_id uuid not null references kitluy_devices.hub_replacement_operations (id),
  from_state text,
  to_state text not null,
  actor_ref text not null,
  detail jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  occurred_at timestamptz not null default now(),
  constraint hre_detail_bounded_chk check (pg_column_size(detail) <= 8192)
);

comment on table kitluy_devices.hub_replacement_events is
  'Group 0179 (WS-11-T006-P01). Append-only replacement audit: every transition with actor, detail and correlation. MC: A/O.';

create or replace function kitluy_devices.enforce_hub_replacement_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'KLUY-HUBREPL-EVENT-IMMUTABLE: replacement events are append-only'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_hub_replacement_events_append_only on kitluy_devices.hub_replacement_events;
create trigger trg_hub_replacement_events_append_only
  before update or delete on kitluy_devices.hub_replacement_events
  for each row execute function kitluy_devices.enforce_hub_replacement_events_append_only();

revoke all on function kitluy_devices.enforce_hub_replacement_events_append_only() from public;
alter function kitluy_devices.enforce_hub_replacement_events_append_only() owner to kitluy_fleet_governor;

create or replace function kitluy_devices.enforce_hub_replacement_governed()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-HUBREPL-IMMUTABLE: a replacement operation is cancelled or failed, never deleted'
      using errcode = 'P0001';
  end if;
  if current_user <> 'kitluy_fleet_governor' then
    raise exception 'KLUY-HUBREPL-GOVERNED: replacement operations change only through governed doors (group 0179)'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hub_replacement_governed on kitluy_devices.hub_replacement_operations;
create trigger trg_hub_replacement_governed
  before insert or update or delete on kitluy_devices.hub_replacement_operations
  for each row execute function kitluy_devices.enforce_hub_replacement_governed();

revoke all on function kitluy_devices.enforce_hub_replacement_governed() from public;
alter function kitluy_devices.enforce_hub_replacement_governed() owner to kitluy_fleet_governor;

-- ---------------------------------------------------------------------------
-- 2. INTERNAL HELPERS
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.hub_replacement_record_event(
  p_op uuid, p_from text, p_to text, p_actor text, p_detail jsonb, p_corr uuid
) returns void
language sql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $$
  insert into kitluy_devices.hub_replacement_events
    (operation_id, from_state, to_state, actor_ref, detail, correlation_id)
  values (p_op, p_from, p_to, p_actor, coalesce(p_detail, '{}'::jsonb), p_corr);
$$;

create or replace function kitluy_devices.live_hub_assignment(
  p_device uuid
) returns kitluy_devices.device_assignments
language sql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $$
  select a.* from kitluy_devices.device_assignments a
   where a.device_id = p_device and a.state in ('pending_trust', 'active')
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 3. THE DOORS
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.request_hub_replacement_v1(
  p_old_hub uuid,
  p_replacement_type text,
  p_reason text,
  p_requester_ref text,
  p_requester_reauth_ref text,
  p_idempotency_key text,
  p_correlation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $req$
declare
  v_old kitluy_devices.devices;
  v_assignment kitluy_devices.device_assignments;
  v_existing kitluy_devices.hub_replacement_operations;
  v_id uuid;
begin
  if p_replacement_type not in ('nvme_same_pi', 'full_pi', 'compromised_loss') then
    raise exception 'KLUY-HUBREPL-TYPE: % is not a replacement type', p_replacement_type
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' or coalesce(btrim(p_requester_ref), '') = '' then
    raise exception 'KLUY-HUBREPL-UNATTRIBUTED: a replacement names its reason and requester'
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_requester_reauth_ref), '') = '' then
    raise exception 'KLUY-HUBREPL-REAUTH-REQUIRED: replacement requires reauthentication evidence (owner decision §2)'
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_idempotency_key), '') = '' or p_correlation_id is null then
    raise exception 'KLUY-HUBREPL-IDENTITY-REQUIRED: an idempotency key and correlation id are mandatory'
      using errcode = 'P0001';
  end if;

  select * into v_existing from kitluy_devices.hub_replacement_operations
   where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.old_hub_device_id = p_old_hub
       and v_existing.replacement_type = p_replacement_type then
      return jsonb_build_object('outcome', 'EXISTING',
                                'operation_id', v_existing.id,
                                'state', v_existing.state);
    end if;
    raise exception 'KLUY-HUBREPL-IDEMPOTENCY-CONFLICT: key % was already used for a different replacement', p_idempotency_key
      using errcode = 'P0001';
  end if;

  select * into v_old from kitluy_devices.devices where id = p_old_hub for update;
  if not found or v_old.device_class <> 'store_hub' then
    raise exception 'KLUY-HUBREPL-NOT-HUB: % is not an enrolled Store Hub', p_old_hub
      using errcode = 'P0001';
  end if;

  v_assignment := kitluy_devices.live_hub_assignment(p_old_hub);
  if v_assignment.id is null then
    -- Emergency containment may already have revoked the old Hub (owner
    -- decision §2): a compromised_loss replacement then anchors on the
    -- LATEST historical assignment; other types require a live one.
    if p_replacement_type = 'compromised_loss' then
      select a.* into v_assignment from kitluy_devices.device_assignments a
       where a.device_id = p_old_hub
       order by a.assignment_generation desc limit 1;
    end if;
    if v_assignment.id is null then
      raise exception 'KLUY-HUBREPL-UNASSIGNED: the old Hub has no assignment to replace'
        using errcode = 'P0001';
    end if;
  end if;

  insert into kitluy_devices.hub_replacement_operations
    (replacement_type, old_hub_device_id, tenant_id, digital_store_id,
     store_location_id, environment, reason, requester_ref,
     requester_reauth_ref, idempotency_key, expected_assignment_generation,
     correlation_id)
  values
    (p_replacement_type, p_old_hub, v_assignment.tenant_id,
     v_assignment.digital_store_id, v_assignment.store_location_id,
     'development', p_reason, btrim(p_requester_ref),
     btrim(p_requester_reauth_ref), p_idempotency_key,
     v_assignment.assignment_generation, p_correlation_id)
  returning id into v_id;

  perform kitluy_devices.hub_replacement_record_event(
    v_id, null, 'requested', btrim(p_requester_ref),
    jsonb_build_object('replacement_type', p_replacement_type,
                       'old_hub', p_old_hub), p_correlation_id);

  return jsonb_build_object('outcome', 'REQUESTED', 'operation_id', v_id,
                            'expected_assignment_generation',
                            v_assignment.assignment_generation);
end;
$req$;

comment on function kitluy_devices.request_hub_replacement_v1(uuid, text, text, text, text, text, uuid) is
  'Group 0179 (WS-11-T006-P01). Opens a replacement operation: scope derived from the old Hub''s live assignment, reauthentication evidence mandatory, idempotent on the key (identical retry EXISTING; conflicting key refused).';

create or replace function kitluy_devices.approve_hub_replacement_v1(
  p_op uuid,
  p_approver_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $appr$
declare
  v_op kitluy_devices.hub_replacement_operations;
begin
  select * into v_op from kitluy_devices.hub_replacement_operations
   where id = p_op for update;
  if not found then
    raise exception 'KLUY-HUBREPL-UNKNOWN: operation % does not exist', p_op
      using errcode = 'P0001';
  end if;
  if v_op.state = 'approved' and v_op.approver_ref = btrim(p_approver_ref) then
    return jsonb_build_object('outcome', 'ALREADY_APPROVED');
  end if;
  if v_op.state <> 'requested' then
    raise exception 'KLUY-HUBREPL-STATE: approval applies to a requested operation, not %', v_op.state
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_approver_ref), '') = '' then
    raise exception 'KLUY-HUBREPL-UNAPPROVED: an approver must be named'
      using errcode = 'P0001';
  end if;
  if btrim(p_approver_ref) = v_op.requester_ref then
    raise exception 'KLUY-HUBREPL-SELF-APPROVAL: the requester can never approve their own replacement'
      using errcode = 'P0001';
  end if;

  update kitluy_devices.hub_replacement_operations
  set state = 'approved', approver_ref = btrim(p_approver_ref),
      approved_at = now(), updated_at = now()
  where id = p_op;
  perform kitluy_devices.hub_replacement_record_event(
    p_op, 'requested', 'approved', btrim(p_approver_ref), '{}', v_op.correlation_id);
  return jsonb_build_object('outcome', 'APPROVED');
end;
$appr$;

comment on function kitluy_devices.approve_hub_replacement_v1(uuid, text) is
  'Group 0179. Four-eyes approval: requester and approver structurally distinct (CHECK + door).';

create or replace function kitluy_devices.register_replacement_hub_v1(
  p_op uuid,
  p_replacement_hub uuid,
  p_actor_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $prov$
declare
  v_op kitluy_devices.hub_replacement_operations;
  v_new kitluy_devices.devices;
  v_new_assignment kitluy_devices.device_assignments;
begin
  select * into v_op from kitluy_devices.hub_replacement_operations
   where id = p_op for update;
  if not found then
    raise exception 'KLUY-HUBREPL-UNKNOWN: operation % does not exist', p_op
      using errcode = 'P0001';
  end if;
  if v_op.state = 'replacement_provisioned'
     and v_op.replacement_hub_device_id = p_replacement_hub then
    return jsonb_build_object('outcome', 'ALREADY_PROVISIONED');
  end if;
  if v_op.state <> 'approved' then
    raise exception 'KLUY-HUBREPL-STATE: provisioning applies to an approved operation, not %', v_op.state
      using errcode = 'P0001';
  end if;

  if v_op.replacement_type = 'nvme_same_pi' then
    if p_replacement_hub <> v_op.old_hub_device_id then
      raise exception 'KLUY-HUBREPL-IDENTITY: same-Pi NVMe replacement keeps the SAME Hub UUID (owner decision §1)'
        using errcode = 'P0001';
    end if;
  else
    if p_replacement_hub = v_op.old_hub_device_id then
      raise exception 'KLUY-HUBREPL-IDENTITY: a replacement Pi requires a NEW Hub UUID; the old identity is never transferred (owner decision §1)'
        using errcode = 'P0001';
    end if;
    select * into v_new from kitluy_devices.devices where id = p_replacement_hub;
    if not found or v_new.device_class <> 'store_hub' then
      raise exception 'KLUY-HUBREPL-NOT-HUB: % is not an enrolled Store Hub', p_replacement_hub
        using errcode = 'P0001';
    end if;
    v_new_assignment := kitluy_devices.live_hub_assignment(p_replacement_hub);
    if v_new_assignment.id is null
       or v_new_assignment.store_location_id <> v_op.store_location_id
       or v_new_assignment.tenant_id <> v_op.tenant_id
       or v_new_assignment.digital_store_id <> v_op.digital_store_id then
      raise exception 'KLUY-HUBREPL-SCOPE: the replacement Hub must hold a live assignment in the SAME Tenant, Store and Location'
        using errcode = 'P0001';
    end if;
  end if;

  update kitluy_devices.hub_replacement_operations
  set state = 'replacement_provisioned',
      replacement_hub_device_id = p_replacement_hub,
      updated_at = now()
  where id = p_op;
  perform kitluy_devices.hub_replacement_record_event(
    p_op, v_op.state, 'replacement_provisioned', btrim(p_actor_ref),
    jsonb_build_object('replacement_hub', p_replacement_hub), v_op.correlation_id);
  return jsonb_build_object('outcome', 'PROVISIONED');
end;
$prov$;

comment on function kitluy_devices.register_replacement_hub_v1(uuid, uuid, text) is
  'Group 0179. Binds the replacement identity: SAME device for nvme_same_pi (UUID retained), a DIFFERENT enrolled Hub with a live same-scope assignment otherwise. Cross-Tenant/Store/Location refused.';

create or replace function kitluy_devices.mark_replacement_restore_ready_v1(
  p_op uuid, p_backup_ref uuid, p_actor_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $rr$
declare
  v_op kitluy_devices.hub_replacement_operations;
begin
  select * into v_op from kitluy_devices.hub_replacement_operations
   where id = p_op for update;
  if not found then
    raise exception 'KLUY-HUBREPL-UNKNOWN: operation % does not exist', p_op using errcode = 'P0001';
  end if;
  if v_op.state = 'restore_ready' then
    return jsonb_build_object('outcome', 'ALREADY_RESTORE_READY');
  end if;
  if v_op.state <> 'replacement_provisioned' then
    raise exception 'KLUY-HUBREPL-STATE: restore-ready applies after provisioning, not %', v_op.state
      using errcode = 'P0001';
  end if;
  update kitluy_devices.hub_replacement_operations
  set state = 'restore_ready', backup_ref = p_backup_ref, updated_at = now()
  where id = p_op;
  perform kitluy_devices.hub_replacement_record_event(
    p_op, 'replacement_provisioned', 'restore_ready', btrim(p_actor_ref),
    jsonb_build_object('backup_ref', p_backup_ref), v_op.correlation_id);
  return jsonb_build_object('outcome', 'RESTORE_READY');
end;
$rr$;

create or replace function kitluy_devices.mark_replacement_cutover_ready_v1(
  p_op uuid, p_actor_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $cr$
declare
  v_op kitluy_devices.hub_replacement_operations;
begin
  select * into v_op from kitluy_devices.hub_replacement_operations
   where id = p_op for update;
  if not found then
    raise exception 'KLUY-HUBREPL-UNKNOWN: operation % does not exist', p_op using errcode = 'P0001';
  end if;
  if v_op.state = 'cutover_ready' then
    return jsonb_build_object('outcome', 'ALREADY_CUTOVER_READY');
  end if;
  if v_op.state <> 'restore_ready' then
    raise exception 'KLUY-HUBREPL-STATE: cutover-ready applies after restore-ready, not %', v_op.state
      using errcode = 'P0001';
  end if;
  update kitluy_devices.hub_replacement_operations
  set state = 'cutover_ready', updated_at = now() where id = p_op;
  perform kitluy_devices.hub_replacement_record_event(
    p_op, 'restore_ready', 'cutover_ready', btrim(p_actor_ref), '{}', v_op.correlation_id);
  return jsonb_build_object('outcome', 'CUTOVER_READY');
end;
$cr$;

create or replace function kitluy_devices.commit_hub_replacement_cutover_v1(
  p_op uuid,
  p_expected_assignment_generation integer,
  p_actor_ref text,
  p_old_credential_revocation_ref text,
  p_old_hub_reachable boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $cut$
declare
  v_op kitluy_devices.hub_replacement_operations;
  v_old_assignment kitluy_devices.device_assignments;
  v_old kitluy_devices.devices;
begin
  select * into v_op from kitluy_devices.hub_replacement_operations
   where id = p_op for update;
  if not found then
    raise exception 'KLUY-HUBREPL-UNKNOWN: operation % does not exist', p_op using errcode = 'P0001';
  end if;

  -- Retry after success returns the ORIGINAL result (§7.7); a concurrent
  -- second caller serializes on the row lock and lands here too.
  if v_op.state in ('cutover_committed', 'old_hub_retired', 'completed') then
    return jsonb_build_object('outcome', 'CUTOVER_ALREADY_COMMITTED',
                              'operation_id', v_op.id,
                              'committed_at', v_op.cutover_committed_at);
  end if;
  if v_op.state <> 'cutover_ready' then
    raise exception 'KLUY-HUBREPL-STATE: cutover applies to a cutover_ready operation, not % (approval and eligibility cannot be skipped)', v_op.state
      using errcode = 'P0001';
  end if;
  if v_op.approver_ref is null then
    raise exception 'KLUY-HUBREPL-UNAPPROVED: cutover without four-eyes approval is impossible'
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_old_credential_revocation_ref), '') = '' then
    raise exception 'KLUY-HUBREPL-REVOCATION-REQUIRED: the old operational certificate revocation must be recorded before cutover (owner decision §1)'
      using errcode = 'P0001';
  end if;
  if p_expected_assignment_generation <> v_op.expected_assignment_generation then
    raise exception 'KLUY-HUBREPL-STALE-GENERATION: cutover expected generation %, got %', v_op.expected_assignment_generation, p_expected_assignment_generation
      using errcode = 'P0001';
  end if;

  select * into v_old from kitluy_devices.devices
   where id = v_op.old_hub_device_id for update;

  v_old_assignment := kitluy_devices.live_hub_assignment(v_op.old_hub_device_id);

  if v_op.replacement_type = 'nvme_same_pi' then
    -- Owner-fixed NVMe order, composed from the EXISTING doors: the live
    -- assignment is revoked (0121 door — also revokes terminal assignments
    -- and drops the offline projection), then the storage replacement is
    -- recorded (0120 door — revokes the old certificates, pins
    -- private_key_carried_over = false, quarantines pending governed
    -- re-enrollment). The SAME UUID then re-earns trust: re-enroll, claim,
    -- new generation, NEW key and certificate.
    if v_old_assignment.id is null
       or v_old_assignment.assignment_generation <> v_op.expected_assignment_generation then
      raise exception 'KLUY-HUBREPL-STALE-GENERATION: the old Hub''s live assignment moved; cutover refused'
        using errcode = 'P0001';
    end if;
    perform kitluy_devices.revoke_device_assignment_v1(
      v_op.old_hub_device_id,
      format('HUB_NVME_REPLACEMENT: %s', v_op.reason), btrim(p_actor_ref));
    perform kitluy_devices.record_device_replacement_v1(
      v_op.old_hub_device_id, 'storage_module',
      'HUB_NVME_REPLACEMENT', btrim(p_actor_ref), null, null);
  else
    if v_old_assignment.id is not null then
      if v_old_assignment.assignment_generation <> v_op.expected_assignment_generation then
        raise exception 'KLUY-HUBREPL-STALE-GENERATION: the old Hub''s live assignment moved; cutover refused'
          using errcode = 'P0001';
      end if;
      perform kitluy_devices.revoke_device_assignment_v1(
        v_op.old_hub_device_id,
        format('HUB_REPLACEMENT_%s: %s', upper(v_op.replacement_type), v_op.reason),
        btrim(p_actor_ref));
    end if;
    -- (compromised_loss with an already-revoked assignment: the emergency
    -- path did the revocation; recorded below, never re-claimed here.)

    select * into v_old from kitluy_devices.devices
     where id = v_op.old_hub_device_id;
    if v_op.replacement_type = 'full_pi' then
      update kitluy_devices.devices
      set lifecycle_state = 'replaced',
          replaced_by_device_id = v_op.replacement_hub_device_id,
          updated_at = now()
      where id = v_op.old_hub_device_id;
      perform kitluy_devices.record_lifecycle_event(
        v_op.old_hub_device_id, v_old.lifecycle_state, 'replaced',
        'HUB_REPLACEMENT_CUTOVER', btrim(p_actor_ref),
        jsonb_build_object('operation_id', p_op,
                           'replaced_by', v_op.replacement_hub_device_id));
    else
      if v_old.lifecycle_state <> 'quarantined' then
        perform kitluy_devices.quarantine_device_v1(
          v_op.old_hub_device_id, 'manual_quarantine', 'CRITICAL',
          btrim(p_actor_ref), format('compromised hub replacement: %s', v_op.reason),
          jsonb_build_object('operation_id', p_op));
      end if;
    end if;

    -- §7.1 one active Hub per Location, door-enforced: after revoking the
    -- old assignment, the replacement's live assignment must be the ONLY
    -- store_hub-class live assignment left in this Location.
  end if;

  -- §7.1 one active Hub per Location, door-enforced for EVERY type: after
  -- the revocations above, no OTHER store_hub-class device may hold a live
  -- assignment in this Location besides the replacement identity.
  if (select count(*)
        from kitluy_devices.device_assignments a
        join kitluy_devices.devices d on d.id = a.device_id
       where a.store_location_id = v_op.store_location_id
         and a.state in ('pending_trust', 'active')
         and d.device_class = 'store_hub'
         and a.device_id <> coalesce(v_op.replacement_hub_device_id, v_op.old_hub_device_id)) > 0 then
    raise exception 'KLUY-HUBREPL-DUAL-ACTIVE: another live Store Hub assignment exists for this Location; cutover refused'
      using errcode = 'P0001';
  end if;

  update kitluy_devices.hub_replacement_operations
  set state = 'cutover_committed',
      old_credential_revocation_ref = btrim(p_old_credential_revocation_ref),
      old_hub_unreachable = not coalesce(p_old_hub_reachable, true),
      cutover_committed_at = now(),
      updated_at = now()
  where id = p_op;
  perform kitluy_devices.hub_replacement_record_event(
    p_op, 'cutover_ready', 'cutover_committed', btrim(p_actor_ref),
    jsonb_build_object('old_hub_reachable', coalesce(p_old_hub_reachable, true),
                       'revocation_ref', btrim(p_old_credential_revocation_ref)),
    v_op.correlation_id);

  return jsonb_build_object('outcome', 'CUTOVER_COMMITTED',
                            'old_hub_unreachable', not coalesce(p_old_hub_reachable, true));
end;
$cut$;

comment on function kitluy_devices.commit_hub_replacement_cutover_v1(uuid, integer, text, text, boolean) is
  'Group 0179. The atomic cutover: expected-generation check, old assignment revoked, old identity replaced (replaced_by set) or quarantined, dual-active refused, unreachable old Hub RECORDED not claimed cleaned, retry returns the original result. Same-Pi NVMe moves no assignment — the identity stays, the certificate does not.';

create or replace function kitluy_devices.retire_old_hub_replacement_v1(
  p_op uuid, p_actor_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $ret$
declare
  v_op kitluy_devices.hub_replacement_operations;
  v_old kitluy_devices.devices;
begin
  select * into v_op from kitluy_devices.hub_replacement_operations
   where id = p_op for update;
  if not found then
    raise exception 'KLUY-HUBREPL-UNKNOWN: operation % does not exist', p_op using errcode = 'P0001';
  end if;
  if v_op.state = 'old_hub_retired' then
    return jsonb_build_object('outcome', 'ALREADY_RETIRED');
  end if;
  if v_op.state <> 'cutover_committed' then
    raise exception 'KLUY-HUBREPL-STATE: retirement applies after cutover, not %', v_op.state
      using errcode = 'P0001';
  end if;

  select * into v_old from kitluy_devices.devices where id = v_op.old_hub_device_id;
  if v_op.replacement_type = 'compromised_loss'
     and v_old.lifecycle_state = 'quarantined' then
    perform kitluy_devices.retire_device_v1(
      v_op.old_hub_device_id, 'HUB_REPLACEMENT_RETIREMENT', btrim(p_actor_ref));
  end if;
  -- full_pi: 'replaced' IS the terminal identity outcome (replaced_by set);
  -- nvme_same_pi: the device continues as the same identity — nothing to
  -- retire. Both recorded, neither rewritten.

  update kitluy_devices.hub_replacement_operations
  set state = 'old_hub_retired', updated_at = now() where id = p_op;
  perform kitluy_devices.hub_replacement_record_event(
    p_op, 'cutover_committed', 'old_hub_retired', btrim(p_actor_ref),
    jsonb_build_object('old_lifecycle', v_old.lifecycle_state), v_op.correlation_id);
  return jsonb_build_object('outcome', 'OLD_HUB_RETIRED');
end;
$ret$;

create or replace function kitluy_devices.complete_hub_replacement_v1(
  p_op uuid, p_actor_ref text, p_new_credential_activation_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $done$
declare
  v_op kitluy_devices.hub_replacement_operations;
begin
  select * into v_op from kitluy_devices.hub_replacement_operations
   where id = p_op for update;
  if not found then
    raise exception 'KLUY-HUBREPL-UNKNOWN: operation % does not exist', p_op using errcode = 'P0001';
  end if;
  if v_op.state = 'completed' then
    return jsonb_build_object('outcome', 'ALREADY_COMPLETED');
  end if;
  if v_op.state <> 'old_hub_retired' then
    raise exception 'KLUY-HUBREPL-STATE: completion applies after retirement, not %', v_op.state
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_new_credential_activation_ref), '') = '' then
    raise exception 'KLUY-HUBREPL-ACTIVATION-REQUIRED: completion records the NEW credential activation evidence (owner decision §1)'
      using errcode = 'P0001';
  end if;
  update kitluy_devices.hub_replacement_operations
  set state = 'completed',
      new_credential_activation_ref = btrim(p_new_credential_activation_ref),
      completed_at = now(), updated_at = now()
  where id = p_op;
  perform kitluy_devices.hub_replacement_record_event(
    p_op, 'old_hub_retired', 'completed', btrim(p_actor_ref),
    jsonb_build_object('terminal_repair_required', v_op.terminal_repair_required),
    v_op.correlation_id);
  return jsonb_build_object('outcome', 'COMPLETED',
                            'terminal_repair_required', v_op.terminal_repair_required);
end;
$done$;

create or replace function kitluy_devices.cancel_hub_replacement_v1(
  p_op uuid, p_actor_ref text, p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $cxl$
declare
  v_op kitluy_devices.hub_replacement_operations;
begin
  select * into v_op from kitluy_devices.hub_replacement_operations
   where id = p_op for update;
  if not found then
    raise exception 'KLUY-HUBREPL-UNKNOWN: operation % does not exist', p_op using errcode = 'P0001';
  end if;
  if v_op.state = 'cancelled' then
    return jsonb_build_object('outcome', 'ALREADY_CANCELLED');
  end if;
  if v_op.state in ('cutover_committed', 'old_hub_retired', 'completed') then
    raise exception 'KLUY-HUBREPL-STATE: a committed cutover is rolled forward or failed, never cancelled'
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'KLUY-HUBREPL-UNATTRIBUTED: cancellation records its reason' using errcode = 'P0001';
  end if;
  update kitluy_devices.hub_replacement_operations
  set state = 'cancelled', failure_reason = p_reason, updated_at = now()
  where id = p_op;
  perform kitluy_devices.hub_replacement_record_event(
    p_op, v_op.state, 'cancelled', btrim(p_actor_ref),
    jsonb_build_object('reason', p_reason), v_op.correlation_id);
  return jsonb_build_object('outcome', 'CANCELLED');
end;
$cxl$;

create or replace function kitluy_devices.fail_hub_replacement_v1(
  p_op uuid, p_actor_ref text, p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $fail$
declare
  v_op kitluy_devices.hub_replacement_operations;
begin
  select * into v_op from kitluy_devices.hub_replacement_operations
   where id = p_op for update;
  if not found then
    raise exception 'KLUY-HUBREPL-UNKNOWN: operation % does not exist', p_op using errcode = 'P0001';
  end if;
  if v_op.state = 'failed' then
    return jsonb_build_object('outcome', 'ALREADY_FAILED');
  end if;
  if v_op.state in ('completed', 'cancelled') then
    raise exception 'KLUY-HUBREPL-STATE: a % operation cannot fail', v_op.state using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'KLUY-HUBREPL-UNATTRIBUTED: failure records its reason' using errcode = 'P0001';
  end if;
  update kitluy_devices.hub_replacement_operations
  set state = 'failed', failure_reason = p_reason, updated_at = now()
  where id = p_op;
  perform kitluy_devices.hub_replacement_record_event(
    p_op, v_op.state, 'failed', btrim(p_actor_ref),
    jsonb_build_object('reason', p_reason), v_op.correlation_id);
  return jsonb_build_object('outcome', 'FAILED', 'from_state', v_op.state);
end;
$fail$;

-- ---------------------------------------------------------------------------
-- 4. OWNERSHIP, RLS, GRANTS
-- ---------------------------------------------------------------------------
alter table kitluy_devices.hub_replacement_operations owner to kitluy_fleet_governor;
alter table kitluy_devices.hub_replacement_events owner to kitluy_fleet_governor;

do $rls$
declare
  v_table text;
begin
  foreach v_table in array array[
    'kitluy_devices.hub_replacement_operations',
    'kitluy_devices.hub_replacement_events'] loop
    execute format('alter table %s enable row level security', v_table);
    execute format('alter table %s force row level security', v_table);
    execute format('revoke all on table %s from public, anon, authenticated, service_role', v_table);
  end loop;
end
$rls$;

drop policy if exists hro_governor on kitluy_devices.hub_replacement_operations;
create policy hro_governor on kitluy_devices.hub_replacement_operations
  for all to kitluy_fleet_governor using (true) with check (true);
drop policy if exists hre_governor on kitluy_devices.hub_replacement_events;
create policy hre_governor on kitluy_devices.hub_replacement_events
  for all to kitluy_fleet_governor using (true) with check (true);

do $own_fn$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'kitluy_devices.hub_replacement_record_event(uuid, text, text, text, jsonb, uuid)',
    'kitluy_devices.live_hub_assignment(uuid)',
    'kitluy_devices.request_hub_replacement_v1(uuid, text, text, text, text, text, uuid)',
    'kitluy_devices.approve_hub_replacement_v1(uuid, text)',
    'kitluy_devices.register_replacement_hub_v1(uuid, uuid, text)',
    'kitluy_devices.mark_replacement_restore_ready_v1(uuid, uuid, text)',
    'kitluy_devices.mark_replacement_cutover_ready_v1(uuid, text)',
    'kitluy_devices.commit_hub_replacement_cutover_v1(uuid, integer, text, text, boolean)',
    'kitluy_devices.retire_old_hub_replacement_v1(uuid, text)',
    'kitluy_devices.complete_hub_replacement_v1(uuid, text, text)',
    'kitluy_devices.cancel_hub_replacement_v1(uuid, text, text)',
    'kitluy_devices.fail_hub_replacement_v1(uuid, text, text)'] loop
    execute format('alter function %s owner to kitluy_fleet_governor', v_fn);
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
  foreach v_fn in array array[
    'kitluy_devices.request_hub_replacement_v1(uuid, text, text, text, text, text, uuid)',
    'kitluy_devices.approve_hub_replacement_v1(uuid, text)',
    'kitluy_devices.register_replacement_hub_v1(uuid, uuid, text)',
    'kitluy_devices.mark_replacement_restore_ready_v1(uuid, uuid, text)',
    'kitluy_devices.mark_replacement_cutover_ready_v1(uuid, text)',
    'kitluy_devices.commit_hub_replacement_cutover_v1(uuid, integer, text, text, boolean)',
    'kitluy_devices.retire_old_hub_replacement_v1(uuid, text)',
    'kitluy_devices.complete_hub_replacement_v1(uuid, text, text)',
    'kitluy_devices.cancel_hub_replacement_v1(uuid, text, text)',
    'kitluy_devices.fail_hub_replacement_v1(uuid, text, text)'] loop
    execute format('grant execute on function %s to kitluy_fleet_service, kitluy_test_harness', v_fn);
  end loop;
end
$own_fn$;

-- ---------------------------------------------------------------------------
-- 5. PROVE THE BOUNDARY ON APPLY
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'kitluy_devices.request_hub_replacement_v1(uuid, text, text, text, text, text, uuid)',
    'kitluy_devices.commit_hub_replacement_cutover_v1(uuid, integer, text, text, boolean)'] loop
    if has_function_privilege('service_role', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'KLUY-MIGRATION-0179: a runtime identity reaches % directly', v_fn;
    end if;
    if not has_function_privilege('kitluy_fleet_service', v_fn, 'execute') then
      raise exception 'KLUY-MIGRATION-0179: the fleet service cannot reach %', v_fn;
    end if;
  end loop;
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kitluy_devices'
      and c.relname in ('hub_replacement_operations', 'hub_replacement_events')
      and not (c.relrowsecurity and c.relforcerowsecurity)) then
    raise exception 'KLUY-MIGRATION-0179: a replacement table is missing ENABLE+FORCE RLS';
  end if;
  raise notice 'KLUY-MIGRATION-0179: governed Hub replacement authority installed (four-eyes, idempotent, dual-active refused at cutover, history never rewritten)';
end
$guard$;

do $hand_back$
begin
  execute format('revoke kitluy_fleet_governor from %I', current_user);
end
$hand_back$;
