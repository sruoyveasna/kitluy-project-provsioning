-- kitluy:hub:migration:0044
-- ===========================================================================
-- KitLuy Store Hub local database -- the Store's explicit primary vertical on
-- the Hub assignment.
--
-- Authority:
--   TERMINAL-APPLICATION-ASSIGNMENT-001 requirement 3, resolving
--     KLREQ-VERTICAL-ENVELOPE-001: the signed terminal configuration delivery
--     must carry the Digital Store's EXPLICIT authoritative primary vertical
--     instead of deriving it from the terminal profile prefix.
--   Rebuild bible v4.0.0 §3.2: one Digital Store, exactly one primary vertical
--     (`kitluy_core.digital_stores.primary_vertical_code`, cloud group 0020).
--   Hub §2 / 0004_core: the Hub is a single-vertical appliance, and Neutral
--     Core carries no vertical VOCABULARY -- this column stores a registry KEY
--     (`laundry`, `cafe_restaurant`, ...), which is data, not vocabulary.
--
-- WHY NULLABLE. `edge_identity.hub_assignment` has no production writer on
-- the Hub yet (rows come from `hub/seed/dev-fixtures.sql` and tests), so no
-- migration can backfill a value the Hub does not hold. The column is
-- nullable and the runtime FAILS CLOSED: `deriveEligibility` refuses a
-- terminal (VERTICAL_UNAVAILABLE) rather than signing a delivery without a
-- vertical. The cloud->Hub assignment writer, when built, must populate it
-- from `digital_stores.primary_vertical_code`. Recorded in the task handoff.
-- ===========================================================================

alter table edge_identity.hub_assignment
  add column if not exists primary_vertical_code text null;

alter table edge_identity.hub_assignment
  drop constraint if exists hub_assignment_primary_vertical_shape_ck;

-- Registry-key shape only. The registry itself lives in @kitluy/shared-types;
-- the Hub does not enumerate verticals (Neutral Core).
alter table edge_identity.hub_assignment
  add constraint hub_assignment_primary_vertical_shape_ck
  check (primary_vertical_code is null or primary_vertical_code ~ '^[a-z][a-z0-9_]*$');

comment on column edge_identity.hub_assignment.primary_vertical_code is
  'The Digital Store''s explicit primary vertical (registry key), signed into every terminal configuration delivery (v2). NULL = not yet replicated from cloud; the runtime refuses to sign a delivery for a terminal whose Hub assignment carries no vertical (TERMINAL-APPLICATION-ASSIGNMENT-001 / KLREQ-VERTICAL-ENVELOPE-001).';
