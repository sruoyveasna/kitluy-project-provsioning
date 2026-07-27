-- kitluy:group:0100
-- Migration group 0100: terminal_profile_identifiers (KL-DEC-001-T003).
--   Renames the LOGICAL Laundry terminal-profile identifiers stored in
--   kitluy_laundry.garment_scan_events.terminal_role to the canonical
--   dot-separated vocabulary approved by KLD-2026-07-26-002 Group 2
--   (OWNER-APPROVED 2026-07-27):
--     t1_intake_cashier   -> laundry.t1.intake_cashier
--     t2_customer_display -> laundry.t2.customer_display
--     t3_ready_scan_in    -> laundry.t3.ready_scan_in
--     t4_pickup_scan_out  -> laundry.t4.pickup_scan_out
--   T2 owns no custody vocabulary at all (RB v4 §5.3), so its identifier is
--   renamed in code only and stays absent from the storable set below.
-- Authority: KLD-2026-07-26-002 Group 2 (APPROVED); KLV4-DEC-005 (owner-locked
--   T1-T4 model); task 00_AI_HANDOFF/tasks/KL-DEC-001-T003.md. Group 2:
--   "Because no affected profile identifier has been deployed, the existing
--   scaffold identifiers may be mechanically renamed in one governed
--   implementation change without runtime aliases." No alias layer, no
--   dual-accept window, no deprecation period is created here.
-- Reconciliation: KLREC-2026-07-26-009 (terminal-profile identifier drift)
--   moves to RESOLVED. Group 0080 deliberately stored the pre-ballot spellings
--   and fenced the rename behind the KL-DEC-001 ballot; the ballot is recorded,
--   so this is the single governed commit that ballot authorized.
-- Retired forever and never reused (Group 2): t2_scan_in, t3_scan_out. Neither
--   appears in any constraint, row or seed value in this repository.
-- Explicitly NOT renamed:
--   * physical device/hardware profile codes laundry_front_counter,
--     laundry_ready_pickup, laundry_t1_dedicated, laundry_t2_dedicated,
--     laundry_t3_dedicated, laundry_t4_dedicated — Group 2: the logical
--     identifiers "do not replace physical device-profile codes";
--   * kitluy_config.configuration_versions.terminal_profile_code (group 0050) —
--     a free-text configuration scope key with no enumerated value set and no
--     non-null rows; nothing to rename, and widening it is out of this scope.
-- Forward-only paired migration: group 0080 is COMMITTED and is never edited in
--   place (KL-DEC-001-T003 rollback note; migration plan). This file supersedes
--   the three group-0080 terminal_role CHECK constraints by DROP + re-CREATE
--   with the canonical values. The T3-only Ready scan-in and T4-only pickup
--   scan-out separation (KBR-LND-004 / KBR-LND-005) and the T2 exclusion
--   (RB v4 §5.3) are preserved verbatim — no check is weakened, widened or
--   dropped without an equivalent replacement in the same transaction.
-- Statement order is load-bearing: the three CHECK constraints must be dropped
--   BEFORE the rows are rewritten, otherwise the canonical value violates the
--   superseded constraint on any database that already holds custody rows (a
--   fresh `supabase db reset` has an empty table and would hide the fault). The
--   constraints are re-added afterwards, which re-validates every existing row.
--   The whole file runs in one transaction holding ACCESS EXCLUSIVE on the
--   table, so no concurrent session ever observes the unconstrained window.
-- Append-only carve-out: kitluy_laundry.garment_scan_events carries
--   trg_append_only_garment_scan_events (group 0095), whose function
--   unconditionally rejects UPDATE. kitluy_auth.enforce_append_only()'s own
--   contract names the single exception: "any approved operator repair uses an
--   explicit governed procedure that disables the trigger inside its own
--   audited transaction" (group 0035, review RV-201). This is a governed
--   VOCABULARY rename, not a business correction: no custody fact, actor,
--   timestamp, order, garment, storage position, reason code, idempotency key
--   or aggregate version changes — only the spelling of the logical profile
--   identifier. A compensating record is deliberately NOT used, because a
--   second event would duplicate the chain of custody and collide with the
--   Tenant idempotency uniqueness anchor. The trigger is disabled and
--   re-enabled inside this one transaction and nowhere else.
-- Schema-additive: no table, column, relation, index, policy or grant is
--   dropped. LOCAL execution only; never applied automatically in production
--   (KL-INF-P1-037, OWNER-LOCKED).
-- kitluy:destructive-approved:KLD-2026-07-26-002
--   Covers the three ALTER TABLE ... DROP CONSTRAINT statements below, each
--   re-created in the same transaction with the canonical identifier set.

begin;

