-- kitluy:group:0030
-- Migration group 0030: authz_and_audit (WS-04-T002).
-- Contents per docs/data/kitluy-suite-supabase-migration-plan-v1.0.0.md section 2:
--   kitluy_admin (incidents first — kitluy_auth.break_glass_sessions FKs
--   kitluy_admin.platform_incidents), then kitluy_auth (all), then kitluy_audit (all).
--   kitluy_admin.safety_switches FK to kitluy_auth.approval_requests is added after
--   kitluy_auth is created (single transaction, so a plain ADD CONSTRAINT is safe).
-- Column contract: docs/source/data-contracts/kitluy-suite-supabase-data-dictionary-v1.0.0.md
-- Status: SCAFFOLDED. Execution BLOCKED (BLK-002: Docker and Supabase CLI absent).
-- Statically validated only; NOT applied anywhere; no application is claimed.
-- Production application is human-operated with four-eyes approval, never automatic
-- (KL-INF-P1-037, OWNER-LOCKED). Purely additive: no destructive statements.
-- RBAC registry content (107 permission keys, role templates, approval policies,
-- SoD rules) is SEED data (group 0150), not DDL (plan group 0030 Backfill note).
-- Append-only guard triggers and the four-eyes decision trigger attach in
-- 20260726190035_0035 together with RLS enablement and policies.

begin;

-- ===========================================================================
-- Schema: kitluy_admin (Owner: Admin Portal)
-- ===========================================================================
create schema if not exists kitluy_admin;

comment on schema kitluy_admin is
  'Owner: Admin Portal. HET CRM, verification, onboarding, readiness, support, incidents and privileged operations. Ref: kitluy-suite-supabase-data-dictionary-v1.0.0.md';

create table if not exists kitluy_admin.platform_incidents (
  id uuid primary key default gen_random_uuid(),
  incident_code text not null,
  severity text not null,
  status text not null,
  impact text,
  commander_id uuid references auth.users (id),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  review_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_incidents_incident_code_key unique (incident_code)
);

comment on table kitluy_admin.platform_incidents is
  'Owner: Admin Portal. Incident command record. Timeline/history is append-only via platform_incident_events. MC: MUT.';

create table if not exists kitluy_admin.platform_incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references kitluy_admin.platform_incidents (id),
  event_type text not null,
  actor_id uuid references auth.users (id),
  message text,
  occurred_at timestamptz not null default now()
);

comment on table kitluy_admin.platform_incident_events is
  'Owner: Admin Portal. Incident timeline. Append-only (enforce_append_only attaches in 0035; no UPDATE/DELETE policies ever). MC: A/O.';

create table if not exists kitluy_admin.crm_leads (
  id uuid primary key default gen_random_uuid(),
  source_code text,
  company_name text not null,
  contact_name text,
  contact_phone text,
  owner_user_id uuid references auth.users (id),
  status text not null,
  next_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table kitluy_admin.crm_leads is
  'Owner: Admin Portal. Lead pipeline. Invariant: no operational Tenant authority until conversion. Status vocabulary registry-governed (seeded in 0150). MC: MUT.';

create table if not exists kitluy_admin.partner_verification_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  status text not null default 'PENDING',
  reviewer_id uuid references auth.users (id),
  reason_code text,
  evidence_summary text,
  opened_at timestamptz not null default now(),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_verification_cases_status_check check (
    status in ('NOT_STARTED', 'PENDING', 'NEEDS_INFORMATION', 'APPROVED', 'REJECTED', 'SUSPENDED')
  )
);

-- One active (undecided) case per tenant unless exception.
create unique index if not exists partner_verification_cases_active_tenant_key
  on kitluy_admin.partner_verification_cases (tenant_id)
  where decided_at is null;

comment on table kitluy_admin.partner_verification_cases is
  'Owner: Admin Portal. Partner verification workflow. One active case per tenant (partial unique). Decisions require reason/evidence and audit; decided rows are treated as evidence. Vocabulary: enum registry partner_verification_status. MC: MUT (decisions A/O).';

create table if not exists kitluy_admin.onboarding_workspaces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid references kitluy_core.digital_stores (id),
  store_location_id uuid references kitluy_core.store_locations (id),
  owner_id uuid references auth.users (id),
  progress_state text not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onboarding_workspaces_version_check check (version >= 1)
);

