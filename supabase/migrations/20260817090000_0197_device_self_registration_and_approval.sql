-- kitluy:migration:0197
--
-- ADMIN-APPROVED DEVICE REGISTRATION, AND PERMANENT BOARD IDENTITY
-- =============================================================================
-- Authority: the owner plan "KitLuy Admin-Approved Device Registration —
-- Direct-to-Cloud Hybrid Trust Plan v1.0.0" (2026-08-17), §1.1-§1.7.
--
-- THE OWNER RULE THIS GROUP EXISTS TO ENFORCE
-- -------------------------------------------
--   "One physical Raspberry Pi board maps to one permanent opaque KitLuy
--    device_record_id. Hardware evidence RESOLVES that identity; it does not
--    DEFINE or replace it. OS/storage installations and cryptographic
--    credentials are independent versioned child lifecycles. Unknown hardware
--    may register only as untrusted and receives no Store-operational trust
--    until HET verification and approval."
--
-- WHAT WAS WRONG BEFORE
-- ---------------------
-- Development open enrollment called `enroll_device_v1`, which creates a device
-- row and moves it `manufactured -> enrolled` in ONE atomic call. So any Pi that
-- could reach the endpoint became immediately pairable, and — worse — a
-- REFLASHED board arrived as a brand-new device carrying the SAME `board_serial`,
-- which `colliding_evidence_device_ids` correctly flagged and
-- `quarantine_evidence_collisions_v1` quarantined. Observed on real hardware this
-- month. The database was reporting that the identity anchor was wrong: identity
-- was effectively following the SD card, because the key lives on the card.
--
-- WHAT THIS GROUP DOES NOT DO
-- ---------------------------
-- It does not issue any operational credential or certificate. Registration
-- proof-of-possession authenticates a request to its own self-presented key and
-- proves NOTHING about which board sent it (plan §2.3). Operational trust stays
-- certificate/PKI controlled and gated on BLK-005.
--
-- It adds NO credential table: `device_credentials.certificate_generation` plus
-- `device_credential_heads.current_generation/previous_generation` already
-- implement credential generations in full (plan §13.1).
--
-- ===========================================================================
-- kitluy:destructive-approved:KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001
-- ===========================================================================
-- The destructive statements in this group are `drop trigger if exists` and
-- `revoke all` against objects THIS FILE creates in the same transaction — the
-- create-or-replace idiom groups 0140/0141 already use. No pre-existing table,
-- column, trigger, function or grant is dropped, and no row is deleted: the one
-- schema change to an existing table is an ADDITIVE nullable column.
-- ===========================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Reported hostname (plan §1.1)
-- -----------------------------------------------------------------------------
-- Operator-facing and MUTABLE. This is the name an operator reads off the Pi's
-- own console — the `pi5-zjjtir` an admin must be able to match against the
-- fleet list before approving. It is deliberately NOT a hardware signal: the
-- signal enum is a closed hardware vocabulary and a hostname is OS
-- configuration that changes without the board changing.
alter table kitluy_devices.devices
  add column if not exists reported_hostname text;

comment on column kitluy_devices.devices.reported_hostname is
  'Last hostname the device reported at registration. Operator-facing, mutable, non-secret, and NEVER an identity input — it exists so an admin can match a pending row to the physical unit in front of them.';

-- -----------------------------------------------------------------------------
-- 1b. A name for credential reuse (plan §1.5 Path D, §7.3)
-- -----------------------------------------------------------------------------
-- `trust_incident_type` had no value for "this key is already another board's".
-- The nearest existing value, `key_fingerprint_mismatch`, means the OPPOSITE
-- thing — a board presenting a key that is not the one on record — and reusing
-- it would make a copied-appliance report indistinguishable from an ordinary
-- key mismatch in the very view HET is supposed to triage from.
--
-- ADD VALUE is additive and irreversible-by-design in PostgreSQL; no existing
-- value is renamed or removed, so no stored row changes meaning. The new value
-- is not USED anywhere in this transaction, which is what PostgreSQL requires
-- of a value added inside one.
alter type kitluy_devices.trust_incident_type
  add value if not exists 'credential_reuse_detected';

