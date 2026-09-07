-- kitluy:migration:0200
--
-- A STALE FLOOR IS NOT AN ATTACK, AND MUST STOP BEING TREATED AS ONE
-- =============================================================================
-- Authority: owner decision 2026-08-24 (Store Hub boot/networking/provisioning
-- clarification §3 and the Defect B decision); KLD-2026-07-28-002 §12 (the
-- trusted-time model this REFINES and does not replace); group 0123 (the model),
-- group 0198 (the R-1 repaired composition bridge).
--
-- WHY THIS IS ADDITIVE RATHER THAN AN EDIT
-- ----------------------------------------
-- Group 0123 has been applied to the hosted development project. It is history
-- and is not rewritten. Group 0198 had NOT been applied anywhere shared (the
-- hosted ledger stands at 0197), so its R-1 repair was made in place; this group
-- carries only what 0123 owns, plus the final shape of the 0198 bridge so a
-- database that already recorded 0198 still converges.
--
-- THE DEFECT
-- ----------
-- `trusted_time_max_forward_jump_seconds` is 3600 in development, and the
-- trusted floor advances ONLY on a `trusted` evaluation. Those two rules
-- together make a floor that is more than an hour old permanently
-- unrecoverable: every later observation is classified
-- `restricted_forward_jump`, which refuses to advance the floor, which
-- guarantees the next observation is further ahead still.
--
-- Reproduced on the development fixture: a floor of 2026-08-10T07:08:05Z,
-- 13.9 days old, answering `restricted_forward_jump` to the real current time.
--
-- A Store Hub that closed overnight, sat in a box for a week, or lost power for
-- an afternoon is not a compromised device. Under the shipped rule it became one
-- permanently, and the shop could not open.
--
-- WHAT THE RULE WAS ACTUALLY FOR
-- ------------------------------
-- §12.4: "an RTC materially ahead requires investigation and must not blindly
-- advance the floor." That is a statement about a LOW-ASSURANCE source. A
-- hardware clock jumping forward is evidence of tampering or a dead battery,
-- because a device's own clock is exactly what an attacker controls.
--
-- It is not a statement about elapsed wall time. When the authority reads its
-- OWN clock, a large forward difference from a stale floor is not an anomaly —
-- it is Tuesday.
--
-- THE CORRECTION, AND ITS EXACT LIMIT
-- -----------------------------------
-- One new source class, `cloud_authoritative`, whose defining property is that
-- NO caller can supply its value: it is `now()`, evaluated inside this function,
-- inside the database. A caller asks for it with a boolean; it cannot say what
-- it is. That is the same invariant R-1 established for the 0198 bridge, held
-- one layer deeper so it cannot be lost by a future caller.
--
-- The forward-jump restriction is lifted for that source ALONE. Everything else
-- is untouched:
--
--   rtc                   strict forward-jump, exactly as before
--   authenticated_network strict forward-jump, exactly as before
--   signed_cloud_token    strict forward-jump, exactly as before
--   ROLLBACK detection    unchanged for every source, cloud_authoritative included
--   monotonic floor       unchanged; nothing here moves a floor backwards
--
-- `signed_cloud_token` is deliberately NOT exempted. Its assurance rests on a
-- signature that this database does not verify — the caller asserts it — so
-- exempting it would re-open R-1 through a different parameter.
--
-- WHAT THIS GROUP DOES NOT ADD
-- ----------------------------
-- No reset function, no floor-clearing door, no operator override, no second
-- trusted-time subsystem. A device whose floor was pushed into the FUTURE (the
-- R-1 damage) is still stuck, and stays stuck: `now()` is behind such a floor,
-- so it is discarded as rollback and the device stays restricted. That is the
-- monotonic floor working. Recovering those devices is a separate governed
-- decision and is not smuggled in here.

-- -----------------------------------------------------------------------------
-- 1. The new source class.
-- -----------------------------------------------------------------------------
-- Its own transaction: PostgreSQL forbids USING an enum value in the same
-- transaction that added it, and the function below names it.
begin;
alter type kitluy_devices.trusted_time_source add value if not exists 'cloud_authoritative';
commit;

begin;

do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

