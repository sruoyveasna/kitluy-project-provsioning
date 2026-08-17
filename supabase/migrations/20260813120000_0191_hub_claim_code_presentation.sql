-- kitluy:migration:0191
--
-- STORE HUB CLAIM CODES: FORMAT, TTL AND LOCKOUT
-- =============================================================================
-- Authority: KLSRC-0162 §12 (Hub pairing-code entry), §33 (pairing-code
-- security); kitluy-device-discovery-and-pairing-protocol-v1.0.0 §6.1, which
-- specifies the Store Hub provisioning code as:
--
--     "8 characters using unambiguous Crockford Base32."
--     "Valid for 15 minutes by default."
--     "Single-use."
--     "Five failed attempts lock the session and emit a security event."
--
-- `device_claims` (group 0121) implements the single-use, replay-protected,
-- atomic half of that contract correctly. It implements NONE of the rest:
--
--   * TTL is checked only as "> 0 and <= 86400" at issuance — one second to
--     TWENTY-FOUR HOURS, against a documented fifteen minutes;
--   * there is no attempt counter, so an eight-character code could be guessed
--     without limit and without ever raising a security event;
--   * nothing constrains the code FORMAT, so issuer and device could disagree
--     on what an operator is even allowed to type.
--
-- That machinery exists, but only for TERMINALS
-- (`device_provisioning_codes` + `evaluate_terminal_provisioning_code_v1`,
-- groups 0162/0164). It is not reused by widening that table: its own header
-- draws the boundary explicitly —
--
--     "the repository name is `device_provisioning_codes`, and it is
--      deliberately NOT `device_claims` — the Hub claim keeps its own
--      semantics (assignment bootstrap), while a provisioning code binds a
--      TERMINAL assignment and an intended profile."
--
-- and that table is structurally terminal-only (`terminal_device_id`,
-- `terminal_assignment_id`, `terminal_profile_key` all NOT NULL). So this group
-- gives the Hub path the same PROTECTIONS with its own semantics, copying the
-- ordering decisions that were learned there rather than the table.
--
-- WHAT THIS GROUP DOES NOT DO
-- ---------------------------
-- It does not touch `redeem_device_claim_v1`. Redemption stays exactly as group
-- 0121 left it, including the deliberate stop at `awaiting_trust` — activation
-- is certificate-backed and gated on BLK-005. Presentation is a SEPARATE step
-- that runs before redemption and decides whether a redemption may be attempted
-- at all.
--
-- WHAT A SUCCESSFUL PRESENTATION DISCLOSES
-- ----------------------------------------
-- The MATCH branch returns the claim's SCOPE (tenant, digital store, location)
-- alongside the claim id. That is not incidental: redemption requires the
-- canonical payload digest, the canonical payload is device + scope + expiry, and
-- a caller that cannot see the scope cannot compose it. The alternative was table
-- SELECT for the pairing service, or a reader door callable with any claim id —
-- both wider. A REFUSED presentation discloses nothing at all. Details at the
-- MATCH branch itself.

begin;

-- -----------------------------------------------------------------------------
-- 1. Attempt accounting on the claim itself.
-- -----------------------------------------------------------------------------
-- Capped at five by the schema, not merely by the function: a second caller
-- that reached the row by another path still cannot record a sixth attempt.
alter table kitluy_devices.device_claims
  add column if not exists failed_attempt_count integer not null default 0,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'device_claims_attempts_chk'
       and conrelid = 'kitluy_devices.device_claims'::regclass
  ) then
    alter table kitluy_devices.device_claims
      add constraint device_claims_attempts_chk
      check (failed_attempt_count between 0 and 5);
  end if;

  -- A lock is a fact with a reason, or it is not a lock.
  if not exists (
    select 1 from pg_constraint
     where conname = 'device_claims_lock_coherent_chk'
       and conrelid = 'kitluy_devices.device_claims'::regclass
  ) then
    alter table kitluy_devices.device_claims
      add constraint device_claims_lock_coherent_chk
      check ((locked_at is null) = (locked_reason is null));
  end if;
