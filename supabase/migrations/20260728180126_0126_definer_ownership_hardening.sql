-- kitluy:group:0126
-- Migration group 0126: definer_ownership_hardening (WS-11-T003 Step 4).
--
-- Closes a finding raised by the owner's governor-containment condition and
-- caught by assertion section 32b.
--
-- `attempt_activate_device_v1` is SECURITY DEFINER and was owned by `postgres`.
-- In this stack `postgres` is NOT a superuser — it is a LOGIN-CAPABLE role with
-- BYPASSRLS. A definer function owned by something that can authenticate runs
-- with the privileges of an account an attacker could target directly, which is
-- a materially weaker boundary than the one that was reviewed.
--
-- The fix is a dedicated NOLOGIN owner. Deliberately NOT reusing
-- `kitluy_credential_issuer`: that role governs credential issuance, and
-- folding activation into it would give one identity both powers for no reason
-- other than convenience.
--
-- Additive. Groups 0120-0125 are not edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).

begin;

do $create_role$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_activation_governor') then
    create role kitluy_activation_governor nologin;
  end if;
end
$create_role$;

do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

-- CREATE as well as USAGE: `alter function ... owner to` requires the new owner
-- to hold CREATE on the containing schema.
grant usage, create on schema kitluy_devices to kitluy_activation_governor;

-- The definer body calls the raising activation form, which is revoked from
-- PUBLIC and service_role. Its new owner needs that EXECUTE explicitly.
grant execute on function kitluy_devices.activate_device_v1(uuid, text, text)
  to kitluy_activation_governor;
grant execute on function
  kitluy_devices.record_activation_refusal_v1(uuid, text, text, text, text)
  to kitluy_activation_governor;
grant execute on function kitluy_devices.record_lifecycle_event(
  uuid, kitluy_devices.device_lifecycle_state, kitluy_devices.device_lifecycle_state,
  text, text, jsonb) to kitluy_activation_governor;

-- The definer writes through the device and incident tables on the refusal
-- path, so the owner needs those grants too.
grant select, insert, update on
  kitluy_devices.devices,
  kitluy_devices.device_lifecycle_events,
  kitluy_devices.device_trust_incidents,
  kitluy_devices.device_assignments,
  kitluy_devices.device_terminal_assignments,
  kitluy_devices.device_assignment_projections,
  kitluy_devices.device_certificates
  to kitluy_activation_governor;

-- activate_device_v1 calls a dozen SECURITY INVOKER helpers, all of which run
-- as the definer owner. Granting only the entry point left the body failing
-- with `permission denied for function ...`, which surfaced as a generic
-- ACTIVATION_FAILED and MASKED the real PKI refusal — a worse outcome than
-- the original problem, since the operator would have been told the wrong
-- thing. Grant across the schema.
do $governor_execute$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'kitluy_devices'
  loop
    execute format('grant execute on function %s to kitluy_activation_governor', r.sig);
  end loop;
end
$governor_execute$;

-- RLS ENABLE+FORCE means a grant alone is not enough: without a policy the
-- new definer owner sees ZERO rows and reports every device as missing.
-- Named policies rather than BYPASSRLS on the role — the whole point of a
-- NOLOGIN governor is that it is constrained, and BYPASSRLS would undo that.
-- READ access across the schema. The activation checks consult the PKI
-- configuration, trusted-time state, profiles and enrollments; granting only
-- the tables it WRITES left it reporting `permission denied for table
-- pki_trust_configuration` as a generic ACTIVATION_FAILED, masking the real
-- BLK-005 refusal. Reads are broad; WRITES stay on the explicit list above.
do $governor_read$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kitluy_devices' and c.relkind = 'r'
      -- Skip tables this role does not own. Group 0125 handed the
      -- credential-table ownership to kitluy_credential_issuer and took the
      -- membership back, so a blanket loop would fail on them — and the
      -- activation path has no business reading credential rows anyway.
      and pg_get_userbyid(c.relowner) = current_user
  loop
    execute format('grant select on kitluy_devices.%I to kitluy_activation_governor', r.relname);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'kitluy_devices' and tablename = r.relname
        and policyname = r.relname || '_activation_read')
    then
      execute format(
        'create policy %I on kitluy_devices.%I for select to kitluy_activation_governor using (true)',
        r.relname || '_activation_read', r.relname);
    end if;
  end loop;
end
$governor_read$;

do $activation_policies$
declare
  r text;
begin
  foreach r in array array[
    'devices', 'device_lifecycle_events', 'device_trust_incidents',
    'device_assignments', 'device_terminal_assignments',
    'device_assignment_projections', 'device_certificates']
  loop
    execute format(
      'create policy %I on kitluy_devices.%I for all to kitluy_activation_governor using (true) with check (true)',
      r || '_activation_governor', r);
  end loop;
end
$activation_policies$;

alter function kitluy_devices.attempt_activate_device_v1(uuid, text, text)
  owner to kitluy_activation_governor;

comment on function kitluy_devices.attempt_activate_device_v1(uuid, text, text) is
  'The only activation path reachable by an application role (KLRISK-DEVICE-001). SECURITY DEFINER with a pinned search_path, owned by the NOLOGIN kitluy_activation_governor — group 0126 moved it off `postgres`, which is login-capable with BYPASSRLS in this stack and therefore a weaker definer context than the review assumed. Records the refusal or the activation, commits it with the caller''s transaction, and returns a typed outcome.';

-- Hand the membership back. Same reasoning as group 0125: a login-capable role
-- that stays a member can SET ROLE into the governor, and NOLOGIN does nothing
-- about that.
do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

commit;