-- -----------------------------------------------------------------------------
-- 2. The refined evaluation, as a core plus the unchanged public signature.
-- -----------------------------------------------------------------------------
-- WHY NOT JUST ADD A PARAMETER TO `evaluate_trusted_time_v1`
-- ----------------------------------------------------------
-- Because a defaulted seventh parameter creates a second overload, and every
-- existing six-argument call then resolves to "function is not unique" — which
-- breaks the device-side gateway that calls it positionally. The way out of that
-- is DROP and recreate, and the first draft of this group did exactly that.
--
-- Dropping a function that application code calls is worth avoiding on its own
-- terms: any backend holding a cached plan for the old OID fails until it
-- replans, and this group will eventually run against the hosted development
-- project while services are connected to it. A `create or replace` has no such
-- window.
--
-- So nothing that application code calls is dropped. The logic moves into a core
-- function, and `evaluate_trusted_time_v1` keeps its EXACT six-argument
-- signature and becomes a one-line delegate — no drop, no ambiguity, no cached
-- plan pointing at a vanished OID.
--
-- (An earlier revision of this comment blamed a PostgreSQL SIGSEGV on that drop.
-- That was wrong and is corrected here: the local PG17 development container
-- segfaults on a class of permission-denied paths, it does so for functions this
-- group never touches — `assert_device_not_contained_v1` and
-- `assert_support_session_active_v1` both reproduce it — and its FIRST such crash
-- is dated 2026-08-07, seventeen days before this group was written. It is an
-- instance-level fault recorded in the handoff, not a property of this SQL.)
--
-- This is NOT a second trusted-time subsystem. It is the opposite: one
-- implementation, reached two ways. The body below is group 0123's, with the
-- source-aware anomaly classification and the in-boundary clock as the only
-- changes; everything else is character-identical on purpose.
create or replace function kitluy_devices.evaluate_trusted_time_core_v1(
  p_device_id uuid,
  p_environment text,
  p_valid_rtc_time timestamptz,
  p_authenticated_network_time timestamptz,
  p_valid_signed_token_time timestamptz,
  p_correlation_id uuid default null,
  -- A REQUEST, NOT A VALUE. The caller asks the authority to read its own clock.
  -- There is deliberately no timestamptz parameter that carries this source, so
  -- no caller — however privileged, however buggy — can choose what "now" means.
  p_use_server_authoritative_time boolean default false
) returns kitluy_devices.trusted_time_outcome
language plpgsql
-- SEARCH PATH IS PINNED, AND `now()` IS SCHEMA-QUALIFIED. BOTH ARE R-1.
--
-- Found by independent review, not by the author. `evaluate_trusted_time_v1`
-- (0123) had no `SET search_path` and this function inherited that. It did not
-- matter while every source was a parameter — but the moment the function reads
-- a clock ITSELF, an unqualified `now()` is resolved through the CALLER's
-- search_path, and a caller that puts a schema containing its own `now()` ahead
-- of `pg_catalog` chooses the value of the exempt source.
--
-- Demonstrated by the reviewer against this database: with a shadowing
-- `evil.now()` first on the path, the core returned
-- `status=trusted, source=cloud_authoritative, trusted_time=2036-01-01` — the
-- caller naming authoritative time, which is precisely what R-1 forbids.
--
-- Only `postgres` and `kitluy_activation_governor` can execute this today, so it
-- was not reachable by an application role, and the bridge was already safe
-- because it pins its own path. Neither is a reason to leave a forgeable clock:
-- "unreachable today" is a property of the grant table, not of this function.
--
-- Both belts are worn. `set search_path` fixes resolution for everything in the
-- body; `pg_catalog.now()` makes the one call that matters independent of it.
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $$
declare
  v_policy kitluy_devices.trust_policy;
  v_state kitluy_devices.device_trusted_time;
  v_floor timestamptz;
  v_best timestamptz;
  v_source kitluy_devices.trusted_time_source := 'none';
  v_status kitluy_devices.trusted_time_status;
  v_anomaly text;
  v_advanced boolean := false;
  v_lag interval;
  v_jump interval;
  v_server_time timestamptz;
  v_result kitluy_devices.trusted_time_outcome;
