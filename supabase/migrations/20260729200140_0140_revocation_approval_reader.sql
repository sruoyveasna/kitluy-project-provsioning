-- kitluy:group:0140
-- Migration group 0140: revocation_approval_reader (WS-11-T003 Step 4 boundary).
--
-- Authority: KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 **Ruling 2** —
--   "The approval gate may not run as `service_role`".
-- Amends:    KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001.
--
-- Additive. Groups 0125-0139 are COMMITTED and are NOT edited; group 0139's
-- `service_role` ownership of the approval gate is superseded here rather than
-- rewritten.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- SCOPE. Ruling 2 only. Ruling 1's scope binding (`revocation_recorded_scopes`,
-- the canonicalized `payload_hash` digest, single-use scope consumption) is a
-- LATER migration and is deliberately NOT attempted here. Ruling 3 is already
-- enforced by group 0138's one-way trigger and is re-proved below only to show
-- this group did not disturb it.
--
-- ===========================================================================
-- WHAT 0139 CONCEDED, AND WHY IT IS NOW WRONG
-- ===========================================================================
-- Group 0139's header records the concession in its own words: a dedicated
-- NOLOGIN reader "cannot be made to work without one of the two things above:
-- BYPASSRLS (which `postgres` cannot grant — it is not a superuser in this
-- stack) or a new SELECT policy on `kitluy_auth`". It then chose `service_role`
-- — the global-BYPASSRLS identity — precisely to avoid widening the
-- `kitluy_auth` RLS surface, and recorded the alternative for the owner.
--
-- The owner has now chosen the alternative. Ruling 2 authorizes the second
-- route explicitly, including the exact cost: "The RLS policy census increase
-- from 58 to 61 is OWNER-APPROVED for this exact purpose."
--
-- The measured facts 0139 relied on are unchanged and were re-measured here:
--
--   * `kitluy_auth.approval_requests`, `approval_policies` and
--     `approval_decisions` are RLS ENABLED **and FORCED**, owned by `postgres`;
--   * their only SELECT policies are `TO authenticated`;
--   * a NOLOGIN role with USAGE + SELECT and no BYPASSRLS reads ZERO rows;
--   * `service_role` reads everything solely through the `rolbypassrls` ROLE
--     ATTRIBUTE — not through a grant and not through a policy;
--   * `postgres` is NOT superuser here and cannot grant BYPASSRLS.
--
-- So three narrowly scoped policies are the only route, and this migration
-- takes exactly that route and no wider one.
--
-- WHY THE 0139 DESIGN WAS A REAL WEAKNESS AND NOT A COSMETIC ONE. A definer
-- owned by `service_role` runs the approval read with GLOBAL BYPASSRLS: every
-- row of every RLS-protected table in the database is inside that function's
-- reach. Nothing but the function body limited what it could have looked at. A
-- future edit — or a future caller — inherits that reach silently. The reader
-- built here can see three relations, restricted to one `action` value, in
-- SELECT only, on a subset of their columns, and it can see nothing else in the
-- database at all. That difference is the whole point of Ruling 2.
--
-- ===========================================================================
-- THE ONE MECHANISM THIS GROUP ADDS BEYOND THE ROLE, THE POLICIES AND THE GATE
-- ===========================================================================
-- The gate's LAST judgement is single use: an approval is authority for exactly
-- ONE revocation, proved by
--     exists (select 1 from kitluy_devices.device_credential_revocations
--              where approval_request_id = <the approval>)
-- `device_credential_revocations` is ALSO RLS ENABLED and FORCED. Under
-- `service_role`'s BYPASSRLS that read simply worked. Under a constrained
-- reader it would return ZERO rows — and zero rows there does not mean
-- "refuse", it means "not consumed". That is a FAIL-OPEN: a consumed approval
-- would authorize a second revocation.
--
-- Two ways to keep it fail-closed:
--
--   (a) a fourth RLS policy, on `kitluy_devices.device_credential_revocations`,
--       TO the reader. Ruling 2 says EXACTLY THREE, and a table policy would
--       also let the reader read revocation evidence rows it has no business
--       reading; or
--   (b) the reader never reads that table at all, and asks the role that
--       already owns the fact.
--
-- (b) is taken. `credential_revocation_approval_consumed_v1` is a SECURITY
-- DEFINER owned by `kitluy_credential_issuer` — the governor that already
-- writes and reads that evidence under its own named policy — pinned
-- search_path, no writes, returning ONE boolean about ONE approval id and
-- nothing else. EXECUTE is revoked from PUBLIC and granted ONLY to the reader.
-- The reader therefore holds no grant and no policy on
-- `device_credential_revocations`, and learns exactly one bit about an approval
-- id it was already given. If that EXECUTE were ever removed the gate would
-- RAISE rather than silently approve — fail closed, not fail open.
--
-- ===========================================================================
-- WHAT THIS GROUP DELIBERATELY DOES NOT DO
-- ===========================================================================
--   * it grants the credential governor NOTHING on `kitluy_auth` — section 41a
--     and 42 still find every `has_table_privilege('kitluy_credential_issuer',
--     'kitluy_auth.…', …)` false, and this migration re-checks it;
--   * it adds NO policy outside the three Ruling 2 names, so the section 7
--     SELECT-policy census moves 58 -> 61 and not one further;
--   * it grants the reader NO write privilege anywhere, and no membership to
--     any application, worker, issuer, service or human role;
--   * it weakens no judgement group 0136 wrote. Every refusal is preserved in
--     the same order, and each is re-proved by CALLING the function.

begin;

-- ---------------------------------------------------------------------------
-- 1. THE ROLE. NOLOGIN, and — stated explicitly because it is the point of
--    Ruling 2 — NO BYPASSRLS. `postgres` could not grant BYPASSRLS here even if
--    the decision allowed it, but the absence is asserted below rather than
--    assumed from the absence of a statement.
-- ---------------------------------------------------------------------------
do $create_reader$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_credential_approval_reader') then
    create role kitluy_credential_approval_reader nologin;
  end if;
end
$create_reader$;

