-- kitluy:group:0158
-- Migration group 0158: reauth_expiry_authoritative_time.
--
-- Authority: KLD-2026-07-31-SECURITY-TEST-CLOCK-001 (owner-locked);
-- KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001 (the 300-second window);
-- WS-11-T003 Step 4 §3.
--
-- ===========================================================================
-- WHY THIS EXISTS
-- ===========================================================================
-- Group 0157 installed the sanctioned test clock and proved it inert. It was also,
-- at that point, DECORATIVE: `consume_reauthentication_evidence_v1` compares
-- `clock_timestamp()` against `expires_at`, so nothing the clock did could change
-- the outcome of a governed emergency, and the expiry race remained untestable.
--
-- This replaces exactly one comparison and one assignment in that function with
-- `kitluy_ops.authoritative_now_v1()`.
--
-- ===========================================================================
-- WHY THIS IS SAFE IN PRODUCTION
-- ===========================================================================
-- `authoritative_now_v1()` returns `clock_timestamp()` unless a
-- `kitluy_ops.test_clock_policy` row exists for environment `test`, and no
-- migration creates that row — group 0157 creates the table EMPTY and asserts it
-- stays empty. So production behaviour is byte-for-byte what it was: the same
-- clock, the same window, the same refusals.
--
-- What changes is that a test database whose operator deliberately enabled the
-- clock can now move the boundary the governed path actually reads.
--
-- ===========================================================================
-- WHAT IS DELIBERATELY NOT CHANGED
-- ===========================================================================
-- The FUNCTION SIGNATURE. No clock or instant parameter is added, here or
-- anywhere: a business RPC that accepted an instant would let a caller decide
-- when "now" is, which is the whole control. The clock is read from the session,
-- never passed.
--
-- `expires_at` is still computed at creation from the governed policy window and
-- is still never updated by any path — a failed attempt neither spends the
-- evidence nor buys more time with it.
--
-- Additive. Groups 0136-0157 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).

-- The function is owned by the applying role, so no ownership borrow is needed;
-- it does need to reach the clock, and a SECURITY DEFINER runs as its OWNER.
grant usage on schema kitluy_ops to postgres;
grant execute on function kitluy_ops.authoritative_now_v1() to postgres;

create or replace function kitluy_auth.consume_reauthentication_evidence_v1(
  p_evidence_id uuid,
  p_action_class text,
  p_environment text,
  p_authorization_id uuid
) returns boolean
language plpgsql
security definer
set search_path to 'kitluy_auth', 'auth', 'kitluy_ops', 'pg_catalog'
as $function$
declare
  v_actor uuid := auth.uid();
  v_row kitluy_auth.reauthentication_evidence;
  v_now timestamptz := kitluy_ops.authoritative_now_v1();
begin
  if v_actor is null or p_authorization_id is null then
    return false;
  end if;

  -- Locked, so two concurrent actions cannot both spend one row.
  select * into v_row from kitluy_auth.reauthentication_evidence
   where evidence_id = p_evidence_id
   for update;
  if not found then return false; end if;

  -- Every binding, each refused for its own reason rather than as "invalid".
  if v_row.actor_user_id is distinct from v_actor then return false; end if;
  if v_row.action_class is distinct from p_action_class then return false; end if;
  if v_row.environment is distinct from p_environment then return false; end if;
  if v_row.lifecycle_state <> 'ACTIVE' then return false; end if;
  if v_row.consumed_at is not null then return false; end if;
  if v_row.revoked_at is not null or v_row.superseded_at is not null then return false; end if;

  -- FRESHNESS against AUTHORITATIVE time.
  --
  -- `v_now` is captured ONCE, before the row lock is taken, and reused for both
  -- the comparison and the audit stamp. Reading the clock twice would let a
  -- transaction that waited a long time on the lock be judged against one instant
  -- and recorded against another.
  --
  -- In production `authoritative_now_v1()` IS `clock_timestamp()`; see the header.
  if v_now > v_row.expires_at then return false; end if;

  update kitluy_auth.reauthentication_evidence
     set consumed_at = v_now,
         consumed_for_authorization = p_authorization_id,
         lifecycle_state = 'CONSUMED'
   where evidence_id = p_evidence_id
     and consumed_at is null;

  -- If the action that called this rolls back, so does this UPDATE, and the
  -- evidence stays ACTIVE with its ORIGINAL expiry. A failed attempt neither
  -- spends the evidence nor buys more time with it.
  return found;
end
$function$;

-- Grants are preserved by `create or replace`, but restated so a future reader
-- can see the intended surface without consulting the catalogue.
revoke all on function kitluy_auth.consume_reauthentication_evidence_v1(uuid, text, text, uuid)
  from public;
grant execute on function kitluy_auth.consume_reauthentication_evidence_v1(uuid, text, text, uuid)
  to kitluy_credential_approval_reader;

comment on function kitluy_auth.consume_reauthentication_evidence_v1(uuid, text, text, uuid) is
  'Single-use, action-bound, environment-bound re-authentication spend. Freshness is judged against kitluy_ops.authoritative_now_v1(), which IS clock_timestamp() unless a test_clock_policy row exists (group 0157, never seeded by any migration). Takes no clock parameter: a caller must not decide when now is.';

-- ---------------------------------------------------------------------------
-- PROVE THE SIGNATURE DID NOT GROW A CLOCK, AND PRODUCTION TIME IS UNCHANGED
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_args text;
  v_drift numeric;
begin
  select pg_get_function_arguments(p.oid) into v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_auth' and p.proname = 'consume_reauthentication_evidence_v1';

  if v_args ~* '(p_now|p_clock|p_instant|p_as_of|p_current_time)' then
    raise exception
      'KLUY-MIGRATION-0158: the evidence spend grew a clock parameter (%); a caller must not decide when now is',
      v_args using errcode = 'P0001';
  end if;

  -- With no policy row — which is the state every migration leaves — authoritative
  -- time must be real time.
  if exists (select 1 from kitluy_ops.test_clock_policy) then
    raise exception
      'KLUY-MIGRATION-0158: test_clock_policy is not empty; group 0157 requires it to stay empty'
      using errcode = 'P0001';
  end if;

  select abs(extract(epoch from (kitluy_ops.authoritative_now_v1() - clock_timestamp())))
    into v_drift;
  if v_drift > 5 then
    raise exception
      'KLUY-MIGRATION-0158: authoritative time diverges from real time by %s with no policy row',
      v_drift using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-MIGRATION-0158: evidence freshness now reads authoritative time; signature unchanged (%), policy table empty, authoritative time == real time',
    v_args;
end
$guard$;