begin
  -- Policy first. An absent forward-jump threshold fails closed here.
  v_policy := kitluy_devices.resolve_trust_policy_v1(p_environment);

  -- MIXING IS REFUSED, NOT DOCUMENTED.
  --
  -- Also from independent review. Selection is max-wins and the forward-jump
  -- exemption keys off the WINNING source, so a caller that asked for server
  -- time AND offered a device reading one second ahead of it would see the
  -- device source win, take the strict rule, and lose the recovery entirely —
  -- a fast RTC silently denying a Hub its way back. An exact tie resolves to
  -- `rtc` too, because the server branch requires strictly greater.
  --
  -- The bridge always passes nulls, so this is unreachable today. But a
  -- seven-argument function that accepts both is an invitation, and the failure
  -- is quiet. Refused structurally instead: asking the authority for the time
  -- and offering it a time are different requests, and this door takes one.
  if p_use_server_authoritative_time
     and (p_valid_rtc_time is not null
       or p_authenticated_network_time is not null
       or p_valid_signed_token_time is not null) then
    raise exception 'KLUY-DEVICE-TIME-SOURCE-CONFLICT: server-authoritative time was requested together with a caller-supplied source; ask for one or the other'
      using errcode = 'P0001';
  end if;

  -- THE AUTHORITATIVE READING, GENERATED HERE. Not a parameter, by design.
  -- `pg_catalog.now()` explicitly: see the search_path note on the signature.
  if p_use_server_authoritative_time then
    v_server_time := pg_catalog.now();
  end if;

  insert into kitluy_devices.device_trusted_time (device_id)
  values (p_device_id)
  on conflict (device_id) do nothing;

  select * into v_state from kitluy_devices.device_trusted_time
  where device_id = p_device_id for update;

  v_floor := v_state.trusted_time_floor;
  v_lag := make_interval(secs => v_policy.max_clock_lag_seconds);
  v_jump := make_interval(secs => v_policy.trusted_time_max_forward_jump_seconds);

  -- §12: trusted time is the MAXIMUM of the VALID sources. A source more than
  -- max_clock_lag behind the floor is rollback and is discarded, not averaged.
  -- The authoritative reading is held to the SAME rollback rule as everything
  -- else — a floor ahead of the authority's own clock still refuses to move back.
  if p_valid_rtc_time is not null and (v_floor is null or p_valid_rtc_time >= v_floor - v_lag) then
    if v_best is null or p_valid_rtc_time > v_best then
      v_best := p_valid_rtc_time; v_source := 'rtc';
    end if;
  end if;
  if p_authenticated_network_time is not null
     and (v_floor is null or p_authenticated_network_time >= v_floor - v_lag) then
    if v_best is null or p_authenticated_network_time > v_best then
      v_best := p_authenticated_network_time; v_source := 'authenticated_network';
    end if;
  end if;
  if p_valid_signed_token_time is not null
     and (v_floor is null or p_valid_signed_token_time >= v_floor - v_lag) then
    if v_best is null or p_valid_signed_token_time > v_best then
      v_best := p_valid_signed_token_time; v_source := 'signed_cloud_token';
    end if;
  end if;
  if v_server_time is not null and (v_floor is null or v_server_time >= v_floor - v_lag) then
    if v_best is null or v_server_time > v_best then
      v_best := v_server_time; v_source := 'cloud_authoritative';
    end if;
  end if;

  -- ROLLBACK: a source was offered but every one of them is too far behind.
  if v_best is null
     and (p_valid_rtc_time is not null
       or p_authenticated_network_time is not null
       or p_valid_signed_token_time is not null
       or v_server_time is not null) then
    v_status := 'restricted_clock_rollback';
    v_anomaly := format('every offered source is more than %s seconds behind the trusted floor',
                        v_policy.max_clock_lag_seconds);

  -- NO SOURCE AT ALL. The floor alone is not a source (§12 first-boot rule).
  elsif v_best is null then
    v_status := 'restricted_no_trusted_source';
    v_anomaly := 'no trustworthy time source was available';

  -- NO FLOOR YET: ONLY THE AUTHORITY MAY SET THE FIRST ONE (owner Decision 2).
  --
  -- The forward-jump test below reads `v_floor is not null`, so before this
  -- branch existed a device with NO floor accepted ANY offered timestamp as its
  -- permanent monotonic floor. Found by independent review, and it is R-1's exact
  -- outcome on the path the device-side gateway is written to call:
  --
  --     NULL floor + rtc = now() + 3650 days  ->  trusted, floor := 2036
  --     then any real observation             ->  restricted_clock_rollback
  --
  -- with no recovery, because a monotonic floor is what forbids one. Seventeen
  -- development devices were already in that state.
  --
  -- The first floor is permanent in a way no later one is: every subsequent
  -- comparison is made against it. So it may come only from `cloud_authoritative`
  -- — `pg_catalog.now()` read inside this function, which no caller can choose.
  --
  -- `signed_cloud_token` is NOT admitted either, and that is deliberate: this
  -- database does not verify its signature (the caller asserts it), so it is not
  -- authoritative enough to fix a device's clock permanently. When the boundary
  -- can verify it, that is a governed change to this branch and nowhere else.
  elsif v_floor is null and v_source <> 'cloud_authoritative' then
    v_status := 'restricted_no_trusted_source';
    v_anomaly := format(
      'no trusted-time floor exists and %s may not establish one; only cloud_authoritative may initialize the floor',
      v_source);

  -- FORWARD JUMP beyond the SIGNED policy threshold. §12.4: an RTC materially
  -- ahead requires investigation and must not blindly advance the floor.
  --
  -- EXEMPT: `cloud_authoritative`. That reading was produced by this function
  -- inside the database; no caller chose it, so a large gap measures how long
  -- the device was away, not how far something moved its clock. Applying the
  -- rule to it made a floor older than one hour permanently unrecoverable, which
  -- closed shops rather than protecting them.
  elsif v_floor is not null
        and v_best > v_floor + v_jump
        and v_source <> 'cloud_authoritative' then
    v_status := 'restricted_forward_jump';
    v_anomaly := format('selected time is more than %s seconds ahead of the trusted floor',
                        v_policy.trusted_time_max_forward_jump_seconds);
  else
    v_status := 'trusted';
    v_anomaly := null;
  end if;

  -- The floor advances ONLY on a trusted evaluation, and only forwards.
  if v_status = 'trusted' and (v_floor is null or v_best > v_floor) then
    v_advanced := true;
  end if;

  -- Floor advancement and its audit record commit together (§12.2). Both are
  -- statements in this one function call, inside the caller's transaction.
  update kitluy_devices.device_trusted_time
  set trusted_time_floor = case when v_advanced then v_best else trusted_time_floor end,
      last_validated_rtc_time = coalesce(p_valid_rtc_time, last_validated_rtc_time),
      last_authenticated_network_time = coalesce(p_authenticated_network_time, last_authenticated_network_time),
      last_signed_cloud_token_time = coalesce(p_valid_signed_token_time, last_signed_cloud_token_time),
      -- "SELECTED" MEANS ACCEPTED, NOT MERELY OFFERED.
      --
      -- Found by the re-review. A refused evaluation used to write the refused
      -- candidate into `last_selected_trusted_time` and `last_source`, so a
      -- device whose NULL-floor initialization had just been rejected carried
      -- `last_selected_trusted_time = 2036-…` and `last_source = rtc`. It is
      -- inert — only `trusted_time_floor` feeds any security comparison, and the
      -- reviewer confirmed a later legitimate call is unaffected — but it is a
      -- record of a selection that never happened, sitting in the columns an
      -- operator would read first during an incident.
      --
      -- The three `last_*_time` columns above are deliberately still written on a
      -- refusal: they record what was OFFERED, which is exactly the forensic
      -- trail worth having. This pair records what was CHOSEN, so it moves only
      -- when something was.
      last_selected_trusted_time =
        case when v_status = 'trusted' then v_best else last_selected_trusted_time end,
      last_source =
        case when v_status = 'trusted' then v_source else last_source end,
      status = v_status,
      anomaly_type = v_anomaly,
      policy_version = v_policy.policy_version,
      audit_correlation_id = p_correlation_id,
      updated_at = now()
  where device_id = p_device_id;

  insert into kitluy_devices.device_trusted_time_events
    (device_id, event_type, from_floor, to_floor, selected_time, source, status,
     anomaly_type, policy_version, correlation_id, detail)
  values
    (p_device_id,
     case when v_advanced then 'FLOOR_ADVANCED'
          when v_status <> 'trusted' then 'RESTRICTED_ENTERED'
          else 'FLOOR_HELD' end,
     v_floor,
     case when v_advanced then v_best else v_floor end,
     v_best, case when v_best is null then 'none' else v_source end, v_status,
     v_anomaly, v_policy.policy_version, p_correlation_id,
     jsonb_build_object('environment', p_environment,
                        'rtc_offered', p_valid_rtc_time is not null,
                        'network_offered', p_authenticated_network_time is not null,
                        'token_offered', p_valid_signed_token_time is not null,
                        'server_authoritative_requested', p_use_server_authoritative_time));

  v_result := row(
    v_status,
    -- The reported trusted time is the greatest of the selection and the floor.
    greatest(coalesce(v_best, v_floor), coalesce(v_floor, v_best)),
    case when v_best is null then 'persisted_floor' else v_source end,
    v_advanced,
    v_anomaly,
    v_status <> 'trusted',
    case v_status
      when 'trusted' then 'trusted time established'
      else coalesce(v_anomaly, 'restricted') end
  )::kitluy_devices.trusted_time_outcome;

  return v_result;