-- Both memberships are BORROWED so this migration can transfer ownership, and
-- both are HANDED BACK before commit — groups 0134/0136/0137/0138/0139 do the
-- same, and section 32's containment assertion refuses a migration that keeps
-- one. The reader membership is handed back too, and the SET ROLE refusal that
-- results is proved by execution at the foot of this file.
do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
  execute format('grant kitluy_credential_approval_reader to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 2. MINIMUM GRANTS.
--
-- COLUMN-LEVEL, because column-level is sufficient. The gate needs eight of
-- `approval_requests`' thirteen columns, three of `approval_policies`' twelve
-- and three of `approval_decisions`' seven. `payload_hash` and `reason` are
-- NOT among them on any of the three relations: Ruling 2 requires the gate to
-- "expose no approval row or payload", and the cheapest way to guarantee that
-- is for the identity behind it to be unable to read a payload at all.
-- ---------------------------------------------------------------------------
grant usage on schema kitluy_auth to kitluy_credential_approval_reader;

grant select (id, policy_id, requester_id, resource_id, environment, action,
              status, expires_at)
  on kitluy_auth.approval_requests to kitluy_credential_approval_reader;

grant select (id, risk_class, quorum)
  on kitluy_auth.approval_policies to kitluy_credential_approval_reader;

grant select (approval_request_id, approver_id, decision)
  on kitluy_auth.approval_decisions to kitluy_credential_approval_reader;

-- USAGE only, so the gate can resolve its own return type
-- (`kitluy_devices.approval_verdict`) and the single-use helper. No table
-- privilege on `kitluy_devices` is granted here, and none is held.
grant usage on schema kitluy_devices to kitluy_credential_approval_reader;

-- ---------------------------------------------------------------------------
-- 3. EXACTLY THREE RLS SELECT POLICIES (census 58 -> 61,
--    KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002).
--
-- Visibility is anchored on ONE fact — `action =
-- 'device_credential_revocation'` — and the other two relations are reachable
-- only THROUGH a request carrying it. A refund approval, a configuration
-- approval, a time correction, a garment exception: none of them exist as far
-- as this role is concerned, and neither do their policies or their decisions.
--
-- The two EXISTS clauses are themselves evaluated as the reader, so the
-- `approval_requests` policy applies inside them as well. Removing that policy
-- therefore blinds all three relations at once, which is the desired direction
-- of failure.
-- ---------------------------------------------------------------------------
create policy approval_requests_credential_revocation_reader
  on kitluy_auth.approval_requests
  for select
  to kitluy_credential_approval_reader
  using (action = 'device_credential_revocation');

create policy approval_policies_credential_revocation_reader
  on kitluy_auth.approval_policies
  for select
  to kitluy_credential_approval_reader
  using (
    exists (
      select 1 from kitluy_auth.approval_requests r
       where r.policy_id = approval_policies.id
         and r.action = 'device_credential_revocation'));

create policy approval_decisions_credential_revocation_reader
  on kitluy_auth.approval_decisions
  for select
  to kitluy_credential_approval_reader
  using (
    exists (
      select 1 from kitluy_auth.approval_requests r
       where r.id = approval_decisions.approval_request_id
         and r.action = 'device_credential_revocation'));

comment on policy approval_requests_credential_revocation_reader
  on kitluy_auth.approval_requests is
  'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 2. The dedicated NOLOGIN kitluy_credential_approval_reader sees device_credential_revocation approval requests and nothing else in this database. It replaces group 0139''s reliance on service_role''s global BYPASSRLS attribute.';
comment on policy approval_policies_credential_revocation_reader
  on kitluy_auth.approval_policies is
  'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 2. Only a policy REACHABLE FROM a credential-revocation request is visible; the reader cannot enumerate the approval-policy catalogue.';
comment on policy approval_decisions_credential_revocation_reader
  on kitluy_auth.approval_decisions is
  'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 2. Only decisions ON a credential-revocation request are visible; four eyes is still counted from immutable decision rows, but the reader sees no other approval''s decisions.';

-- ---------------------------------------------------------------------------
-- 4. THE SINGLE-USE FACT, ASKED OF THE ROLE THAT OWNS IT.
--
-- Owned by `kitluy_credential_issuer`, which already holds
-- `device_credential_revocations_issuer_write` (group 0136) on this table.
-- Returns one boolean. Writes nothing. Reachable ONLY by the reader.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.credential_revocation_approval_consumed_v1(
  p_approval_request_id uuid
) returns boolean
language sql
stable
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $consumed$
  select exists (
    select 1
      from kitluy_devices.device_credential_revocations
     where approval_request_id = p_approval_request_id);
$consumed$;

alter function kitluy_devices.credential_revocation_approval_consumed_v1(uuid)
  owner to kitluy_credential_issuer;

revoke all on function
  kitluy_devices.credential_revocation_approval_consumed_v1(uuid) from public;
grant execute on function
  kitluy_devices.credential_revocation_approval_consumed_v1(uuid)
  to kitluy_credential_approval_reader;

comment on function kitluy_devices.credential_revocation_approval_consumed_v1(uuid) is
  'Answers ONE question — has this approval already authorized a revocation — for the approval gate, which after group 0140 runs as kitluy_credential_approval_reader and deliberately holds no grant and no RLS policy on kitluy_devices.device_credential_revocations. SECURITY DEFINER owned by kitluy_credential_issuer (which already reads that evidence under its own named policy), pinned search_path, no dynamic SQL, no writes, returns a boolean and never a row. The alternative — a fourth RLS policy TO the reader on the evidence table — is refused by KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 2, which authorizes exactly three. If this EXECUTE were removed the gate would RAISE rather than treat a consumed approval as unconsumed: fail closed, not fail open.';

-- ---------------------------------------------------------------------------
-- 5. THE GATE, RECREATED UNDER THE NEW OWNER.
--
-- Every judgement is group 0136's, in group 0136's order, with group 0136's
-- refusal codes. Three things change:
--
--   * the IDENTITY it runs as (Ruling 2);
--   * `select *` becomes an explicit column list, so the column-level grants
--     above are sufficient and the body cannot read a payload even by
--     accident;
--   * the single-use check goes through the helper above rather than reading
--     `device_credential_revocations` directly.
--
-- Note on the WRONG-ACTION branch: under the new policy a non-revocation
-- approval is INVISIBLE, so that branch is now unreachable through this role
-- and such an approval is refused one step earlier as UNAPPROVED / "does not
-- exist". The branch is kept deliberately — it is the correct answer if
-- visibility is ever widened, and deleting a check because the current
-- configuration makes it redundant is how the next configuration change
-- becomes a hole.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.evaluate_credential_revocation_approval_v1(
  p_approval_request_id uuid,
  p_device_id uuid,
  p_environment text,
  p_requester_ref text
) returns kitluy_devices.approval_verdict
language plpgsql
stable
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $evaluate$
declare
  v_policy_id uuid;
  v_requester_id uuid;
  v_resource_id uuid;
  v_req_environment text;
  v_action text;
  v_status text;
  v_expires_at timestamptz;
  v_risk_class text;
  v_quorum integer;
  v_approvers integer;
  v_self integer;
  v_deny constant text := 'KLUY-CRED-REVOCATION-';
begin
  if p_approval_request_id is null then
    return row(false, v_deny || 'UNAPPROVED',
      'this revocation requires an approval and none was presented')::kitluy_devices.approval_verdict;
  end if;

  -- Column list, not `select *`: the reader holds SELECT on these eight
  -- columns and on no others. `payload_hash` and `reason` are unreadable.
  select r.policy_id, r.requester_id, r.resource_id, r.environment,
         r.action, r.status, r.expires_at
    into v_policy_id, v_requester_id, v_resource_id, v_req_environment,
         v_action, v_status, v_expires_at
    from kitluy_auth.approval_requests r
   where r.id = p_approval_request_id;
  if not found then
    -- Either the request does not exist, or it is not a credential-revocation
    -- approval and is invisible to this role. Both are the same answer: this
    -- is not authority to revoke a credential.
    return row(false, v_deny || 'UNAPPROVED',
      format('approval request %s does not exist', p_approval_request_id))::kitluy_devices.approval_verdict;
  end if;

  select p.risk_class, p.quorum into v_risk_class, v_quorum
    from kitluy_auth.approval_policies p
   where p.id = v_policy_id;

  -- An UNDECLARED risk class is insufficient, not permissive. Group 0124's
  -- ruling, applied to the same aggregate.
  if coalesce(v_risk_class, 'A0') not in ('A3', 'A4') then
    return row(false, v_deny || 'RISK-CLASS',
      format('approval policy risk class %s is below the A3/A4 a credential revocation requires',
             coalesce(v_risk_class, 'undeclared')))::kitluy_devices.approval_verdict;
  end if;

  if v_action <> 'device_credential_revocation' then
    return row(false, v_deny || 'WRONG-ACTION',
      format('approval authorizes %s, not device_credential_revocation', v_action))::kitluy_devices.approval_verdict;
  end if;
  if v_req_environment <> p_environment then
    return row(false, v_deny || 'WRONG-SCOPE',
      format('approval is scoped to environment %s, not %s', v_req_environment, p_environment))::kitluy_devices.approval_verdict;
  end if;
  if v_resource_id is distinct from p_device_id then
    return row(false, v_deny || 'WRONG-SCOPE',
      'approval does not name this device')::kitluy_devices.approval_verdict;
  end if;
  if v_status <> 'APPROVED' then
    return row(false, v_deny || 'UNAPPROVED',
      format('approval request is %s', v_status))::kitluy_devices.approval_verdict;
  end if;
  if v_expires_at is not null and v_expires_at <= now() then
    return row(false, v_deny || 'UNAPPROVED',
      format('approval expired at %s', v_expires_at))::kitluy_devices.approval_verdict;
  end if;

  -- Four eyes derived from the immutable decision rows, never a mutable flag.
  select count(*) filter (where d.decision = 'APPROVE'),
         count(*) filter (where d.decision = 'APPROVE' and d.approver_id = v_requester_id)
  into v_approvers, v_self
  from kitluy_auth.approval_decisions d
  where d.approval_request_id = p_approval_request_id;

  if v_self > 0 then
    return row(false, v_deny || 'SELF-APPROVED',
      'the requester approved their own credential revocation')::kitluy_devices.approval_verdict;
  end if;
  if v_approvers < coalesce(v_quorum, 1) then
    return row(false, v_deny || 'UNAPPROVED',
      format('%s approver(s) recorded, policy requires %s',
             v_approvers, coalesce(v_quorum, 1)))::kitluy_devices.approval_verdict;
  end if;

  -- Single use. An approval is authority for ONE revocation. Asked of the
  -- governor that owns the evidence, because this role deliberately cannot
  -- read it — see the header. A missing EXECUTE raises here; it does not
  -- quietly answer "not consumed".
  if kitluy_devices.credential_revocation_approval_consumed_v1(p_approval_request_id) then
    return row(false, v_deny || 'APPROVAL-CONSUMED',
      'this approval has already authorized a revocation')::kitluy_devices.approval_verdict;
  end if;

  return row(true, null, null)::kitluy_devices.approval_verdict;
end
$evaluate$;

-- `alter function ... owner to` requires the INCOMING owner to hold CREATE on
-- the containing schema (the constraint group 0126 hit and documented). It is
-- granted for the statement and revoked immediately: the reader must not keep
-- the ability to create objects in kitluy_devices, and it held none before.
-- USAGE, granted in section 2, survives — the gate resolves its return type
-- and the helper through it.
grant create on schema kitluy_devices to kitluy_credential_approval_reader;
alter function kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text)
  owner to kitluy_credential_approval_reader;
