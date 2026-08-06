-- kitluy:group:0186
-- ===========================================================================
-- WS-12-T002 — T1 customer and consent-decision ingestion
-- (KLD-2026-08-06-WS12-T002-001, OWNER-APPROVED — LOCKED).
--
-- WHY THIS GROUP EXISTS. The WS-06 customer/consent authority (0060/0065/
-- 0070) shipped TABLES with no governed doors: planned group 0130
-- (functions/RPCs) was never authored, and the only write path is the raw
-- `service_role` schema grant — exactly what a Hub-originated fact must
-- not use. WS-12-T002 makes the Store Hub capture minimal customers and
-- consent decisions OFFLINE; on reconnect each outbox fact must land in
-- the cloud authority EXACTLY ONCE through a door that owns its own
-- idempotency, scope verification and refusal vocabulary — the
-- 0176/0177 ingestion-door discipline applied to kitluy_core for the
-- first time (the WS-06 tables predate the governor era; this group
-- bridges the two conventions and changes NOTHING about the tables).
--
-- WHAT DOES NOT HAPPEN HERE. No customer merge, no destructive
-- deduplication, no cross-Store identity linking (owner decision §1): a
-- normalized-phone collision returns a CONFLICT verdict carrying no
-- customer detail, and resolution stays with the governed merge workflow
-- (0060 customer_merge_requests, four-eyes). No notification-preference
-- projection is written (the notifications service owns that projection;
-- RECORDED as out of T002 scope). Consent purpose VERSIONS are not
-- seeded: notice text and policy references are owner/legal values
-- (repository rule 9) — the five purpose KEYS below are technical
-- registry identifiers; without owner-published versions the consent door
-- fails closed, which is correct.
--
-- Authority: owner decision §2/§3/§5; KBR-CUS-001/002/004/005;
-- 0176/0177 ingestion-door pattern; 0060/0065 table contracts.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Roles (0177 pattern): a NOLOGIN governor owns the doors and the
--    evidence journal; the sync ingestion service may execute them.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_customer_ingestion_governor') then
    create role kitluy_customer_ingestion_governor nologin;
  end if;
end $$;

comment on role kitluy_customer_ingestion_governor is
  'T1 customer/consent ingestion authority (group 0186). NOLOGIN; owns the two ingestion doors and the effects journal. The WS-06 tables it writes keep their FORCE RLS; this role holds explicit policies (0177 pattern), never BYPASSRLS.';

-- Borrow the governor for the ALTER ... OWNER statements below; revoked in
-- the tail (0176 pattern; membership is required to give ownership away).
do $borrow$
begin
  execute format('grant kitluy_customer_ingestion_governor to %I', current_user);
end $borrow$;

grant usage, create on schema kitluy_core to kitluy_customer_ingestion_governor;

-- ---------------------------------------------------------------------------
-- 2. The effects journal — replay answers and conflict verdicts.
-- ---------------------------------------------------------------------------
create table kitluy_core.customer_ingestion_effects (
  effect_key     text        primary key,
  effect_kind    text        not null,
  tenant_id      uuid        not null references kitluy_core.tenants (id),
  payload_hash   char(64)    not null,
  outcome        text        not null,
  cloud_customer_id uuid     null references kitluy_core.customers (id),
  consent_grant_id  uuid     null references kitluy_core.consent_grants (id),
  detail         text        not null default '',
  correlation_id uuid        null,
  created_at     timestamptz not null default now(),
  constraint customer_ingestion_effects_key_ck
    check (effect_key ~ '^kh1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9]+$'),
  constraint customer_ingestion_effects_kind_ck
    check (effect_kind in ('local_customer', 'consent_decision')),
  constraint customer_ingestion_effects_outcome_ck
    check (outcome in ('APPLIED', 'CONFLICT', 'WITHDRAWN_NO_GRANT', 'ACKNOWLEDGED', 'DECLINED_RECORDED')),
  constraint customer_ingestion_effects_hash_ck
    check (payload_hash ~ '^[0-9a-f]{64}$')
);

comment on table kitluy_core.customer_ingestion_effects is
  'Append-only ingestion journal (group 0186). One row per applied Hub outbox effect: the unique effect key IS the exactly-once guarantee, and a redelivery returns the stored verdict without touching the authority again. A CONFLICT row carries NO customer identity — the collision is surfaced for governed resolution, never disclosed (owner decision §2.4/§5).';

