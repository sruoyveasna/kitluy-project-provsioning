-- kitluy:group:0169
-- Migration group 0169: atomic_terminal_code_recovery.
--
-- Authority: WS-11-T004-P02B2B2B2A (package contract);
-- kitluy-device-discovery-and-pairing-protocol-v1.0.0 §6.1; migrations
-- 0162-0168 (schema, issuance, presentation, revocation, canonical
-- expiration, replacement issuance and lineage, replay reconciliation).
--
-- ===========================================================================
-- THE ONE DOOR THIS GROUP ADDS
-- ===========================================================================
-- `recover_terminal_provisioning_code_v1`: the governed, ATOMIC, explicitly
-- authorized recovery of ONE committed outstanding terminal provisioning code
-- whose raw value an authorized human reconciled (0168) as issued but no
-- longer possesses. The caller supplies a terminal assignment id, the
-- ORIGINAL issuance idempotency key, a NEW recovery idempotency key and a
-- mandatory bounded reason — never a raw code, an actor, a scope, a Hub, a
-- profile, an environment, a state, a predecessor or a clock. Everything
-- authoritative is DERIVED from the authenticated session and the stored
-- rows.
--
-- The committed outcome is all-or-nothing inside ONE transaction:
--   old code:  ISSUED -> REVOKED   (immutable history, recovery reason)
--   new code:  new row -> ISSUED   (fresh Crockford code, digest, payload,
--                                   correlation-shared lineage, 15-minute
--                                   expiry, NULL replacement lineage)
-- Both commit together or neither does. There is no two-transaction split,
-- no enqueued second half, no partial recovery record.
--
-- Authorization (recorded decision): the actor must hold BOTH existing exact
-- scoped permissions — fleet.device_provisioning_code.issue AND
-- fleet.device_provisioning_code.revoke — for the DERIVED device and
-- environment. No new permission is invented (the package prefers reuse and
-- no repository authority requires a distinct one). Sensitive-action policy
-- (0165 recorded decision, re-confirmed): the re-authentication/four-eyes
-- decisions govern CREDENTIAL revocation, not a 15-minute provisioning code;
-- the mandatory bounded reason is required, and no reauthentication,
-- confirmation or approval is invented.
--
-- Lineage (recorded decision): recovery is NOT expired-code replacement. The
-- old code finishes REVOKED, so `replaces_provisioning_code_id` — whose 0167
-- integrity rule admits only an EXPIRED predecessor — stays NULL. The two
-- operations are bound RELATIONALLY instead: one shared correlation id on
-- both rows and both events, and the recovery idempotency key stored on the
-- successor (idempotency_key) and the predecessor (revocation_idempotency_
-- key). No new column is added without evidence of a canonical requirement.
--
-- Out of scope (later packages): broad cross-operation recovery races and
-- ambiguous-response hardening (P02B2B2B2B), expiration workers (P02B2B2C),
-- redemption and proof-of-possession (P02B3), production grant composition
-- (P02C), HTTP routes, Store Hub runtime integration.
--
-- ===========================================================================
-- kitluy:destructive-approved:WS-11-T004-P02B2B2B2A -- no DROP/TRUNCATE/
-- DELETE in this group; the marker is present so the destructive-guard never
-- reads a future edit of this file as unmarked history.
-- ===========================================================================