end;
$$;

comment on function kitluy_devices.evaluate_trusted_time_core_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid, boolean) is
  'Group 0123 §12, refined by group 0200. The single implementation; evaluate_trusted_time_v1 delegates to it. Unchanged except for one rule: a forward jump beyond trusted_time_max_forward_jump_seconds is an anomaly for rtc, authenticated_network and signed_cloud_token, and is NOT an anomaly for cloud_authoritative. cloud_authoritative is now() read inside this function — the caller requests it with a boolean and can never supply its value — so a large gap measures elapsed absence, not clock tampering. Applying the rule to it made any floor older than one hour permanently unrecoverable. Rollback detection, the monotonic floor and every other source class are untouched, and no reset path is added.';

-- A NEW function's EXECUTE default is PUBLIC. Revoking it is not optional:
-- group 0198 §3a exists because exactly this default was left behind once
-- already, and it left `anon` holding a definer.
revoke all on function kitluy_devices.evaluate_trusted_time_core_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid, boolean) from public;
revoke all on function kitluy_devices.evaluate_trusted_time_core_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid, boolean) from anon;
revoke all on function kitluy_devices.evaluate_trusted_time_core_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid, boolean) from authenticated;
revoke all on function kitluy_devices.evaluate_trusted_time_core_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid, boolean) from service_role;
alter function kitluy_devices.evaluate_trusted_time_core_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid, boolean)
  owner to postgres;