comment on table kitluy_admin.onboarding_workspaces is
  'Owner: Admin Portal. Guided onboarding aggregate. Invariant: Digital Store is created before optional physical Location (KLD-2026-07-20-001). MC: CFG-V.';

create table if not exists kitluy_admin.readiness_policies (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null,
  version bigint not null,
  subject_type text not null,
  blocker boolean not null default false,
  evaluator_key text,
  status text not null,
  created_at timestamptz not null default now(),
  constraint readiness_policies_key_version_key unique (policy_key, version),
  constraint readiness_policies_version_check check (version >= 1)
);

comment on table kitluy_admin.readiness_policies is
  'Owner: Admin Portal. Versioned readiness checks. Policy version is stored with every result. MC: IMM-V.';

create table if not exists kitluy_admin.readiness_results (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id uuid not null,
  policy_id uuid not null references kitluy_admin.readiness_policies (id),
  status text not null,
  source_ref text,
  as_of timestamptz,
  evidence_file_id uuid,
  evaluated_at timestamptz not null default now()
);

comment on table kitluy_admin.readiness_results is
  'Owner: Admin Portal. Evidence-backed readiness result. History retained; append-only (enforce_append_only in 0035). Never claim ready from stale/incomplete inputs. evidence_file_id is a plain uuid; FK to kitluy_files.file_objects is added NOT VALID in group 0100 (plan rule R4). MC: A/O.';

create table if not exists kitluy_admin.go_live_approvals (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id uuid not null,
  requester_id uuid not null references auth.users (id),
  approver_id uuid not null references auth.users (id),
  decision text not null,
  evidence_package_id uuid,
  decided_at timestamptz not null default now(),
  constraint go_live_approvals_four_eyes_check check (approver_id <> requester_id)
);

comment on table kitluy_admin.go_live_approvals is
  'Owner: Admin Portal. Pilot/go-live approval. DB-enforced four-eyes: CHECK approver_id <> requester_id. Append-only and environment-specific. MC: A/O.';

create table if not exists kitluy_admin.support_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references kitluy_core.tenants (id),
  digital_store_id uuid references kitluy_core.digital_stores (id),
  store_location_id uuid references kitluy_core.store_locations (id),
  priority text not null,
  status text not null,
  assignee_id uuid references auth.users (id),
  sla_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_tenant_id_idx
  on kitluy_admin.support_tickets (tenant_id);

comment on table kitluy_admin.support_tickets is
  'Owner: Admin Portal. Support case lifecycle. Invariant: support does not imply unrestricted access (consent-scoped sessions gate actual access). MC: MUT.';

create table if not exists kitluy_admin.support_access_sessions (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references kitluy_admin.support_tickets (id),
  consent_ref text not null,
  scope jsonb not null,
  purpose text not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint support_access_sessions_expiry_check check (expires_at > starts_at)
);

comment on table kitluy_admin.support_access_sessions is
  'Owner: Admin Portal. Consent-scoped support access. Time-bound (expires_at required), revocable, audited (RLS-019/RLS-020). Partner consent is mandatory. MC: MUT (revoke/expire only).';

create table if not exists kitluy_admin.support_interventions (
  id uuid primary key default gen_random_uuid(),
  support_access_session_id uuid not null references kitluy_admin.support_access_sessions (id),
  actor_id uuid not null references auth.users (id),
  action text not null,
  resource text,
  outcome text,
  occurred_at timestamptz not null default now()
);

comment on table kitluy_admin.support_interventions is
  'Owner: Admin Portal. Append-only support actions; no hidden impersonation. enforce_append_only attaches in 0035. MC: A/O.';

create table if not exists kitluy_admin.safety_switches (
  id uuid primary key default gen_random_uuid(),
  switch_key text not null,
  scope text not null,
  environment text not null,
  state text not null,
  reason text,
  approval_request_id uuid,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_switches_key_scope_env_key unique (switch_key, scope, environment),
  constraint safety_switches_version_check check (version >= 1)
);

comment on table kitluy_admin.safety_switches is
  'Owner: Admin Portal. Emergency platform controls. Sensitive production changes require approval (approval_request_id FK added below, after kitluy_auth.approval_requests exists) and audit. MC: CFG-V.';

-- ===========================================================================
-- Schema: kitluy_auth (Owner: Security)
-- ===========================================================================
create schema if not exists kitluy_auth;