create index customer_ingestion_effects_tenant_idx
  on kitluy_core.customer_ingestion_effects (tenant_id, effect_kind, created_at desc);

alter table kitluy_core.customer_ingestion_effects enable row level security;
alter table kitluy_core.customer_ingestion_effects force row level security;
create policy customer_ingestion_effects_read on kitluy_core.customer_ingestion_effects
  for select to kitluy_customer_ingestion_governor using (true);
create policy customer_ingestion_effects_write on kitluy_core.customer_ingestion_effects
  for insert to kitluy_customer_ingestion_governor with check (true);
grant select, insert on kitluy_core.customer_ingestion_effects
  to kitluy_customer_ingestion_governor;

create trigger trg_append_only_customer_ingestion_effects
  before update or delete on kitluy_core.customer_ingestion_effects
  for each row execute function kitluy_auth.enforce_append_only();

-- ---------------------------------------------------------------------------
-- 3. Governor write surface over the EXISTING WS-06 tables (FORCE RLS
--    stays; the governor gets explicit policies + minimal grants).
-- ---------------------------------------------------------------------------
-- Per-command policies only: the append-only WS-06 ledgers must never gain
-- an UPDATE/DELETE/ALL policy (structural assertion), and the doors need
-- exactly SELECT + INSERT.
do $$
declare
  t text;
begin
  foreach t in array array['customers', 'customer_contacts',
                           'customer_store_relationships',
                           'consent_grants', 'consent_withdrawals'] loop
    execute format(
      'create policy %I on kitluy_core.%I for select to kitluy_customer_ingestion_governor using (true)',
      t || '_customer_ingestion_read', t);
    execute format(
      'create policy %I on kitluy_core.%I for insert to kitluy_customer_ingestion_governor with check (true)',
      t || '_customer_ingestion_write', t);
  end loop;
  foreach t in array array['consent_purposes', 'consent_purpose_versions',
                           'tenants', 'digital_stores'] loop
    execute format(
      'create policy %I on kitluy_core.%I for select to kitluy_customer_ingestion_governor using (true)',
      t || '_customer_ingestion_read', t);
  end loop;
end $$;

grant select, insert on kitluy_core.customers,
                        kitluy_core.customer_contacts,
                        kitluy_core.customer_store_relationships,
                        kitluy_core.consent_grants,
                        kitluy_core.consent_withdrawals
  to kitluy_customer_ingestion_governor;
grant select on kitluy_core.consent_purposes, kitluy_core.consent_purpose_versions,
                kitluy_core.tenants, kitluy_core.digital_stores
  to kitluy_customer_ingestion_governor;
grant usage on schema kitluy_core to kitluy_edge_sync_service, kitluy_test_harness;

-- ---------------------------------------------------------------------------
-- 4. The five consent-purpose KEYS (technical registry identifiers; owner
--    decision §3 categories, kept distinct). Versions are owner values and
--    are NOT created here — the consent door fails closed until they exist.
-- ---------------------------------------------------------------------------
insert into kitluy_core.consent_purposes (purpose_key, communication_class, description)
values
  ('privacy_notice_acknowledgement', 'LEGAL',
   'Privacy-notice acknowledgement. NOT consent for any communication (owner decision §3.2).'),
  ('operational_communication', 'OPERATIONAL',
   'Operational/transactional communication about the customer''s own Bookings.'),
  ('sms_marketing', 'MARKETING', 'SMS marketing. Never preselected.'),
  ('telegram_marketing', 'MARKETING', 'Telegram marketing. Never preselected.'),
  ('email_marketing', 'MARKETING', 'Email marketing where an email exists. Never preselected.')