-- -----------------------------------------------------------------------------
-- 2b. The public signature, unchanged, now a delegate.
-- -----------------------------------------------------------------------------
-- EXACTLY the six arguments group 0123 published, so every existing positional
-- caller keeps working and nothing is dropped. It requests `false`: a caller
-- arriving through this door offers device-side sources and gets the strict
-- forward-jump rule, which is the whole point of the split.
create or replace function kitluy_devices.evaluate_trusted_time_v1(
  p_device_id uuid,
  p_environment text,
  p_valid_rtc_time timestamptz,
  p_authenticated_network_time timestamptz,
  p_valid_signed_token_time timestamptz,
  p_correlation_id uuid default null
) returns kitluy_devices.trusted_time_outcome
language sql
-- Pinned for the same reason as the core: a delegate whose own resolution can
-- be steered is a delegate that can be pointed somewhere else.
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $$
  select kitluy_devices.evaluate_trusted_time_core_v1(
           p_device_id, p_environment, p_valid_rtc_time,
           p_authenticated_network_time, p_valid_signed_token_time,
           p_correlation_id, false)
$$;

comment on function kitluy_devices.evaluate_trusted_time_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid) is
  'Group 0123 §12, delegating to evaluate_trusted_time_core_v1 since group 0200. Signature and behaviour for device-offered sources are unchanged: rtc, authenticated_network and signed_cloud_token all keep the strict forward-jump rule. Server-authoritative time is NOT reachable through this door — it is requested by establish_device_trusted_time_v1, which is a SECURITY DEFINER and takes no timestamp.';

-- `service_role` LOSES THIS, AND THAT IS THE REST OF R-1.
--
-- Removing the timestamps from the bridge closed the composition boundary. It
-- did NOT close the door underneath: `service_role` held a direct EXECUTE grant
-- here, and `service_role` is the role the device-registry service actually
-- connects as before it assumes a composition identity. Demonstrated against the
-- local PG17 database while writing this group:
--
--   as kitluy_activation_service, through the bridge   -> does not exist
--   as kitluy_activation_service, direct               -> permission denied
--   as service_role, direct                            -> SUCCEEDED, floor 2036
--   as anon                                            -> permission denied
--
-- So the exact R-1 exploit survived one function deeper, reachable by the exact
-- caller class R-1 is about. `service_role` is not a member of
-- kitluy_activation_governor (checked), so this revoke removes the reach rather
-- than shadowing it behind an inherited grant.
--
-- Nothing legitimate loses anything: `establish_device_trusted_time_v1` is the
-- only database object whose body reaches the evaluation, it is a definer owned
-- by `postgres`, and the composition reaches it as kitluy_activation_service. A
-- caller that wants trusted time asks the bridge.
revoke all on function kitluy_devices.evaluate_trusted_time_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid) from public;
revoke all on function kitluy_devices.evaluate_trusted_time_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid) from anon;
revoke all on function kitluy_devices.evaluate_trusted_time_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid) from authenticated;
revoke all on function kitluy_devices.evaluate_trusted_time_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid) from service_role;
alter function kitluy_devices.evaluate_trusted_time_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid) owner to postgres;

-- The owning governor keeps both: a DBA identity, never an application
-- connection, and the grant this migration borrows to do its own work.
grant execute on function kitluy_devices.evaluate_trusted_time_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid)
  to kitluy_activation_governor;
grant execute on function kitluy_devices.evaluate_trusted_time_core_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid, boolean)
  to kitluy_activation_governor;

-- -----------------------------------------------------------------------------
-- 3. The bridge, in its final shape.
-- -----------------------------------------------------------------------------
-- Group 0198 carries the R-1 repair. Repeated here so a database that already
-- recorded 0198 in its ledger — every local development database does — still
-- converges on the repaired signature, and so the six-timestamp form is gone
-- wherever it exists.
drop function if exists kitluy_devices.establish_device_trusted_time_v1(
  uuid, text, timestamptz, timestamptz, timestamptz, uuid);