comment on schema kitluy_auth is
  'Owner: Security. Teams, permissions, role templates, assignments, scopes, approvals, service identities and authorization evidence. Ref: kitluy-suite-supabase-data-dictionary-v1.0.0.md';

create table if not exists kitluy_auth.admin_user_profiles (
  user_id uuid primary key references auth.users (id),
  status text not null,
  assurance_level text,
  last_reauth_at timestamptz,
  disabled_at timestamptz,
  security_metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table kitluy_auth.admin_user_profiles is
  'Owner: Security. HET user eligibility/security state; user_id references auth.users(id). Eligibility is separate from role assignment. MC: MUT.';

create table if not exists kitluy_auth.teams (
  id uuid primary key default gen_random_uuid(),
  team_key text not null,
  name text not null,
  owner_user_id uuid references auth.users (id),
  status text not null,
  review_cadence_days integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_team_key_key unique (team_key)
);

comment on table kitluy_auth.teams is
  'Owner: Security. Organizational teams. Teams organize assignments; they are never the final authorization decision. MC: MUT.';

create table if not exists kitluy_auth.team_memberships (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references kitluy_auth.teams (id),
  user_id uuid not null references auth.users (id),
  status text not null default 'ACTIVE',
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  review_due_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint team_memberships_status_check check (
    status in ('INVITED', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED')
  ),
  constraint team_memberships_validity_check check (valid_to is null or valid_to > valid_from)
);

create unique index if not exists team_memberships_active_team_user_key
  on kitluy_auth.team_memberships (team_id, user_id)
  where status = 'ACTIVE';

comment on table kitluy_auth.team_memberships is
  'Owner: Security. Explicit user-to-team membership. UNIQUE active (team_id, user_id) via partial index; expired membership must not authorize. Status vocabulary: enum registry membership_status. MC: MUT.';

create table if not exists kitluy_auth.permissions (
  id uuid primary key default gen_random_uuid(),
  permission_key text not null,
  version bigint not null,
  risk_class text not null,
  resource_types text[] not null default '{}',
  environments text[] not null default '{}',
  status text not null,
  created_at timestamptz not null default now(),
  constraint permissions_key_version_key unique (permission_key, version),
  constraint permissions_risk_class_check check (
    risk_class in ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')
  ),
  constraint permissions_version_check check (version >= 1)
);

comment on table kitluy_auth.permissions is
  'Owner: Security. Central permission registry (content = RBAC permission registry, 107 keys, seeded in group 0150). Permission keys are immutable once released. Risk vocabulary: enum registry permission_risk_class. MC: IMM-V.';

create table if not exists kitluy_auth.role_templates (
  id uuid primary key default gen_random_uuid(),
  role_key text not null,
  version bigint not null,
  name text not null,
  system_role boolean not null default false,
  status text not null,
  effective_from timestamptz,
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  constraint role_templates_key_version_key unique (role_key, version),
  constraint role_templates_version_check check (version >= 1)
);

comment on table kitluy_auth.role_templates is
  'Owner: Security. Versioned role template header. Assignments bind to an explicit version. MC: IMM-V.';

create table if not exists kitluy_auth.role_permission_grants (
  id uuid primary key default gen_random_uuid(),
  role_template_id uuid not null references kitluy_auth.role_templates (id),
  permission_id uuid not null references kitluy_auth.permissions (id),
  effect text not null default 'ALLOW',
  constraint_set_id uuid,
  created_at timestamptz not null default now(),
  constraint role_permission_grants_template_permission_key unique (role_template_id, permission_id),
  constraint role_permission_grants_effect_check check (effect in ('ALLOW', 'DENY'))
);

comment on table kitluy_auth.role_permission_grants is
  'Owner: Security. Permissions in a role version. Deny precedence is explicit (effect DENY wins in evaluation). MC: IMM-V.';

create table if not exists kitluy_auth.role_assignments (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id uuid not null,
  team_id uuid references kitluy_auth.teams (id),
  role_template_id uuid not null references kitluy_auth.role_templates (id),
  status text not null default 'ACTIVE',
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  review_due_at timestamptz,
  granted_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint role_assignments_validity_check check (valid_to is null or valid_to > valid_from)
);

-- No overlapping duplicate active assignment for the same subject and role version.
create unique index if not exists role_assignments_active_subject_role_key
  on kitluy_auth.role_assignments (subject_type, subject_id, role_template_id)
  where status = 'ACTIVE';

create index if not exists role_assignments_subject_idx
  on kitluy_auth.role_assignments (subject_type, subject_id);

comment on table kitluy_auth.role_assignments is
  'Owner: Security. Subject role assignment. No overlapping duplicate active assignment (partial unique). Assignment without scope is invalid except approved global platform roles (evaluated in helpers/RPCs). MC: MUT.';

create table if not exists kitluy_auth.assignment_scopes (
  id uuid primary key default gen_random_uuid(),
  role_assignment_id uuid not null references kitluy_auth.role_assignments (id),
  scope_type text not null,
  scope_id uuid,
  environment text not null,
  include_descendants boolean not null default false,
  exclusion_set_id uuid,
  created_at timestamptz not null default now()
);

-- UNIQUE (role_assignment_id, scope_type, scope_id, environment); scope_id is NULL
-- for platform-wide scope and is coalesced so NULL rows also collide.
create unique index if not exists assignment_scopes_unique_scope_key
  on kitluy_auth.assignment_scopes (
    role_assignment_id,
    scope_type,
    coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
    environment
  );

comment on table kitluy_auth.assignment_scopes is
  'Owner: Security. Resource/environment scope for a role assignment. Tenant/Store/Location isolation remains enforced by RLS regardless of UI. MC: MUT.';

create table if not exists kitluy_auth.separation_of_duties_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null,
  version bigint not null,
  left_permission_key text not null,
  right_permission_key text not null,
  treatment text not null,
  status text not null,
  effective_from timestamptz,
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  constraint separation_of_duties_rules_key_version_key unique (rule_key, version),
  constraint separation_of_duties_rules_treatment_check check (
    treatment in ('NONE', 'REAUTH', 'SINGLE_APPROVER', 'FOUR_EYES', 'BREAK_GLASS_ONLY')
  ),
  constraint separation_of_duties_rules_version_check check (version >= 1)
);

comment on table kitluy_auth.separation_of_duties_rules is
  'Owner: Security. Conflicting-role/permission rules. Four-eyes approval cannot be satisfied by requester or conflicted actor. Treatment vocabulary: enum registry approval_treatment. MC: IMM-V.';

create table if not exists kitluy_auth.approval_policies (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null,
  version bigint not null,
  permission_key text not null,
  environment text not null,
  quorum integer not null default 1,
  reauth_required boolean not null default false,
  reason_required boolean not null default true,
  evidence_required boolean not null default false,
  status text not null,
  created_at timestamptz not null default now(),
  constraint approval_policies_key_version_key unique (policy_key, version),
  constraint approval_policies_quorum_check check (quorum >= 1),
  constraint approval_policies_version_check check (version >= 1)
);

comment on table kitluy_auth.approval_policies is
  'Owner: Security. Action approval policy (A0..A4 treatments). Production-sensitive actions require approved policy evaluation. MC: IMM-V.';

create table if not exists kitluy_auth.access_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id),
  subject_id uuid not null,
  requested_role_key text,
  requested_scopes jsonb,
  reason text not null,
  ticket_ref text,
  status text not null default 'PENDING',
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table kitluy_auth.access_requests is
  'Owner: Security. Access request lifecycle. Approval cannot silently widen requested scope. MC: MUT.';

