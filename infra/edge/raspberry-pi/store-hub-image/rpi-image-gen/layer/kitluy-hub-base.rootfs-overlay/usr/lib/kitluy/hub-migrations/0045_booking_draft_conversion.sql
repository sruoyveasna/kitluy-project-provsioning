-- kitluy:hub:migration:0045
-- ===========================================================================
-- KitLuy Store Hub local database -- a Booking Draft records the Booking it
-- was converted into (T1-REAL-OPERATIONS-001, slice 2).
--
-- Authority:
--   KLD-2026-09-19-T1-REAL-OPERATIONS-001 decision 1: T1 creates the Booking
--     at confirm, from the verified cart, in ONE Hub command served on the
--     approved route POST /edge/v1/laundry/bookings/{id}/confirm-intake with
--     {id} = the WS-12-T002 Booking Draft; the Hub "converts the draft
--     (lifecycle = converted)".
--   KLD-2026-08-06-WS12-T002-001 §4.1 (LOCKED): only an open draft is
--     editable; converted / cancelled / expired / superseded are ends. 0040's
--     guard already lets an OPEN draft move to `converted` (it refuses any
--     change on a non-open draft and demands version + 1); this group adds
--     the TRACE of that one transition, not a new transition.
--
-- WHAT THIS ADDS
--   booking_draft.converted_booking_id   the edge_laundry.booking the draft
--                                        became. Set exactly when lifecycle
--                                        becomes 'converted' (CHECK), never
--                                        changed afterwards (0040 guard: a
--                                        converted draft cannot change).
--
-- WHAT IT DOES NOT CHANGE, AND WHY
--   The draft-event vocabulary stays ('created', 'updated', 'cancelled').
--   The cloud draft projection door (cloud group 0187,
--   kitluy_laundry.ingest_booking_draft_event_v1) accepts exactly those three
--   event types and ANY lifecycle including 'converted'; a fourth Hub-only
--   type would be refused at ingestion (KLUY-DRAFT-INGEST-SCHEMA) until a
--   cloud migration widened it. The conversion is therefore recorded as an
--   'updated' receipt whose `changes` carry lifecycle 'converted' and the
--   booking id -- the same fact in both vocabularies, nothing lost, nothing
--   dead-lettered. Widening both ends together is slice 4's ingestion work.
-- ===========================================================================

alter table edge_laundry.booking_draft
  add column if not exists converted_booking_id uuid null
    references edge_laundry.booking (id);

alter table edge_laundry.booking_draft
  drop constraint if exists booking_draft_converted_booking_ck;

-- A converted draft names its Booking; no other lifecycle may.
alter table edge_laundry.booking_draft
  add constraint booking_draft_converted_booking_ck
  check ((lifecycle = 'converted') = (converted_booking_id is not null));

create index if not exists booking_draft_converted_booking_idx
  on edge_laundry.booking_draft (converted_booking_id)
  where converted_booking_id is not null;

comment on column edge_laundry.booking_draft.converted_booking_id is
  'The edge_laundry.booking this draft became at confirm-intake (KLD-2026-09-19-T1-REAL-OPERATIONS-001 decision 1). Set exactly once, together with lifecycle = converted, by the Hub command laundry.booking.confirm_from_draft; the 0040 guard forbids any later change.';

-- ---------------------------------------------------------------------------
-- Self-verification.
-- ---------------------------------------------------------------------------
do $guard0045$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'edge_laundry' and table_name = 'booking_draft'
       and column_name = 'converted_booking_id'
  ) then
    raise exception 'KLUY-HUB-MIGRATION-0045: converted_booking_id is missing';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'booking_draft_converted_booking_ck'
  ) then
    raise exception 'KLUY-HUB-MIGRATION-0045: the converted-booking CHECK is missing';
  end if;
  -- The 0040/0041 guard still stands: nothing here replaced it.
  if pg_get_functiondef('edge_laundry.enforce_booking_draft_guard()'::regprocedure)
     not like '%KLUY-EDGE-DRAFT-NOT-OPEN%' then
    raise exception 'KLUY-HUB-MIGRATION-0045: the booking-draft guard is not in place';
  end if;
  raise notice 'KLUY-HUB-MIGRATION-0045: booking_draft.converted_booking_id installed (set with lifecycle = converted, immutable afterwards)';
end $guard0045$;
