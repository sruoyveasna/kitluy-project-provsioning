-- kitluy:group:0141
-- Migration group 0141: revocation_scope_binding (WS-11-T003 Step 4 boundary).
--
-- Authority: KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 **Ruling 1** —
--   the exact revocation scope "must be cryptographically bound into the
--   approval payload hash", is immutable after submission, and is consumed
--   single-use and atomically with the revocation.
-- Amends:    KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §3/§3.1.
--
-- Additive. Groups 0125-0140 are COMMITTED and are NOT edited. Group 0138
-- created `revocation_recorded_scopes` and its refusals (no wildcard, no empty
-- set, no wildcard token, four eyes, append-only). This group adds the ONE
-- thing Ruling 1 asks for that 0138 could not yet do: it makes the recorded
-- affected set a CRYPTOGRAPHIC term of the approval rather than a row that
-- merely cites one.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- WHAT 0138 LEFT OPEN, IN 0138'S OWN WORDS
-- ===========================================================================
-- Group 0138's header explains why the broader scope is written down in
-- `kitluy_devices` rather than inside the approval: a KitLuy approval request
-- carries a payload HASH, not a payload, so "there is no column in which a
-- request could enumerate credentials".
--
-- That is true and this group does not change it. But it left a gap Ruling 1
-- names exactly: the scope row CITES `approval_request_id`, and nothing tied
-- the bytes of that row to the bytes the approvers approved. Two failures were
-- reachable:
--
--   * a scope row could name approval X while describing an affected set the
--     approvers of X never saw — the citation is not a binding;
--   * a second scope row for a different incident reference could be recorded
--     and then used, because single use was enforced on the APPROVAL
--     (`revocation_recorded_scopes_approval_idx`) but nothing consumed the
--     SCOPE atomically with the revocation it authorized.
--
-- Ruling 1 closes both: the digest of the canonical affected set is a term of
-- `payload_hash`, so an approval either commits to this exact set or it does
-- not verify at all; and the scope is spent exactly once, in the same
-- transaction as the revocation.
--
-- ===========================================================================
-- THE ONE PRIVILEGE THIS GROUP ADDS, AND WHY IT IS THE MINIMUM
-- ===========================================================================
-- RECORDED CONFLICT — see the decision-and-reconciliation register entry
-- RC-015. Group 0140 wrote, correctly for group 0140, that the approval reader
-- holds "no read of payload_hash or reason at all", and its assertions proved
-- it. Ruling 1 now REQUIRES the binding to be verified, and a binding to a hash
-- cannot be verified without reading that hash. Ruling 1 and Ruling 2 are the
-- same owner decision and must both hold, so the minimum that satisfies both is
-- taken here:
--
--   * `kitluy_credential_approval_reader` gains SELECT on ONE further column,
--     `kitluy_auth.approval_requests.payload_hash`, on rows it can ALREADY see;
--   * NO new RLS policy is created, so the section 7 SELECT-policy census stays
--     at the 58 -> 61 Ruling 2 approved and moves no further;
--   * `reason` stays unreadable, every other kitluy_auth relation stays
--     unreadable, and the gate still returns a verdict and never a hash;
--   * a hash is not a payload. It discloses nothing about the affected set to a
--     role that does not already know the set; it only lets that role check an
--     equality it is required to check.
--
-- The alternative — a definer owned by some role that can already read
-- `payload_hash` — is refused: no such role exists here except `service_role`,
-- whose global BYPASSRLS is exactly what Ruling 2 removed from this path.
-- Re-introducing it to check a hash would undo Ruling 2 to satisfy Ruling 1.
--
-- ===========================================================================
-- WHAT THIS GROUP DELIBERATELY DOES NOT DO
-- ===========================================================================
--   * it does not weaken or re-open any 0138 refusal — every CHECK there still
--     stands and is re-proved in assertions;
--   * it does not make the scope mutable in any way: the digest and the payload
--     hash are COMPUTED by a BEFORE INSERT trigger from the stored identifiers,
--     never accepted from the caller, and 0138's append-only trigger still
--     refuses every UPDATE and DELETE;
--   * it does not let a caller choose scope — `resolve_revocation_scope_v1`
--     still derives scope from the REASON;
--   * it does not touch the emergency path's one-way trigger (Ruling 3).