revoke create on schema kitluy_devices from kitluy_credential_approval_reader;

-- Re-stated AFTER the ownership move, because an owner change rewrites the
-- grantor on every existing entry. PostgreSQL grants EXECUTE to PUBLIC at
-- creation and a later GRANT does not revoke it; section 32b checks exactly
-- this.
revoke all on function
  kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text)
  from public;
-- The ONLY caller is revoke_device_credential_v1, whose definer identity is the
-- credential governor. Nothing else is granted.
grant execute on function
  kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text)
  to kitluy_credential_issuer;

comment on function kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text) is
  'Database-side four-eyes gate for credential revocation, against the SAME kitluy_auth approval aggregate group 0124 uses. Every judgement is group 0136''s, unchanged and in the same order: A3/A4 risk class (undeclared is insufficient), action, device and environment scope, APPROVED status, unexpired window, non-self-approval, quorum from immutable decision rows, single-use consumption. Group 0139 pinned the read to service_role because that was the only route then available; KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 2 supersedes that additively. Group 0140 makes it a SECURITY DEFINER owned by the NOLOGIN, NON-BYPASSRLS kitluy_credential_approval_reader, whose entire reach is three kitluy_auth relations restricted by three RLS SELECT policies to action = device_credential_revocation, SELECT-only, on a column subset that excludes payload_hash and reason. Pinned search_path, no dynamic SQL, no writes, EXECUTE revoked from PUBLIC and granted only to the credential governor kitluy_credential_issuer and to nothing else; it returns an approval_verdict and never an approval row or payload.';