create or replace function kitluy_devices.establish_device_trusted_time_v1(
  p_device_id uuid,
  p_environment text,
  p_correlation_id uuid default null
) returns kitluy_devices.trusted_time_outcome
language sql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $$
  select kitluy_devices.evaluate_trusted_time_core_v1(
           p_device_id,
           p_environment,
           null,   -- RTC: not the control plane's to claim
           null,   -- authenticated network: not this path's to assert
           null,   -- signed token: nothing here can verify one
           coalesce(p_correlation_id, gen_random_uuid()),
           true)   -- READ YOUR OWN CLOCK. The caller cannot say what it reads.
$$;

comment on function kitluy_devices.establish_device_trusted_time_v1(uuid, text, uuid) is
  'Groups 0198 (R-1) and 0200. The SECURITY DEFINER privilege bridge the activation composition uses to establish a device''s trusted time while holding no table access of its own. It takes NO timestamp: it asks evaluate_trusted_time_core_v1 to read the database clock. The shipped version accepted three caller-supplied timestamps and an external review advanced a device floor ten years into the future through them, which a monotonic floor makes permanent. A caller may REQUEST establishment; it may never PROVIDE the value. Granted to kitluy_activation_service ONLY.';

alter function kitluy_devices.establish_device_trusted_time_v1(uuid, text, uuid) owner to postgres;
revoke all on function kitluy_devices.establish_device_trusted_time_v1(uuid, text, uuid) from public;
revoke all on function kitluy_devices.establish_device_trusted_time_v1(uuid, text, uuid) from anon;
revoke all on function kitluy_devices.establish_device_trusted_time_v1(uuid, text, uuid) from authenticated;
grant execute on function kitluy_devices.establish_device_trusted_time_v1(uuid, text, uuid)
  to kitluy_activation_service;

-- -----------------------------------------------------------------------------
-- 3b. THE TABLE LAYER, WHICH THE FUNCTION LAYER DID NOT CLOSE.
-- -----------------------------------------------------------------------------
-- Owner Decision 1 and 1A. Independent review demonstrated that everything above
-- proved a NARROWER property than it claimed: revoking EXECUTE closed the
-- governed doors and left the tables underneath wide open.
--
--   set local role service_role;
--   update kitluy_devices.device_trusted_time
--      set trusted_time_floor = now() + interval '3650 days', status = 'trusted';
--   -- SUCCEEDED
--
-- No function call, no bridge, no boolean. `0123:922-925` granted `service_role`
-- insert/update on the table and `service_role` carries `rolbypassrls`, so RLS is
-- not in the path either. The monotonic trigger is `before delete or update` and
-- rejects only BACKWARDS movement, so it waves a decade forward through.
--
-- Two further routes reached the same outcome: rewriting `trust_policy`
-- (`trusted_time_max_forward_jump_seconds = 315360000`, or `is_active = false` as
-- a fleet-wide fail-closed denial), and manufacturing the four-eyes evidence
-- `emergency_time_correction_v1` consults, because the same role could write
-- `kitluy_auth.approval_*` as well.
--
-- WHY THIS IS SAFE TO REVOKE NOW
-- ------------------------------
-- Inventoried before touching anything: there is NO non-test application writer
-- of any relation below, and no application caller of the emergency correction
-- door. The approval-writing test fixtures assume `kitluy_credential_issuer`, not
-- `service_role`. So no legitimate path is being removed, and nothing needed to
-- be replaced by a governed door first.
--
-- The whole-table-clearing privilege is not named in the revokes below:
-- `service_role` does not hold it (inventoried), and `migrations:validate`
-- refuses that keyword anywhere in a migration without a destructive-approved
-- marker — which a REVOKE has no business claiming. The guard block asserts the
-- EXACT privilege set instead, which covers that verb and every other, and also
-- catches a future blanket grant loop re-adding one.
--
-- SELECT IS KEPT THROUGHOUT. `service_role` still reads what it needs; only the
-- authority to MUTATE trust is withdrawn. The governed path is unaffected:
-- `establish_device_trusted_time_v1` is a SECURITY DEFINER owned by `postgres`,
-- which owns these tables, so it writes as the owner and never as its caller.
revoke insert, update, delete on kitluy_devices.device_trusted_time from service_role;
-- The append-only audit trail. UPDATE here would let the record of a trust
-- decision be rewritten after the fact, which is worse than the decision itself.
revoke insert, update, delete on kitluy_devices.device_trusted_time_events from service_role;
-- 0123 calls these values "SIGNED POLICY, not a code constant". They were
-- writable by the application connection role.
revoke insert, update, delete on kitluy_devices.trust_policy from service_role;
revoke insert, update, delete on kitluy_devices.pki_trust_configuration from service_role;
-- Decision 1A: the actor requesting a correction must not be able to create the
-- approval evidence the correction door consults.
revoke insert, update, delete on kitluy_devices.time_correction_approvals from service_role;
revoke insert, update, delete on kitluy_auth.approval_policies from service_role;
revoke insert, update, delete on kitluy_auth.approval_requests from service_role;
revoke insert, update, delete on kitluy_auth.approval_decisions from service_role;
revoke insert, update, delete on kitluy_audit.sensitive_action_approvals from service_role;