on conflict (purpose_key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. The customer ingestion door.
-- ---------------------------------------------------------------------------
create function kitluy_core.ingest_local_customer_v1(
  p_effect_key text,
  p_payload_hash text,
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_display_name text,
  p_phone_e164 text,
  p_phone_display text,
  p_preferred_locale text,
  p_source_code text,
  p_correlation_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_core, extensions
as $ingest$
declare
  v_existing kitluy_core.customer_ingestion_effects;
  v_customer_id uuid;
  v_mask text;
begin
  if p_effect_key !~ '^kh1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9]+$' then
    raise exception 'KLUY-CUSTOMER-INGEST-SCHEMA: the effect key is not the canonical kh1 shape (KLREQ-026)'
      using errcode = 'P0001';
  end if;
  if p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'KLUY-CUSTOMER-INGEST-SCHEMA: the payload hash is not lowercase hex SHA-256'
      using errcode = 'P0001';
  end if;

  -- Idempotency FIRST: a redelivered effect returns its original verdict.
  select * into v_existing from kitluy_core.customer_ingestion_effects
   where effect_key = p_effect_key;
  if found then
    if v_existing.payload_hash <> p_payload_hash then
      raise exception 'KLUY-CUSTOMER-INGEST-IDEMPOTENCY: effect key % was applied with a different payload',
        p_effect_key using errcode = 'P0001';
    end if;
    return jsonb_build_object('outcome', 'DUPLICATE_IGNORED',
                              'originalOutcome', v_existing.outcome,
                              'cloudCustomerId', v_existing.cloud_customer_id);
  end if;

  if not exists (select 1 from kitluy_core.tenants where id = p_tenant_id) then
    raise exception 'KLUY-CUSTOMER-INGEST-SCOPE: unknown tenant' using errcode = 'P0001';
  end if;
  if not exists (select 1 from kitluy_core.digital_stores
                  where id = p_digital_store_id and tenant_id = p_tenant_id) then
    raise exception 'KLUY-CUSTOMER-INGEST-SCOPE: the Digital Store does not belong to the Tenant'
      using errcode = 'P0001';
  end if;
  if p_display_name is null or length(trim(p_display_name)) not between 1 and 200 then
    raise exception 'KLUY-CUSTOMER-INGEST-SCHEMA: a display name of 1..200 characters is required'
      using errcode = 'P0001';
  end if;

  -- Normalized-phone collision => CONFLICT, never a merge and never a
  -- second customer under the colliding ACTIVE identifier. The verdict
  -- carries NO customer identity (owner decision §2.4: no route may
  -- expose whether a customer exists in another Store).
  if p_phone_e164 is not null and exists (
    select 1 from kitluy_core.customer_contacts
     where tenant_id = p_tenant_id and type = 'PHONE'
       and normalized_value = p_phone_e164 and status = 'ACTIVE'
  ) then
    insert into kitluy_core.customer_ingestion_effects
      (effect_key, effect_kind, tenant_id, payload_hash, outcome, detail, correlation_id)
    values
      (p_effect_key, 'local_customer', p_tenant_id, p_payload_hash, 'CONFLICT',
       'normalized_phone_collision', p_correlation_id);
    return jsonb_build_object('outcome', 'CONFLICT', 'reason', 'normalized_phone_collision');
  end if;

  insert into kitluy_core.customers (tenant_id, display_name, status, preferred_locale)
  values (p_tenant_id, trim(p_display_name), 'ACTIVE',
          coalesce(p_preferred_locale, 'km-KH'))
  returning id into v_customer_id;

  if p_phone_e164 is not null then
    v_mask := '+855••••' || right(p_phone_e164, 4);
    insert into kitluy_core.customer_contacts
      (tenant_id, customer_id, type, normalized_value, display_value, masked_value,
       verified_at, is_primary, consent_status, status)
    values
      (p_tenant_id, v_customer_id, 'PHONE', p_phone_e164, p_phone_display, v_mask,
       null, true, 'UNKNOWN', 'UNVERIFIED');
    -- UNVERIFIED: presence is not verification (owner decision §2.7), and
    -- the status keeps the row outside the ACTIVE-identifier unique index
    -- until the governed verification/duplicate workflow resolves it.
  end if;

  insert into kitluy_core.customer_store_relationships
    (tenant_id, customer_id, digital_store_id, status, source_code)
  values (p_tenant_id, v_customer_id, p_digital_store_id, 'ACTIVE',
          coalesce(p_source_code, 't1_intake'));

  insert into kitluy_core.customer_ingestion_effects
    (effect_key, effect_kind, tenant_id, payload_hash, outcome, cloud_customer_id,
     correlation_id)
  values
    (p_effect_key, 'local_customer', p_tenant_id, p_payload_hash, 'APPLIED',
     v_customer_id, p_correlation_id);

  return jsonb_build_object('outcome', 'APPLIED', 'cloudCustomerId', v_customer_id);
end;
$ingest$;

-- ---------------------------------------------------------------------------
-- 6. The consent-decision ingestion door.
-- ---------------------------------------------------------------------------
create function kitluy_core.ingest_consent_decision_v1(
  p_effect_key text,
  p_payload_hash text,
  p_tenant_id uuid,
  p_cloud_customer_id uuid,
  p_purpose_key text,
  p_policy_version bigint,
  p_decision text,
  p_channel text,
  p_source text,
  p_evidence_ref text,
  p_correlation_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_core, extensions
as $ingest$
declare
  v_existing kitluy_core.customer_ingestion_effects;
  v_version_id uuid;
  v_grant kitluy_core.consent_grants;
  v_grant_id uuid;
  v_outcome text;
begin
  if p_effect_key !~ '^kh1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9]+$' then
    raise exception 'KLUY-CONSENT-INGEST-SCHEMA: the effect key is not the canonical kh1 shape'
      using errcode = 'P0001';
  end if;
  if p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'KLUY-CONSENT-INGEST-SCHEMA: the payload hash is not lowercase hex SHA-256'
      using errcode = 'P0001';
  end if;
  if p_decision not in ('granted', 'declined', 'withdrawn', 'acknowledged') then
    raise exception 'KLUY-CONSENT-INGEST-SCHEMA: % is not a consent decision', coalesce(p_decision, '<null>')
      using errcode = 'P0001';
  end if;
  if (p_purpose_key = 'privacy_notice_acknowledgement') <> (p_decision = 'acknowledged') then
    raise exception 'KLUY-CONSENT-INGEST-SCHEMA: acknowledgement pairs only with the privacy notice (owner decision §3.2)'
      using errcode = 'P0001';
  end if;

  select * into v_existing from kitluy_core.customer_ingestion_effects
   where effect_key = p_effect_key;
  if found then
    if v_existing.payload_hash <> p_payload_hash then
      raise exception 'KLUY-CONSENT-INGEST-IDEMPOTENCY: effect key % was applied with a different payload',
        p_effect_key using errcode = 'P0001';
    end if;
    return jsonb_build_object('outcome', 'DUPLICATE_IGNORED',
                              'originalOutcome', v_existing.outcome);
  end if;

  if not exists (select 1 from kitluy_core.customers
                  where id = p_cloud_customer_id and tenant_id = p_tenant_id) then
    -- Merged refusal: existence in another Tenant is never disclosed.
    raise exception 'KLUY-CONSENT-INGEST-CUSTOMER-UNKNOWN: no such customer in this Tenant'
      using errcode = 'P0001';
  end if;

  select v.id into v_version_id
    from kitluy_core.consent_purpose_versions v
    join kitluy_core.consent_purposes p on p.id = v.consent_purpose_id
   where p.purpose_key = p_purpose_key and v.version = p_policy_version;
  if v_version_id is null then
    raise exception 'KLUY-CONSENT-INGEST-POLICY-VERSION-UNKNOWN: purpose % has no published version % (owner values pending)',
      coalesce(p_purpose_key, '<null>'), p_policy_version using errcode = 'P0001';
  end if;

  if p_decision in ('granted', 'acknowledged') then
    insert into kitluy_core.consent_grants
      (tenant_id, customer_id, consent_purpose_version_id, channel, source,
       evidence_ref, recorded_by)
    values
      (p_tenant_id, p_cloud_customer_id, v_version_id, p_channel, p_source,
       p_evidence_ref, null)
    returning id into v_grant_id;
    v_outcome := case when p_decision = 'acknowledged' then 'ACKNOWLEDGED' else 'APPLIED' end;
  elsif p_decision = 'declined' then
    -- A decline creates no grant: the evidence lives in this journal row
    -- (KBR-CUS-004 — consent state is never a mutable boolean; absence of
    -- a grant plus this fact is the truthful record).
    v_grant_id := null;
    v_outcome := 'DECLINED_RECORDED';
  else -- withdrawn
    select g.* into v_grant
      from kitluy_core.consent_grants g
      left join kitluy_core.consent_withdrawals w on w.consent_grant_id = g.id
     where g.tenant_id = p_tenant_id and g.customer_id = p_cloud_customer_id
       and g.consent_purpose_version_id in (
             select v2.id from kitluy_core.consent_purpose_versions v2
             join kitluy_core.consent_purposes p2 on p2.id = v2.consent_purpose_id
            where p2.purpose_key = p_purpose_key)
       and w.id is null
     order by g.granted_at desc
     limit 1;
    if v_grant.id is null then
      -- Withdrawal with nothing to withdraw is still evidence — recorded,
      -- non-destructive, and idempotent on redelivery.
      v_grant_id := null;
      v_outcome := 'WITHDRAWN_NO_GRANT';
    else
      insert into kitluy_core.consent_withdrawals
        (tenant_id, consent_grant_id, reason_code, source, recorded_by)
      values (p_tenant_id, v_grant.id, 'customer_request', p_source, null);
      v_grant_id := v_grant.id;
      v_outcome := 'APPLIED';
    end if;
  end if;

  insert into kitluy_core.customer_ingestion_effects
    (effect_key, effect_kind, tenant_id, payload_hash, outcome, cloud_customer_id,
     consent_grant_id, correlation_id)
  values
    (p_effect_key, 'consent_decision', p_tenant_id, p_payload_hash, v_outcome,
     p_cloud_customer_id, v_grant_id, p_correlation_id);

  return jsonb_build_object('outcome', v_outcome,
                            'consentGrantId', v_grant_id);
end;
$ingest$;

-- ---------------------------------------------------------------------------
-- 7. Ownership, execution grants, hardening (0176/0177 tail).
-- ---------------------------------------------------------------------------
alter table kitluy_core.customer_ingestion_effects owner to kitluy_customer_ingestion_governor;
alter function kitluy_core.ingest_local_customer_v1(text, text, uuid, uuid, text, text, text, text, text, uuid)
  owner to kitluy_customer_ingestion_governor;
alter function kitluy_core.ingest_consent_decision_v1(text, text, uuid, uuid, text, bigint, text, text, text, text, uuid)
  owner to kitluy_customer_ingestion_governor;

revoke execute on function
  kitluy_core.ingest_local_customer_v1(text, text, uuid, uuid, text, text, text, text, text, uuid),
  kitluy_core.ingest_consent_decision_v1(text, text, uuid, uuid, text, bigint, text, text, text, text, uuid)
  from public;
grant execute on function
  kitluy_core.ingest_local_customer_v1(text, text, uuid, uuid, text, text, text, text, text, uuid),
  kitluy_core.ingest_consent_decision_v1(text, text, uuid, uuid, text, bigint, text, text, text, text, uuid)
  to kitluy_edge_sync_service, kitluy_test_harness;

-- The migrator hands the governor back (0176 pattern).
do $return$
begin
  execute format('revoke kitluy_customer_ingestion_governor from %I', current_user);
end $return$;

-- ---------------------------------------------------------------------------
-- 8. Self-verification.
-- ---------------------------------------------------------------------------
do $guard$
begin
  if (select count(*) from kitluy_core.consent_purposes
       where purpose_key in ('privacy_notice_acknowledgement', 'operational_communication',
                             'sms_marketing', 'telegram_marketing', 'email_marketing')) <> 5 then
    raise exception 'KLUY-MIGRATION-0186: the five consent purposes are not registered';
  end if;
  if exists (select 1 from kitluy_core.consent_purpose_versions v
              join kitluy_core.consent_purposes p on p.id = v.consent_purpose_id
             where p.purpose_key = 'sms_marketing') then
    raise exception 'KLUY-MIGRATION-0186: purpose versions must NOT ship from a migration (owner legal values)';
  end if;
  if has_function_privilege('public',
      'kitluy_core.ingest_local_customer_v1(text,text,uuid,uuid,text,text,text,text,text,uuid)'::regprocedure,
      'execute') then
    raise exception 'KLUY-MIGRATION-0186: PUBLIC can execute the customer ingestion door';
  end if;
  if not has_function_privilege('kitluy_edge_sync_service',
      'kitluy_core.ingest_consent_decision_v1(text,text,uuid,uuid,text,bigint,text,text,text,text,uuid)'::regprocedure,
      'execute') then
    raise exception 'KLUY-MIGRATION-0186: the sync ingestion service cannot execute the consent door';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_core' and c.relname = 'customer_ingestion_effects'
       and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception 'KLUY-MIGRATION-0186: the effects journal is not FORCE-RLS';
  end if;
  raise notice 'KLUY-MIGRATION-0186: T1 customer/consent ingestion doors installed (governor-owned, effect-key idempotent, fail-closed on unpublished policy versions)';
end $guard$;