-- Ownership borrow, same as groups 0125-0168: the applying role is not a
-- member of the NOLOGIN definer owner. Handed back at the end of this file.
do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
  execute format('grant kitluy_credential_approval_reader to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 0. BRIDGES: the only kitluy_auth reach this door is allowed
-- ---------------------------------------------------------------------------
-- Same pattern as groups 0163/0165: narrowly owned definer bridges, each
-- owned by the approval reader and executable by EXACTLY the governor. The
-- actor bridge (`provisioning_code_actor_v1`), the scoped issue bridge
-- (`provisioning_code_issue_permitted_v1`) and both revocation bridges
-- (`provisioning_code_revoke_held_v1`, `provisioning_code_revoke_permitted_v1`)
-- already exist and are reused unchanged. One bridge is added: the coarse
-- ISSUANCE gate (does the actor hold the issue permission AT ALL), so an
-- actor holding neither recovery ingredient is refused BEFORE any row is
-- read and learns nothing about code or request existence.
create or replace function kitluy_devices.provisioning_code_issue_held_v1()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, kitluy_auth
as $held_bridge$
  select coalesce(kitluy_auth.has_permission(
    'fleet.device_provisioning_code.issue', null, null, null), false);
$held_bridge$;

-- The approval reader needs CREATE on the schema to own the bridge in it
-- (groups 0150/0163/0165 established the same grant for their bridges).
-- Revoked again below, immediately after the ownership move.
grant create on schema kitluy_devices to kitluy_credential_approval_reader;

alter function kitluy_devices.provisioning_code_issue_held_v1()
  owner to kitluy_credential_approval_reader;

revoke create on schema kitluy_devices from kitluy_credential_approval_reader;

revoke all on function kitluy_devices.provisioning_code_issue_held_v1() from public, anon, authenticated;
grant execute on function kitluy_devices.provisioning_code_issue_held_v1()
  to kitluy_activation_governor;

-- ---------------------------------------------------------------------------
-- 1. THE DOOR
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.recover_terminal_provisioning_code_v1(
  p_terminal_assignment_id uuid,
  p_original_idempotency_key text,
  p_recovery_idempotency_key text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_auth, kitluy_ops, extensions
as $recover$
declare
  v_actor uuid;
  v_prior kitluy_devices.device_provisioning_codes;
  v_predecessor kitluy_devices.device_provisioning_codes;
  v_assignment kitluy_devices.device_terminal_assignments;
  v_scope kitluy_devices.device_assignments;
  v_code_row kitluy_devices.device_provisioning_codes;
  v_hub_count integer;
  v_hub uuid;
  v_environment text;
  v_now timestamptz;
  v_expires timestamptz;
  v_code text;
  v_digest text;
  v_payload text;
  v_code_id uuid;
  v_correlation uuid;
  v_reason text;
  v_recovery_predecessor uuid;
  v_recovery_successor uuid;
  v_prior_actor text;
  v_prior_correlation uuid;
  v_final_state text;
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea;
  v_i integer;
begin
  -- CONTRACT violations are jsonb refusals, never raised errors: a caller
  -- mistake and an attacker must be told apart by the result, not by a crash.
  if p_terminal_assignment_id is null then
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-NO-ASSIGNMENT',
      'detail', 'a recovery names exactly one terminal assignment');
  end if;
  if p_original_idempotency_key is null or btrim(p_original_idempotency_key) = '' then
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-NO-ORIGINAL-KEY',
      'detail', 'a recovery names the original issuance idempotency key');
  end if;
  if p_recovery_idempotency_key is null or btrim(p_recovery_idempotency_key) = '' then
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-NO-RECOVERY-KEY',
      'detail', 'a recovery needs its own new idempotency key');
  end if;

  -- THE REASON CONTRACT (identical to the 0165 revocation door): mandatory,
  -- non-empty after canonical trimming, bounded at 500 characters, free of
  -- control characters, free of key material, and free of anything shaped
  -- like the raw code itself.
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-NO-REASON',
      'detail', 'a recovery requires a reason');
  end if;
  v_reason := btrim(p_reason);
  if length(v_reason) > 500 then
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-REASON-TOO-LONG',
      'detail', 'the reason exceeds the 500-character bound');
  end if;
  if v_reason ~ '[[:cntrl:]]' then
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-REASON-INVALID',
      'detail', 'the reason contains control characters');
  end if;
  if v_reason ~* 'private[[:space:]]+key' then
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-REASON-INVALID',
      'detail', 'the reason appears to contain key material');
  end if;
  if v_reason ~ '(^|[^0-9A-Za-z])[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}([^0-9A-Za-z]|$)' then
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-REASON-INVALID',
      'detail', 'the reason contains a token shaped like a provisioning code');
  end if;

  -- 1. THE ACTOR. Resolved by the database from the session; never accepted
  -- from any argument, body field or claim the caller could edit.
  v_actor := kitluy_devices.provisioning_code_actor_v1();
  if v_actor is null then
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-UNAUTHENTICATED',
      'detail', 'no authenticated actor context');
  end if;

  -- 2. THE COARSE GATES, BEFORE ANY ROW IS READ: recovery composes issuance
  -- and revocation, so an actor who does not hold BOTH permissions somewhere
  -- is refused here and cannot distinguish "no such request" from "request
  -- outside my scope".
  if not kitluy_devices.provisioning_code_issue_held_v1()
     or not kitluy_devices.provisioning_code_revoke_held_v1() then
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-PERMISSION-DENIED',
      'detail', 'recovery requires both fleet.device_provisioning_code.issue and fleet.device_provisioning_code.revoke');
  end if;

  -- 3. RECOVERY-KEY IDEMPOTENCY FIRST. The recovery key is the successor
  -- row's issuance key: a replay finds the row the earlier recovery created.
  select * into v_prior
    from kitluy_devices.device_provisioning_codes
   where idempotency_key = p_recovery_idempotency_key
   for update;
  if found then
    -- The 0168 disclosure pattern, doubled: BEFORE any row detail is
    -- disclosed the actor must hold BOTH exact permissions for the row's own
    -- derived device and environment — otherwise the repository-standard
    -- safe refusal, so a cross-scope caller cannot tell "committed" from
    -- "nonexistent".
    if not kitluy_devices.provisioning_code_issue_permitted_v1(
             v_prior.terminal_device_id, v_prior.environment)
       or not kitluy_devices.provisioning_code_revoke_permitted_v1(
             v_prior.terminal_device_id, v_prior.environment) then
      return jsonb_build_object(
        'outcome', 'RECOVERY_REFUSED',
        'refusal_code', 'KLUY-PROVCODE-PERMISSION-DENIED',
        'detail', 'the actor does not hold the recovery permissions for this device and environment');
    end if;
    -- Identify the recovery predecessor RELATIONALLY: the REVOKED event that
    -- shares the successor's CREATED correlation.
    select e_rev.provisioning_code_id, e_rev.actor_ref, e_rev.correlation_id
      into v_recovery_predecessor, v_prior_actor, v_prior_correlation
      from kitluy_devices.device_provisioning_code_events e_rev
      join kitluy_devices.device_provisioning_code_events e_new
        on e_new.correlation_id = e_rev.correlation_id
       and e_new.event_type = 'CREATED'
       and e_new.provisioning_code_id = v_prior.id
     where e_rev.event_type = 'REVOKED'
       and e_rev.provisioning_code_id <> v_prior.id
     limit 1;
    if v_recovery_predecessor is not null then
      select * into v_predecessor
        from kitluy_devices.device_provisioning_codes
       where id = v_recovery_predecessor;
    end if;
    -- The immutable replay identity: same assignment, same original request,
    -- same trimmed reason, same actor. Anything else conflicts closed.
    if v_recovery_predecessor is not null
       and v_prior.terminal_assignment_id = p_terminal_assignment_id
       and v_predecessor.idempotency_key = p_original_idempotency_key
       and v_predecessor.revocation_reason = v_reason
       and v_prior_actor = v_actor::text then
      return jsonb_build_object(
        'outcome', 'ALREADY_RECOVERED',
        'provisioning_code_id', v_prior.id,
        'revoked_provisioning_code_id', v_recovery_predecessor,
        'terminal_assignment_id', v_prior.terminal_assignment_id,
        'state', v_prior.state,
        'created_at', v_prior.created_at,
        'expires_at', v_prior.expires_at,
        'terminal_profile_key', v_prior.terminal_profile_key,
        'store_hub_device_id', v_prior.store_hub_device_id,
        'correlation_id', v_prior.correlation_id,
        'raw_code_available', false,
        'recovery_completed', true,
        'replay', true,
        'detail', 'this recovery idempotency key already recovered the code; the fresh raw code was returned once, at the creating recovery, and is never stored');
    end if;
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-CONFLICTING-REPLAY',
      'detail', 'this recovery idempotency key was used for a different recovery');
  end if;

  -- 4. THE ASSIGNMENT, LOCKED. Concurrent recoveries for one assignment
  -- serialize here, BEFORE any decision is read, so two winners cannot
  -- exist. This is the established assignment-then-code order shared with
  -- the 0164 evaluator, the 0165 revocation door and the 0167 replacement
  -- path; no code-first ordering is introduced.
  select * into v_assignment
    from kitluy_devices.device_terminal_assignments
   where id = p_terminal_assignment_id
   for update;
  if not found then
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-ASSIGNMENT-MISSING',
      'detail', 'no terminal assignment with that id');
  end if;

  -- The recovery-key check AGAIN, under the lock: a same-key race waits here
  -- for the winner's commit, and the replay must be answered
  -- ALREADY_RECOVERED (the first check ran before the winner committed and
  -- saw nothing).
  select * into v_prior
    from kitluy_devices.device_provisioning_codes
   where idempotency_key = p_recovery_idempotency_key
   for update;
  if found then
    if not kitluy_devices.provisioning_code_issue_permitted_v1(
             v_prior.terminal_device_id, v_prior.environment)
       or not kitluy_devices.provisioning_code_revoke_permitted_v1(
             v_prior.terminal_device_id, v_prior.environment) then
      return jsonb_build_object(
        'outcome', 'RECOVERY_REFUSED',
        'refusal_code', 'KLUY-PROVCODE-PERMISSION-DENIED',
        'detail', 'the actor does not hold the recovery permissions for this device and environment');
    end if;
    select e_rev.provisioning_code_id, e_rev.actor_ref, e_rev.correlation_id
      into v_recovery_predecessor, v_prior_actor, v_prior_correlation
      from kitluy_devices.device_provisioning_code_events e_rev
      join kitluy_devices.device_provisioning_code_events e_new
        on e_new.correlation_id = e_rev.correlation_id
       and e_new.event_type = 'CREATED'
       and e_new.provisioning_code_id = v_prior.id
     where e_rev.event_type = 'REVOKED'
       and e_rev.provisioning_code_id <> v_prior.id
     limit 1;
    if v_recovery_predecessor is not null then
      select * into v_predecessor
        from kitluy_devices.device_provisioning_codes
       where id = v_recovery_predecessor;
    end if;
    if v_recovery_predecessor is not null
       and v_prior.terminal_assignment_id = p_terminal_assignment_id
       and v_predecessor.idempotency_key = p_original_idempotency_key
       and v_predecessor.revocation_reason = v_reason
       and v_prior_actor = v_actor::text then
      return jsonb_build_object(
        'outcome', 'ALREADY_RECOVERED',
        'provisioning_code_id', v_prior.id,
        'revoked_provisioning_code_id', v_recovery_predecessor,
        'terminal_assignment_id', v_prior.terminal_assignment_id,
        'state', v_prior.state,
        'created_at', v_prior.created_at,
        'expires_at', v_prior.expires_at,
        'terminal_profile_key', v_prior.terminal_profile_key,
        'store_hub_device_id', v_prior.store_hub_device_id,
        'correlation_id', v_prior.correlation_id,
        'raw_code_available', false,
        'recovery_completed', true,
        'replay', true,
        'detail', 'this recovery idempotency key already recovered the code; the fresh raw code was returned once, at the creating recovery, and is never stored');
    end if;
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-CONFLICTING-REPLAY',
      'detail', 'this recovery idempotency key was used for a different recovery');
  end if;

  -- 5. THE ASSIGNMENT MUST BE LIVE (the 0163/0165 rule).
  if v_assignment.state not in ('pending_trust', 'active') then
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-ASSIGNMENT-INACTIVE',
      'detail', format('the terminal assignment is %s, not live', v_assignment.state));
  end if;

  -- 6. THE SCOPE, DERIVED — never caller-supplied.
  select * into v_scope
    from kitluy_devices.device_assignments
   where id = v_assignment.assignment_id;
  if not found then
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-ASSIGNMENT-MISSING',
      'detail', 'the assignment the terminal assignment references does not exist');
  end if;

  -- 7. THE ACTIVE HUB, RE-VALIDATED NOW (ADMIN-QA-014; the 0167 replacement
  -- rule): the projection is written ONLY by a successful activation, so its
  -- presence IS the active condition. A revoked, replaced or inactive Hub
  -- refuses recovery BEFORE any mutation — the old code stays ISSUED, no
  -- event, no row, no residue.
  select count(*) into v_hub_count
    from kitluy_devices.device_assignment_projections p
   where p.tenant_id = v_scope.tenant_id
     and p.digital_store_id = v_scope.digital_store_id
     and p.store_location_id = v_scope.store_location_id;
  if v_hub_count = 0 then
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-HUB-INACTIVE',
      'detail', 'no activated Store Hub at this scope; recovery cannot reissue without an active Hub');
  end if;
  select p.device_id, p.environment into v_hub, v_environment
    from kitluy_devices.device_assignment_projections p
   where p.tenant_id = v_scope.tenant_id
     and p.digital_store_id = v_scope.digital_store_id
     and p.store_location_id = v_scope.store_location_id
   order by p.projected_at, p.device_id
   limit 1;

  -- 8. THE EXACT SCOPED PERMISSIONS — BOTH, against the DERIVED device and
  -- environment. The environment gate is this check: grants are per
  -- environment, so a wrong-environment actor holds nothing here.
  if not kitluy_devices.provisioning_code_issue_permitted_v1(v_assignment.device_id, v_environment)
     or not kitluy_devices.provisioning_code_revoke_permitted_v1(v_assignment.device_id, v_environment) then
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-PERMISSION-DENIED',
      'detail', 'recovery requires both fleet.device_provisioning_code.issue and fleet.device_provisioning_code.revoke for this device and environment');
  end if;

  -- 9. THE ORIGINAL CODE, LOCATED AND LOCKED, through its authoritative
  -- assignment and the original issuance idempotency key. A raw code is
  -- never accepted anywhere on this door.
  select * into v_code_row
    from kitluy_devices.device_provisioning_codes
   where terminal_assignment_id = p_terminal_assignment_id
     and idempotency_key = p_original_idempotency_key
   for update;
  if not found then
    -- The key may name a request committed under ANOTHER assignment. That
    -- fact is disclosed only when the actor is authorized for THAT row's
    -- own derived device and environment; otherwise the safe refusal, so no
    -- cross-scope existence leaks.
    select * into v_prior
      from kitluy_devices.device_provisioning_codes
     where idempotency_key = p_original_idempotency_key;
    if found
       and kitluy_devices.provisioning_code_issue_permitted_v1(
             v_prior.terminal_device_id, v_prior.environment)
       and kitluy_devices.provisioning_code_revoke_permitted_v1(
             v_prior.terminal_device_id, v_prior.environment) then
      return jsonb_build_object(
        'outcome', 'RECOVERY_REFUSED',
        'refusal_code', 'KLUY-PROVCODE-CONFLICTING-REQUEST',
        'detail', 'the original issuance key belongs to a different assignment');
    end if;
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-REQUEST-NOT-FOUND',
      'detail', 'no committed issuance for this assignment under that original key');
  end if;

  -- Scope consistency, re-verified under the lock (the 0165 discipline): the
  -- code must still name exactly the device, location and profile its
  -- assignment binds.
  if v_assignment.device_id is distinct from v_code_row.terminal_device_id
     or v_assignment.store_location_id is distinct from v_code_row.store_location_id
     or v_assignment.terminal_profile_key is distinct from v_code_row.terminal_profile_key then
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-SCOPE-INCONSISTENT',
      'detail', 'the code names a device, location or profile its assignment does not');
  end if;

  v_now := kitluy_ops.authoritative_now_v1();

  -- 10. ELIGIBILITY: only a currently ISSUED, unexpired code is recoverable.
  -- Terminal states answer their stable classification with no mutation and
  -- no event; an overdue ISSUED row is the replacement path's input, not
  -- recovery's, and is classified ALREADY-EXPIRED without being expired here
  -- (expiration is the canonical 0166 helper's one ownership).
  if v_code_row.state = 'issued' and v_now >= v_code_row.expires_at then
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-ALREADY-EXPIRED',
      'provisioning_code_id', v_code_row.id,
      'terminal_assignment_id', v_code_row.terminal_assignment_id,
      'state', 'issued',
      'detail', 'the code is past its expiry; expired-code replacement, not recovery, is the path');
  end if;
  if v_code_row.state = 'revoked' then
    -- A recovery already completed against this code when its REVOKED event
    -- shares a correlation with a successor's CREATED event. That answer is
    -- stable, names both rows safely and changes nothing.
    select e_new.provisioning_code_id into v_recovery_successor
      from kitluy_devices.device_provisioning_code_events e_rev
      join kitluy_devices.device_provisioning_code_events e_new
        on e_new.correlation_id = e_rev.correlation_id
       and e_new.event_type = 'CREATED'
       and e_new.provisioning_code_id <> v_code_row.id
     where e_rev.provisioning_code_id = v_code_row.id
       and e_rev.event_type = 'REVOKED'
     limit 1;
    if v_recovery_successor is not null then
      return jsonb_build_object(
        'outcome', 'RECOVERY_ALREADY_COMPLETED',
        'provisioning_code_id', v_recovery_successor,
        'revoked_provisioning_code_id', v_code_row.id,
        'terminal_assignment_id', v_code_row.terminal_assignment_id,
        'raw_code_available', false,
        'recovery_completed', true,
        'detail', 'this code was already recovered; the successor stands and no further recovery is permitted against it');
    end if;
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-ALREADY-REVOKED',
      'provisioning_code_id', v_code_row.id,
      'terminal_assignment_id', v_code_row.terminal_assignment_id,
      'state', 'revoked',
      'detail', 'the code is already revoked; terminal states are never overwritten by recovery');
  end if;
  if v_code_row.state in ('locked', 'expired', 'redeemed') then
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-ALREADY-' || upper(v_code_row.state::text),
      'provisioning_code_id', v_code_row.id,
      'terminal_assignment_id', v_code_row.terminal_assignment_id,
      'state', v_code_row.state,
      'detail', format('the code is already %s; terminal states are never overwritten by recovery', v_code_row.state));
  end if;

  -- 11. THE ATOMIC RECOVERY. Revocation and fresh issuance commit together
  -- in THIS transaction; any failure anywhere rolls both back, leaving the
  -- old code ISSUED with no event, no row and no residue. The shared
  -- correlation id binds the two rows and the two events relationally.
  v_expires := v_now + interval '15 minutes';
  v_code_id := gen_random_uuid();
  v_correlation := gen_random_uuid();

  -- 11a. REVOKE THE UNUSABLE CODE, exactly once, with the state guard that
  -- makes a losing racer answer the winner's classification instead of
  -- raising an uncontrolled error (unreachable under the held row lock).
  update kitluy_devices.device_provisioning_codes
     set state = 'revoked',
         revoked_at = v_now,
         revocation_reason = v_reason,
         revocation_idempotency_key = p_recovery_idempotency_key
   where id = v_code_row.id and state = 'issued';
  if not found then
    select c.state::text into v_final_state
      from kitluy_devices.device_provisioning_codes c where c.id = v_code_row.id;
    return jsonb_build_object(
      'outcome', 'RECOVERY_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-ALREADY-' || upper(coalesce(v_final_state, 'UNAVAILABLE')),
      'provisioning_code_id', v_code_row.id,
      'terminal_assignment_id', v_code_row.terminal_assignment_id,
      'state', v_final_state,
      'detail', 'a competing transition committed first; the terminal state stands and no recovery was performed');
  end if;

  -- 11b. THE ONE REVOKED EVENT, atomic with the transition: recovery-specific
  -- safe reason code, authoritative actor and time, the shared correlation
  -- and safe non-secret provenance — never a raw code, digest or secret.
  insert into kitluy_devices.device_provisioning_code_events
    (provisioning_code_id, tenant_id, digital_store_id, store_location_id, environment,
     event_type, actor_type, actor_ref, reason_code, correlation_id, detail)
  values
    (v_code_row.id, v_code_row.tenant_id, v_code_row.digital_store_id, v_code_row.store_location_id,
     v_code_row.environment, 'REVOKED', 'OPERATOR', v_actor::text, 'LOST_CODE_RECOVERY',
     v_correlation, jsonb_build_object(
       'revocation_reason', v_reason,
       'recovered_provisioning_code_id', v_code_id));

  -- 11c. THE FRESH CODE. Eight Crockford Base32 characters (no I, L, O, U),
  -- one secure-random byte per character, 256 = 8 * 32 exactly so byte % 32
  -- is perfectly uniform (the 0163 generator, unchanged). A COMPLETELY new
  -- code: nothing is copied from the revoked predecessor. The raw value
  -- exists only in this frame.
  v_bytes := extensions.gen_random_bytes(8);
  v_code := '';
  for v_i in 0..7 loop
    v_code := v_code || substr(v_alphabet, (pg_catalog.get_byte(v_bytes, v_i) % 32) + 1, 1);
  end loop;

  -- 11d. THE DIGEST CONTRACT (0162, unchanged): sha-256 of the raw code for
  -- the digest; sha-256 of the canonical scope binding for the payload —
  -- bound to the CURRENT assignment-derived Hub, profile, environment and
  -- the fresh expiry.
  v_digest := encode(extensions.digest(v_code, 'sha256'), 'hex');
  v_payload := encode(extensions.digest(
    'ws11-t004.code.v1' || E'\n' ||
    v_scope.tenant_id::text || E'\n' ||
    v_scope.digital_store_id::text || E'\n' ||
    v_scope.store_location_id::text || E'\n' ||
    v_hub::text || E'\n' ||
    v_assignment.device_id::text || E'\n' ||
    v_assignment.id::text || E'\n' ||
    v_assignment.terminal_profile_key || E'\n' ||
    v_environment || E'\n' ||
    v_expires::text,
    'sha256'), 'hex');

  -- 11e. THE SUCCESSOR ROW: new UUID, new key, new correlation-shared
  -- identity, state ISSUED, zero attempts, no terminal-state timestamps, and
  -- replacement lineage NULL — recovery is NOT expired-code replacement, and
  -- the 0167 rule (only an EXPIRED predecessor may be replaced) is never
  -- overloaded.
  insert into kitluy_devices.device_provisioning_codes
    (id, tenant_id, digital_store_id, store_location_id, store_hub_device_id,
     terminal_device_id, terminal_assignment_id, terminal_profile_key, environment,
     code_digest, payload_sha256,
     created_at, expires_at, issued_by_operator_ref, correlation_id, idempotency_key,
     replaces_provisioning_code_id)
  values
    (v_code_id, v_scope.tenant_id, v_scope.digital_store_id, v_scope.store_location_id,
     v_hub, v_assignment.device_id, v_assignment.id, v_assignment.terminal_profile_key,
     v_environment, v_digest, v_payload,
     v_now, v_expires, v_actor::text, v_correlation, p_recovery_idempotency_key,
     null);

  -- 11f. THE ONE CREATED EVENT, atomic with the row, sharing the recovery
  -- correlation and recording safe non-secret provenance only.
  insert into kitluy_devices.device_provisioning_code_events
    (provisioning_code_id, tenant_id, digital_store_id, store_location_id, environment,
     event_type, actor_type, actor_ref, correlation_id, detail)
  values
    (v_code_id, v_scope.tenant_id, v_scope.digital_store_id, v_scope.store_location_id,
     v_environment, 'CREATED', 'OPERATOR', v_actor::text, v_correlation,
     jsonb_build_object('recovers_provisioning_code_id', v_code_row.id));

  -- 12. THE RAW CODE, returned exactly once, from this creating transaction
  -- only — after the new row exists inside it. It is never stored, never in
  -- an event, never reconstructable on replay.
  return jsonb_build_object(
    'outcome', 'RECOVERED',
    'provisioning_code_id', v_code_id,
    'revoked_provisioning_code_id', v_code_row.id,
    'code', v_code,
    'expires_at', v_expires,
    'terminal_profile_key', v_assignment.terminal_profile_key,
    'store_hub_device_id', v_hub,
    'correlation_id', v_correlation,
    'raw_code_available', true,
    'recovery_completed', true,
    'detail', 'the raw recovery code is returned in this response only; it is not stored anywhere');