-- Both memberships are BORROWED so this migration can transfer ownership, and
-- both are HANDED BACK before commit — groups 0134/0136/0137/0138/0139/0140 do
-- the same, and section 32's containment assertion refuses a migration that
-- keeps one.
do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
  execute format('grant kitluy_credential_approval_reader to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. THE CANONICAL FORM.
--
-- "Canonical scope bytes have one stable representation" (Ruling 1). Three
-- things make that true here:
--
--   * every identifier list is DEDUPLICATED and SORTED, so reordering or
--     repeating an identifier cannot change the bytes;
--   * every field is emitted as a `name=value` line in a FIXED order, with the
--     cardinality emitted next to the list, so a value containing the
--     separator cannot be confused for a new field (an identifier is a uuid or
--     a provider reference; the count pins the list length independently);
--   * NULL and empty are distinguishable: NULL renders as the two characters
--     `\N`, which no uuid, key reference or fingerprint can spell.
--
-- IMMUTABLE, so the result can be recomputed identically forever and used from
-- a generated column, a CHECK or a trigger.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.canonical_identifier_list_v1(p_values text[])
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $canon_list$
  -- distinct + sorted: the two operations that make reordering and duplication
  -- unable to change the bytes. NULL members are dropped, not rendered, so a
  -- NULL smuggled into an array cannot vary the digest.
  select coalesce(string_agg(v, ',' order by v), '')
    from (select distinct unnest(coalesce(p_values, array[]::text[])) as v) s
   where v is not null;
$canon_list$;

comment on function kitluy_devices.canonical_identifier_list_v1(text[]) is
  'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1. One stable representation of an identifier list: DISTINCT, SORTED, comma-joined, NULL members dropped. Reordering or duplicating an identifier cannot change the bytes, which is what makes the scope digest a binding rather than a description.';

create or replace function kitluy_devices.canonical_revocation_scope_v1(
  p_reason kitluy_devices.credential_revocation_reason,
  p_environment text,
  p_subject_type text,
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_requester_ref text,
  p_decision_version text,
  p_affected_device_ids uuid[],
  p_affected_key_references text[],
  p_affected_fingerprints text[],
  p_affected_credential_ids uuid[]
)
returns text
language sql
immutable
parallel safe
set search_path = kitluy_devices, pg_catalog
as $canon_scope$
  -- Fixed field order. Every line is `name=value`. `\N` is the NULL rendering
  -- and is unspellable by any uuid, key reference or fingerprint.
  select concat_ws(E'\n',
    'kitluy.revocation.scope.v1',
    'decision_version='  || coalesce(p_decision_version, '\N'),
    'reason='            || coalesce(p_reason::text, '\N'),
    'environment='       || coalesce(p_environment, '\N'),
    'subject_type='      || coalesce(p_subject_type, '\N'),
    'tenant='            || coalesce(p_tenant_id::text, '\N'),
    'digital_store='     || coalesce(p_digital_store_id::text, '\N'),
    'store_location='    || coalesce(p_store_location_id::text, '\N'),
    'requester='         || coalesce(p_requester_ref, '\N'),
    'devices_n='         || cardinality(coalesce(p_affected_device_ids, array[]::uuid[])),
    'devices='           || kitluy_devices.canonical_identifier_list_v1(coalesce(p_affected_device_ids, array[]::uuid[])::text[]),
    'key_references_n='  || cardinality(coalesce(p_affected_key_references, array[]::text[])),
    'key_references='    || kitluy_devices.canonical_identifier_list_v1(coalesce(p_affected_key_references, array[]::text[])),
    'fingerprints_n='    || cardinality(coalesce(p_affected_fingerprints, array[]::text[])),
    'fingerprints='      || kitluy_devices.canonical_identifier_list_v1(coalesce(p_affected_fingerprints, array[]::text[])),
    'credentials_n='     || cardinality(coalesce(p_affected_credential_ids, array[]::uuid[])),
    'credentials='       || kitluy_devices.canonical_identifier_list_v1(coalesce(p_affected_credential_ids, array[]::uuid[])::text[]),
    'identifier_count='  || (cardinality(coalesce(p_affected_device_ids, array[]::uuid[]))
                           + cardinality(coalesce(p_affected_key_references, array[]::text[]))
                           + cardinality(coalesce(p_affected_fingerprints, array[]::text[]))
                           + cardinality(coalesce(p_affected_credential_ids, array[]::uuid[])))
  );
$canon_scope$;

comment on function kitluy_devices.canonical_revocation_scope_v1 is
  'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1. The canonical bytes of a revocation scope, binding EVERY term the ruling enumerates: sorted canonical affected identifiers, reason, environment, tenant / digital store / store location, subject type, identifier count, requester and owner-decision version. Fixed field order, `\N` for NULL, per-list cardinality emitted beside each list. IMMUTABLE, so the same scope always produces the same bytes and a changed scope always produces different bytes.';

create or replace function kitluy_devices.revocation_scope_digest_v1(p_canonical text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $digest$
  select encode(sha256(convert_to(p_canonical, 'UTF8')), 'hex');
$digest$;

comment on function kitluy_devices.revocation_scope_digest_v1(text) is
  'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1. SHA-256 of the canonical scope bytes, hex. The "exact scope digest" the ruling requires to be included in payload_hash.';

-- The approval payload hash. The scope digest is a TERM of it, not the whole of
-- it: an approval commits to this exact affected set AND to the reason,
-- environment, tenancy, subject type, identifier count, requester and decision
-- version it was granted under. Change any one and the hash changes, so the
-- approval no longer verifies and the revocation fails closed.
create or replace function kitluy_devices.revocation_approval_payload_hash_v1(
  p_scope_digest text,
  p_reason kitluy_devices.credential_revocation_reason,
  p_environment text,
  p_subject_type text,
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_identifier_count integer,
  p_requester_ref text,
  p_decision_version text
)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $payload_hash$
  select encode(sha256(convert_to(concat_ws(E'\n',
    'kitluy.revocation.approval.v1',
    'decision_version=' || coalesce(p_decision_version, '\N'),
    'scope_digest='     || coalesce(p_scope_digest, '\N'),
    'reason='           || coalesce(p_reason::text, '\N'),
    'environment='      || coalesce(p_environment, '\N'),
    'subject_type='     || coalesce(p_subject_type, '\N'),
    'tenant='           || coalesce(p_tenant_id::text, '\N'),
    'digital_store='    || coalesce(p_digital_store_id::text, '\N'),
    'store_location='   || coalesce(p_store_location_id::text, '\N'),
    'identifier_count=' || coalesce(p_identifier_count::text, '\N'),
    'requester='        || coalesce(p_requester_ref, '\N')
  ), 'UTF8')), 'hex');
$payload_hash$;

comment on function kitluy_devices.revocation_approval_payload_hash_v1 is
  'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1. The value `kitluy_auth.approval_requests.payload_hash` must carry for a recorded-scope revocation. Binds the exact scope digest together with reason, environment, subject type, tenant / digital store / store location, identifier count, requester and owner-decision version. Domain-separated from the scope digest by its own prefix so one can never be replayed as the other.';

-- ---------------------------------------------------------------------------
-- 2. THE BOUND COLUMNS.
--
-- Additive to group 0138's table. The digest and the payload hash are NOT
-- caller-supplied: section 3's BEFORE INSERT trigger computes them from the
-- stored identifiers. A caller therefore cannot record a row whose digest
-- disagrees with its own contents, and 0138's append-only trigger means no one
-- can move them afterwards.
-- ---------------------------------------------------------------------------
alter table kitluy_devices.revocation_recorded_scopes
  add column if not exists subject_type text not null default 'CREDENTIAL',
  add column if not exists tenant_id uuid,
  add column if not exists digital_store_id uuid,
  add column if not exists store_location_id uuid,
  add column if not exists requester_ref text,
  add column if not exists decision_version text not null
    default 'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002',
  add column if not exists identifier_count integer,
  add column if not exists scope_digest text,
  add column if not exists payload_hash text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'revocation_recorded_scopes_subject_type_chk') then
    alter table kitluy_devices.revocation_recorded_scopes
      add constraint revocation_recorded_scopes_subject_type_chk
      check (subject_type in ('DEVICE', 'KEY', 'CREDENTIAL', 'MIXED'));
  end if;
  -- The digest and hash are 64 hex characters or the row is not bound. A NULL
  -- here would be a scope with no binding, which Ruling 1 fails closed on.
  if not exists (select 1 from pg_constraint
                  where conname = 'revocation_recorded_scopes_digest_shape_chk') then
    alter table kitluy_devices.revocation_recorded_scopes
      add constraint revocation_recorded_scopes_digest_shape_chk
      check (scope_digest ~ '^[0-9a-f]{64}$' and payload_hash ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'revocation_recorded_scopes_identifier_count_chk') then
    alter table kitluy_devices.revocation_recorded_scopes
      add constraint revocation_recorded_scopes_identifier_count_chk
      check (identifier_count = cardinality(affected_device_ids)
                              + cardinality(affected_key_references)
                              + cardinality(affected_fingerprints)
                              + cardinality(affected_credential_ids)
             and identifier_count > 0);
  end if;
end
$$;

comment on column kitluy_devices.revocation_recorded_scopes.scope_digest is
  'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1. SHA-256 of the canonical scope bytes, COMPUTED by trg_revocation_recorded_scopes_bind and never accepted from a caller.';
comment on column kitluy_devices.revocation_recorded_scopes.payload_hash is
  'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1. The value the approving kitluy_auth.approval_requests row must carry in its own payload_hash for this scope to be usable. COMPUTED, never accepted from a caller. Immutable afterwards (group 0138 append-only trigger).';

-- ---------------------------------------------------------------------------
-- 3. THE BINDING IS COMPUTED, NOT ASSERTED.
--
-- A caller that could supply `scope_digest` could supply one that does not
-- describe the row it sits on. So the caller supplies neither. This trigger
-- derives both values from the identifiers actually being stored, immediately
-- before they are stored.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.bind_revocation_scope()
returns trigger
language plpgsql
set search_path = kitluy_devices, pg_catalog
as $bind$
declare
  v_canonical text;
begin
  new.identifier_count :=
      cardinality(coalesce(new.affected_device_ids, array[]::uuid[]))
    + cardinality(coalesce(new.affected_key_references, array[]::text[]))
    + cardinality(coalesce(new.affected_fingerprints, array[]::text[]))
    + cardinality(coalesce(new.affected_credential_ids, array[]::uuid[]));

  v_canonical := kitluy_devices.canonical_revocation_scope_v1(
    new.reason_code, new.environment, new.subject_type,
    new.tenant_id, new.digital_store_id, new.store_location_id,
    new.requester_ref, new.decision_version,
    new.affected_device_ids, new.affected_key_references,
    new.affected_fingerprints, new.affected_credential_ids);

  new.scope_digest := kitluy_devices.revocation_scope_digest_v1(v_canonical);
  new.payload_hash := kitluy_devices.revocation_approval_payload_hash_v1(
    new.scope_digest, new.reason_code, new.environment, new.subject_type,
    new.tenant_id, new.digital_store_id, new.store_location_id,
    new.identifier_count, new.requester_ref, new.decision_version);
  return new;
end
$bind$;

comment on function kitluy_devices.bind_revocation_scope() is
  'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1. Computes scope_digest and payload_hash from the identifiers actually being stored, so a caller cannot record a scope whose binding disagrees with its own contents. Group 0138''s append-only trigger then makes both immutable.';

-- BEFORE INSERT only. There is deliberately no UPDATE branch: group 0138's
-- append-only trigger refuses every UPDATE on this table, and adding one here
-- would imply otherwise.
drop trigger if exists trg_revocation_recorded_scopes_bind
  on kitluy_devices.revocation_recorded_scopes;
create trigger trg_revocation_recorded_scopes_bind
  before insert on kitluy_devices.revocation_recorded_scopes
  for each row execute function kitluy_devices.bind_revocation_scope();

-- ---------------------------------------------------------------------------
-- 4. SINGLE USE, ATOMIC WITH THE REVOCATION.
--
-- Consumption is a ROW, not a flag: `revocation_recorded_scopes` is append-only
-- and cannot carry a mutable "consumed" column without contradicting that.
--
-- The unique constraints do the work. Two concurrent revocations that both
-- reach this table for the same scope produce one INSERT and one unique
-- violation, in the same transactions as their revocations — so exactly one
-- revocation commits and the loser's revocation rolls back with it. That is
-- what "consumed atomically with the revocation" means here, and it is why
-- consumption is not a separate statement that could be skipped.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.revocation_scope_consumptions (
  consumption_id uuid primary key default gen_random_uuid(),
  incident_scope_id uuid not null
    references kitluy_devices.revocation_recorded_scopes (incident_scope_id),
  approval_request_id uuid not null,
  revocation_id uuid not null,
  environment text not null,
  -- The digest the consumer verified against, kept so the evidence says WHAT
  -- was consumed and not merely THAT something was.
  scope_digest text not null,
  payload_hash text not null,
  consumed_by text not null,
  consumed_at timestamptz not null default clock_timestamp(),
  sequence_no bigint generated always as identity,

  -- Single use, three ways, because each is a distinct replay:
  constraint revocation_scope_consumptions_scope_once unique (incident_scope_id),
  constraint revocation_scope_consumptions_approval_once unique (approval_request_id),
  constraint revocation_scope_consumptions_revocation_once unique (revocation_id),
  constraint revocation_scope_consumptions_digest_chk
    check (scope_digest ~ '^[0-9a-f]{64}$' and payload_hash ~ '^[0-9a-f]{64}$'),
  constraint revocation_scope_consumptions_actor_chk check (btrim(consumed_by) <> '')
);

comment on table kitluy_devices.revocation_scope_consumptions is
  'Owner: Security. KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1 — "approval consumption must be single-use and atomic with revocation". Append-only. One row per scope, per approval and per revocation, each enforced by its own UNIQUE constraint because each is a different replay: re-using a scope, re-using an approval, and attaching two scopes to one revocation. Inserted inside the revoking transaction, so a duplicate does not merely fail the insert, it fails the revocation. MC: A/O.';

create trigger trg_revocation_scope_consumptions_append_only
  before update or delete on kitluy_devices.revocation_scope_consumptions
  for each row execute function kitluy_auth.enforce_append_only();

alter table kitluy_devices.revocation_scope_consumptions enable row level security;
alter table kitluy_devices.revocation_scope_consumptions force row level security;

grant select, insert on kitluy_devices.revocation_scope_consumptions
  to kitluy_credential_issuer;
grant select on kitluy_devices.revocation_scope_consumptions to service_role;

create policy revocation_scope_consumptions_issuer_write
  on kitluy_devices.revocation_scope_consumptions
  for all to kitluy_credential_issuer using (true) with check (true);
create policy revocation_scope_consumptions_service_read
  on kitluy_devices.revocation_scope_consumptions
  for select to service_role using (true);

-- ---------------------------------------------------------------------------
-- 5. THE MINIMUM PRIVILEGE RULING 1 REQUIRES — see the header and RC-015.
--
-- One column, on rows the reader can already see, with NO new policy: the
-- Ruling 2 census stays at 61.
-- ---------------------------------------------------------------------------
grant select (payload_hash) on kitluy_auth.approval_requests
  to kitluy_credential_approval_reader;

-- ---------------------------------------------------------------------------
-- 6. THE VERIFIER.
--
-- Owned by the same NOLOGIN, non-BYPASSRLS reader group 0140 established, for
-- the same reason: the identity that touches `kitluy_auth` is the one that can
-- see nothing else in the database. Returns a verdict. Never returns the hash,
-- the payload, or the scope row.
--
-- FAILS CLOSED on every one of Ruling 1's listed failures: missing scope,
-- empty scope, wildcard scope, malformed scope, a digest that does not
-- recompute, and a payload hash the approval does not carry.
-- ---------------------------------------------------------------------------
-- The ONE fact the verifier needs from kitluy_auth, asked of the ONE identity
-- Ruling 2 allows to ask. Owned by the NOLOGIN, non-BYPASSRLS reader, whose
-- entire reach is the three Ruling 2 policies; it can therefore see this row
-- only if the approval's action is `device_credential_revocation`. Returns a
-- hash, never a row, never a payload, never a reason.
create or replace function kitluy_devices.credential_revocation_approval_payload_hash_v1(
  p_approval_request_id uuid
) returns text
language sql
stable
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $approval_hash$
  select lower(btrim(r.payload_hash))
    from kitluy_auth.approval_requests r
   where r.id = p_approval_request_id
     and r.payload_hash is not null
     and btrim(r.payload_hash) <> '';
$approval_hash$;

create or replace function kitluy_devices.verify_revocation_scope_binding_v1(
  p_incident_scope_id uuid,
  p_approval_request_id uuid,
  p_environment text
) returns kitluy_devices.approval_verdict
language plpgsql
stable
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $verify$
declare
  v_scope kitluy_devices.revocation_recorded_scopes;
  v_recomputed_digest text;
  v_expected_payload_hash text;
  v_approval_payload_hash text;
  v_deny constant text := 'KLUY-CRED-REVOCATION-SCOPE-';
begin
  if p_incident_scope_id is null then
    return row(false, v_deny || 'MISSING',
      'this revocation reason requires a recorded scope and none was presented')::kitluy_devices.approval_verdict;
  end if;
  if p_approval_request_id is null then
    return row(false, v_deny || 'UNAPPROVED',
      'a recorded scope is authority only together with the approval it is bound to')::kitluy_devices.approval_verdict;
  end if;

  select * into v_scope
    from kitluy_devices.revocation_recorded_scopes
   where incident_scope_id = p_incident_scope_id;
  if not found then
    return row(false, v_deny || 'MISSING',
      format('recorded scope %s does not exist', p_incident_scope_id))::kitluy_devices.approval_verdict;
  end if;

  -- The scope must belong to the approval it is presented with. A scope row
  -- that cites a different approval is not authority for this one.
  if v_scope.approval_request_id is distinct from p_approval_request_id then
    return row(false, v_deny || 'MISMATCH',
      'the recorded scope is not bound to this approval request')::kitluy_devices.approval_verdict;
  end if;
  if v_scope.environment is distinct from p_environment then
    return row(false, v_deny || 'MISMATCH',
      format('the recorded scope is scoped to environment %s, not %s',
             v_scope.environment, p_environment))::kitluy_devices.approval_verdict;
  end if;

  -- Empty and wildcard, re-checked here rather than trusted to the CHECKs that
  -- also forbid them. A verifier that assumes its inputs were validated is a
  -- verifier that stops verifying the day the inputs change.
  if coalesce(v_scope.identifier_count, 0) = 0 then
    return row(false, v_deny || 'EMPTY',
      'an empty affected set is an unrestricted one')::kitluy_devices.approval_verdict;
  end if;
  if v_scope.unrestricted_wildcard
     or v_scope.affected_key_references && array['*', '%', 'ALL', 'all', 'ANY', 'any']::text[]
     or v_scope.affected_fingerprints && array['*', '%', 'ALL', 'all', 'ANY', 'any']::text[] then
    return row(false, v_deny || 'WILDCARD',
      'decision §3.1 forbids an unrestricted affected set, however it is spelled')::kitluy_devices.approval_verdict;
  end if;
  if v_scope.scope_digest is null or v_scope.payload_hash is null
     or v_scope.scope_digest !~ '^[0-9a-f]{64}$' or v_scope.payload_hash !~ '^[0-9a-f]{64}$' then
    return row(false, v_deny || 'MALFORMED',
      'the recorded scope carries no well-formed binding')::kitluy_devices.approval_verdict;
  end if;

  -- Recompute from the identifiers as stored. If the row were ever altered
  -- around the stored digest, this is where it stops.
  v_recomputed_digest := kitluy_devices.revocation_scope_digest_v1(
    kitluy_devices.canonical_revocation_scope_v1(
      v_scope.reason_code, v_scope.environment, v_scope.subject_type,
      v_scope.tenant_id, v_scope.digital_store_id, v_scope.store_location_id,
      v_scope.requester_ref, v_scope.decision_version,
      v_scope.affected_device_ids, v_scope.affected_key_references,
      v_scope.affected_fingerprints, v_scope.affected_credential_ids));
  if v_recomputed_digest is distinct from v_scope.scope_digest then
    return row(false, v_deny || 'DIGEST-MISMATCH',
      'the recorded scope does not hash to its own stored digest')::kitluy_devices.approval_verdict;
  end if;

  v_expected_payload_hash := kitluy_devices.revocation_approval_payload_hash_v1(
    v_recomputed_digest, v_scope.reason_code, v_scope.environment, v_scope.subject_type,
    v_scope.tenant_id, v_scope.digital_store_id, v_scope.store_location_id,
    v_scope.identifier_count, v_scope.requester_ref, v_scope.decision_version);
  if v_expected_payload_hash is distinct from v_scope.payload_hash then
    return row(false, v_deny || 'DIGEST-MISMATCH',
      'the recorded scope does not hash to its own stored payload hash')::kitluy_devices.approval_verdict;
  end if;

  -- The binding itself: does the APPROVAL commit to this exact scope? One
  -- column, one equality, no payload and no hash returned to the caller.
  -- Asked of the READER, which is the only identity that touches kitluy_auth.
  -- It returns ONE hash for ONE credential-revocation approval and nothing
  -- else — no row, no payload, no reason. The environment is not re-read here
  -- because it is already a TERM of the hash being compared: an approval
  -- granted for another environment cannot produce this value.
  v_approval_payload_hash :=
    kitluy_devices.credential_revocation_approval_payload_hash_v1(p_approval_request_id);
  if v_approval_payload_hash is null then
    return row(false, v_deny || 'UNAPPROVED',
      format('approval request %s does not exist, or is not a credential-revocation approval',
             p_approval_request_id))::kitluy_devices.approval_verdict;
  end if;
  -- A missing payload hash is NOT "nothing to check". Ruling 1 fails closed.
  if v_approval_payload_hash is null or btrim(v_approval_payload_hash) = '' then
    return row(false, v_deny || 'UNBOUND',
      'the approval carries no payload hash, so it commits to no scope')::kitluy_devices.approval_verdict;
  end if;
  if lower(btrim(v_approval_payload_hash)) is distinct from v_expected_payload_hash then
    return row(false, v_deny || 'HASH-MISMATCH',
      'the approval does not commit to this affected set')::kitluy_devices.approval_verdict;
  end if;

  -- Already spent? The consumption table is in kitluy_devices and the reader
  -- holds no grant on it, so this is asked of the governor exactly as group
  -- 0140 asks the single-use question.
  if kitluy_devices.revocation_scope_consumed_v1(p_incident_scope_id, p_approval_request_id) then
    return row(false, v_deny || 'CONSUMED',
      'this recorded scope has already authorized a revocation')::kitluy_devices.approval_verdict;
  end if;

  return row(true, null, null)::kitluy_devices.approval_verdict;
end
$verify$;

-- The single-use fact, asked of the role that owns the evidence — group 0140's
-- pattern, for group 0140's reason: the reader deliberately holds no grant and
-- no policy on kitluy_devices consumption evidence, and zero rows there would
-- be a FAIL-OPEN rather than a refusal.
create or replace function kitluy_devices.revocation_scope_consumed_v1(
  p_incident_scope_id uuid,
  p_approval_request_id uuid
) returns boolean
language sql
stable
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $consumed_scope$
  select exists (
    select 1 from kitluy_devices.revocation_scope_consumptions
     where incident_scope_id = p_incident_scope_id
        or approval_request_id = p_approval_request_id);
$consumed_scope$;

alter function kitluy_devices.revocation_scope_consumed_v1(uuid, uuid)
  owner to kitluy_credential_issuer;
revoke all on function kitluy_devices.revocation_scope_consumed_v1(uuid, uuid) from public;
grant execute on function kitluy_devices.revocation_scope_consumed_v1(uuid, uuid)
  to kitluy_credential_issuer;

comment on function kitluy_devices.revocation_scope_consumed_v1(uuid, uuid) is
  'Answers ONE question — has this recorded scope or its approval already authorized a revocation — for the scope verifier, which runs as kitluy_credential_approval_reader and deliberately holds no grant on kitluy_devices.revocation_scope_consumptions. SECURITY DEFINER owned by kitluy_credential_issuer, pinned search_path, no dynamic SQL, no writes, returns a boolean and never a row. If this EXECUTE were removed the verifier would RAISE rather than treat a spent scope as unspent: fail closed, not fail open.';

-- Ownership transfer, with the same borrowed-CREATE dance and the same
-- immediate revoke group 0140 documented.
-- The HASH HELPER is the reader's, for the reason group 0140 established: the
-- identity that touches kitluy_auth is the one that can see nothing else.
grant create on schema kitluy_devices to kitluy_credential_approval_reader;
alter function kitluy_devices.credential_revocation_approval_payload_hash_v1(uuid)
  owner to kitluy_credential_approval_reader;
revoke create on schema kitluy_devices from kitluy_credential_approval_reader;

revoke all on function
  kitluy_devices.credential_revocation_approval_payload_hash_v1(uuid) from public;
grant execute on function
  kitluy_devices.credential_revocation_approval_payload_hash_v1(uuid)
  to kitluy_credential_issuer;

-- The VERIFIER is the GOVERNOR's, because it reads
-- `kitluy_devices.revocation_recorded_scopes` — the governor's own table, under
-- the governor's own policy. Making the reader own this would have required
-- granting the reader a table and a policy in kitluy_devices, widening exactly
-- the surface Ruling 2 narrowed. The split is deliberate: the governor knows
-- the scope (it is revoking it) and learns one hash; the reader knows the
-- approval and learns nothing about the scope.
alter function kitluy_devices.verify_revocation_scope_binding_v1(uuid, uuid, text)
  owner to kitluy_credential_issuer;

revoke all on function
  kitluy_devices.verify_revocation_scope_binding_v1(uuid, uuid, text) from public;
grant execute on function
  kitluy_devices.verify_revocation_scope_binding_v1(uuid, uuid, text)
  to kitluy_credential_issuer;

comment on function kitluy_devices.verify_revocation_scope_binding_v1(uuid, uuid, text) is
  'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1. Proves that an approval cryptographically commits to an exact recorded affected set before that set may be revoked. Recomputes the canonical scope digest from the identifiers as stored, recomputes the expected approval payload hash from the digest plus reason, environment, subject type, tenant / digital store / store location, identifier count, requester and decision version, and compares it to kitluy_auth.approval_requests.payload_hash. Fails closed on a missing, empty, wildcard, malformed, unbound, mismatched or already-consumed scope. SECURITY DEFINER owned by the NOLOGIN, non-BYPASSRLS kitluy_credential_approval_reader whose only kitluy_auth reach is three Ruling 2 policies plus SELECT on the single payload_hash column this verification requires (RC-015); pinned search_path, no dynamic SQL, no writes; returns an approval_verdict and never a hash, a payload or a scope row. EXECUTE revoked from PUBLIC, granted only to kitluy_credential_issuer.';

-- ---------------------------------------------------------------------------
-- 7. CONSUMPTION, CALLABLE ONLY BY THE GOVERNOR.
--
-- Deliberately NOT a "check then write": the UNIQUE constraints are the
-- decision. A caller that raced another to the same scope loses here, inside
-- its own revoking transaction, and its revocation rolls back with it.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.consume_revocation_scope_v1(
  p_incident_scope_id uuid,
  p_approval_request_id uuid,
  p_revocation_id uuid,
  p_environment text,
  p_consumed_by text
) returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $consume$
declare
  v_scope kitluy_devices.revocation_recorded_scopes;
begin
  select * into v_scope from kitluy_devices.revocation_recorded_scopes
   where incident_scope_id = p_incident_scope_id;
  if not found then
    return jsonb_build_object('outcome', 'SCOPE_REFUSED',
      'refusal_code', 'KLUY-CRED-REVOCATION-SCOPE-MISSING',
      'detail', 'a scope that does not exist cannot be consumed');
  end if;

  insert into kitluy_devices.revocation_scope_consumptions (
    incident_scope_id, approval_request_id, revocation_id, environment,
    scope_digest, payload_hash, consumed_by)
  values (
    p_incident_scope_id, p_approval_request_id, p_revocation_id, p_environment,
    v_scope.scope_digest, v_scope.payload_hash, p_consumed_by);

  return jsonb_build_object('outcome', 'CONSUMED',
    'incident_scope_id', p_incident_scope_id,
    'scope_digest', v_scope.scope_digest);
exception
  -- A replay. The caller is told, and because this runs inside the revoking
  -- transaction the caller's own revocation does not survive either.
  when unique_violation then
    return jsonb_build_object('outcome', 'SCOPE_REFUSED',
      'refusal_code', 'KLUY-CRED-REVOCATION-SCOPE-CONSUMED',
      'detail', 'this recorded scope, approval or revocation has already been consumed');
end
$consume$;

alter function kitluy_devices.consume_revocation_scope_v1(uuid, uuid, uuid, text, text)
  owner to kitluy_credential_issuer;
revoke all on function
  kitluy_devices.consume_revocation_scope_v1(uuid, uuid, uuid, text, text) from public;
grant execute on function
  kitluy_devices.consume_revocation_scope_v1(uuid, uuid, uuid, text, text)
  to kitluy_credential_issuer;

comment on function kitluy_devices.consume_revocation_scope_v1(uuid, uuid, uuid, text, text) is
  'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1 — single-use consumption, atomic with the revocation. Writes the append-only consumption row inside the revoking transaction; the UNIQUE constraints on scope, approval and revocation are the decision, so a concurrent replay loses here and its revocation rolls back with it rather than being detected afterwards. EXECUTE revoked from PUBLIC and granted only to the credential governor.';

-- ---------------------------------------------------------------------------
-- 8. FUNCTION HYGIENE.
--
-- PostgreSQL grants EXECUTE to PUBLIC at creation. The canonicalizer, the two
-- hash functions and the binding trigger are pure and disclose nothing on their
-- own, but "it leaks nothing" is not the standard this repository holds
-- functions to — section 32's permanent hygiene assertion refuses a PUBLIC
-- EXECUTE in `kitluy_devices` outright, and a digest function reachable by
-- anyone is a free oracle for confirming guessed affected sets.
--
-- The governor needs them because `record_revocation_scope_v1` is its definer
-- and the binding trigger fires inside it; the reader needs them because
-- `verify_revocation_scope_binding_v1` recomputes the digest under its own
-- ownership. Nothing else does.
-- ---------------------------------------------------------------------------
do $hygiene_0141$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname in ('canonical_identifier_list_v1',
                         'canonical_revocation_scope_v1',
                         'revocation_scope_digest_v1',
                         'revocation_approval_payload_hash_v1',
                         'bind_revocation_scope',
                         'credential_revocation_approval_payload_hash_v1')
  loop
    execute format('revoke all on function %s from public', r.signature);
    execute format('grant execute on function %s to kitluy_credential_issuer', r.signature);
    execute format('grant execute on function %s to kitluy_credential_approval_reader', r.signature);
  end loop;
end
$hygiene_0141$;

-- The memberships borrowed at the top are HANDED BACK, exactly as groups
-- 0134/0136/0137/0138/0139/0140 do. A migration that kept one would leave the
-- login-capable migration role able to SET ROLE to a governor for ever, which
-- is what the permanent assertion in section 32 refuses.
do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
  execute format('revoke kitluy_credential_approval_reader from %I', current_user);
end
$hand_back$;