-- `emergency_time_correction_v1` and its evaluator are NOT security definers
-- (`prosecdef=false`, owner `postgres`), so they run as their caller and need the
-- table access just revoked. Leaving EXECUTE would offer `service_role` a door
-- that can now only fail with an opaque permission error halfway through.
--
-- Emergency time correction is therefore a GOVERNOR-ONLY operation until a
-- proper composition door exists for it — an operator acting deliberately, which
-- is what a four-eyes emergency path should require. This removes no application
-- capability: the door has no non-test caller anywhere in the repository.
revoke execute on function kitluy_devices.emergency_time_correction_v1(uuid, timestamptz, text, text, uuid, text, uuid, uuid, text) from service_role;
revoke execute on function kitluy_devices.evaluate_time_correction_approval_v1(uuid, uuid, text, uuid) from service_role;

-- -----------------------------------------------------------------------------
-- 3c. THE REST OF THE CHAIN WEARS THE SAME BELT.
-- -----------------------------------------------------------------------------
-- The re-review noted that `resolve_trust_policy_v1`,
-- `emergency_time_correction_v1` and `evaluate_time_correction_approval_v1` do
-- not pin `search_path`, unlike everything else in this chain. None is currently
-- exploitable — their bodies make no unqualified security-relevant call — but
-- "not currently exploitable" is a property of today's bodies, and the whole
-- reason the core needed pinning was that a later edit gave it a clock to read.
--
-- Pinned with `alter function` rather than by rewriting them: these are released
-- objects (0123/0124) and their logic is not this group's business. Changing
-- only the resolution environment is the smallest correction that removes the
-- inconsistency.
alter function kitluy_devices.resolve_trust_policy_v1(text)
  set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions;
alter function kitluy_devices.emergency_time_correction_v1(uuid, timestamptz, text, text, uuid, text, uuid, uuid, text)
  set search_path = pg_catalog, kitluy_devices, kitluy_auth, kitluy_ops, extensions;
alter function kitluy_devices.evaluate_time_correction_approval_v1(uuid, uuid, text, uuid)
  set search_path = pg_catalog, kitluy_devices, kitluy_auth, kitluy_ops, extensions;

do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

-- -----------------------------------------------------------------------------
-- 4. Prove the boundary on apply.
-- -----------------------------------------------------------------------------
do $guard$
declare
  v_extra integer;
  v_rel text;
  v_privs text;