end$$;

comment on column kitluy_devices.device_claims.failed_attempt_count is
  'Monotonic count of failed presentations. Capped at five by device_claims_attempts_chk so the cap survives a caller that bypasses the presentation function. An EXPIRED code never increments this: expiry is a bookkeeping fact, not a failed attempt.';
comment on column kitluy_devices.device_claims.locked_at is
  'Set on the fifth failed presentation. A locked claim takes no further presentations and can only be replaced by issuing a new one.';

-- -----------------------------------------------------------------------------
-- 2. The canonical code format, defined ONCE.
-- -----------------------------------------------------------------------------
-- Crockford Base32 excludes I, L, O and U precisely so an operator reading a
-- code aloud in a shop cannot confuse it with 1, 0 or a vowel. Exposing the
-- alphabet as a function means the issuer, the presenter and any test all agree
-- on the same 32 characters rather than each writing the regex from memory.
create or replace function kitluy_devices.hub_claim_code_alphabet_v1()
returns text
language sql
immutable
as $$ select '0123456789ABCDEFGHJKMNPQRSTVWXYZ' $$;

comment on function kitluy_devices.hub_claim_code_alphabet_v1 is
  'Crockford Base32, unambiguous subset: no I, L, O or U. Pairing protocol section 6.1.';

create or replace function kitluy_devices.normalize_hub_claim_code_v1(p_code text)
returns text
language sql
immutable
as $$
  -- Uppercase only. NOTHING is trimmed and nothing ambiguous is aliased: a code
  -- that needs repair to be valid is a code the operator did not type, and
  -- silently repairing it would make two different inputs the same credential.
  -- The display hyphen in KLSRC-0162's `ABCD-8291` is presentation only and is
  -- NOT accepted here; a caller that renders one must strip it before presenting.
  select upper(coalesce(p_code, ''))
$$;

comment on function kitluy_devices.normalize_hub_claim_code_v1 is
  'Uppercase-fold only. Never trims, never aliases ambiguous characters, never strips a display hyphen. Anything not matching the canonical eight-character alphabet after folding is MALFORMED.';

-- -----------------------------------------------------------------------------
-- 3. Fifteen-minute issuance ceiling.
-- -----------------------------------------------------------------------------
-- The 0121 issuance door accepts up to 86400 seconds. Rather than alter that
-- function (it is shared and its TTL argument is a caller contract), the
-- ceiling is enforced where it cannot be argued with: on the row.
--
-- Existing rows are exempt by construction — the constraint is NOT VALID, so
-- claims issued under the old ceiling stay readable and redeemable, while every
-- NEW claim is held to fifteen minutes.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'device_claims_ttl_chk'
       and conrelid = 'kitluy_devices.device_claims'::regclass
  ) then
    alter table kitluy_devices.device_claims
      add constraint device_claims_ttl_chk
      check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
      not valid;
  end if;
end$$;

-- -----------------------------------------------------------------------------
-- 4. Audit vocabulary for presentation.
-- -----------------------------------------------------------------------------
-- `device_claim_events.event_type` is a closed vocabulary and knows only the
-- REDEMPTION half of the claim lifecycle: CREATED, REDEEMED, REPLAYED, REFUSED,
-- EXPIRED, REVOKED. Presentation is a step that did not exist when 0121 wrote
-- that list, so its three facts have nowhere to be recorded.
--
-- They are added rather than folded into the existing `CLAIM_REFUSED`, because
-- the pairing protocol §6.1 requires that five failed attempts "emit a SECURITY
-- event". Recording a lockout as a generic refusal would make the one event the
-- protocol mandates indistinguishable, in the audit trail, from an ordinary
-- wrong-code refusal — which is the same as not emitting it.
--
-- Widening a CHECK is safe for every existing row: nothing previously accepted
-- becomes invalid. It does however require dropping the constraint to re-add it,
-- which is the ONE destructive statement this group carries — and it is put back
-- in the same transaction, as a strict superset.
--
-- kitluy:destructive-approved:KLD-2026-08-13-HUB-CLAIM-PRESENTATION-001
alter table kitluy_devices.device_claim_events
  drop constraint if exists device_claim_events_type_chk;