-- -----------------------------------------------------------------------------
-- 2. Installation generations (plan §1.2)
-- -----------------------------------------------------------------------------
-- The child lifecycle that makes board continuity honest. A reflash keeps the
-- board's `device_record_id` and starts a NEW installation generation, so the
-- fleet can answer "same board, third SD card" instead of pretending nothing
-- changed or inventing a second device.
--
-- Deliberately its own table rather than JSON on `devices` (plan §1.2, "do not
-- encode authoritative installation history only in JSON metadata") and rather
-- than reusing `manufacturing_enrollments.enrollment_sequence`: that chain is
-- KEY generation. An OS reflash can happen without a key change and a key can
-- rotate without a reinstall, so collapsing them would lose the distinction the
-- owner asked for.
create table if not exists kitluy_devices.device_installations (
  id uuid primary key default gen_random_uuid(),
  device_record_id uuid not null references kitluy_devices.devices (id),
  generation integer not null,
  -- What made this a distinct installation: storage evidence, image digest,
  -- machine-id. STORAGE evidence belongs here and nowhere near identity
  -- resolution (plan §"Storage signals").
  installation_evidence jsonb not null default '{}'::jsonb,
  image_release_ref text,
  installation_fingerprint text not null,
  first_seen_at timestamptz not null default now(),
  superseded_at timestamptz,
  state text not null default 'current',
  created_by_actor_ref text not null,
  created_at timestamptz not null default now(),
  constraint device_installations_generation_positive check (generation >= 1),
  constraint device_installations_state_chk check (state in ('current', 'superseded')),
  -- A superseded generation is a fact with a time, or it is not superseded.
  constraint device_installations_supersede_coherent
    check ((state = 'superseded') = (superseded_at is not null)),
  constraint device_installations_generation_unique unique (device_record_id, generation),
  -- The same installation must not be recorded twice for one board: this is what
  -- makes a retried or replayed registration idempotent rather than additive.
  constraint device_installations_fingerprint_unique
    unique (device_record_id, installation_fingerprint)
);

comment on table kitluy_devices.device_installations is
  'One row per material OS/storage installation on a physical board. A reflash keeps device_record_id and opens a NEW generation; the previous generation is superseded, never deleted. Storage evidence lives HERE and is never used to resolve permanent board identity.';

create index if not exists device_installations_device_current_idx
  on kitluy_devices.device_installations (device_record_id)
  where state = 'current';

alter table kitluy_devices.device_installations enable row level security;
alter table kitluy_devices.device_installations force row level security;

-- History is append-and-supersede. An installation record is evidence of what
-- was on a board at a point in time; rewriting it would make the fleet's account
-- of a device unfalsifiable.
create or replace function kitluy_devices.enforce_installation_history()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-INSTALL-APPEND-ONLY: installation history is never deleted';
  end if;
  if old.device_record_id <> new.device_record_id
     or old.generation <> new.generation
     or old.installation_fingerprint <> new.installation_fingerprint
     or old.first_seen_at <> new.first_seen_at then
    raise exception
      'KLUY-INSTALL-IMMUTABLE: only state/superseded_at may change on an installation record';
  end if;
  if old.state = 'superseded' and new.state = 'current' then
    raise exception 'KLUY-INSTALL-NO-RESURRECT: a superseded installation is not restored';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_installation_history on kitluy_devices.device_installations;
create trigger enforce_installation_history
  before update or delete on kitluy_devices.device_installations
  for each row execute function kitluy_devices.enforce_installation_history();

-- -----------------------------------------------------------------------------
-- 3. Board resolution (plan §1.4)
-- -----------------------------------------------------------------------------
-- "Have I already registered this physical board?" — the question that makes
-- reflash continuity possible.
--
-- Returns a RESULT, not a bare uuid, because the honest answers include "I found
-- something but a human must look at it". A function that returned only a uuid
-- would force every caller to treat a weak match exactly like a strong one.
create or replace function kitluy_devices.resolve_device_by_board_evidence_v1(
  p_signals jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $resolve$
declare
  v_board text;
  v_soc text;
  v_mac text;
  v_ids uuid[];
  v_matched text[] := array[]::text[];
begin
  -- Signals arrive as [{signal_type, signal_value}, …], the same shape
  -- `enroll_device_v1` accepts.
  -- NORMALISED on the way in. Stored signals are constrained to
  -- `lower(btrim(value))`, so comparing a raw submitted value would let a board
  -- fail to recognise ITSELF over nothing but letter case — and a board that
  -- cannot match itself is a duplicate device and a quarantine.
  select kitluy_devices.normalize_hardware_signal(
           max(s->>'signal_value') filter (where s->>'signal_type' = 'board_serial')),
         kitluy_devices.normalize_hardware_signal(
           max(s->>'signal_value') filter (where s->>'signal_type' = 'soc_serial')),
         kitluy_devices.normalize_hardware_signal(
           max(s->>'signal_value') filter (where s->>'signal_type' = 'mac_address'))
    into v_board, v_soc, v_mac
    from jsonb_array_elements(coalesce(p_signals, '[]'::jsonb)) s;

  -- PREFERRED PATH: exact board_serial against the CURRENT manifest of a device
  -- that is not retired/replaced.
  --
  -- `is_storage_module_signal` is honoured by naming the signal types
  -- explicitly: storage evidence must never resolve a permanent board, or a card
  -- moved between two boards would merge two physical devices.
  if v_board is not null and v_board <> '' then
    select array_agg(distinct d.id) into v_ids
      from kitluy_devices.devices d
      join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
      join kitluy_devices.hardware_manifest_signals sig on sig.manifest_id = e.hardware_manifest_id
     where sig.signal_type = 'board_serial'
       and sig.signal_value = v_board
       and d.lifecycle_state not in ('retired', 'replaced');
    if v_ids is not null then v_matched := array_append(v_matched, 'board_serial'); end if;
  end if;

  -- Corroboration, not a fallback. `soc_serial` only strengthens or contradicts a
  -- board_serial match; on its own it is treated the same cautious way as MAC.
  if v_ids is not null and array_length(v_ids, 1) = 1
     and v_soc is not null and v_soc <> '' then
    if exists (
      select 1
        from kitluy_devices.devices d
        join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
        join kitluy_devices.hardware_manifest_signals sig on sig.manifest_id = e.hardware_manifest_id
       where d.id = v_ids[1] and sig.signal_type = 'soc_serial' and sig.signal_value = v_soc
    ) then
      v_matched := array_append(v_matched, 'soc_serial');
    end if;
  end if;

  -- More than one live device claims this board serial. Two physical boards
  -- cannot share one, so something is wrong that a human must resolve — and
  -- guessing here would attach a shop's Hub to the wrong record.
  if v_ids is not null and array_length(v_ids, 1) > 1 then
    return jsonb_build_object(
      'device_id', null,
      'confidence', 'conflict',
      'matched_signal_types', to_jsonb(v_matched),
      'requires_review', true,
      'conflict_reason', 'KLUY-BOARD-EVIDENCE-AMBIGUOUS');
  end if;

  if v_ids is not null then
    return jsonb_build_object(
      'device_id', v_ids[1],
      'confidence', case when 'soc_serial' = any (v_matched) then 'strong' else 'board_serial' end,
      'matched_signal_types', to_jsonb(v_matched),
      'requires_review', false,
      'conflict_reason', null);
  end if;

  -- NO board_serial match. A MAC-only match must NEVER automatically reclaim an
  -- existing device (plan §"MAC address"): MAC is reassignable and cloneable, so
  -- auto-merging on it would silently fuse two physical devices. Report the
  -- candidate for review and resolve nothing.
  if v_mac is not null and v_mac <> '' and exists (
    select 1
      from kitluy_devices.devices d
      join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
      join kitluy_devices.hardware_manifest_signals sig on sig.manifest_id = e.hardware_manifest_id
     where sig.signal_type = 'mac_address'
       and sig.signal_value = v_mac
       and d.lifecycle_state not in ('retired', 'replaced')
  ) then
    return jsonb_build_object(
      'device_id', null,
      'confidence', 'mac_only',
      'matched_signal_types', to_jsonb(array['mac_address']),
      'requires_review', true,
      'conflict_reason', 'KLUY-BOARD-EVIDENCE-MAC-ONLY');
  end if;

  return jsonb_build_object(
    'device_id', null,
    'confidence', 'none',
    'matched_signal_types', to_jsonb(v_matched),
    'requires_review', false,
    'conflict_reason', null);
end;
$resolve$;

comment on function kitluy_devices.resolve_device_by_board_evidence_v1 is
  'Answers "have I seen this physical board?" from board-bound evidence only. board_serial resolves; soc_serial corroborates; MAC-only and multi-match return requires_review and resolve NOTHING. Storage signals are never consulted — a card moved between boards must not merge two devices.';

-- -----------------------------------------------------------------------------
-- 4. Registration intake (plan §1.5)
-- -----------------------------------------------------------------------------
-- The door an untrusted, self-signed registration reaches. It may create a
-- PENDING device and it may open installation generations. It may NOT enrol,
-- assign, or grant any operational trust — those are the HET decision that comes
-- after, and the separation is the point of this group.
create or replace function kitluy_devices.register_device_v1(
  p_asset_tag text,
  p_hardware_profile_id uuid,
  p_registration_public_key_fingerprint text,
  p_hostname text,
  p_signals jsonb,
  p_installation_evidence jsonb,
  p_actor_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $register$
declare
  v_resolution jsonb;
  v_device_id uuid;
  v_lifecycle text;
  v_profile record;
  v_manifest_id uuid;
  v_enrollment_id uuid;
  v_station_id uuid;
  v_install_fp text;
  v_install_id uuid;
  v_generation integer;
  v_installation_created boolean := false;
  v_credential_reuse boolean := false;
  v_credential_returning boolean := false;
  v_reuse_owner uuid;
  v_now timestamptz := kitluy_ops.authoritative_now_v1();
begin
  if p_registration_public_key_fingerprint is null
     or p_registration_public_key_fingerprint = '' then
    raise exception 'KLUY-REGISTER-NO-KEY: a registration must present its public key fingerprint'
      using errcode = 'P0001';
  end if;

  -- ---------------------------------------------------------------------------
  -- Which board is this?
  -- ---------------------------------------------------------------------------
  v_resolution := kitluy_devices.resolve_device_by_board_evidence_v1(p_signals);

  -- PATH: evidence needs a human. FAIL CLOSED (plan §7.5). Nothing is created,
  -- nothing is mutated, no trust is implied — a device whose board evidence is
  -- ambiguous must not quietly become either of the candidates.
  if (v_resolution->>'requires_review')::boolean then
    return jsonb_build_object(
      'status', 'TRUST_REVIEW_REQUIRED',
      'device_id', null,
      'installation_id', null,
      'conflict_reason', v_resolution->>'conflict_reason');
  end if;

  v_device_id := nullif(v_resolution->>'device_id', '')::uuid;

  -- ---------------------------------------------------------------------------
  -- PATH D (detection): this credential already belongs to a DIFFERENT board.
  -- ---------------------------------------------------------------------------
  -- A copied SD card presents the key it was cloned with. That is a security
  -- signal, never evidence that the second board is the first one — so the key
  -- must not be allowed to drag one board's identity onto another.
  --
  -- Detection does NOT return here. Refusing outright would leave HET with no
  -- record of the second board at all, and a cloned appliance somebody is
  -- holding is precisely the thing the fleet should be able to see (plan §1.5
  -- Path D.2). So the second board goes on to receive its OWN pending identity
  -- below, and an incident is opened before this function returns.
  --
  -- The earliest holder of the fingerprint is treated as the legitimate one.
  -- That is the only assumption a machine can defend; deciding it for real is
  -- what the HET review is for.
  --
  -- Holders already flagged for reusing THIS fingerprint are excluded, and that
  -- exclusion is load-bearing: without it, the clone's own sealed enrollment
  -- would make every later registration by the legitimate board look like reuse
  -- too, so copying a key once would lock the real device out of registration
  -- permanently.
  select d.id into v_reuse_owner
    from kitluy_devices.manufacturing_enrollments e
    join kitluy_devices.devices d on d.id = e.device_id
   where e.device_public_key_fingerprint = p_registration_public_key_fingerprint
     and d.lifecycle_state not in ('retired', 'replaced')
     and (v_device_id is null or d.id <> v_device_id)
     and not exists (
       select 1
         from kitluy_devices.device_trust_incidents i
        where i.device_id = d.id
          and i.incident_type = 'credential_reuse_detected'
          and i.cleared_at is null
          and i.detail->>'reused_public_key_fingerprint'
              = p_registration_public_key_fingerprint)
   order by e.created_at, e.enrollment_sequence
   limit 1;

  v_credential_reuse := v_reuse_owner is not null;

  -- The station a self-registration is attributed to. Registration is not a
  -- factory action, so it is attributed rather than authenticated — which is
  -- exactly why approval exists downstream.
  select id into v_station_id
    from kitluy_devices.enrollment_stations
   where status = 'active'
   order by created_at
   limit 1;
  if v_station_id is null then
    raise exception 'KLUY-REGISTER-NO-STATION: no active enrollment station exists'
      using errcode = 'P0001';
  end if;

  -- The installation fingerprint is what makes a retry idempotent and a genuine
  -- reflash distinguishable. Derived from the submitted installation evidence,
  -- so identical evidence is the same installation however many times it arrives.
  v_install_fp := encode(
    extensions.digest(coalesce(p_installation_evidence, '{}'::jsonb)::text, 'sha256'), 'hex');

  -- ---------------------------------------------------------------------------
  -- PATH A: board never seen. Create it PENDING.
  -- ---------------------------------------------------------------------------
  if v_device_id is null then
    select hp.id, hp.device_class into v_profile
      from kitluy_devices.hardware_profiles hp
     where hp.id = p_hardware_profile_id and hp.is_active;
    if not found then
      raise exception 'KLUY-REGISTER-NO-PROFILE: no active hardware profile %', p_hardware_profile_id
        using errcode = 'P0001';
    end if;

    -- `lifecycle_state` is left to its DEFAULT of `manufactured` rather than
    -- being written. Registration has no authority to choose a lifecycle state,
    -- and naming one here — even the right one — would make this function look
    -- like it could name a different one.
    insert into kitluy_devices.devices
      (asset_tag, hardware_profile_id, device_class, manufactured_at, reported_hostname)
    values (p_asset_tag, p_hardware_profile_id, v_profile.device_class, v_now, p_hostname)
    returning id into v_device_id;

    insert into kitluy_devices.hardware_manifests
      (device_id, signal_count, captured_at, captured_by_station)
    values (v_device_id,
            coalesce(jsonb_array_length(p_signals), 0),
            v_now,
            v_station_id)
    returning id into v_manifest_id;

    -- `is_storage_module` is set from the canonical classifier rather than left to
    -- a default: it is the column that decides whether a signal may ever
    -- participate in identity resolution, so it must be derived from the one
    -- function that owns that judgement, not restated here.
    insert into kitluy_devices.hardware_manifest_signals
      (manifest_id, signal_type, signal_value, is_storage_module)
    select v_manifest_id,
           (s->>'signal_type')::kitluy_devices.hardware_signal_type,
           -- Through the canonical normaliser: `hardware_manifest_signals`
           -- constrains `signal_value = lower(btrim(signal_value))`, and the
           -- RESOLVER must compare the same normalised form or a board would
           -- fail to match itself over a difference in case.
           kitluy_devices.normalize_hardware_signal(s->>'signal_value'),
           kitluy_devices.is_storage_module_signal(
             (s->>'signal_type')::kitluy_devices.hardware_signal_type)
      from jsonb_array_elements(coalesce(p_signals, '[]'::jsonb)) s;

    insert into kitluy_devices.manufacturing_enrollments
      (device_id, hardware_manifest_id, enrollment_sequence, device_public_key_fingerprint,
       public_key_algorithm, key_storage_class, enrollment_station_id, enrollment_operator_ref,
       enrollment_reason)
    values (v_device_id, v_manifest_id, 1, p_registration_public_key_fingerprint,
            'ed25519', 'software', v_station_id, p_actor_ref,
            'self-registration: untrusted observed device awaiting HET approval')
    returning id into v_enrollment_id;

    update kitluy_devices.devices
       set current_enrollment_id = v_enrollment_id
     where id = v_device_id;

    v_lifecycle := 'manufactured';
  else
    -- -------------------------------------------------------------------------
    -- PATHS B and C: board already known. Same device_record_id, always.
    -- -------------------------------------------------------------------------
    -- The lifecycle state is READ, never written. A board already approved stays
    -- approved across a reflash; a board still pending stays pending. This
    -- function cannot promote and cannot demote.
    select lifecycle_state::text into v_lifecycle
      from kitluy_devices.devices where id = v_device_id;

    if v_lifecycle in ('retired', 'replaced', 'quarantined', 'restricted_investigation') then
      -- Registration must never resurrect a contained device (plan §7.6).
      return jsonb_build_object(
        'status', 'TRUST_REVIEW_REQUIRED',
        'device_id', v_device_id,
        'installation_id', null,
        'conflict_reason', 'KLUY-DEVICE-CONTAINED-' || upper(v_lifecycle));
    end if;

    -- A changed registration key on a KNOWN board is a credential rotation, not a
    -- new device. WHICH door performs it depends on whether the board has been
    -- trusted yet, and the difference matters:
    --
    --   * an ENROLLED board goes through `reenroll_device_v1`, the governed door
    --     that owns the trust consequences of replacing a key on a trusted device;
    --   * a PENDING board cannot use it — `reenroll_device_v1` refuses any state
    --     but `enrolled` (KLUY-DEVICE-REENROLL-STATE). That refusal is correct,
    --     so the registration path supersedes the pending registration
    --     enrollment itself. Nothing trusted depends on it: the board has never
    --     been approved, and its registration credential is untrusted by
    --     definition (plan §2.3).
    --
    -- A key detected as another board's is NOT rotated in, on either branch.
    -- Rotating it would take a board that may well be legitimate and move its
    -- credential onto a key someone else also holds — turning a detected clone
    -- into a working one. The presented key stays unadopted and the incident
    -- opened below carries the evidence.
    if not v_credential_reuse and not exists (
      select 1 from kitluy_devices.manufacturing_enrollments e
       where e.id = (select current_enrollment_id from kitluy_devices.devices where id = v_device_id)
         and e.device_public_key_fingerprint = p_registration_public_key_fingerprint
    ) then
      -- A REVOKED credential is not rotated around (plan §2.4: "a replay must
      -- never restore a revoked credential").
      --
      -- The reachable case is the CURRENT enrollment being revoked. Revocation
      -- is a deliberate act — something decided this key must stop being
      -- honoured — and a board that then presents a different key is asking
      -- registration to move on from that decision. `enforce_enrollment_append_only`
      -- would refuse the supersede anyway, but it would do so as a raw trigger
      -- error (`KLUY-DEVICE-ENROLLMENT-IMMUTABLE`) leaking out of a function
      -- whose contract is to return a status. So the refusal is made here, in
      -- the vocabulary the caller understands.
      --
      -- A merely SUPERSEDED fingerprint is a different case and is allowed
      -- forward: the same board booting an OLDER card legitimately presents the
      -- key that card still holds. It rotates forward to a new generation rather
      -- than resurrecting the old row, and the reason records that it happened
      -- so the chain shows it.
      --
      -- Note deliberately: a non-current enrollment can never BE revoked. The
      -- append-only rule lets a `sealed` row close exactly once, so a row that
      -- closed as `superseded` can never later become `revoked`. Checking the
      -- whole fingerprint history for revocation would therefore be a branch
      -- that cannot fire, which is why only the current enrollment is examined.
      if exists (
        select 1 from kitluy_devices.manufacturing_enrollments e
         where e.id = (select current_enrollment_id from kitluy_devices.devices where id = v_device_id)
           and e.revoked_at is not null
      ) then
        return jsonb_build_object(
          'status', 'TRUST_REVIEW_REQUIRED',
          'device_id', v_device_id,
          'installation_id', null,
          'installation_created', false,
          'credential_reuse_detected', false,
          'conflict_reason', 'KLUY-CREDENTIAL-REVOKED');
      end if;

      select exists (
        select 1 from kitluy_devices.manufacturing_enrollments e
         where e.device_id = v_device_id
           and e.device_public_key_fingerprint = p_registration_public_key_fingerprint
      ) into v_credential_returning;

      if v_lifecycle = 'enrolled' then
        perform kitluy_devices.reenroll_device_v1(
          v_device_id, p_registration_public_key_fingerprint, 'ed25519', 'software',
          (select station_key from kitluy_devices.enrollment_stations where id = v_station_id),
          p_actor_ref, p_signals,
          case when v_credential_returning
               then 'self-registration: same physical board presented a PREVIOUSLY SUPERSEDED registration key (older installation); rotated forward, not resurrected'
               else 'self-registration: registration credential rotated on the same physical board' end,
          null);
      else
        -- Supersede the pending registration and open the next enrollment
        -- generation. History is preserved, not overwritten: the previous row
        -- stays as evidence of what key this board presented before.
        select e.id into v_enrollment_id
          from kitluy_devices.manufacturing_enrollments e
         where e.id = (select current_enrollment_id from kitluy_devices.devices where id = v_device_id);

        insert into kitluy_devices.hardware_manifests
          (device_id, signal_count, captured_at, captured_by_station)
        values (v_device_id, coalesce(jsonb_array_length(p_signals), 0), v_now, v_station_id)
        returning id into v_manifest_id;

        insert into kitluy_devices.hardware_manifest_signals
          (manifest_id, signal_type, signal_value, is_storage_module)
        select v_manifest_id,
               (s->>'signal_type')::kitluy_devices.hardware_signal_type,
               kitluy_devices.normalize_hardware_signal(s->>'signal_value'),
               kitluy_devices.is_storage_module_signal(
                 (s->>'signal_type')::kitluy_devices.hardware_signal_type)
          from jsonb_array_elements(coalesce(p_signals, '[]'::jsonb)) s;

        update kitluy_devices.manufacturing_enrollments
           set state = 'superseded', superseded_at = v_now
         where id = v_enrollment_id;

        insert into kitluy_devices.manufacturing_enrollments
          (device_id, hardware_manifest_id, enrollment_sequence, device_public_key_fingerprint,
           public_key_algorithm, key_storage_class, enrollment_station_id, enrollment_operator_ref,
           enrollment_reason, supersedes_enrollment_id)
        select v_device_id, v_manifest_id,
               coalesce(max(e.enrollment_sequence), 0) + 1,
               p_registration_public_key_fingerprint,
               'ed25519', 'software', v_station_id, p_actor_ref,
               case when v_credential_returning
                    then 'self-registration: pending board presented a PREVIOUSLY SUPERSEDED registration key (older installation); rotated forward, not resurrected'
                    else 'self-registration: registration credential rotated while still pending approval' end,
               v_enrollment_id
          from kitluy_devices.manufacturing_enrollments e
         where e.device_id = v_device_id
        returning id into v_enrollment_id;

        update kitluy_devices.devices
           set current_enrollment_id = v_enrollment_id
         where id = v_device_id;
      end if;
    end if;

    update kitluy_devices.devices
       set reported_hostname = coalesce(p_hostname, reported_hostname)
     where id = v_device_id;
  end if;

  -- ---------------------------------------------------------------------------
  -- Installation generation, for every path that reached a device
  -- ---------------------------------------------------------------------------
  select id into v_install_id
    from kitluy_devices.device_installations
   where device_record_id = v_device_id and installation_fingerprint = v_install_fp;

  if v_install_id is null then
    -- A genuinely new installation. Supersede the current one and open the next
    -- generation; the previous row is kept because it is the evidence of what
    -- was on this board before.
    update kitluy_devices.device_installations
       set state = 'superseded', superseded_at = v_now
     where device_record_id = v_device_id and state = 'current';

    select coalesce(max(generation), 0) + 1 into v_generation
      from kitluy_devices.device_installations where device_record_id = v_device_id;

    insert into kitluy_devices.device_installations
      (device_record_id, generation, installation_evidence, installation_fingerprint,
       image_release_ref, created_by_actor_ref)
    values (v_device_id, v_generation, coalesce(p_installation_evidence, '{}'::jsonb), v_install_fp,
            p_installation_evidence->>'imageRelease', p_actor_ref)
    returning id into v_install_id;
    v_installation_created := true;
  end if;

  -- ---------------------------------------------------------------------------
  -- PATH D (record): the security event, opened once per board and fingerprint
  -- ---------------------------------------------------------------------------
  -- Recording the incident IS the containment, and deliberately so: an OPEN
  -- trust incident is already consulted by `evaluate_provisioning_eligibility_v1`,
  -- `activate_device_v1`, `prepare_device_credential_issuance_v1` and
  -- `reenroll_device_v1`. So this one insert withholds provisioning eligibility,
  -- activation and credential issuance without registration writing a lifecycle
  -- state it has no authority to choose. Quarantine remains a governed decision
  -- with its own door (`quarantine_device_v1`), taken by HET after review.
  if v_credential_reuse then
    if not exists (
      select 1 from kitluy_devices.device_trust_incidents i
       where i.device_id = v_device_id
         and i.incident_type = 'credential_reuse_detected'
         and i.cleared_at is null
         and i.detail->>'reused_public_key_fingerprint'
             = p_registration_public_key_fingerprint
    ) then
      insert into kitluy_devices.device_trust_incidents
        (device_id, incident_type, severity, detected_at, detected_by, detail)
      values (v_device_id, 'credential_reuse_detected', 'CRITICAL', v_now,
              'kitluy_devices.register_device_v1',
              jsonb_build_object(
                'reused_public_key_fingerprint', p_registration_public_key_fingerprint,
                'earlier_holder_device_id', v_reuse_owner,
                'reported_hostname', p_hostname,
                'installation_fingerprint', v_install_fp,
                'actor_ref', p_actor_ref,
                -- Which of the two boards is the impostor is NOT decided here.
                'assessment', 'both boards presented the same registration key; HET must determine which board is legitimate'));
    end if;

    return jsonb_build_object(
      'status', 'TRUST_REVIEW_REQUIRED',
      -- The SECOND board's own identity, never the earlier holder's. This is the
      -- whole point of Path D: the clone is visible, and it is visible as itself.
      'device_id', v_device_id,
      'installation_id', v_install_id,
      'installation_created', v_installation_created,
      'credential_reuse_detected', true,
      'conflict_reason', 'KLUY-CREDENTIAL-REUSE-DETECTED');
  end if;

  return jsonb_build_object(
    'status', case when v_lifecycle = 'manufactured' then 'PENDING_APPROVAL'
                   else 'KNOWN_DEVICE_INSTALLATION_REGISTERED' end,
    'device_id', v_device_id,
    'installation_id', v_install_id,
    'installation_created', v_installation_created,
    'credential_reuse_detected', false,
    'conflict_reason', null);
end;
$register$;

comment on function kitluy_devices.register_device_v1 is
  'Untrusted registration intake. Creates a PENDING (manufactured) device for an unseen board, or resolves a known board to its EXISTING device_record_id and opens a new installation generation on reflash. Never enrols, never assigns, never issues operational trust, never resurrects a contained device, and never lets a reused credential move identity between boards.';

-- -----------------------------------------------------------------------------
-- 5. HET approval (plan §1.6)
-- -----------------------------------------------------------------------------
-- Approval means "HET verified this hardware and admits it to the trusted
-- fleet". It is not a UI acknowledgement, which is why it demands a reason and a
-- verification reference and writes both into the audit trail.
create or replace function kitluy_devices.approve_device_enrollment_v1(
  p_device_id uuid,
  p_actor_ref text,
  p_reason text,
  p_environment text,
  p_verification_evidence_ref text,
  p_second_approver_ref text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops
as $approve$
declare
  v_state text;
  v_open_incidents integer;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'KLUY-APPROVE-NO-REASON: approving hardware into the trusted fleet requires a reason'
      using errcode = 'P0001';
  end if;
  if p_verification_evidence_ref is null or btrim(p_verification_evidence_ref) = '' then
    raise exception 'KLUY-APPROVE-NO-VERIFICATION: approval records WHAT was verified, not merely who clicked'
      using errcode = 'P0001';
  end if;
  if p_actor_ref is null or btrim(p_actor_ref) = '' then
    raise exception 'KLUY-APPROVE-NO-ACTOR: an approval names its approver' using errcode = 'P0001';
  end if;

  -- FOUR EYES BY ENVIRONMENT. The rule is switched ON for pilot/production, never
  -- relaxed (CLAUDE.md hard rule 7). Development uses one admin plus a reason so
  -- the owner can approve their own test hardware, which is a deliberate
  -- environment difference and not a weakening of the rule where it applies.
  if p_environment in ('pilot', 'production') then
    if p_second_approver_ref is null or btrim(p_second_approver_ref) = '' then
      raise exception
        'KLUY-APPROVE-FOUR-EYES-REQUIRED: % approval requires a second distinct approver', p_environment
        using errcode = 'P0001';
    end if;
    if btrim(p_second_approver_ref) = btrim(p_actor_ref) then
      raise exception
        'KLUY-APPROVE-FOUR-EYES-SAME-ACTOR: the second approver must be a different person'
        using errcode = 'P0001';
    end if;
  end if;

  select lifecycle_state::text into v_state
    from kitluy_devices.devices where id = p_device_id for update;
  if not found then
    raise exception 'KLUY-APPROVE-NO-DEVICE: no such device %', p_device_id using errcode = 'P0001';
  end if;

  -- ONLY from pending. A quarantined, retired, replaced or restricted device is
  -- never resurrected through an approval — containment decisions have their own
  -- governed exits, and letting approval undo them would make containment
  -- advisory.
  if v_state <> 'manufactured' then
    raise exception
      'KLUY-APPROVE-WRONG-STATE: device % is %; only a pending (manufactured) device may be approved',
      p_device_id, v_state using errcode = 'P0001';
  end if;

  -- AN OPEN TRUST INCIDENT IS NOT APPROVABLE (plan §8.6).
  -- A credential-reuse or evidence-conflict finding must be resolved through the
  -- door that owns it — `clear_device_containment_v1`, which demands a clearance
  -- reason — and not overruled in passing by an approval. Without this check the
  -- suspected clone from `register_device_v1` Path D could be waved into the
  -- trusted fleet by a single click, which is exactly the "casual one-click Trust
  -- Device" the plan §4.4 forbids.
  --
  -- The predicate is deliberately IDENTICAL to the one
  -- `evaluate_provisioning_eligibility_v1` already applies, `activation_blocked`
  -- exclusion included, so approval and eligibility cannot disagree about what
  -- counts as an open incident.
  select count(*) into v_open_incidents
    from kitluy_devices.device_trust_incidents
   where device_id = p_device_id
     and cleared_at is null
     and incident_type <> 'activation_blocked';
  if v_open_incidents > 0 then
    raise exception
      'KLUY-APPROVE-OPEN-INCIDENT: device % has % open trust incident(s); clear them through the containment door before approving',
      p_device_id, v_open_incidents using errcode = 'P0001';
  end if;

  perform kitluy_devices.record_lifecycle_event(
    p_device_id, 'manufactured'::kitluy_devices.device_lifecycle_state,
    'enrolled'::kitluy_devices.device_lifecycle_state,
    'HET_HARDWARE_VERIFIED_AND_APPROVED', p_actor_ref,
    jsonb_build_object(
      'reason', p_reason,
      'verification_evidence_ref', p_verification_evidence_ref,
      'environment', p_environment,
      'second_approver_ref', p_second_approver_ref));

  update kitluy_devices.devices
     set lifecycle_state = 'enrolled'
   where id = p_device_id and lifecycle_state = 'manufactured';

  return jsonb_build_object('device_id', p_device_id, 'lifecycle_state', 'enrolled');
end;
$approve$;

comment on function kitluy_devices.approve_device_enrollment_v1 is
  'HET admits verified pending hardware to the trusted fleet: manufactured -> enrolled only. Requires a reason AND a verification-evidence reference, requires a second distinct approver in pilot/production, refuses every other source state so containment can never be undone by an approval, and refuses any device carrying an open trust incident so a suspected clone cannot be approved past its own security finding.';

-- -----------------------------------------------------------------------------
-- 6. The registration identity (plan §1.7)
-- -----------------------------------------------------------------------------
-- Separation of duty, stated as a grant: the identity that ACCEPTS an untrusted
-- registration cannot APPROVE one. If one role could do both, "admin approval"
-- would be a description of a UI rather than a control.
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_device_registration_service') then
    create role kitluy_device_registration_service nologin;
  end if;
end
$roles$;

-- NOLOGIN, and assumed per transaction with `SET LOCAL ROLE` by the registration
-- intake connecting as `service_role` — exactly as `kitluy_hub_pairing_service`
-- (0192) and `kitluy_hub_issuance_service` (0193) are used.
--
-- This grant is what makes the role REACHABLE, and its absence is not a
-- theoretical problem: PostgreSQL 16 gives the creator of a role only an
-- ADMIN-option membership, with `inherit_option` and `set_option` both false. So
-- a role that is merely created cannot be entered by anybody — `SET LOCAL ROLE`
-- fails with "permission denied to set role" — and the least-privilege identity
-- would be decorative. Measured on the local PG17 stack: the three older service
-- roles can be assumed and this one could not, until this grant.
grant kitluy_device_registration_service to service_role;

revoke all on function kitluy_devices.register_device_v1(text, uuid, text, text, jsonb, jsonb, text) from public;
revoke all on function kitluy_devices.register_device_v1(text, uuid, text, text, jsonb, jsonb, text) from anon;
revoke all on function kitluy_devices.register_device_v1(text, uuid, text, text, jsonb, jsonb, text) from authenticated;
grant execute on function kitluy_devices.register_device_v1(text, uuid, text, text, jsonb, jsonb, text)
  to kitluy_device_registration_service;

grant usage on schema kitluy_devices to kitluy_device_registration_service;

-- -----------------------------------------------------------------------------
-- 6b. Resolving a hardware profile KEY, without a table grant
-- -----------------------------------------------------------------------------
-- `register_device_v1` takes a profile id, matching `enroll_device_v1` and every
-- other door in this schema. A device cannot send an id: a profile UUID differs
-- between environments, so baking one into a generic image would put a
-- per-environment identity in a clonable artifact. It sends a stable KEY
-- instead, and this resolves it.
--
-- A definer reader rather than `grant select on hardware_profiles`, which is the
-- same choice 0195 and 0196 made for the same reason: the registration identity
-- should hold no table privilege at all, so that "it cannot read the device
-- tables" needs no qualification. It returns the id and nothing else — not the
-- required signal types, not the profile row — because an unauthenticated caller
-- has no business enumerating the hardware catalogue.
create or replace function kitluy_devices.hardware_profile_id_for_key_v1(
  p_profile_key text
) returns uuid
language sql
security definer
stable
set search_path = pg_catalog, kitluy_devices
as $$
  select hp.id
    from kitluy_devices.hardware_profiles hp
   where hp.profile_key = p_profile_key
     and hp.is_active
   limit 1;
$$;

comment on function kitluy_devices.hardware_profile_id_for_key_v1 is
  'Resolves an ACTIVE hardware profile key to its id, and returns nothing else. Exists so the registration intake can name a profile by a stable key — an id would be a per-environment value baked into a generic image — while the registration identity keeps zero table privileges. Returns NULL for an unknown or inactive key; the caller refuses with KLUY-REG-UNKNOWN-PROFILE.';

revoke all on function kitluy_devices.hardware_profile_id_for_key_v1(text) from public;
revoke all on function kitluy_devices.hardware_profile_id_for_key_v1(text) from anon;
grant execute on function kitluy_devices.hardware_profile_id_for_key_v1(text)
  to kitluy_device_registration_service;
grant execute on function kitluy_devices.hardware_profile_id_for_key_v1(text) to service_role;

-- The approval door is granted to the management API's identity ONLY. Never to
-- the registration service.
revoke all on function kitluy_devices.approve_device_enrollment_v1(uuid, text, text, text, text, text) from public;
revoke all on function kitluy_devices.approve_device_enrollment_v1(uuid, text, text, text, text, text) from anon;
revoke all on function kitluy_devices.approve_device_enrollment_v1(uuid, text, text, text, text, text) from authenticated;
grant execute on function kitluy_devices.approve_device_enrollment_v1(uuid, text, text, text, text, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- 7. The approval permission
-- -----------------------------------------------------------------------------
insert into kitluy_auth.permissions
  (permission_key, version, risk_class, resource_types, environments, status)
values ('fleet.device_enrollment.approve', 1, 'CRITICAL', array['device'], array['all'], 'ACTIVE')
on conflict (permission_key, version) do nothing;

insert into kitluy_auth.role_permission_grants (role_template_id, permission_id, effect)
select rt.id, p.id, 'ALLOW'
  from kitluy_auth.role_templates rt, kitluy_auth.permissions p
 where rt.role_key = 'HET_PLATFORM_ADMIN'
   and p.permission_key = 'fleet.device_enrollment.approve'
   and not exists (
     select 1 from kitluy_auth.role_permission_grants g
      where g.role_template_id = rt.id and g.permission_id = p.id);

-- -----------------------------------------------------------------------------
-- 8. Prove the boundaries this group exists to create
-- -----------------------------------------------------------------------------
do $assert$
begin
  -- The separation of duty, asserted rather than described.
  if has_function_privilege('kitluy_device_registration_service',
       'kitluy_devices.approve_device_enrollment_v1(uuid, text, text, text, text, text)', 'execute') then
    raise exception
      'KLUY-MIGRATION-0197: the registration service can approve enrollment; accepting an untrusted registration must never confer the authority to trust it';
  end if;

  if not has_function_privilege('kitluy_device_registration_service',
       'kitluy_devices.register_device_v1(text, uuid, text, text, jsonb, jsonb, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0197: the registration service cannot register';
  end if;

  -- The registration identity holds capabilities and no table reach, matching
  -- the 0192 pattern. A registration service that could read the fleet directly
  -- would make the RPC contract decorative.
  if has_table_privilege('kitluy_device_registration_service', 'kitluy_devices.devices', 'select')
     or has_table_privilege('kitluy_device_registration_service', 'kitluy_devices.devices', 'insert') then
    raise exception
      'KLUY-MIGRATION-0197: the registration service gained direct access to kitluy_devices.devices';
  end if;

  raise notice
    'KLUY-MIGRATION-0197: registration intake, board resolution, installation generations and HET approval applied; registration cannot enrol and cannot approve';
end
$assert$;

commit;
