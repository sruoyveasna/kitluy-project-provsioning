-- kitluy:hub:migration:0025
-- ===========================================================================
-- KitLuy Store Hub local database — corrections for independent review
-- findings RV-013 and RV-014 (re-verification pass,
-- 00_AI_HANDOFF/reviews/2026-07-28__WS-10-SYNC__REVIEW.md Part II).
--
-- The reviewer classed both as NON-BLOCKING because the resolver has no
-- production caller yet. They are fixed anyway: both are fail-open defects in
-- an AUTHORIZATION path, and "there is no caller yet" is a statement about
-- today, not about the next cycle that adds one.
--
-- Both were reproduced before this file was written.
--
-- ---------------------------------------------------------------------------
-- RV-013 — a grant belonging to ANOTHER TENANT could permit this one.
--
-- `resolve_permission_grant` filtered on `g.location_id` but never on the
-- grant's OWN `tenant_id` / `digital_store_id`, and the `platform` branch
-- matched unconditionally. A platform-scoped ALLOW carrying the attacker
-- tenant's scope columns therefore resolved to `allow` for a completely
-- different tenant. Reproduced: `allow`.
--
-- THE FIX. Every grant must belong to the scope being asked about. The
-- resolver now filters on the grant's own tenant and Digital Store as well as
-- its Location, so a row from another tenant is not even loaded.
--
-- ---------------------------------------------------------------------------
-- RV-014 — a DENY with a NULL scope_id FAILED OPEN.
--
-- The scope match used `is not distinct from`, which is FALSE when the grant's
-- `scope_id` is NULL and the request's is not. A `tenant`-scoped DENY with a
-- NULL `scope_id` was therefore never loaded, and a narrow ALLOW won.
-- Reproduced: `allow`. Nothing forced a non-platform grant to carry a
-- `scope_id`, because `platform` legitimately has none.
--
-- This is the ONE direction the rest of the cycle is built to avoid: every
-- other refusal path fails closed.
--
-- THE FIX, in two layers.
--   1. A CHECK makes the malformed row unstorable: exactly the `platform`
--      scope may have a NULL `scope_id`.
--   2. The resolver treats a malformed non-platform DENY as MATCHING anyway.
--      The asymmetry is deliberate — a malformed deny still denies, a
--      malformed allow still grants nothing. If layer 1 is ever relaxed, the
--      failure direction stays closed.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. RV-014 layer 1 — a non-platform grant must name its scope.
-- ---------------------------------------------------------------------------
alter table edge_config.permission_grant_projection
  add constraint permission_grant_projection_scope_id_ck
    check ((scope_type = 'platform') = (scope_id is null));

comment on constraint permission_grant_projection_scope_id_ck
  on edge_config.permission_grant_projection is
  'RV-014: only the platform scope may omit a scope_id. A tenant/digital_store/store_location grant with a NULL scope_id was silently unmatchable, so a DENY carrying one failed OPEN.';

-- ---------------------------------------------------------------------------
-- 2. RV-013 + RV-014 layer 2 — the corrected resolver.
--
-- kitluy:destructive-approved:RV-013 — the 0024 signature is DROPPED. It
-- resolves a cross-tenant allow and drops a malformed deny; leaving it callable
-- beside the corrected one would preserve both defects.
-- ---------------------------------------------------------------------------
drop function edge_config.resolve_permission_grant(uuid, uuid, uuid, uuid, text, text, uuid, boolean, timestamptz);

create function edge_config.resolve_permission_grant(
  p_tenant_id        uuid,
  p_digital_store_id uuid,
  p_location_id      uuid,
  p_actor_id         uuid,
  p_permission_key   text,
  p_scope_type       text,
  p_scope_id         uuid,
  p_online           boolean default true,
  p_as_of            timestamptz default now()
) returns text
language plpgsql
stable
as $$
declare
  v_has_allow boolean := false;
  r record;
begin
  for r in
    select *
    from edge_config.permission_grant_projection g
    -- RV-013: the grant must BELONG to the scope being asked about. Without
    -- these three, a row carrying another tenant's scope columns was still
    -- considered, and a platform-scoped allow from anywhere permitted here.
    where g.tenant_id = p_tenant_id
      and g.digital_store_id = p_digital_store_id
      and g.location_id = p_location_id
      and g.actor_id = p_actor_id
      and g.permission_key = p_permission_key
      and g.revoked_at is null
      and g.not_before <= p_as_of
      and (g.expires_at is null or g.expires_at > p_as_of)
      and (
        (g.scope_type = 'platform' and g.scope_id is null)
        or (g.scope_type = 'tenant' and g.scope_id = p_tenant_id)
        or (g.scope_type = 'digital_store' and g.scope_id = p_digital_store_id)
        or (g.scope_type = 'store_location' and g.scope_id = p_location_id)
        -- Scope types outside the hierarchy (terminal, device, …) match exactly.
        or (g.scope_type = p_scope_type and g.scope_id is not distinct from p_scope_id)
        -- RV-014 layer 2: a malformed non-platform grant with no scope_id is
        -- unmatchable by every branch above. Load it ANYWAY when it is a DENY,
        -- so the failure direction stays closed even if the CHECK is relaxed.
        -- A malformed ALLOW is deliberately NOT loaded: it grants nothing.
        or (g.effect = 'deny' and g.scope_type <> 'platform' and g.scope_id is null)
      )
    order by g.projection_version desc
  loop
    -- DENY ANYWHERE IN THE CHAIN WINS, checked before any allow can be
    -- accumulated, so no row ordering can let a narrow allow through.
    if r.effect = 'deny' then
      return 'deny';
    end if;

    if not p_online then
      -- Offline use needs a duration an APPROVED SIGNED POLICY granted. No
      -- duration means no offline validity; the Hub invents none (KLREQ-025).
      if r.offline_validity_seconds is null then
        continue;
      end if;
      if r.granted_at + make_interval(secs => r.offline_validity_seconds) <= p_as_of then
        continue;
      end if;
    end if;

    v_has_allow := true;
  end loop;

  if v_has_allow then
    return 'allow';
  end if;
  -- Missing, unknown or expired: fail closed.
  return 'unknown';
end;
$$;

comment on function edge_config.resolve_permission_grant(uuid, uuid, uuid, uuid, text, text, uuid, boolean, timestamptz) is
  'KLREQ-025 resolver. Corrected for review findings RV-002 (walks the whole scope chain, deny anywhere wins), RV-013 (a grant must belong to the tenant, Digital Store and Location being asked about — a cross-tenant platform allow no longer permits) and RV-014 (a malformed non-platform DENY with no scope_id is still loaded, so the failure direction stays closed; a malformed ALLOW is not). Missing/unknown/expired returns `unknown`, which callers treat as a refusal.';

revoke execute on function
  edge_config.resolve_permission_grant(uuid, uuid, uuid, uuid, text, text, uuid, boolean, timestamptz)
  from public;
grant execute on function
  edge_config.resolve_permission_grant(uuid, uuid, uuid, uuid, text, text, uuid, boolean, timestamptz)
  to kitluy_hub_runtime;