-- ===========================================================================
-- HOSTILE ASSERTIONS — TWELVE NEGATIVE CONTROLS, EACH BY EXECUTION
-- ===========================================================================
-- Group 0136 shipped a non-functional governed operation because its assertions
-- INSPECTED metadata instead of calling anything. That lesson is applied to a
-- boundary change here: every control below either calls the gate, sets the
-- role and runs a real query, or drops a real policy and observes the real
-- consequence. `pg_proc.proowner` is checked too, but never on its own — the
-- executable proof that the gate runs as the constrained reader rather than as
-- any BYPASSRLS identity is control 8: removing one of the READER'S policies
-- makes the gate refuse. That could not happen if a BYPASSRLS role were still
-- behind it.
--
-- IT LEAVES NOTHING BEHIND. Fixtures live inside a plpgsql subtransaction
-- unwound by a sentinel, exactly as group 0139's probe does; group 0138 asserts
-- one migration earlier that shipping revokes nothing.
-- ===========================================================================
do $assert_0140$
declare
  v_findings text[] := array[]::text[];
  v_probe_error text := '';
  v_requester constant uuid := '00000000-0000-4000-8000-000000000141';
  v_approver constant uuid := '00000000-0000-4000-8000-000000000142';
  v_tenant uuid;
  v_store uuid;
  v_location uuid;
  v_profile uuid;
  v_device uuid;
  v_other_device uuid;
  v_fp text := encode(sha256(convert_to('kl0140-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_token text := encode(sha256(convert_to('kl0140-t-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_payload text := encode(sha256(convert_to('kl0140-p-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_idem text := encode(sha256(convert_to('kl0140-i-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_req_id text := 'rq-0140-' || gen_random_uuid()::text;
  v_prep jsonb;
  v_links jsonb := jsonb_build_array(
    jsonb_build_object('link_position', 0, 'role', 'root', 'subject_fingerprint', repeat('r', 64),
                       'issuer_key_id', 'rk', 'canonical_tbs', 'R', 'detached_signature_b64', 'qg=='),
    jsonb_build_object('link_position', 1, 'role', 'intermediate', 'subject_fingerprint', repeat('i', 64),
                       'issuer_key_id', 'rk', 'canonical_tbs', 'I', 'detached_signature_b64', 'uw=='));
  v_credential uuid;
  v_policy_a4 uuid;
  v_policy_unrelated uuid;
  v_ap_ok uuid;
  v_ap_scope uuid;
  v_ap_unrelated uuid;
  v_intent text := 's0140-' || gen_random_uuid()::text;
  v_res jsonb;
  v_state text;
  v_visible integer;
  v_total integer;
  v_n integer;
  v_role text;
  v_pol record;
  v_rel text;
  v_mode text;
begin
  begin
    -- -------------------------------------------------------------------
    -- Fixtures. The migration runs BEFORE any seed, so every anchor the
    -- issuance chain needs is built here (group 0139's pattern).
    -- -------------------------------------------------------------------
    insert into auth.users (id, email)
    values (v_requester, 'kl0140.requester@kitluy.invalid'),
           (v_approver, 'kl0140.approver@kitluy.invalid')
    on conflict (id) do nothing;

    insert into kitluy_core.reference_values
      (registry_key, value_code, status, sort_order, effective_from)
    select 'vertical_code', 'LAUNDRY', 'ACTIVE', 1, timestamptz '2026-07-26 00:00:00+00'
     where not exists (select 1 from kitluy_core.reference_values
                        where registry_key = 'vertical_code' and value_code = 'LAUNDRY');

    insert into kitluy_core.tenants (tenant_code, legal_name, display_name, status, default_locale)
    values ('KL0140-PROBE', 'Group 0140 approval-reader probe tenant',
            'Group 0140 approval-reader probe tenant', 'ACTIVE', 'km-KH')
    returning id into v_tenant;

    insert into kitluy_core.digital_stores
      (tenant_id, store_code, name, primary_vertical_code, status,
       default_locale, default_currency_code, timezone)
    values (v_tenant, 'KL0140-STORE', 'Group 0140 probe store', 'LAUNDRY',
            'ACTIVE_HYBRID', 'km-KH', 'KHR', 'Asia/Phnom_Penh')
    returning id into v_store;

    insert into kitluy_core.store_locations
      (tenant_id, digital_store_id, location_code, name, country_code,
       operating_status, hub_required)
    values (v_tenant, v_store, 'KL0140-LOC', 'Group 0140 probe location', 'KH',
            'ACTIVE', true)
    returning id into v_location;

    insert into kitluy_devices.hardware_profiles
      (profile_key, display_name, device_class, manufacturer, model_identifier,
       required_signal_types, certification_status)
    values ('KL0140-APPROVAL-READER-PROBE', 'Group 0140 approval-reader probe profile', 'store_hub',
            'MIGRATION-FIXTURE', 'PROBE-0140',
            array['mac_address', 'board_serial', 'storage_serial']::kitluy_devices.hardware_signal_type[],
            'CERTIFIED')
    on conflict (profile_key) do nothing;
    select id into v_profile from kitluy_devices.hardware_profiles
     where profile_key = 'KL0140-APPROVAL-READER-PROBE';

    v_device := kitluy_devices.enroll_device_v1(
      'KL0140-' || gen_random_uuid()::text, v_profile, now(), v_fp,
      'ed25519', 'software', 'STATION-0140', 'OP-0140',
      jsonb_build_array(
        jsonb_build_object('signal_type', 'mac_address', 'signal_value',
          '01:40:' || substr(md5(random()::text), 1, 8)),
        jsonb_build_object('signal_type', 'board_serial', 'signal_value',
          'board-0140-' || gen_random_uuid()::text),
        jsonb_build_object('signal_type', 'storage_serial', 'signal_value',
          'nvme-0140-' || gen_random_uuid()::text)));
    perform kitluy_devices.create_device_claim_v1(
      v_device, v_tenant, v_store, v_location, v_token, v_payload, 900, 'OP-0140');
    perform kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_device, 'HUB-0140');

    v_prep := kitluy_devices.prepare_device_credential_issuance_v1(
      v_req_id, v_device, 'development', 'device_identity', 1, 'PEM-0140', v_fp,
      v_idem, repeat('9', 64), 'ed25519', repeat('8', 64), decode('a1', 'hex'),
      true, 'ica-0140', now(), 'trusted', 'SVC-0140');
    perform kitluy_devices.record_device_credential_signature_v1(
      v_req_id, v_prep ->> 'canonical_tbs_hash', decode('1111', 'hex'), true, 'SVC-0140');
    perform kitluy_devices.finalize_device_credential_issuance_v1(v_req_id, v_links, 'SVC-0140');

    select credential_id into v_credential from kitluy_devices.device_credentials
     where device_record_id = v_device and certificate_generation = 1;
    if v_credential is null then
      v_findings := v_findings || 'the probe could not issue a credential to revoke';
      raise exception using errcode = 'P0001', message = 'KLUY-0140-PROBE-COMPLETE',
        detail = 'fixture';
    end if;

    v_other_device := kitluy_devices.enroll_device_v1(
      'KL0140-OTHER-' || gen_random_uuid()::text, v_profile, now(),
      encode(sha256(convert_to('kl0140-other-' || gen_random_uuid()::text, 'UTF8')), 'hex'),
      'ed25519', 'software', 'STATION-0140', 'OP-0140',
      jsonb_build_array(
        jsonb_build_object('signal_type', 'mac_address', 'signal_value',
          '01:41:' || substr(md5(random()::text), 1, 8)),
        jsonb_build_object('signal_type', 'board_serial', 'signal_value',
          'board-0140b-' || gen_random_uuid()::text),
        jsonb_build_object('signal_type', 'storage_serial', 'signal_value',
          'nvme-0140b-' || gen_random_uuid()::text)));

    -- -------------------------------------------------------------------
    -- The approval rows: one good credential-revocation approval, one for
    -- the WRONG device, and one that has nothing to do with credentials.
    -- -------------------------------------------------------------------
    insert into kitluy_auth.approval_policies
      (policy_key, version, permission_key, environment, quorum, status, risk_class)
    values ('device.credential.revocation.a4.0140', 1, 'device.credential.revoke',
            'development', 1, 'ACTIVE', 'A4')
    returning id into v_policy_a4;

    insert into kitluy_auth.approval_policies
      (policy_key, version, permission_key, environment, quorum, status, risk_class)
    values ('device.time.correction.a4.0140', 1, 'device.time.correct',
            'development', 1, 'ACTIVE', 'A4')
    returning id into v_policy_unrelated;

    insert into kitluy_auth.approval_requests
      (policy_id, requester_id, resource_type, resource_id, environment, action,
       payload_hash, reason, status)
    values (v_policy_a4, v_requester, 'device', v_device, 'development',
            'device_credential_revocation', repeat('a', 64),
            'terminal is being permanently replaced', 'APPROVED')
    returning id into v_ap_ok;
    insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
    values (v_ap_ok, v_approver, 'APPROVE');

    insert into kitluy_auth.approval_requests
      (policy_id, requester_id, resource_type, resource_id, environment, action,
       payload_hash, reason, status)
    values (v_policy_a4, v_requester, 'device', v_other_device, 'development',
            'device_credential_revocation', repeat('b', 64),
            'a different terminal entirely', 'APPROVED')
    returning id into v_ap_scope;
    insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
    values (v_ap_scope, v_approver, 'APPROVE');

    -- The UNRELATED approval. Same aggregate, same environment, same device,
    -- fully APPROVED, A4 — everything is right about it except that it is not
    -- a credential revocation. Control 6 requires it to be invisible.
    insert into kitluy_auth.approval_requests
      (policy_id, requester_id, resource_type, resource_id, environment, action,
       payload_hash, reason, status)
    values (v_policy_unrelated, v_requester, 'device', v_device, 'development',
            'device_time_correction', repeat('c', 64),
            'an approval that has nothing to do with credentials', 'APPROVED')
    returning id into v_ap_unrelated;
    insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
    values (v_ap_unrelated, v_approver, 'APPROVE');

    -- ===================================================================
    -- CONTROL 2 — the gate EVALUATES a real approval under the new owner.
    -- `service_role` ownership is not required; this call is the proof.
    -- ===================================================================
    begin
      v_res := to_jsonb(kitluy_devices.evaluate_credential_revocation_approval_v1(
        v_ap_ok, v_device, 'development', 'requester@0140'));
      if (v_res ->> 'authorized')::boolean is not true then
        v_findings := v_findings ||
          format('control 2: the reader-owned gate refused a valid A4 approval: %s', v_res ->> 'refusal_code');
      end if;
    exception when others then
      v_findings := v_findings ||
        format('control 2: the reader-owned gate could not evaluate an approval: %s', sqlerrm);
    end;

    -- ===================================================================
    -- CONTROL 7 — a cross-device approval and a wrong-environment approval
    -- are REFUSED, through the real call.
    -- ===================================================================
    v_res := to_jsonb(kitluy_devices.evaluate_credential_revocation_approval_v1(
      v_ap_scope, v_device, 'development', 'requester@0140'));
    if (v_res ->> 'authorized')::boolean is not false
       or (v_res ->> 'refusal_code') <> 'KLUY-CRED-REVOCATION-WRONG-SCOPE' then
      v_findings := v_findings ||
        format('control 7: an approval naming ANOTHER device was not refused as wrong scope: %s', v_res);
    end if;
    v_res := to_jsonb(kitluy_devices.evaluate_credential_revocation_approval_v1(
      v_ap_ok, v_device, 'staging', 'requester@0140'));
    if (v_res ->> 'authorized')::boolean is not false
       or (v_res ->> 'refusal_code') <> 'KLUY-CRED-REVOCATION-WRONG-SCOPE' then
      v_findings := v_findings ||
        format('control 7: an approval scoped to another environment was accepted: %s', v_res);
    end if;

    -- ===================================================================
    -- CONTROLS 3, 5, 6 and 11 — run AS THE READER, on real rows.
    --
    -- Control 3's BYPASSRLS half is proved here rather than from
    -- pg_roles: a BYPASSRLS role would see every approval request in the
    -- database. This one sees only credential revocations.
    -- ===================================================================
    execute 'set role kitluy_credential_approval_reader';
    begin
      select count(*) into v_visible from kitluy_auth.approval_requests;
      select count(*) into v_n from kitluy_auth.approval_requests
       where action = 'device_credential_revocation';
      execute 'reset role';
    exception when others then
      execute 'reset role';
      raise;
    end;
    select count(*) into v_total from kitluy_auth.approval_requests;

    if v_visible <> v_n then
      v_findings := v_findings ||
        format('control 5: the reader saw %s approval request(s) but only %s are credential revocations',
               v_visible, v_n);
    end if;
    if v_visible = 0 then
      v_findings := v_findings || 'control 5: the reader saw NO approval requests, so nothing was proved';
    end if;
    if v_total <= v_visible then
      v_findings := v_findings ||
        'control 6: the probe built no unrelated approval, so invisibility was not tested';
    end if;

    execute 'set role kitluy_credential_approval_reader';
    begin
      -- Control 6: the unrelated approval, addressed BY ITS OWN ID.
      select count(*) into v_n from kitluy_auth.approval_requests where id = v_ap_unrelated;
      if v_n <> 0 then
        v_findings := v_findings ||
          'control 6: an approval with a different action was visible to the reader';
      end if;
      -- ...and neither its policy nor its decision.
      select count(*) into v_n from kitluy_auth.approval_policies where id = v_policy_unrelated;
      if v_n <> 0 then
        v_findings := v_findings ||
          'control 6: the policy of an unrelated approval was visible to the reader';
      end if;
      select count(*) into v_n from kitluy_auth.approval_decisions
       where approval_request_id = v_ap_unrelated;
      if v_n <> 0 then
        v_findings := v_findings ||
          'control 6: the decisions of an unrelated approval were visible to the reader';
      end if;
      -- ...while the revocation approval's policy and decision ARE visible,
      -- so the policies are narrow rather than simply broken.
      select count(*) into v_n from kitluy_auth.approval_policies where id = v_policy_a4;
      if v_n <> 1 then
        v_findings := v_findings ||
          'control 5: the reader could not see the policy of a credential-revocation approval';
      end if;
      select count(*) into v_n from kitluy_auth.approval_decisions
       where approval_request_id = v_ap_ok;
      if v_n <> 1 then
        v_findings := v_findings ||
          'control 5: the reader could not see the decisions of a credential-revocation approval';
      end if;

      -- Control 11, by execution: a real INSERT, UPDATE and DELETE attempt.
      begin
        insert into kitluy_auth.approval_requests
          (policy_id, requester_id, resource_type, resource_id, environment, action,
           payload_hash, reason, status)
        values (v_policy_a4, v_requester, 'device', v_device, 'development',
                'device_credential_revocation', repeat('f', 64), 'the reader writing', 'APPROVED');
        v_findings := v_findings || 'control 11: the reader INSERTed an approval request';
      exception when insufficient_privilege then
        null;
      end;
      begin
        update kitluy_auth.approval_requests set status = 'REJECTED' where id = v_ap_ok;
        v_findings := v_findings || 'control 11: the reader UPDATEd an approval request';
      exception when insufficient_privilege then
        null;
      end;
      -- The removal privileges are proved by the privilege scan below rather
      -- than by a live statement: `pnpm migrations:validate` refuses a
      -- migration whose TEXT contains a removal statement unless it carries
      -- `-- kitluy:destructive-approved:<decision-id>`, and this group has no
      -- destructive approval and needs none. Claiming one to make a refusal
      -- probe compile would spend a real safety marker on a lie.
      execute 'reset role';
    exception when others then
      execute 'reset role';
      raise;
    end;

    -- Control 11, second half: no write privilege on ANY kitluy_auth relation,
    -- not merely on the three the gate reads.
    for v_rel in
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'kitluy_auth' and c.relkind in ('r', 'p', 'v', 'm')
    loop
      foreach v_mode in array array['insert', 'update', 'delete', 'references', 'trigger'] loop
        if has_table_privilege('kitluy_credential_approval_reader',
                               format('kitluy_auth.%I', v_rel), v_mode) then
          v_findings := v_findings ||
            format('control 11: the reader holds %s on kitluy_auth.%s', upper(v_mode), v_rel);
        end if;
      end loop;
    end loop;

    -- ...and, wider than kitluy_auth: SELECT is the ONLY privilege this role
    -- holds on any relation or column anywhere in the database. This is what
    -- covers the removal privileges the live probes above deliberately do not
    -- attempt, and it also catches a privilege arriving later by a default-ACL.
    select count(*) into v_n
      from (
        select privilege_type from information_schema.role_table_grants
         where grantee = 'kitluy_credential_approval_reader'
        union all
        select privilege_type from information_schema.role_column_grants
         where grantee = 'kitluy_credential_approval_reader') g
     where g.privilege_type <> 'SELECT';
    if v_n <> 0 then
      v_findings := v_findings ||
        format('control 11: the reader holds %s non-SELECT table/column privilege(s)', v_n);
    end if;

    -- ===================================================================
    -- CONTROL 8 — dropping ANY ONE of the three policies makes the gate
    -- FAIL CLOSED. Each drop happens inside its own subtransaction and is
    -- rolled back; DDL is transactional, so the policy is restored.
    --
    -- This is also the executable proof of CONTROL 1: if a BYPASSRLS
    -- identity were still behind the gate, removing a policy that belongs
    -- to the reader would change nothing at all.
    -- ===================================================================
    for v_pol in
      select * from (values
        ('kitluy_auth', 'approval_requests',  'approval_requests_credential_revocation_reader'),
        ('kitluy_auth', 'approval_policies',  'approval_policies_credential_revocation_reader'),
        ('kitluy_auth', 'approval_decisions', 'approval_decisions_credential_revocation_reader')
      ) as t(sch, tbl, pol)
    loop
      begin
        execute format('drop policy %I on %I.%I', v_pol.pol, v_pol.sch, v_pol.tbl);
        begin
          v_res := to_jsonb(kitluy_devices.evaluate_credential_revocation_approval_v1(
            v_ap_ok, v_device, 'development', 'requester@0140'));
          if (v_res ->> 'authorized')::boolean is not false then
            v_findings := v_findings || format(
              'control 8: with policy %s dropped the gate still AUTHORIZED the revocation', v_pol.pol);
          end if;
        exception when others then
          -- A raised error is also fail-closed; only silent authorization is not.
          null;
        end;
        raise exception using errcode = 'P0001', message = 'KLUY-0140-POLICY-PROBE';
      exception when others then
        get stacked diagnostics v_probe_error = message_text;
        if v_probe_error <> 'KLUY-0140-POLICY-PROBE' then
          v_findings := v_findings ||
            format('control 8: the fail-closed probe for %s did not complete: %s', v_pol.pol, v_probe_error);
        end if;
      end;
    end loop;

    -- The policies are back, and the gate answers again.
    v_res := to_jsonb(kitluy_devices.evaluate_credential_revocation_approval_v1(
      v_ap_ok, v_device, 'development', 'requester@0140'));
    if (v_res ->> 'authorized')::boolean is not true then
      v_findings := v_findings ||
        format('control 8: the policies were not restored by the rollback: %s', v_res);
    end if;

    -- ===================================================================
    -- CONTROLS 9 and 10 — who can EXECUTE the gate, proved by trying.
    -- ===================================================================
    foreach v_role in array array[
      'anon', 'authenticated', 'service_role', 'kitluy_worker_service',
      'kitluy_issuance_service', 'kitluy_job_governor']
    loop
      if exists (select 1 from pg_roles where rolname = v_role) then
        begin
          execute format('set role %I', v_role);
          begin
            v_res := to_jsonb(kitluy_devices.evaluate_credential_revocation_approval_v1(
              v_ap_ok, v_device, 'development', 'requester@0140'));
            v_findings := v_findings ||
              format('control 10: %s executed the approval gate', v_role);
          exception when insufficient_privilege then
            null;
          end;
          execute 'reset role';
        exception when others then
          get stacked diagnostics v_probe_error = message_text;
          execute 'reset role';
          v_findings := v_findings ||
            format('control 10: the execute probe for %s did not complete: %s', v_role, v_probe_error);
        end;
      end if;
    end loop;

    -- Control 9 as a privilege fact for PUBLIC itself, which cannot be
    -- SET ROLE'd to. The executable half is the loop above: `anon` and
    -- `authenticated` hold no grant, so they exercise the PUBLIC path.
    if has_function_privilege('public',
         'kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text)', 'execute')
       or has_function_privilege('public',
         'kitluy_devices.credential_revocation_approval_consumed_v1(uuid)', 'execute') then
      v_findings := v_findings || 'control 9: PUBLIC can execute the approval gate or its single-use helper';
    end if;

    -- Control 10, positive half: the credential governor CAN, and nothing
    -- else holds the grant.
    if not has_function_privilege('kitluy_credential_issuer',
         'kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text)', 'execute') then
      v_findings := v_findings || 'control 10: the governed revocation path cannot reach its own approval gate';
    end if;

    -- ===================================================================
    -- CONTROL 12 — a real revocation completes through the reader-owned
    -- gate, and the revoked credential STAYS revoked (Ruling 3), with
    -- group 0138's one-way trigger untouched.
    -- ===================================================================
    v_res := kitluy_devices.revoke_device_credential_v1(
      v_intent, v_device, 'development', 'device_identity', 1,
      'ADMINISTRATIVE_REPLACEMENT', 'terminal permanently replaced under change KL0140',
      'REPROVISION_REQUIRED', 'requester@0140', 'MIGRATION-0140',
      v_ap_ok, 'approver@0140', 'CHG-0140');
    if (v_res ->> 'outcome') <> 'REVOKED' then
      v_findings := v_findings ||
        format('control 2/12: a fully approved four-eyes revocation did not complete: %s', v_res);
      raise exception using errcode = 'P0001', message = 'KLUY-0140-PROBE-COMPLETE',
        detail = 'revocation';
    end if;

    select state::text into v_state from kitluy_devices.device_credentials
     where credential_id = v_credential;
    if v_state <> 'revoked' then
      v_findings := v_findings || format('control 12: the revoked credential is %s', v_state);
    end if;

    execute 'set role kitluy_credential_issuer';
    begin
      update kitluy_devices.device_credentials
         set state = 'issued', revoked_at = null
       where credential_id = v_credential;
      v_findings := v_findings || 'control 12: a revoked credential was returned to issued';
    exception when others then
      get stacked diagnostics v_probe_error = message_text;
      if v_probe_error not like 'KLUY-REVOCATION-IS-ONE-WAY%' then
        v_findings := v_findings ||
          format('control 12: wrong refusal un-revoking a credential: %s', v_probe_error);
      end if;
    end;
    execute 'reset role';

    if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                    where c.relname = 'device_credentials'
                      and t.tgname = 'trg_device_credentials_revocation_one_way'
                      and not t.tgisinternal) then
      v_findings := v_findings || 'control 12: the one-way revocation trigger is gone';
    end if;

    -- Single use still holds through the helper: the approval that authorized
    -- the completed revocation is no longer authority for another.
    v_res := to_jsonb(kitluy_devices.evaluate_credential_revocation_approval_v1(
      v_ap_ok, v_device, 'development', 'requester@0140'));
    if (v_res ->> 'authorized')::boolean is not false
       or (v_res ->> 'refusal_code') <> 'KLUY-CRED-REVOCATION-APPROVAL-CONSUMED' then
      v_findings := v_findings ||
        format('a consumed approval was still authority for a revocation: %s', v_res);
    end if;

    raise exception using errcode = 'P0001', message = 'KLUY-0140-PROBE-COMPLETE',
      detail = 'ok';
  exception when others then
    get stacked diagnostics v_probe_error = message_text;
    if v_probe_error <> 'KLUY-0140-PROBE-COMPLETE' then
      raise exception 'ASSERT FAIL 0140: the approval-reader probe did not complete: %', v_probe_error;
    end if;
  end;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL 0140: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  -- -------------------------------------------------------------------------
  -- Structure, checked AFTER behaviour rather than instead of it.
  -- -------------------------------------------------------------------------
  -- Scoped to THIS probe's own artifacts rather than to the whole table.
  -- Group 0139 can assert the global form because it applies to a freshly
  -- reset database; scoping it here keeps the assertion true when the file is
  -- replayed against a database that already carries other groups' evidence,
  -- and it is the same guarantee: group 0140 revokes nothing and leaves no
  -- fixture behind.
  if exists (select 1 from kitluy_devices.device_credential_revocations
              where revocation_request_id = v_intent)
     or exists (select 1 from kitluy_core.tenants where tenant_code = 'KL0140-PROBE')
     or exists (select 1 from kitluy_devices.hardware_profiles
                 where profile_key = 'KL0140-APPROVAL-READER-PROBE') then
    raise exception 'ASSERT FAIL 0140: the migration left a probe fixture or a revocation behind';
  end if;

  -- CONTROL 1 — service_role no longer owns the gate. The executable proof is
  -- control 8 above; this is the corroborating fact.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname = 'evaluate_credential_revocation_approval_v1'
       and pg_get_userbyid(p.proowner) = 'service_role') then
    raise exception 'ASSERT FAIL 0140: service_role still owns the approval gate';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname = 'evaluate_credential_revocation_approval_v1'
       and p.prosecdef
       and pg_get_userbyid(p.proowner) = 'kitluy_credential_approval_reader'
       and p.proconfig is not null
       and exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%')) then
    raise exception
      'ASSERT FAIL 0140: the gate is not a reader-owned SECURITY DEFINER with a fixed search_path';
  end if;

  -- CONTROL 3 — the role attributes, beside the behavioural proof above.
  if not exists (
    select 1 from pg_roles
     where rolname = 'kitluy_credential_approval_reader'
       and not rolcanlogin and not rolbypassrls and not rolsuper
       and not rolcreaterole and not rolcreatedb and not rolreplication) then
    raise exception 'ASSERT FAIL 0140: the approval reader holds login or elevated attributes';
  end if;

  -- CONTROL 4, first half — nothing that is not a superuser is a member.
  if exists (
    select 1 from pg_auth_members m
      join pg_roles r on r.oid = m.member
      join pg_roles g on g.oid = m.roleid
     where g.rolname = 'kitluy_credential_approval_reader'
       and not r.rolsuper
       and r.rolname <> current_user) then
    raise exception 'ASSERT FAIL 0140: a non-superuser role is a member of the approval reader';
  end if;
  foreach v_role in array array[
    'service_role', 'authenticated', 'anon', 'authenticator',
    'kitluy_credential_issuer', 'kitluy_worker_service', 'kitluy_issuance_service',
    'kitluy_activation_governor', 'kitluy_job_governor'] loop
    if exists (select 1 from pg_roles where rolname = v_role)
       and (pg_has_role(v_role, 'kitluy_credential_approval_reader', 'MEMBER')
            or pg_has_role(v_role, 'kitluy_credential_approval_reader', 'USAGE')) then
      raise exception
        'ASSERT FAIL 0140: % can reach kitluy_credential_approval_reader', v_role;
    end if;
  end loop;

  -- The census moved 58 -> 61 and NOT ONE FURTHER
  -- (KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 2).
  if (select count(*) from pg_policies
       where schemaname in ('kitluy_core', 'kitluy_auth', 'kitluy_admin', 'kitluy_audit')
         and cmd = 'SELECT') <> 61 then
    raise exception 'ASSERT FAIL 0140: the SELECT-policy census is not 61';
  end if;
  if (select count(*) from pg_policies
       where 'kitluy_credential_approval_reader' = any (roles::text[])) <> 3 then
    raise exception 'ASSERT FAIL 0140: the approval reader is named by other than exactly three policies';
  end if;
  if exists (select 1 from pg_policies
              where 'kitluy_credential_approval_reader' = any (roles::text[])
                and cmd <> 'SELECT') then
    raise exception 'ASSERT FAIL 0140: the approval reader holds a non-SELECT policy';
  end if;

  -- The reader reaches nothing else: no other schema, no table privilege
  -- outside the three approval relations.
  if has_schema_privilege('kitluy_credential_approval_reader', 'kitluy_devices', 'create')
     or has_schema_privilege('kitluy_credential_approval_reader', 'kitluy_core', 'usage')
     or has_schema_privilege('kitluy_credential_approval_reader', 'kitluy_audit', 'usage')
     or has_schema_privilege('kitluy_credential_approval_reader', 'kitluy_admin', 'usage') then
    raise exception 'ASSERT FAIL 0140: the approval reader reaches beyond kitluy_auth and kitluy_devices';
  end if;
  if has_table_privilege('kitluy_credential_approval_reader',
                         'kitluy_devices.device_credential_revocations', 'select')
     or has_table_privilege('kitluy_credential_approval_reader',
                            'kitluy_devices.device_credentials', 'select') then
    raise exception 'ASSERT FAIL 0140: the approval reader can read kitluy_devices tables directly';
  end if;

  -- The credential governor gained NOTHING on the approvals aggregate — the
  -- invariant groups 0138/0139 and assertion sections 41a/42 also hold.
  if has_schema_privilege('kitluy_credential_issuer', 'kitluy_auth', 'usage')
     or has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_requests', 'select')
     or has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_policies', 'select')
     or has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_decisions', 'select') then
    raise exception 'ASSERT FAIL 0140: the credential governor now reaches kitluy_auth directly';
  end if;

  -- No column of any approval relation beyond the enumerated ones is readable.
  if has_column_privilege('kitluy_credential_approval_reader',
                          'kitluy_auth.approval_requests', 'payload_hash', 'select')
     or has_column_privilege('kitluy_credential_approval_reader',
                             'kitluy_auth.approval_requests', 'reason', 'select')
     or has_column_privilege('kitluy_credential_approval_reader',
                             'kitluy_auth.approval_decisions', 'reason', 'select')
     or has_column_privilege('kitluy_credential_approval_reader',
                             'kitluy_auth.approval_policies', 'policy_key', 'select') then
    raise exception 'ASSERT FAIL 0140: the approval reader can read an approval payload or reason';
  end if;
end
$assert_0140$;

-- The memberships borrowed at the top are HANDED BACK, exactly as groups
-- 0134/0136/0137/0138/0139 do. A migration that kept one would leave the
-- login-capable migration role able to SET ROLE to a governor for ever, which
-- is what the permanent assertion in section 32 refuses.
do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
  execute format('revoke kitluy_credential_approval_reader from %I', current_user);
end
$hand_back$;

-- ===========================================================================
-- CONTROL 4, second half — BY EXECUTION, and only possible here.
--
-- `postgres` in this stack is the most privileged non-superuser identity there
-- is: LOGIN, BYPASSRLS, CREATEROLE, and the role every migration runs as. If IT
-- is refused SET ROLE, no application, worker, issuer or service identity can
-- reach the reader either — SET ROLE is decided by session-user membership, and
-- the membership enumeration above shows none of them hold any.
-- ===========================================================================
do $assert_0140_setrole$
declare
  v_reached boolean := false;
begin
  begin
    execute 'set role kitluy_credential_approval_reader';
    v_reached := true;
    execute 'reset role';
  exception when others then
    null;
  end;
  if v_reached then
    raise exception
      'ASSERT FAIL 0140: the migration role can still SET ROLE to kitluy_credential_approval_reader';
  end if;
end
$assert_0140_setrole$;

commit;
