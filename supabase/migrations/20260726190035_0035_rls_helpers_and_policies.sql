-- kitluy:group:0035
-- Migration group 0035: RLS helpers, integrity triggers, RLS enablement and policies
-- for groups 0010, 0020 and 0030 (WS-02-T002 / WS-03-T001 / WS-04-T002).
-- Sequenced per owner direction KLD-2026-07-26-003 row 5: authz/audit is followed by
-- functions/RLS helpers, then policies, in the same release train. The full-platform
-- RLS enablement (group 0120) and RPC layer (group 0130) still cover later groups;
-- this file covers exactly the 45 tables created by groups 0010-0030 so they are
-- fail-closed from the moment they exist.
-- Helper names are the canonical names of the RLS specification section 3
-- (docs/data/kitluy-suite-supabase-rls-and-authorization-v1.0.0.md) and the
-- functions/RPC/triggers contract:
--   current_actor_context, current_tenant_ids, current_digital_store_ids,
--   current_location_ids, has_permission, assert_permission,
--   require_reauthentication, consume_execution_token, record_authorization_decision.
-- Status: SCAFFOLDED. Execution BLOCKED (BLK-002: Docker and Supabase CLI absent).
-- Statically validated only; NOT applied anywhere; no application is claimed.
-- Purely additive: no destructive statements. Never applied automatically to
-- production (KL-INF-P1-037, OWNER-LOCKED).
-- Policy model (RLS spec section 4/5): SELECT-only policies for authenticated;
-- anon has NO policy on any kitluy_* table; every write path is PC-RPC/PC-SVC
-- (the versioned SECURITY DEFINER RPCs land in group 0130), so NO INSERT, UPDATE
-- or DELETE policy exists in this file — writes fail closed for client roles.
-- Append-only tables get NO UPDATE/DELETE policy ever, plus the enforce_append_only
-- trigger as defense in depth. There is no catch-all permissive policy; the only
-- USING (true) policies are the all-authenticated reference-data reads explicitly
-- allowed by RLS spec section 5.1 (plans, reference_values, reference_value_translations).

begin;

-- ===========================================================================
-- 1. Context resolution helper functions (Owner: Security; RLS spec section 3)
--    All are SECURITY DEFINER with a locked search_path, EXECUTE revoked from
--    PUBLIC and anon, fail-closed (empty/false on any unresolved input), and
--    STABLE where they only read (revocation applies at the next statement).
-- ===========================================================================

create or replace function kitluy_auth.current_actor_context()
returns jsonb
language sql
stable
security definer
set search_path = kitluy_auth, kitluy_core, auth, public
as $$
  select jsonb_build_object(
    'actor_type', case when auth.uid() is null then 'anonymous' else 'user' end,
    'user_id', auth.uid(),
    'jwt_role', nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'session_id', nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id'
  );
$$;

comment on function kitluy_auth.current_actor_context() is
  'Resolves actor type and identity from the signed JWT (sub only; app_metadata/user_metadata are never authorization truth). Fail-closed: anonymous when unresolved. Device/service context resolution completes in group 0130.';

create or replace function kitluy_auth.current_tenant_ids()
returns uuid[]
language sql
stable
security definer
set search_path = kitluy_core, kitluy_auth, auth, public
as $$
  select coalesce(array_agg(m.tenant_id), '{}'::uuid[])
  from kitluy_core.memberships m
  join kitluy_core.tenants t on t.id = m.tenant_id
  where auth.uid() is not null
    and m.user_id = auth.uid()
    and m.status = 'ACTIVE'
    and m.valid_from <= now()
    and (m.valid_to is null or m.valid_to > now())
    and t.status in ('ONBOARDING', 'ACTIVE', 'GRACE');
$$;

comment on function kitluy_auth.current_tenant_ids() is
  'uuid[] of tenants with an active, unexpired, unrevoked membership for the current actor (server-derived from relational state, never from client claims — RLS-004/RLS-010). STABLE; empty on any doubt (no membership, suspended membership, suspended/cancelled tenant, anonymous).';