create table if not exists kitluy_auth.approval_requests (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references kitluy_auth.approval_policies (id),
  requester_id uuid not null references auth.users (id),
  resource_type text not null,
  resource_id uuid,
  environment text not null,
  action text not null,
  payload_hash text not null,
  reason text not null,
  status text not null default 'PENDING',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- UNIQUE active (payload_hash, requester_id, action): one open request per exact
-- payload per requester. PENDING is the provisional open-state code pending the
-- 0150 registry seed of the approval lifecycle vocabulary.
create unique index if not exists approval_requests_active_payload_key
  on kitluy_auth.approval_requests (payload_hash, requester_id, action)
  where status = 'PENDING';

comment on table kitluy_auth.approval_requests is
  'Owner: Security. Four-eyes request aggregate. Execution payload must match the approved payload_hash; payload/target/environment change invalidates prior approval. MC: MUT (state machine only).';

create table if not exists kitluy_auth.approval_decisions (
  id uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null references kitluy_auth.approval_requests (id),
  approver_id uuid not null references auth.users (id),
  decision text not null,
  reason text,
  evidence_file_id uuid,
  decided_at timestamptz not null default now(),
  constraint approval_decisions_request_approver_key unique (approval_request_id, approver_id)
);

comment on table kitluy_auth.approval_decisions is
  'Owner: Security. Immutable approver decisions. Append-only; requester cannot approve own action — DB-enforced four-eyes via trigger trg_approval_decisions_four_eyes (0035) comparing approver_id to approval_requests.requester_id; there is no mutable approved flag — approval state derives from these immutable decision rows. evidence_file_id FK deferred to group 0100 (rule R4). MC: A/O.';

create table if not exists kitluy_auth.execution_tokens (
  id uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null references kitluy_auth.approval_requests (id),
  token_hash text not null,
  payload_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint execution_tokens_token_hash_key unique (token_hash)
);

comment on table kitluy_auth.execution_tokens is
  'Owner: Security. Single-use approved execution authority. token_hash only — the raw token is never stored. Single purpose, short lived; consumption is atomic via kitluy_auth.consume_execution_token (0035). SELECT is PROHIBITED for client roles (server-consumed only). MC: A/O.';

create table if not exists kitluy_auth.temporary_grants (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null,
  permission_key text not null,
  scope jsonb,
  environment text not null,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  approver_id uuid references auth.users (id),
  reason text not null,
  created_at timestamptz not null default now(),
  constraint temporary_grants_expiry_check check (expires_at > starts_at)
);

comment on table kitluy_auth.temporary_grants is
  'Owner: Security. Time-limited elevated access. CHECK expires_at > starts_at; automatic expiry and review evidence required. MC: MUT (revoke/expiry only).';

create table if not exists kitluy_auth.break_glass_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users (id),
  incident_id uuid not null references kitluy_admin.platform_incidents (id),
  environment text not null,
  grants jsonb not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  review_status text not null,
  created_at timestamptz not null default now(),
  constraint break_glass_sessions_expiry_check check (expires_at > started_at)
);