-- ---------------------------------------------------------------------------
-- 1. Drop the superseded group-0080 terminal_role CHECK constraints. They
--    enumerate the pre-rename spellings and would reject the canonical values
--    written in step 2. Equivalent constraints are re-added in step 3, inside
--    this same transaction.
-- ---------------------------------------------------------------------------
alter table kitluy_laundry.garment_scan_events
  drop constraint if exists garment_scan_events_terminal_role_check;

alter table kitluy_laundry.garment_scan_events
  drop constraint if exists garment_scan_events_t3_only_check;

alter table kitluy_laundry.garment_scan_events
  drop constraint if exists garment_scan_events_t4_only_check;

-- ---------------------------------------------------------------------------
-- 2. Rewrite the stored logical identifiers (governed append-only carve-out).
--    A fresh reset finds an empty table; an already-seeded developer database
--    is migrated in place. Only terminal_role changes.
-- ---------------------------------------------------------------------------
alter table kitluy_laundry.garment_scan_events
  disable trigger trg_append_only_garment_scan_events;

update kitluy_laundry.garment_scan_events
   set terminal_role = 'laundry.t1.intake_cashier'
 where terminal_role = 't1_intake_cashier';

update kitluy_laundry.garment_scan_events
   set terminal_role = 'laundry.t3.ready_scan_in'
 where terminal_role = 't3_ready_scan_in';

update kitluy_laundry.garment_scan_events
   set terminal_role = 'laundry.t4.pickup_scan_out'
 where terminal_role = 't4_pickup_scan_out';

alter table kitluy_laundry.garment_scan_events
  enable trigger trg_append_only_garment_scan_events;

-- ---------------------------------------------------------------------------
-- 3. Re-create the three CHECK constraints over the canonical vocabulary. ADD
--    CONSTRAINT validates every existing row, so a missed rename fails the
--    migration here rather than reaching a running system.
-- ---------------------------------------------------------------------------
-- T2 is customer-facing only and never owns a custody event (RB v4 §5.3):
-- laundry.t2.customer_display is intentionally absent from the storable set.
alter table kitluy_laundry.garment_scan_events
  add constraint garment_scan_events_terminal_role_check check (
    terminal_role in (
      'laundry.t1.intake_cashier',
      'laundry.t3.ready_scan_in',
      'laundry.t4.pickup_scan_out'
    )
  );

-- KBR-LND-004: Ready scan-in is T3-only.
alter table kitluy_laundry.garment_scan_events
  add constraint garment_scan_events_t3_only_check check (
    scan_type <> 'READY_SCAN_IN' or terminal_role = 'laundry.t3.ready_scan_in'
  );

-- KBR-LND-005: pickup scan-out is T4-only.
alter table kitluy_laundry.garment_scan_events
  add constraint garment_scan_events_t4_only_check check (
    scan_type <> 'PICKUP_SCAN_OUT' or terminal_role = 'laundry.t4.pickup_scan_out'
  );

-- ---------------------------------------------------------------------------
-- 4. Fail-closed post-conditions: no stale spelling survives, the append-only
--    trigger is armed again, and all three constraints exist.
-- ---------------------------------------------------------------------------
do $$
declare
  stale bigint;
  armed char;
  checks int;
begin
  select count(*) into stale
    from kitluy_laundry.garment_scan_events
   where terminal_role not in (
     'laundry.t1.intake_cashier',
     'laundry.t3.ready_scan_in',
     'laundry.t4.pickup_scan_out'
   );
  if stale > 0 then
    raise exception
      'KLUY-LND-PROFILE-RENAME: % custody row(s) still carry a non-canonical terminal_role (KLD-2026-07-26-002 Group 2)',
      stale;
  end if;

  select tgenabled into armed
    from pg_trigger
   where tgrelid = 'kitluy_laundry.garment_scan_events'::regclass
     and tgname = 'trg_append_only_garment_scan_events';
  if armed is distinct from 'O' then
    raise exception
      'KLUY-LND-PROFILE-RENAME: append-only trigger on garment_scan_events was left disabled (state %)',
      coalesce(armed, 'MISSING');
  end if;

  select count(*) into checks
    from pg_constraint
   where conrelid = 'kitluy_laundry.garment_scan_events'::regclass
     and contype = 'c'
     and conname in (
       'garment_scan_events_terminal_role_check',
       'garment_scan_events_t3_only_check',
       'garment_scan_events_t4_only_check'
     );
  if checks <> 3 then
    raise exception
      'KLUY-LND-PROFILE-RENAME: expected 3 terminal_role CHECK constraints, found %',
      checks;
  end if;

  raise notice
    'group 0100: terminal_role renamed to the canonical laundry.t{1,3,4}.* vocabulary; 3 CHECK constraints re-created; append-only trigger re-armed';
end $$;

commit;