create or replace function kitluy_auth.current_digital_store_ids()
returns uuid[]
language sql
stable
security definer
set search_path = kitluy_core, kitluy_auth, auth, public
as $$
  with store_scopes as (
    select s.scope_id
    from kitluy_auth.role_assignments ra
    join kitluy_auth.assignment_scopes s on s.role_assignment_id = ra.id
    where auth.uid() is not null
      and ra.subject_type = 'user'
      and ra.subject_id = auth.uid()
      and ra.status = 'ACTIVE'
      and ra.valid_from <= now()
      and (ra.valid_to is null or ra.valid_to > now())
      and s.scope_type = 'digital_store'
      and s.scope_id is not null
  )
  select case
    when exists (select 1 from store_scopes) then
      coalesce(
        (select array_agg(ds.id)
         from kitluy_core.digital_stores ds
         join store_scopes ss on ss.scope_id = ds.id
         where ds.status not in ('SUSPENDED', 'CLOSED')),
        '{}'::uuid[])
    else
      coalesce(
        (select array_agg(ds.id)
         from kitluy_core.digital_stores ds
         where ds.tenant_id = any (kitluy_auth.current_tenant_ids())
           and ds.status not in ('SUSPENDED', 'CLOSED')),
        '{}'::uuid[])
  end;
$$;

comment on function kitluy_auth.current_digital_store_ids() is
  'Authorized Digital Stores after assignment-scope evaluation. A user holding explicit digital_store scopes is confined to them (Store scope never implies sibling Stores — RLS-008); otherwise tenant-level membership grants the tenant Stores. Suspended/closed Stores excluded. Exclusion-set evaluation completes in group 0130.';

create or replace function kitluy_auth.current_location_ids()
returns uuid[]
language sql
stable
security definer
set search_path = kitluy_core, kitluy_auth, auth, public
as $$
  with location_scopes as (
    select s.scope_id
    from kitluy_auth.role_assignments ra
    join kitluy_auth.assignment_scopes s on s.role_assignment_id = ra.id
    where auth.uid() is not null
      and ra.subject_type = 'user'
      and ra.subject_id = auth.uid()
      and ra.status = 'ACTIVE'
      and ra.valid_from <= now()
      and (ra.valid_to is null or ra.valid_to > now())
      and s.scope_type = 'store_location'
      and s.scope_id is not null
  )
  select case
    when exists (select 1 from location_scopes) then
      coalesce(
        (select array_agg(sl.id)
         from kitluy_core.store_locations sl
         join location_scopes ls on ls.scope_id = sl.id
         where sl.operating_status not in ('SUSPENDED', 'CLOSED')),
        '{}'::uuid[])
    else
      coalesce(
        (select array_agg(sl.id)
         from kitluy_core.store_locations sl
         where sl.digital_store_id = any (kitluy_auth.current_digital_store_ids())
           and sl.operating_status not in ('SUSPENDED', 'CLOSED')),
        '{}'::uuid[])
  end;
$$;

comment on function kitluy_auth.current_location_ids() is
  'Authorized Store Locations after scope evaluation. A user holding explicit store_location scopes is confined to them (Location scope never implies sibling Locations — RLS-007); otherwise Locations of the authorized Digital Stores. Exclusion-set evaluation completes in group 0130.';