-- One active break-glass session per actor/environment.
create unique index if not exists break_glass_sessions_active_actor_env_key
  on kitluy_auth.break_glass_sessions (actor_id, environment)
  where ended_at is null;

comment on table kitluy_auth.break_glass_sessions is
  'Owner: Security. Emergency elevation. Must alert, be incident-bound (FK kitluy_admin.platform_incidents), time-limited and post-reviewed; one active per actor/environment (partial unique). The environment column is required by the schema-spec constraint (one active per actor/environment); the data dictionary column list omits it — recorded deviation, schema spec followed. Activity evidence is append-only. MC: A/O (evidence).';

create table if not exists kitluy_auth.service_identities (
  id uuid primary key default gen_random_uuid(),
  service_key text not null,
  workload text not null,
  environment text not null,
  status text not null,
  credential_ref text not null,
  rotation_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_identities_key_environment_key unique (service_key, environment)
);

comment on table kitluy_auth.service_identities is
  'Owner: Security. Machine principals (service-account policy). UNIQUE (service_key, environment); no shared service-role key across unrelated workloads; no interactive login or team inheritance. credential_ref is a secret-store reference — never a raw secret. MC: MUT.';

-- Append-only allow/deny evidence, partitioned by decided_at (partitioning declared
-- in this group to avoid later rewrites — plan group 0030 Lock note).
create table if not exists kitluy_auth.authorization_decisions (
  id uuid not null default gen_random_uuid(),
  actor_type text not null,
  actor_id uuid,
  subject_id uuid,
  permission_key text not null,
  resource_type text,
  resource_id uuid,
  scope_snapshot jsonb,
  environment text not null,
  policy_version text,
  result text not null,
  reason_code text,
  request_id text,
  tenant_id uuid,
  decided_at timestamptz not null default now(),
  constraint authorization_decisions_pkey primary key (id, decided_at),
  constraint authorization_decisions_result_check check (result in ('ALLOW', 'DENY'))
) partition by range (decided_at);

create table if not exists kitluy_auth.authorization_decisions_default
  partition of kitluy_auth.authorization_decisions default;

create index if not exists authorization_decisions_decided_at_idx
  on kitluy_auth.authorization_decisions (decided_at);