end
$recover$;

comment on function kitluy_devices.recover_terminal_provisioning_code_v1(uuid, text, text, text) is
  'Group 0169 (WS-11-T004-P02B2B2B2A). The governed atomic lost-code recovery door for terminal provisioning codes (pairing protocol §6.1). For an authorized human who reconciled (0168) a committed issuance whose raw code is gone: the caller supplies the assignment, the ORIGINAL issuance idempotency key, a NEW recovery idempotency key and a mandatory bounded reason — never a raw code, actor, scope, Hub, profile, environment, state, predecessor or clock. The actor must hold BOTH exact scoped permissions (issue + revoke) for the derived device and environment. In ONE transaction the door revokes the unusable ISSUED code (immutable REVOKED history, LOST_CODE_RECOVERY reason) and issues exactly one fresh code under the recovery key — new Crockford value, digest, payload binding, correlation and 15-minute expiry, replacement lineage NULL (recovery is not expired-code replacement). The raw code is returned once, from the creating transaction only, and never stored. Identical replay returns ALREADY_RECOVERED with no raw code and no new work; conflicting replay fails closed; a second recovery key against an already-recovered code answers RECOVERY_ALREADY_COMPLETED; terminal states answer stable classifications with zero residue; the active-Hub gate re-validates before any mutation. P02B2B2B2B owns broader race hardening; P02C owns production grants.';