begin
  -- R-1. No overload of the bridge may take a timestamp, in any position.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname = 'establish_device_trusted_time_v1'
       and 'pg_catalog.timestamptz'::regtype = any (p.proargtypes::oid[])) then
    raise exception 'KLUY-MIGRATION-0200: R-1 — the trusted-time bridge accepts a caller-supplied timestamp'
      using errcode = 'P0001';
  end if;

  -- Exactly one bridge. Two would mean the old one survived under an overload.
  select count(*) into v_extra
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices' and p.proname = 'establish_device_trusted_time_v1';
  if v_extra <> 1 then
    raise exception 'KLUY-MIGRATION-0200: expected exactly one trusted-time bridge, found %', v_extra
      using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', 'kitluy_devices.establish_device_trusted_time_v1(uuid, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.establish_device_trusted_time_v1(uuid, text, uuid)', 'execute') then
    raise exception 'KLUY-MIGRATION-0200: a browser-reachable role can establish trusted time'
      using errcode = 'P0001';
  end if;

  -- The evaluation must not have come back PUBLIC-executable after the drop.
  if has_function_privilege('anon', 'kitluy_devices.evaluate_trusted_time_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.evaluate_trusted_time_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid)', 'execute')
     or has_function_privilege('anon', 'kitluy_devices.evaluate_trusted_time_core_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid, boolean)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.evaluate_trusted_time_core_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid, boolean)', 'execute') then
    raise exception 'KLUY-MIGRATION-0200: a browser-reachable role can evaluate trusted time'
      using errcode = 'P0001';
  end if;

  -- The activation composition still holds EXACTLY its two capabilities. The
  -- drop/recreate above is the classic way to hand a role something extra.
  select count(*) into v_extra
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices'
     and has_function_privilege('kitluy_activation_service', p.oid, 'execute')
     and p.prorettype <> 'pg_catalog.trigger'::regtype
     and p.proname not in ('establish_device_trusted_time_v1', 'attempt_activate_device_v1');
  if v_extra > 0 then
    raise exception 'KLUY-MIGRATION-0200: the activation role can execute % function(s) beyond its two capabilities', v_extra
      using errcode = 'P0001';
  end if;

  -- It must still be unable to reach the evaluation directly, which would let it
  -- offer sources the bridge refuses to carry.
  if has_function_privilege('kitluy_activation_service', 'kitluy_devices.evaluate_trusted_time_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid)', 'execute')
     or has_function_privilege('kitluy_activation_service', 'kitluy_devices.evaluate_trusted_time_core_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid, boolean)', 'execute') then
    raise exception 'KLUY-MIGRATION-0200: the activation role can call the evaluation directly'
      using errcode = 'P0001';
  end if;

  -- R-1, ONE FUNCTION DEEPER. The application connection role must not be able
  -- to bypass the bridge and hand the evaluation a timestamp of its choosing.
  -- This is the hole the boundary repair alone left open.
  if has_function_privilege('service_role', 'kitluy_devices.evaluate_trusted_time_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.evaluate_trusted_time_core_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid, boolean)', 'execute') then
    raise exception 'KLUY-MIGRATION-0200: R-1 — service_role can supply trusted time directly'
      using errcode = 'P0001';
  end if;

  -- R-1, THIRD FORM: a function that reads a clock must not resolve it through
  -- the caller's search_path.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname in ('evaluate_trusted_time_core_v1', 'evaluate_trusted_time_v1',
                         'establish_device_trusted_time_v1', 'resolve_trust_policy_v1',
                         'emergency_time_correction_v1', 'evaluate_time_correction_approval_v1')
       and (p.proconfig is null
            or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))) then
    raise exception 'KLUY-MIGRATION-0200: a trusted-time function does not pin its search_path'
      using errcode = 'P0001';
  end if;

  -- OWNER DECISION 1: the application connection role must hold NO mutation
  -- authority over trust-critical state. Asserted per relation and per
  -- privilege, because the hole this closes was invisible to a function-level
  -- check — 0200's first version tested only has_function_privilege and
  -- therefore proved a property narrower than the one it claimed.
  for v_rel in
    select unnest(array[
      'kitluy_devices.device_trusted_time',
      'kitluy_devices.device_trusted_time_events',
      'kitluy_devices.trust_policy',
      'kitluy_devices.pki_trust_configuration',
      'kitluy_devices.time_correction_approvals',
      'kitluy_auth.approval_policies',
      'kitluy_auth.approval_requests',
      'kitluy_auth.approval_decisions',
      'kitluy_audit.sensitive_action_approvals'])
  loop
    -- Asserted as the EXACT privilege set rather than one probe per privilege:
    -- it covers every mutation verb including ones not named in the revokes, and
    -- it also catches a future blanket grant loop re-adding any of them. It also
    -- keeps the whole-table-clearing keyword out of this file, which
    -- `migrations:validate` refuses without a marker a REVOKE must not claim.
    select coalesce(string_agg(privilege_type, ',' order by privilege_type), '(none)')
      into v_privs
      from information_schema.role_table_grants
     where grantee = 'service_role'
       and table_schema = split_part(v_rel, '.', 1)
       and table_name = split_part(v_rel, '.', 2);
    if v_privs <> 'SELECT' then
      raise exception 'KLUY-MIGRATION-0200: service_role holds "%" on % — expected SELECT only', v_privs, v_rel
        using errcode = 'P0001';
    end if;
  end loop;

  -- Decision 1A: it must not be able to drive the emergency correction door it
  -- can no longer satisfy, nor manufacture the evidence that door consults.
  if has_function_privilege('service_role', 'kitluy_devices.emergency_time_correction_v1(uuid, timestamptz, text, text, uuid, text, uuid, uuid, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0200: service_role can still call emergency time correction'
      using errcode = 'P0001';
  end if;

  -- Decision 2: the governed path must still WORK. A revoke that also broke the
  -- legitimate writer would be a fail-closed outage, not a fix. The bridge is a
  -- definer owned by the table owner, so it writes as owner and not as caller.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices' and p.proname = 'establish_device_trusted_time_v1'
       and p.prosecdef
       and pg_get_userbyid(p.proowner)
           = (select pg_get_userbyid(relowner) from pg_class
               where oid = 'kitluy_devices.device_trusted_time'::regclass)) then
    raise exception 'KLUY-MIGRATION-0200: the trusted-time bridge is not owned by the owner of the state it writes'
      using errcode = 'P0001';
  end if;

  raise notice 'KLUY-MIGRATION-0200: trusted time is source-aware; the bridge carries no caller timestamp; service_role holds no trust-critical mutation';
end
$guard$;

commit;