create index if not exists authorization_decisions_tenant_idx
  on kitluy_auth.authorization_decisions (tenant_id, decided_at);

create index if not exists authorization_decisions_resource_idx
  on kitluy_auth.authorization_decisions (resource_type, resource_id);

comment on table kitluy_auth.authorization_decisions is
  'Owner: Security. Append-only allow/deny evidence; partitioned by decided_at; indexed by tenant/resource. Secrets are redacted before write (kitluy_auth.record_authorization_decision, 0035). No UPDATE/DELETE policies ever. MC: A/O.';

-- Deferred FK: kitluy_admin.safety_switches -> kitluy_auth.approval_requests
-- (kitluy_admin is created before kitluy_auth in this group; plan group 0030 Txn note).
alter table kitluy_admin.safety_switches
  add constraint safety_switches_approval_request_fk
  foreign key (approval_request_id) references kitluy_auth.approval_requests (id);

-- ===========================================================================
-- Schema: kitluy_audit (Owner: Audit/Compliance)
-- ===========================================================================
create schema if not exists kitluy_audit;

comment on schema kitluy_audit is
  'Owner: Audit/Compliance. Immutable audit, sensitive approvals, access reviews and evidence anchors. Ref: kitluy-suite-supabase-data-dictionary-v1.0.0.md';

create table if not exists kitluy_audit.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  digital_store_id uuid,
  store_location_id uuid,
  actor_type text not null,
  actor_id uuid,
  service_identity_id uuid references kitluy_auth.service_identities (id),
  device_id uuid,
  permission_key text,
  action text not null,
  resource_type text,
  resource_id uuid,
  environment text not null,
  reason text,
  before_hash text,
  after_hash text,
  request_id text,
  occurred_at timestamptz not null default now()
);

create index if not exists audit_logs_occurred_at_idx on kitluy_audit.audit_logs (occurred_at);

create index if not exists audit_logs_tenant_idx on kitluy_audit.audit_logs (tenant_id, occurred_at);

comment on table kitluy_audit.audit_logs is
  'Owner: Audit/Compliance. Immutable privileged/business audit. Append-only; cannot be updated or deleted by normal roles (no UPDATE/DELETE policies ever; enforce_append_only in 0035); retention is policy-controlled. Immutable before/after evidence hashes, never raw secrets. device_id is a plain uuid until kitluy_devices lands (group 0080, rule R4). MC: A/O.';

create table if not exists kitluy_audit.sensitive_action_approvals (
  id uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null references kitluy_auth.approval_requests (id),
  execution_token_id uuid references kitluy_auth.execution_tokens (id),
  action_result_ref text,
  executed_by uuid references auth.users (id),
  executed_at timestamptz not null default now()
);

comment on table kitluy_audit.sensitive_action_approvals is
  'Owner: Audit/Compliance. Approval evidence anchor linking approval request, execution token and result. Append-only. MC: A/O.';

create table if not exists kitluy_audit.access_reviews (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  owner_user_id uuid references auth.users (id),
  cadence_days integer,
  status text not null,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table kitluy_audit.access_reviews is
  'Owner: Audit/Compliance. Access review campaign. Append-only evidence. MC: A/O.';

create table if not exists kitluy_audit.access_review_items (
  id uuid primary key default gen_random_uuid(),
  access_review_id uuid not null references kitluy_audit.access_reviews (id),
  assignment_id uuid not null references kitluy_auth.role_assignments (id),
  reviewer_id uuid references auth.users (id),
  decision text not null,
  evidence text,
  decided_at timestamptz not null default now()
);

comment on table kitluy_audit.access_review_items is
  'Owner: Audit/Compliance. Assignment review decision. Append-only; the granter cannot certify their own access review (SoD, evaluated at RPC layer in 0130). MC: A/O.';

create table if not exists kitluy_audit.evidence_packages (
  id uuid primary key default gen_random_uuid(),
  package_type text not null,
  scope text,
  version bigint not null default 1,
  manifest_hash text not null,
  file_refs jsonb,
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint evidence_packages_version_check check (version >= 1)
);

comment on table kitluy_audit.evidence_packages is
  'Owner: Audit/Compliance. Release/restore/go-live evidence manifest (content-hashed). Append-only. MC: A/O.';

commit;