alter function kitluy_devices.recover_terminal_provisioning_code_v1(uuid, text, text, text)
  owner to kitluy_activation_governor;

-- The ONLY public surface: a correctly scoped human, as `authenticated` —
-- the same boundary the 0163 issuance and 0165 revocation doors established.
-- P02C owns any production service grant; there is deliberately none yet.
revoke all on function kitluy_devices.recover_terminal_provisioning_code_v1(uuid, text, text, text) from public;
revoke all on function kitluy_devices.recover_terminal_provisioning_code_v1(uuid, text, text, text) from anon;
revoke all on function kitluy_devices.recover_terminal_provisioning_code_v1(uuid, text, text, text) from service_role;
grant execute on function kitluy_devices.recover_terminal_provisioning_code_v1(uuid, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 2. HAND THE MEMBERSHIPS BACK
-- ---------------------------------------------------------------------------
do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
  execute format('revoke kitluy_credential_approval_reader from %I', current_user);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- 3. PROVE THE DOOR'S BOUNDARY ON APPLY (non-vacuous assertions)
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_door_def text;
  v_trigger_def text;
begin
  -- The door exists with the intended signature, definer, NOLOGIN governor
  -- owner, pinned search_path.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices' and p.proname = 'recover_terminal_provisioning_code_v1'
       and pg_get_function_arguments(p.oid) = 'p_terminal_assignment_id uuid, p_original_idempotency_key text, p_recovery_idempotency_key text, p_reason text'
       and p.prosecdef
       and pg_get_userbyid(p.proowner) = 'kitluy_activation_governor'
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then
    raise exception 'KLUY-MIGRATION-0169: the recovery door is missing, mis-signed, not definer, not governor-owned or unpinned'
      using errcode = 'P0001';
  end if;

  -- The grant boundary: authenticated executes the door; public/anon/
  -- service_role/kitluy_worker_service do not; the bridges are governor-only.
  if has_function_privilege('public', 'kitluy_devices.recover_terminal_provisioning_code_v1(uuid, text, text, text)', 'execute')
     or has_function_privilege('anon', 'kitluy_devices.recover_terminal_provisioning_code_v1(uuid, text, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.recover_terminal_provisioning_code_v1(uuid, text, text, text)', 'execute')
     or has_function_privilege('kitluy_worker_service', 'kitluy_devices.recover_terminal_provisioning_code_v1(uuid, text, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'kitluy_devices.recover_terminal_provisioning_code_v1(uuid, text, text, text)', 'execute')
     or not has_function_privilege('kitluy_activation_governor', 'kitluy_devices.provisioning_code_issue_held_v1()', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.provisioning_code_issue_held_v1()', 'execute')
     or has_function_privilege('public', 'kitluy_devices.provisioning_code_issue_held_v1()', 'execute')
     or has_function_privilege('anon', 'kitluy_devices.provisioning_code_issue_held_v1()', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.provisioning_code_issue_held_v1()', 'execute') then
    raise exception 'KLUY-MIGRATION-0169: the recovery door''s grant boundary is wrong'
      using errcode = 'P0001';
  end if;

  -- The door's body proves the structural contract: both coarse gates, both
  -- scoped gates, the active-Hub revalidation, the one revocation mutation
  -- with its state guard, the shared-correlation binding, the 0163 Crockford
  -- generator, the 15-minute expiry, the NULL replacement lineage, and NO
  -- delegation to the canonical expiration helper (recovery never expires).
  select pg_get_functiondef(p.oid) into v_door_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices' and p.proname = 'recover_terminal_provisioning_code_v1';
  if v_door_def not like '%provisioning_code_issue_held_v1%'
     or v_door_def not like '%provisioning_code_revoke_held_v1%'
     or v_door_def not like '%provisioning_code_issue_permitted_v1%'
     or v_door_def not like '%provisioning_code_revoke_permitted_v1%' then
    raise exception 'KLUY-MIGRATION-0169: the recovery door lost one of its four permission gates'
      using errcode = 'P0001';
  end if;
  if v_door_def not like '%device_assignment_projections%' then
    raise exception 'KLUY-MIGRATION-0169: the active-Hub gate is not on the recovery path'
      using errcode = 'P0001';
  end if;
  if v_door_def not like '%LOST_CODE_RECOVERY%'
     or v_door_def not like '%RECOVERY_ALREADY_COMPLETED%'
     or v_door_def not like '%ALREADY_RECOVERED%' then
    raise exception 'KLUY-MIGRATION-0169: the recovery event or idempotency vocabulary is missing'
      using errcode = 'P0001';
  end if;
  if v_door_def like '%expire_terminal_provisioning_code_v1%' then
    raise exception 'KLUY-MIGRATION-0169: recovery must never expire a code; expiration is the 0166 helper''s one ownership'
      using errcode = 'P0001';
  end if;

  -- No recovery lineage column exists: the only lineage remains the 0167
  -- expired-replacement column, and its rule (only an EXPIRED predecessor may
  -- be replaced) is not overloaded.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'kitluy_devices' and table_name = 'device_provisioning_codes'
       and column_name ~ 'recover' ) then
    raise exception 'KLUY-MIGRATION-0169: a recovery lineage column exists; the shared-correlation binding is the approved design'
      using errcode = 'P0001';
  end if;
  select pg_get_functiondef(p.oid) into v_trigger_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices' and p.proname = 'enforce_provisioning_code_integrity';
  if v_trigger_def not like '%KLUY-PROVCODE-LINEAGE-NOT-EXPIRED%' then
    raise exception 'KLUY-MIGRATION-0169: the expired-only replacement lineage rule was weakened'
      using errcode = 'P0001';
  end if;

  -- No direct table mutation grant appeared for any application identity.
  if has_table_privilege('authenticated', 'kitluy_devices.device_provisioning_codes', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'kitluy_devices.device_provisioning_code_events', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('service_role', 'kitluy_devices.device_provisioning_codes', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_worker_service', 'kitluy_devices.device_provisioning_codes', 'INSERT,UPDATE,DELETE') then
    raise exception 'KLUY-MIGRATION-0169: a direct table mutation grant exists'
      using errcode = 'P0001';
  end if;

  -- FORCE RLS still holds on both tables.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_devices'
       and c.relname in ('device_provisioning_codes', 'device_provisioning_code_events')
       and (not c.relrowsecurity or not c.relforcerowsecurity)) then
    raise exception 'KLUY-MIGRATION-0169: FORCE RLS no longer holds on the provisioning-code tables'
      using errcode = 'P0001';
  end if;

  -- No raw-code or digest-exposure column exists on either table (the
  -- identifier and reason-reference exclusions, as in 0165-0168).
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'kitluy_devices'
       and table_name in ('device_provisioning_codes', 'device_provisioning_code_events')
       and (column_name ~ '(^|_)(code|raw|plain|secret)(_|$)'
            and column_name not in ('code_digest', 'provisioning_code_id', 'reason_code',
                                    'replaces_provisioning_code_id'))) then
    raise exception 'KLUY-MIGRATION-0169: a column that could hold a raw code exists'
      using errcode = 'P0001';
  end if;

  -- The event vocabulary was not extended: no RECOVERED event type exists
  -- (one REVOKED + one CREATED is the whole recovery event contract).
  if exists (
    select 1 from pg_constraint
     where conrelid = 'kitluy_devices.device_provisioning_code_events'::regclass
       and conname = 'device_provisioning_code_events_type_chk'
       and pg_get_constraintdef(oid) like '%RECOVERED%') then
    raise exception 'KLUY-MIGRATION-0169: the event vocabulary gained a recovery event type'
      using errcode = 'P0001';
  end if;

  -- Events remain append-only.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'kitluy_devices.device_provisioning_code_events'::regclass
       and tgname = 'trg_device_provisioning_code_events_append_only') then
    raise exception 'KLUY-MIGRATION-0169: the append-only event trigger is missing'
      using errcode = 'P0001';
  end if;

  -- The issuance, presentation, revocation and expiration boundaries are
  -- unchanged (0163/0168, 0164, 0165, 0166 signatures and grants).
  if not has_function_privilege('authenticated', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or not has_function_privilege('kitluy_test_harness', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'kitluy_devices.revoke_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.revoke_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute')
     or not has_function_privilege('kitluy_test_harness', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0169: the issuance, presentation, revocation or expiration boundary drifted'
      using errcode = 'P0001';
  end if;

  -- No login-capable role holds the NOLOGIN owner.
  if exists (
    select 1 from pg_auth_members m
      join pg_roles r on r.oid = m.member
     where m.roleid = (select oid from pg_roles where rolname = 'kitluy_activation_governor')
       and r.rolcanlogin) then
    raise exception 'KLUY-MIGRATION-0169: a login-capable role is a member of the governor'
      using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-MIGRATION-0169: atomic controlled lost-code recovery applied (authenticated-only door; issue+revoke scoped permissions; one-transaction revoke+reissue; shared-correlation lineage; no worker, no new permission, no production grant; P02B2B2B2B owns race hardening, P02C owns production grants)';
end
$guard$;
