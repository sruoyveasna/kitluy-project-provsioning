-- kitluy:group:0148
-- Migration group 0148: emergency_revocation_permissions.
--
-- Authority: KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.3/§2.4 — the
--   emergency path is executed by "an authorized CISO or incident commander"
--   and post-approved by "a distinct second authorized human".
-- Remediates: RC-023, which blocks RC-021.
--
-- Additive. Groups 0136-0147 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- WHAT RC-023 FOUND, AND WHY IT BLOCKED RC-021
-- ===========================================================================
-- A governed emergency entry point has to VERIFY that the actor really holds
-- CISO or incident-commander authority rather than accept it. That could not be
-- written, for two reasons found by query rather than by reading:
--
--   * `kitluy_auth.permissions` held EIGHT rows and NONE matched `fleet%` or
--     `%device%`. There was no emergency permission key to check against.
--
--   * the existing emergency function takes `declaring_authority` as a
--     caller-supplied enum and `declarer_reauthenticated` as a caller-supplied
--     boolean. Reproduced: `kitluy_issuance_service`, asserting CISO and
--     re-authentication itself, with no approval and no recorded scope,
--     revoked TWO credentials. The authority field IS the RC-021 defect.
--
-- This group supplies the missing half: the keys. It deliberately does NOT
-- build the governed entry point — see the closing section.
--
-- ===========================================================================
-- WHY THE SESSION-SCOPED EVALUATOR IS THE RIGHT MECHANISM, UNCHANGED
-- ===========================================================================
-- `kitluy_auth.has_permission(key, resource_type, resource_id, environment)`
-- resolves the actor from `auth.uid()` — the authenticated session — and fails
-- closed when it is null. It applies explicit DENY precedence and refuses a
-- disabled or non-ACTIVE profile before anything else.
--
-- That is exactly the property the emergency path needs and exactly what a
-- passed actor uuid would destroy. A service identity calling with a human's id
-- would be asserting the delegation rather than proving it, which is the same
-- mistake as `declaring_authority`, moved one column across. So no
-- actor-scoped variant is added here: the governed RPC must run under the
-- human's own session, and these keys are what it will evaluate.
--
-- ===========================================================================
-- THE TWO KEYS
-- ===========================================================================
-- Deliberately TWO, not one. §2.4 requires the post-approver to be a DISTINCT
-- second authorized human; a single key would let one assignment satisfy both
-- halves of a four-eyes control, which is the control failing quietly.
--
-- CRITICAL risk class, because the action is immediate, irreversible and
-- fleet-affecting — the highest the CHECK allows, and the same tier the
-- repository reserves for actions that cannot be undone.
--
-- NOT granted to anybody here. Registering a key and assigning it are separate
-- acts, and this migration performs only the first: no role template receives
-- either key, and no human is named. Authority arrives through explicit scoped
-- assignments made by whoever owns the RBAC registry, and tests create their
-- own scoped assignments to dedicated test humans. A migration that seeded a
-- CISO would be inventing an authority the owner decision names but does not
-- populate.

insert into kitluy_auth.permissions
  (permission_key, version, risk_class, resource_types, environments, status)
values
  -- Immediate, irreversible revocation of the exact authoritative affected set.
  ('fleet.device_credential.emergency_revoke', 1, 'CRITICAL',
   array['device', 'device_credential'], array['all'], 'ACTIVE'),
  -- The distinct second human's post-approval of that same action and scope.
  ('fleet.device_credential.emergency_post_approve', 1, 'CRITICAL',
   array['device', 'device_credential'], array['all'], 'ACTIVE')
on conflict (permission_key, version) do nothing;

-- ---------------------------------------------------------------------------
-- ASSERTIONS, by execution rather than assumption.
-- ---------------------------------------------------------------------------
do $assert_0148$
declare
  v_findings text[] := array[]::text[];
  v_n integer;
begin
  -- Both keys exist and are ACTIVE.
  select count(*) into v_n from kitluy_auth.permissions
   where permission_key in ('fleet.device_credential.emergency_revoke',
                            'fleet.device_credential.emergency_post_approve')
     and status = 'ACTIVE';
  if v_n <> 2 then
    v_findings := v_findings || format('expected 2 ACTIVE emergency permission keys, found %s', v_n)::text;
  end if;

  -- Neither is granted to any role template. Registering is not assigning, and
  -- a key that arrived already granted would hand emergency authority to
  -- whoever happens to hold that template.
  select count(*) into v_n
    from kitluy_auth.role_permission_grants g
    join kitluy_auth.permissions p on p.id = g.permission_id
   where p.permission_key like 'fleet.device_credential.emergency_%';
  if v_n <> 0 then
    v_findings := v_findings ||
      format('emergency permissions are already granted to %s role template(s); this migration must register only', v_n)::text;
  end if;

  -- The keys are distinct, so one assignment cannot satisfy both halves of the
  -- four-eyes control §2.4 requires.
  if (select count(distinct permission_key) from kitluy_auth.permissions
       where permission_key like 'fleet.device_credential.emergency_%') <> 2 then
    v_findings := v_findings || 'the execute and post-approve keys are not distinct'::text;
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL 0148: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;
end
$assert_0148$;

-- ---------------------------------------------------------------------------
-- WHAT THIS GROUP DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------------
-- It does not build the governed emergency entry point, and it does not revoke
-- EXECUTE on `revoke_device_credential_emergency_v1`. RC-021 therefore stays
-- OPEN and the reproduced bypass is still reachable.
--
-- Registering the keys is the prerequisite RC-023 named; it is not the control.
-- The control still needs: an immutable authorization record binding actor,
-- permission evidence, re-authentication evidence, reason, incident reference,
-- tenancy, the exact authoritative affected identifiers and their digest; a
-- public RPC that runs under the human's session and evaluates
-- `has_permission('fleet.device_credential.emergency_revoke', …)`; the seven
-- emergency assertion sites re-homed onto it; and only then the old grant
-- revoked. Revoking the grant before those exist would make the emergency
-- capability unreachable rather than governed, and an unreachable emergency
-- path is its own incident.
--
-- Recorded here rather than implied, because the previous two groups in this
-- area were each read as closing more than they did.