alter table kitluy_devices.device_claim_events
  add constraint device_claim_events_type_chk check (event_type = any (array[
    -- group 0121, unchanged
    'CLAIM_CREATED', 'CLAIM_REDEEMED', 'CLAIM_REDEMPTION_REPLAYED', 'CLAIM_REFUSED',
    'CLAIM_EXPIRED', 'CLAIM_REVOKED', 'ASSIGNMENT_CREATED', 'ASSIGNMENT_REPLACED',
    'ASSIGNMENT_REVOKED', 'TERMINAL_ASSIGNED', 'TERMINAL_REVOKED',
    -- this group: presentation
    'CLAIM_PRESENTED',       -- the right code was typed; redemption has NOT happened
    'CLAIM_FAILED_ATTEMPT',  -- carries MALFORMED vs MISMATCH in `detail`, never to the caller
    'CLAIM_LOCKED'           -- the security event §6.1 mandates, emitted once on the transition
  ]));

-- -----------------------------------------------------------------------------
-- 5. Presentation: the door a Hub CLI calls before any redemption.
-- -----------------------------------------------------------------------------
-- Ordering is copied from evaluate_terminal_provisioning_code_v1 because each
-- step there was learned rather than guessed:
--
--   expiry BEFORE syntax and digest work — an expired code must never count an
--     attempt, or an attacker could exhaust a victim's budget by waiting;
--   the digest compared in CONSTANT TIME — an early-exit comparison leaks the
--     code one character at a time;
--   the presented value and its digest NEVER persisted — the eight-character
--     space is searchable, and storing either hands over a dictionary.
create or replace function kitluy_devices.evaluate_hub_claim_code_v1(
  p_device_id uuid,
  p_presented_code text,
  p_actor_ref text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $eval$
declare
  v_claim kitluy_devices.device_claims;
  v_latest kitluy_devices.device_claims;
  v_now timestamptz;
  v_normalized text;
  v_presented_digest text;
  v_new_count integer;
  v_reason text;
begin
  if p_device_id is null then
    return jsonb_build_object(
      'outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-HUBCLAIM-NO-DEVICE',
      'detail', 'a presentation names exactly one device');
  end if;

  -- The outstanding claim, LOCKED: resolution and evaluation are one
  -- transaction, so two operators typing at once cannot both spend the budget.
  select * into v_claim
    from kitluy_devices.device_claims
   where device_id = p_device_id
     and state = 'issued'
   for update;

  if not found then
    -- Nothing outstanding is not a brute-force opportunity: no event, no attempt.
    select * into v_latest
      from kitluy_devices.device_claims
     where device_id = p_device_id
     order by created_at desc
     limit 1;
    if not found then
      return jsonb_build_object(
        'outcome', 'NO_OUTSTANDING',
        'refusal_code', 'KLUY-HUBCLAIM-NO-OUTSTANDING',
        'detail', 'no pairing code has been issued for this device');
    end if;
    return jsonb_build_object(
      'outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-HUBCLAIM-ALREADY-' || upper(v_latest.state::text),
      'state', v_latest.state,
      'detail', format('the pairing code for this device is already %s', v_latest.state));
  end if;

  if v_claim.locked_at is not null then
    return jsonb_build_object(
      'outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-HUBCLAIM-LOCKED',
      'state', v_claim.state,
      'detail', 'too many failed attempts; ask for a new pairing code');
  end if;

  -- AUTHORITATIVE EXPIRY FIRST, and it costs no attempt.
  v_now := kitluy_ops.authoritative_now_v1();
  if v_claim.expires_at <= v_now then
    update kitluy_devices.device_claims
       set state = 'expired'
     where id = v_claim.id and state = 'issued';
    if found then
      perform kitluy_devices.record_claim_event(
        v_claim.device_id, v_claim.id, null, 'CLAIM_EXPIRED', p_actor_ref,
        jsonb_build_object('reason', 'expired_on_authoritative_clock'));
    end if;
    return jsonb_build_object(
      'outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-HUBCLAIM-EXPIRED',
      'state', 'expired',
      'detail', 'the pairing code expired; this is not a failed attempt');
  end if;

  v_normalized := kitluy_devices.normalize_hub_claim_code_v1(p_presented_code);

  if length(v_normalized) <> 8
     or v_normalized !~ ('^[' || kitluy_devices.hub_claim_code_alphabet_v1() || ']{8}$') then
    v_reason := 'MALFORMED';
  else
    v_reason := null;
  end if;

  if v_reason is null then
    v_presented_digest := encode(extensions.digest(v_normalized, 'sha256'), 'hex');
    if kitluy_devices.constant_time_text_eq_v1(v_presented_digest, v_claim.claim_token_sha256) then
      -- MATCH. Deliberately NO consumption and NO state change: redemption is
      -- redeem_device_claim_v1's job, and it re-locks and rechecks everything.
      -- A presentation that consumed the claim would make the two functions
      -- disagree about who owns single-use.
      perform kitluy_devices.record_claim_event(
        v_claim.device_id, v_claim.id, null, 'CLAIM_PRESENTED', p_actor_ref, null);
      -- THE SCOPE IS RETURNED HERE, AND ONLY HERE.
      --
      -- `redeem_device_claim_v1` demands `p_presented_payload_sha256`, and the
      -- canonical payload (`kitluy.hub-claim-payload.v1`) is device + tenant +
      -- digital store + location + expiry. A caller that cannot see the scope
      -- cannot compose those bytes, so without this the pairing service would
      -- need either table SELECT on `device_claims` or a second reader door
      -- callable with any claim id it happened to learn.
      --
      -- Returning it from the MATCH branch is the narrower of those: disclosure
      -- is bound to a caller that has just PROVEN possession of the correct code
      -- for this device, which is precisely the authority a claim confers — and
      -- redemption would reveal the same scope moments later anyway. A refused
      -- presentation discloses nothing, which is why these fields appear in no
      -- other branch.
      return jsonb_build_object(
        'outcome', 'MATCH_READY',
        'claim_id', v_claim.id,
        'device_id', v_claim.device_id,
        'tenant_id', v_claim.tenant_id,
        'digital_store_id', v_claim.digital_store_id,
        'store_location_id', v_claim.store_location_id,
        'expires_at', v_claim.expires_at,
        'failed_attempt_count', v_claim.failed_attempt_count,
        'detail', 'the code matches an issued, unexpired, unlocked claim; redemption must re-check under its own lock');
    end if;
    v_reason := 'MISMATCH';
  end if;

  -- The failed attempt, atomically.
  update kitluy_devices.device_claims
     set failed_attempt_count = failed_attempt_count + 1
   where id = v_claim.id and state = 'issued' and locked_at is null
  returning failed_attempt_count into v_new_count;

  if v_new_count is null then
    -- A racer locked or consumed it first. Answer with the terminal fact.
    return jsonb_build_object(
      'outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-HUBCLAIM-LOCKED',
      'detail', 'the pairing code is no longer accepting presentations');
  end if;

  perform kitluy_devices.record_claim_event(
    v_claim.device_id, v_claim.id, null, 'CLAIM_FAILED_ATTEMPT', p_actor_ref,
    jsonb_build_object('reason', v_reason, 'failed_attempt_count', v_new_count));

  if v_new_count >= 5 then
    update kitluy_devices.device_claims
       set locked_at = v_now,
           locked_reason = 'five failed presentations'
     where id = v_claim.id;
    -- ONE security event, on the transition only.
    perform kitluy_devices.record_claim_event(
      v_claim.device_id, v_claim.id, null, 'CLAIM_LOCKED', p_actor_ref,
      jsonb_build_object('reason', 'attempt_budget_exhausted', 'failed_attempt_count', v_new_count));
    return jsonb_build_object(
      'outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-HUBCLAIM-LOCKED',
      'failed_attempt_count', v_new_count,
      'detail', 'too many failed attempts; ask for a new pairing code');
  end if;

  -- The refusal names no cause beyond "wrong", and reports the remaining budget
  -- so an operator knows where they stand. It does NOT distinguish MALFORMED
  -- from MISMATCH to the caller: that difference tells a guesser whether their
  -- alphabet is right, and it is recorded in the audit event instead.
  return jsonb_build_object(
    'outcome', 'PRESENTATION_REFUSED',
    'refusal_code', 'KLUY-HUBCLAIM-INVALID',
    'failed_attempt_count', v_new_count,
    'attempts_remaining', 5 - v_new_count,
    'detail', 'that pairing code is not valid for this device');
end;
$eval$;

comment on function kitluy_devices.evaluate_hub_claim_code_v1 is
  'Store Hub pairing-code presentation (pairing protocol section 6.1). Eight-character Crockford Base32, constant-time digest comparison, five-attempt budget with a security event on the fifth. Expiry is evaluated before any attempt is counted. Consumes nothing: redemption remains redeem_device_claim_v1 and re-checks under its own lock. Refuses rather than raises, so a Hub CLI can branch on an outcome code.';

-- -----------------------------------------------------------------------------
-- 6. Definer identity — which role this function RUNS AS.
-- -----------------------------------------------------------------------------
-- This was got wrong once, and the wrong answer is the tempting one, so the
-- reasoning is recorded rather than the conclusion.
--
-- `constant_time_text_eq_v1` is owned by `kitluy_activation_governor` and grants
-- EXECUTE to that role ALONE (group 0164), so the first version of this function
-- failed outright:
--
--     ERROR: permission denied for function constant_time_text_eq_v1
--
-- Group 0164 solved that for the TERMINAL path by transferring its evaluator to
-- the governor, and copying that looks obviously right. It is not, because the
-- two paths sit on differently-owned tables:
--
--   * the terminal path's tables are OWNED by `kitluy_activation_governor`
--     (`device_provisioning_code_events`), which is why its evaluator can write;
--   * the claim path's tables are owned by `postgres` with **FORCED** row-level
--     security, and the only policies the governor has on them are
--     `device_claims_activation_read` / `device_claim_events_activation_read` —
--     SELECT. The schema deliberately gave this role READ access to the claim
--     ledger and nothing more.
--
-- So a governor-owned function here would need new INSERT/UPDATE policies on the
-- claim ledger for a role that was intentionally kept read-only — weakening a
-- real boundary to satisfy a symmetry that does not exist.
--
-- It is owned by `postgres` instead, like every one of its siblings on this path
-- (`create_device_claim_v1`, `redeem_device_claim_v1`, `record_claim_event`), and
-- the comparison helper is granted to `postgres`. That grant hands over no
-- capability: `postgres` already holds BYPASSRLS and owns these tables, and
-- `constant_time_text_eq_v1` is a pure, immutable, side-effect-free string
-- comparison — an ALGORITHM, not a privilege. Restricting who may call it never
-- protected anything a caller could not reimplement in four lines.
--
-- The grantor must be the helper's owner, and the applying role is not a member
-- of that NOLOGIN role, so the membership is borrowed and handed straight back —
-- the same borrow groups 0125-0164 use.
do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

grant execute on function kitluy_devices.constant_time_text_eq_v1(text, text) to postgres;

do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

-- The Hub CLI reaches this through a governed service, never directly.
revoke all on function kitluy_devices.evaluate_hub_claim_code_v1(uuid, text, text) from public;
grant execute on function kitluy_devices.evaluate_hub_claim_code_v1(uuid, text, text) to service_role;

commit;