create or replace function kitluy_auth.has_permission(
  p_permission_key text,
  p_resource_type text default null,
  p_resource_id uuid default null,
  p_environment text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = kitluy_auth, kitluy_core, auth, public
as $$
declare
  v_denied boolean;
  v_allowed boolean;
begin
  -- Fail closed on unresolved actor or missing key.
  if auth.uid() is null or p_permission_key is null or length(trim(p_permission_key)) = 0 then
    return false;
  end if;

  -- Disabled/suspended profile denies (RLS-011); absence of an HET profile does not.
  if exists (
    select 1 from kitluy_auth.admin_user_profiles p
    where p.user_id = auth.uid()
      and (p.disabled_at is not null or p.status <> 'ACTIVE')
  ) then
    return false;
  end if;

  -- Explicit DENY precedence.
  select exists (
    select 1
    from kitluy_auth.role_assignments ra
    join kitluy_auth.role_permission_grants g on g.role_template_id = ra.role_template_id
    join kitluy_auth.permissions perm on perm.id = g.permission_id
    where ra.subject_type = 'user'
      and ra.subject_id = auth.uid()
      and ra.status = 'ACTIVE'
      and ra.valid_from <= now()
      and (ra.valid_to is null or ra.valid_to > now())
      and g.effect = 'DENY'
      and perm.permission_key = p_permission_key
  ) into v_denied;
  if v_denied then
    return false;
  end if;

  -- ALLOW via an active, in-window role assignment on an ACTIVE permission version,
  -- with environment gating when an environment is asserted (RLS-022 fails closed).
  select exists (
    select 1
    from kitluy_auth.role_assignments ra
    join kitluy_auth.role_permission_grants g on g.role_template_id = ra.role_template_id
    join kitluy_auth.permissions perm on perm.id = g.permission_id
    where ra.subject_type = 'user'
      and ra.subject_id = auth.uid()
      and ra.status = 'ACTIVE'
      and ra.valid_from <= now()
      and (ra.valid_to is null or ra.valid_to > now())
      and g.effect = 'ALLOW'
      and perm.permission_key = p_permission_key
      and perm.status = 'ACTIVE'
      and (
        p_environment is null
        or exists (
          select 1 from kitluy_auth.assignment_scopes s
          where s.role_assignment_id = ra.id
            and s.environment in (p_environment, 'all')
        )
      )
  ) into v_allowed;
  if v_allowed then
    return true;
  end if;

  -- Time-boxed temporary grant (environment-exact; never widens across environments).
  return exists (
    select 1 from kitluy_auth.temporary_grants tg
    where tg.subject_id = auth.uid()
      and tg.permission_key = p_permission_key
      and tg.starts_at <= now()
      and tg.expires_at > now()
      and (p_environment is null or tg.environment = p_environment)
  );
end;
$$;

comment on function kitluy_auth.has_permission(text, text, uuid, text) is
  'Fail-closed effective permission evaluation: identity status, deny precedence, active permission version, validity window, environment gating and temporary grants. Full resource-scope/exclusion/SoD evaluation per the resource scope model completes in group 0130; unknown keys, expired assignments and missing environment grants fail closed (RLS-017/RLS-022).';

create or replace function kitluy_auth.assert_permission(
  p_permission_key text,
  p_resource_type text default null,
  p_resource_id uuid default null,
  p_environment text default null
)
returns void
language plpgsql
stable
security definer
set search_path = kitluy_auth, kitluy_core, auth, public
as $$
begin
  if not kitluy_auth.has_permission(p_permission_key, p_resource_type, p_resource_id, p_environment) then
    raise exception 'KLUY-AUTH-PERMISSION-DENIED'
      using errcode = 'P0001',
            hint = 'Permission evaluation failed closed. Generic error by design: no existence or scope disclosure.';
  end if;
end;
$$;

comment on function kitluy_auth.assert_permission(text, text, uuid, text) is
  'has_permission that raises a stable KLUY-AUTH-* error; called at the top of every command RPC (group 0130). Error is generic — no existence, ID, count or status disclosure (RLS-003/RLS-026).';

create or replace function kitluy_auth.require_reauthentication(p_max_age_seconds integer)
returns boolean
language sql
stable
security definer
set search_path = kitluy_auth, auth, public
as $$
  select coalesce(
    (select p.last_reauth_at >= now() - make_interval(secs => p_max_age_seconds)
     from kitluy_auth.admin_user_profiles p
     where p.user_id = auth.uid()
       and p.status = 'ACTIVE'
       and p.disabled_at is null),
    false);
$$;

comment on function kitluy_auth.require_reauthentication(integer) is
  'Verifies a fresh approved re-authentication event for A2-A4 sensitive actions. Fail-closed false when the actor is unresolved, has no profile, is disabled, or the last re-authentication is older than the allowed age.';

create or replace function kitluy_auth.consume_execution_token(
  p_token text,
  p_payload_hash text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = kitluy_auth, public
as $$
declare
  v_id uuid;
begin
  update kitluy_auth.execution_tokens
     set used_at = now()
   where token_hash = encode(digest(p_token, 'sha256'), 'hex')
     and payload_hash = p_payload_hash
     and used_at is null
     and revoked_at is null
     and expires_at > now()
  returning id into v_id;

  if v_id is null then
    raise exception 'KLUY-AUTH-EXECUTION-TOKEN-INVALID'
      using errcode = 'P0001',
            hint = 'Token unknown, expired, revoked, already used, or payload hash mismatch.';
  end if;
  return v_id;
end;
$$;

comment on function kitluy_auth.consume_execution_token(text, text) is
  'Atomic single-use consumption of an A3/A4 execution token bound to the exact payload hash. The raw token is hashed before comparison; raw tokens are never stored (schema spec 2.3).';

create or replace function kitluy_auth.record_authorization_decision(
  p_actor_type text,
  p_actor_id uuid,
  p_permission_key text,
  p_resource_type text,
  p_resource_id uuid,
  p_environment text,
  p_result text,
  p_reason_code text default null,
  p_request_id text default null,
  p_tenant_id uuid default null,
  p_scope_snapshot jsonb default null
)
returns void
language plpgsql
volatile
security definer
set search_path = kitluy_auth, public
as $$
begin
  insert into kitluy_auth.authorization_decisions (
    actor_type, actor_id, permission_key, resource_type, resource_id,
    environment, result, reason_code, request_id, tenant_id, scope_snapshot
  ) values (
    coalesce(p_actor_type, 'unknown'), p_actor_id, p_permission_key,
    p_resource_type, p_resource_id, coalesce(p_environment, 'unknown'),
    p_result, p_reason_code, p_request_id, p_tenant_id, p_scope_snapshot
  );
end;
$$;

comment on function kitluy_auth.record_authorization_decision(text, uuid, text, text, uuid, text, text, text, text, uuid, jsonb) is
  'Append-only allow/deny evidence into kitluy_auth.authorization_decisions. Callers must redact secrets before invoking; the scope snapshot is metadata only.';

-- ===========================================================================
-- 2. Integrity trigger functions (Owner: Security; functions contract)
-- ===========================================================================

create or replace function kitluy_auth.enforce_append_only()
returns trigger
language plpgsql
set search_path = kitluy_auth, public
as $$
begin
  -- Review RV-201 (WS-04-T002): unconditional rejection. Under SECURITY
  -- DEFINER current_user was always the definer, making the maintenance
  -- carve-out permit everything — append-only means NOBODY mutates through
  -- ordinary SQL; corrections are compensating INSERTs, and any approved
  -- operator repair uses an explicit governed procedure that disables the
  -- trigger inside its own audited transaction.
  raise exception 'KLUY-AUTH-APPEND-ONLY: % rejected on %.% (append-only evidence; corrections are compensating records)',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'P0001';
end;
$$;

comment on function kitluy_auth.enforce_append_only() is
  'Unconditionally rejects UPDATE/DELETE on append-only ledgers/evidence (I3; review RV-201). Governed operator repairs must disable the trigger explicitly inside an audited transaction.';

create or replace function kitluy_auth.enforce_four_eyes_decision()
returns trigger
language plpgsql
security definer
set search_path = kitluy_auth, public
as $$
declare
  v_requester uuid;
begin
  select r.requester_id into v_requester
  from kitluy_auth.approval_requests r
  where r.id = new.approval_request_id;

  if v_requester is null then
    raise exception 'KLUY-AUTH-APPROVAL-REQUEST-UNKNOWN'
      using errcode = 'P0001';
  end if;
  if new.approver_id = v_requester then
    raise exception 'KLUY-AUTH-SELF-APPROVAL-DENIED: the requester cannot approve their own action (four-eyes, RLS-021 / KLSEC-026)'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function kitluy_auth.enforce_four_eyes_decision() is
  'DB-enforced four-eyes: an approval decision whose approver equals the approval-request requester is rejected at the database layer regardless of caller (RLS-021, KLSEC-026, SoD policy). Fires on INSERT and UPDATE.';

-- Four-eyes trigger on immutable approver decisions.
create trigger trg_approval_decisions_four_eyes
  before insert or update on kitluy_auth.approval_decisions
  for each row execute function kitluy_auth.enforce_four_eyes_decision();

-- Append-only guards (BEFORE UPDATE OR DELETE) on every A/O table of groups 0010-0030.
create trigger trg_append_only_digital_store_location_links
  before update or delete on kitluy_core.digital_store_location_links
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_readiness_results
  before update or delete on kitluy_admin.readiness_results
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_go_live_approvals
  before update or delete on kitluy_admin.go_live_approvals
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_platform_incident_events
  before update or delete on kitluy_admin.platform_incident_events
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_support_interventions
  before update or delete on kitluy_admin.support_interventions
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_approval_decisions
  before update or delete on kitluy_auth.approval_decisions
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_authorization_decisions
  before update or delete on kitluy_auth.authorization_decisions
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_audit_logs
  before update or delete on kitluy_audit.audit_logs
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_sensitive_action_approvals
  before update or delete on kitluy_audit.sensitive_action_approvals
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_access_reviews
  before update or delete on kitluy_audit.access_reviews
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_access_review_items
  before update or delete on kitluy_audit.access_review_items
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_evidence_packages
  before update or delete on kitluy_audit.evidence_packages
  for each row execute function kitluy_auth.enforce_append_only();

-- ===========================================================================
-- 3. RLS enablement: ENABLE + FORCE on every group 0010-0030 table
--    (fail-closed deny-all baseline; a table without a policy row below denies
--    every command — RLS spec section 4 global defaults, RLS-028).
-- ===========================================================================

alter table kitluy_core.tenants enable row level security;
alter table kitluy_core.tenants force row level security;
alter table kitluy_core.partner_accounts enable row level security;
alter table kitluy_core.partner_accounts force row level security;
alter table kitluy_core.memberships enable row level security;
alter table kitluy_core.memberships force row level security;
alter table kitluy_core.plans enable row level security;
alter table kitluy_core.plans force row level security;
alter table kitluy_core.feature_flags enable row level security;
alter table kitluy_core.feature_flags force row level security;
alter table kitluy_core.reference_values enable row level security;
alter table kitluy_core.reference_values force row level security;
alter table kitluy_core.reference_value_translations enable row level security;
alter table kitluy_core.reference_value_translations force row level security;
alter table kitluy_core.digital_stores enable row level security;
alter table kitluy_core.digital_stores force row level security;
alter table kitluy_core.store_locations enable row level security;
alter table kitluy_core.store_locations force row level security;
alter table kitluy_core.digital_store_location_links enable row level security;
alter table kitluy_core.digital_store_location_links force row level security;

alter table kitluy_admin.crm_leads enable row level security;
alter table kitluy_admin.crm_leads force row level security;
alter table kitluy_admin.partner_verification_cases enable row level security;
alter table kitluy_admin.partner_verification_cases force row level security;
alter table kitluy_admin.onboarding_workspaces enable row level security;
alter table kitluy_admin.onboarding_workspaces force row level security;
alter table kitluy_admin.readiness_policies enable row level security;
alter table kitluy_admin.readiness_policies force row level security;
alter table kitluy_admin.readiness_results enable row level security;
alter table kitluy_admin.readiness_results force row level security;
alter table kitluy_admin.go_live_approvals enable row level security;
alter table kitluy_admin.go_live_approvals force row level security;
alter table kitluy_admin.support_tickets enable row level security;
alter table kitluy_admin.support_tickets force row level security;
alter table kitluy_admin.support_access_sessions enable row level security;
alter table kitluy_admin.support_access_sessions force row level security;
alter table kitluy_admin.support_interventions enable row level security;
alter table kitluy_admin.support_interventions force row level security;
alter table kitluy_admin.platform_incidents enable row level security;
alter table kitluy_admin.platform_incidents force row level security;
alter table kitluy_admin.platform_incident_events enable row level security;
alter table kitluy_admin.platform_incident_events force row level security;
alter table kitluy_admin.safety_switches enable row level security;
alter table kitluy_admin.safety_switches force row level security;

alter table kitluy_auth.admin_user_profiles enable row level security;
alter table kitluy_auth.admin_user_profiles force row level security;
alter table kitluy_auth.teams enable row level security;
alter table kitluy_auth.teams force row level security;
alter table kitluy_auth.team_memberships enable row level security;
alter table kitluy_auth.team_memberships force row level security;
alter table kitluy_auth.permissions enable row level security;
alter table kitluy_auth.permissions force row level security;
alter table kitluy_auth.role_templates enable row level security;
alter table kitluy_auth.role_templates force row level security;
alter table kitluy_auth.role_permission_grants enable row level security;
alter table kitluy_auth.role_permission_grants force row level security;
alter table kitluy_auth.role_assignments enable row level security;
alter table kitluy_auth.role_assignments force row level security;
alter table kitluy_auth.assignment_scopes enable row level security;
alter table kitluy_auth.assignment_scopes force row level security;
alter table kitluy_auth.separation_of_duties_rules enable row level security;
alter table kitluy_auth.separation_of_duties_rules force row level security;
alter table kitluy_auth.approval_policies enable row level security;
alter table kitluy_auth.approval_policies force row level security;
alter table kitluy_auth.access_requests enable row level security;
alter table kitluy_auth.access_requests force row level security;
alter table kitluy_auth.approval_requests enable row level security;
alter table kitluy_auth.approval_requests force row level security;
alter table kitluy_auth.approval_decisions enable row level security;
alter table kitluy_auth.approval_decisions force row level security;
alter table kitluy_auth.execution_tokens enable row level security;
alter table kitluy_auth.execution_tokens force row level security;
alter table kitluy_auth.temporary_grants enable row level security;
alter table kitluy_auth.temporary_grants force row level security;
alter table kitluy_auth.break_glass_sessions enable row level security;
alter table kitluy_auth.break_glass_sessions force row level security;
alter table kitluy_auth.service_identities enable row level security;
alter table kitluy_auth.service_identities force row level security;
alter table kitluy_auth.authorization_decisions enable row level security;
alter table kitluy_auth.authorization_decisions force row level security;
alter table kitluy_auth.authorization_decisions_default enable row level security;
alter table kitluy_auth.authorization_decisions_default force row level security;

alter table kitluy_audit.audit_logs enable row level security;
alter table kitluy_audit.audit_logs force row level security;
alter table kitluy_audit.sensitive_action_approvals enable row level security;
alter table kitluy_audit.sensitive_action_approvals force row level security;
alter table kitluy_audit.access_reviews enable row level security;
alter table kitluy_audit.access_reviews force row level security;
alter table kitluy_audit.access_review_items enable row level security;
alter table kitluy_audit.access_review_items force row level security;
alter table kitluy_audit.evidence_packages enable row level security;
alter table kitluy_audit.evidence_packages force row level security;

-- ===========================================================================
-- 4. Privileges. anon and PUBLIC receive nothing on any kitluy_* object.
--    authenticated receives SELECT only (RLS filters rows); writes stay
--    RPC-only. service_role holds BYPASSRLS in Supabase and is confined by the
--    service-role safety register (RLS spec section 7), never a generic bypass.
-- ===========================================================================

revoke all on schema kitluy_core, kitluy_auth, kitluy_admin, kitluy_audit from public;

grant usage on schema kitluy_core, kitluy_auth, kitluy_admin, kitluy_audit
  to authenticated, service_role;

grant select on all tables in schema kitluy_core to authenticated;
grant select on all tables in schema kitluy_auth to authenticated;
grant select on all tables in schema kitluy_admin to authenticated;
grant select on all tables in schema kitluy_audit to authenticated;

-- Execution tokens are server-consumed only: SELECT is PROHIBITED for clients.
revoke select on kitluy_auth.execution_tokens from authenticated;

grant select, insert, update on all tables in schema kitluy_core to service_role;
grant select, insert, update on all tables in schema kitluy_auth to service_role;
grant select, insert, update on all tables in schema kitluy_admin to service_role;
grant select, insert, update on all tables in schema kitluy_audit to service_role;

-- Helper functions: EXECUTE revoked from PUBLIC and anon; granted to
-- authenticated (policy predicates) and service_role (RPC layer).
revoke all on all functions in schema kitluy_auth from public, anon;

grant execute on function kitluy_auth.current_actor_context() to authenticated, service_role;
grant execute on function kitluy_auth.current_tenant_ids() to authenticated, service_role;
grant execute on function kitluy_auth.current_digital_store_ids() to authenticated, service_role;
grant execute on function kitluy_auth.current_location_ids() to authenticated, service_role;
grant execute on function kitluy_auth.has_permission(text, text, uuid, text) to authenticated, service_role;
grant execute on function kitluy_auth.assert_permission(text, text, uuid, text) to authenticated, service_role;
grant execute on function kitluy_auth.require_reauthentication(integer) to authenticated, service_role;
grant execute on function kitluy_auth.consume_execution_token(text, text) to service_role;
grant execute on function kitluy_auth.record_authorization_decision(text, uuid, text, text, uuid, text, text, text, text, uuid, jsonb) to service_role;

-- ===========================================================================
-- 5. Policies (RLS spec section 5 matrices). SELECT-only; TO authenticated.
--    anon: no policy anywhere. INSERT/UPDATE/DELETE: no policy anywhere
--    (PC-RPC/PC-AO/PROHIBITED — fail closed until group 0130 RPCs).
-- ===========================================================================

-- 5.1 kitluy_core -----------------------------------------------------------

create policy tenants_select_scoped on kitluy_core.tenants
  for select to authenticated
  using (
    id = any (kitluy_auth.current_tenant_ids())
    or kitluy_auth.has_permission('partners.read', 'tenant', id, null)
  );

create policy partner_accounts_select_scoped on kitluy_core.partner_accounts
  for select to authenticated
  using (
    tenant_id = any (kitluy_auth.current_tenant_ids())
    or kitluy_auth.has_permission('partners.read', 'tenant', tenant_id, null)
  );

create policy memberships_select_tenant on kitluy_core.memberships
  for select to authenticated
  using (tenant_id = any (kitluy_auth.current_tenant_ids()));

create policy plans_select_reference on kitluy_core.plans
  for select to authenticated
  using (true);

create policy feature_flags_select_platform on kitluy_core.feature_flags
  for select to authenticated
  using (kitluy_auth.has_permission('configuration.read', null, null, null));

create policy reference_values_select_reference on kitluy_core.reference_values
  for select to authenticated
  using (true);

create policy reference_value_translations_select_reference on kitluy_core.reference_value_translations
  for select to authenticated
  using (true);

create policy digital_stores_select_scoped on kitluy_core.digital_stores
  for select to authenticated
  using (id = any (kitluy_auth.current_digital_store_ids()));

create policy store_locations_select_scoped on kitluy_core.store_locations
  for select to authenticated
  using (id = any (kitluy_auth.current_location_ids()));

create policy digital_store_location_links_select_store on kitluy_core.digital_store_location_links
  for select to authenticated
  using (digital_store_id = any (kitluy_auth.current_digital_store_ids()));

-- 5.2 kitluy_auth -----------------------------------------------------------

create policy admin_user_profiles_select_platform on kitluy_auth.admin_user_profiles
  for select to authenticated
  using (kitluy_auth.has_permission('rbac.read', null, null, null));

create policy teams_select_platform on kitluy_auth.teams
  for select to authenticated
  using (kitluy_auth.has_permission('rbac.read', null, null, null));

create policy team_memberships_select_platform on kitluy_auth.team_memberships
  for select to authenticated
  using (kitluy_auth.has_permission('rbac.read', null, null, null));

create policy permissions_select_platform on kitluy_auth.permissions
  for select to authenticated
  using (kitluy_auth.has_permission('rbac.read', null, null, null));

create policy role_templates_select_platform on kitluy_auth.role_templates
  for select to authenticated
  using (kitluy_auth.has_permission('rbac.read', null, null, null));

create policy role_permission_grants_select_platform on kitluy_auth.role_permission_grants
  for select to authenticated
  using (kitluy_auth.has_permission('rbac.read', null, null, null));

create policy role_assignments_select_platform_or_self on kitluy_auth.role_assignments
  for select to authenticated
  using (
    kitluy_auth.has_permission('rbac.read', null, null, null)
    or (subject_type = 'user' and subject_id = auth.uid())
  );

create policy assignment_scopes_select_platform_or_self on kitluy_auth.assignment_scopes
  for select to authenticated
  using (
    kitluy_auth.has_permission('rbac.read', null, null, null)
    or exists (
      select 1 from kitluy_auth.role_assignments ra
      where ra.id = role_assignment_id
        and ra.subject_type = 'user'
        and ra.subject_id = auth.uid()
    )
  );

create policy separation_of_duties_rules_select_platform on kitluy_auth.separation_of_duties_rules
  for select to authenticated
  using (kitluy_auth.has_permission('rbac.read', null, null, null));

create policy approval_policies_select_platform on kitluy_auth.approval_policies
  for select to authenticated
  using (kitluy_auth.has_permission('rbac.read', null, null, null));

create policy access_requests_select_requester_or_platform on kitluy_auth.access_requests
  for select to authenticated
  using (
    requester_id = auth.uid()
    or subject_id = auth.uid()
    or kitluy_auth.has_permission('rbac.read', null, null, null)
  );

create policy approval_requests_select_requester_or_platform on kitluy_auth.approval_requests
  for select to authenticated
  using (
    requester_id = auth.uid()
    or kitluy_auth.has_permission('rbac.read', null, null, null)
  );

create policy approval_decisions_select_audit on kitluy_auth.approval_decisions
  for select to authenticated
  using (kitluy_auth.has_permission('audit.read', null, null, null));

-- kitluy_auth.execution_tokens: NO policy in any command (SELECT PROHIBITED;
-- server-consumed only) — deny-all by RLS.

create policy temporary_grants_select_platform_or_self on kitluy_auth.temporary_grants
  for select to authenticated
  using (
    kitluy_auth.has_permission('rbac.read', null, null, null)
    or subject_id = auth.uid()
  );

create policy break_glass_sessions_select_audit on kitluy_auth.break_glass_sessions
  for select to authenticated
  using (kitluy_auth.has_permission('audit.read', null, null, null));

create policy service_identities_select_platform on kitluy_auth.service_identities
  for select to authenticated
  using (kitluy_auth.has_permission('rbac.read', null, null, null));

create policy authorization_decisions_select_audit on kitluy_auth.authorization_decisions
  for select to authenticated
  using (kitluy_auth.has_permission('audit.read', null, null, null));

-- 5.3 kitluy_admin ----------------------------------------------------------
-- PC-PLATFORM domain read keys (RBAC registry): partners.read for CRM,
-- verification, onboarding and readiness; platform.health.read for incident
-- and safety surfaces; support.ticket.manage for support surfaces (Partner
-- additionally sees own-tenant tickets/sessions).

create policy crm_leads_select_platform on kitluy_admin.crm_leads
  for select to authenticated
  using (kitluy_auth.has_permission('partners.read', null, null, null));

create policy partner_verification_cases_select_platform on kitluy_admin.partner_verification_cases
  for select to authenticated
  using (kitluy_auth.has_permission('partners.read', 'tenant', tenant_id, null));

create policy onboarding_workspaces_select_platform on kitluy_admin.onboarding_workspaces
  for select to authenticated
  using (kitluy_auth.has_permission('partners.read', 'tenant', tenant_id, null));

create policy readiness_policies_select_platform on kitluy_admin.readiness_policies
  for select to authenticated
  using (kitluy_auth.has_permission('partners.read', null, null, null));

create policy readiness_results_select_platform on kitluy_admin.readiness_results
  for select to authenticated
  using (kitluy_auth.has_permission('partners.read', null, null, null));

create policy go_live_approvals_select_platform on kitluy_admin.go_live_approvals
  for select to authenticated
  using (kitluy_auth.has_permission('partners.read', null, null, null));

create policy support_tickets_select_platform_or_tenant on kitluy_admin.support_tickets
  for select to authenticated
  using (
    kitluy_auth.has_permission('support.ticket.manage', null, null, null)
    or tenant_id = any (kitluy_auth.current_tenant_ids())
  );

create policy support_access_sessions_select_platform_or_tenant on kitluy_admin.support_access_sessions
  for select to authenticated
  using (
    kitluy_auth.has_permission('support.ticket.manage', null, null, null)
    or exists (
      select 1 from kitluy_admin.support_tickets t
      where t.id = ticket_id
        and t.tenant_id = any (kitluy_auth.current_tenant_ids())
    )
  );

create policy support_interventions_select_platform on kitluy_admin.support_interventions
  for select to authenticated
  using (kitluy_auth.has_permission('support.ticket.manage', null, null, null));

create policy platform_incidents_select_platform on kitluy_admin.platform_incidents
  for select to authenticated
  using (kitluy_auth.has_permission('platform.health.read', null, null, null));

create policy platform_incident_events_select_platform on kitluy_admin.platform_incident_events
  for select to authenticated
  using (kitluy_auth.has_permission('platform.health.read', null, null, null));

create policy safety_switches_select_platform on kitluy_admin.safety_switches
  for select to authenticated
  using (kitluy_auth.has_permission('platform.health.read', null, null, null));

-- 5.21 kitluy_audit ---------------------------------------------------------

create policy audit_logs_select_audit on kitluy_audit.audit_logs
  for select to authenticated
  using (kitluy_auth.has_permission('audit.read', null, null, null));

create policy sensitive_action_approvals_select_audit on kitluy_audit.sensitive_action_approvals
  for select to authenticated
  using (kitluy_auth.has_permission('audit.read', null, null, null));

create policy access_reviews_select_audit on kitluy_audit.access_reviews
  for select to authenticated
  using (kitluy_auth.has_permission('audit.read', null, null, null));

create policy access_review_items_select_audit on kitluy_audit.access_review_items
  for select to authenticated
  using (kitluy_auth.has_permission('audit.read', null, null, null));

create policy evidence_packages_select_audit on kitluy_audit.evidence_packages
  for select to authenticated
  using (kitluy_auth.has_permission('audit.read', null, null, null));

-- Manifest: 44 SELECT policies (kitluy_core 10, kitluy_auth 17, kitluy_admin 12,
-- kitluy_audit 5); 0 INSERT/UPDATE/DELETE policies; 0 anon policies;
-- 46 relations RLS ENABLE+FORCE (45 tables + authorization_decisions_default);
-- 9 helper functions; 2 trigger functions; 13 triggers (12 append-only + 1 four-eyes).
-- Asserted by supabase/tests/assertions.sql.

commit;

-- Review RV-202 (WS-04-T002): service_role must not hold UPDATE/DELETE on
-- append-only evidence tables (defense in depth alongside the trigger).
do $$
declare
  r record;
begin
  for r in
    select tgrelid::regclass as tbl
    from pg_trigger
    where tgname = 'trg_append_only'
  loop
    execute format('revoke update, delete on %s from service_role', r.tbl);
  end loop;
end $$;
