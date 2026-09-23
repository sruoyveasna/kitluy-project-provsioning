-- ===========================================================================
-- 0236 — a REFLASH RECOVERY grants the previous credential no overlap
-- ===========================================================================
-- Handoff 54 §8 recorded the gap, and handoff 39 §9 had it open as an owner
-- question: after a successful reflash recovery the INCUMBENT credential stayed
-- usable for the ordinary renewal overlap — up to three days. For a renewal that
-- window is the whole point: the same board holds both keys and needs time to
-- adopt the new one. For a RE-FLASH it is exactly wrong. The incumbent's private
-- key was on the SD card that was replaced: it is gone, or it is in whoever's
-- hand is holding that card. Nothing on the new installation needs it.
--
-- WHY THIS IS NOT A REVOCATION
-- ---------------------------
-- Revoking here is not available, and deliberately so. Owner decision §2.5 is a
-- CHECK constraint, not a convention:
--
--   credential_revocation_policy_no_machine_chk
--     check (machine_initiated_revocation_permitted = false)
--
--   "no automatic machine-generated revocation is approved for Phase 1. A worker
--    may detect, record and escalate; it may not decide to revoke."
--
-- Every revocation reason also requires four eyes (0136/0138), and none of the
-- nine approved reasons names a re-flash. A machine that revoked here would be
-- taking a decision the owner reserved for people.
--
-- So the incumbent is INVALIDATED rather than revoked, through the lifecycle
-- that already exists: the OVERLAP. `certificate-validity` accepts a previous
-- generation only while the head grants one —
--
--     if (generation < context.currentCertificateGeneration) {
--       if (overlap === null || generation !== overlap.previousGeneration) {
--         return reject("CERT_STALE_CERTIFICATE_GENERATION", …);
--
-- — so a head that grants no overlap ends the old certificate's usefulness at
-- the instant the new one is finalized, with no decision taken and no history
-- rewritten. The incumbent row keeps its state and its audit trail; its X.509
-- artifact is already `superseded` by 0224's trigger. If a person later decides
-- the old card was compromised, the governed four-eyes revocation door is
-- unchanged and still theirs to use.
--
-- ORDINARY RENEWAL IS NOT TOUCHED.
-- The branch below fires only when the generation being finalized belongs to a
-- reservation carrying RECOVERY EVIDENCE — the same marker
-- `classify_operational_certificate_request_v1` already uses to answer
-- 'RECOVERY'. A renewal keeps `previous_generation` and its 3-day
-- `overlap_ends_at` exactly as before.
--
-- WHY A BEFORE-UPDATE TRIGGER, NOT A NEW finalize
-- -----------------------------------------------
-- `finalize_device_credential_issuance_v1` is ~300 lines of governed issuance;
-- re-creating it to change two assignments would put all of it at risk for no
-- gain. A BEFORE trigger edits NEW in place, so it needs no second UPDATE and
-- cannot disturb `trg_device_heads_authority`'s rule that every write moves the
-- version by exactly one. It is named to sort AFTER `trg_device_heads_overlap`,
-- so that trigger still validates the overlap finalize proposed before this one
-- withdraws it.
-- ===========================================================================

set local role kitluy_credential_issuer;

create or replace function kitluy_devices.recovery_grants_no_overlap()
returns trigger
language plpgsql
as $$
declare
  v_is_recovery boolean;
begin
  -- Only an advance can carry an overlap, and only one that proposes one.
  if new.previous_generation is null and new.overlap_ends_at is null then
    return new;
  end if;
  if new.current_generation is not distinct from old.current_generation then
    return new;
  end if;

  -- Is the generation being finalized a RECOVERY? Resolved the way
  -- `complete_same_key_renewal` resolves a reservation — device, environment,
  -- purpose and the generation being issued — then tested against the recovery
  -- evidence written in the same transaction as the reservation (0224).
  select exists (
    select 1
      from kitluy_devices.device_renewal_reservations r
      join kitluy_devices.device_credential_recovery_evidence e
        on e.renewal_attempt_id = r.renewal_attempt_id
     where r.device_record_id = new.device_record_id
       and r.environment = new.environment
       and r.purpose = new.purpose
       and r.next_credential_generation = new.current_generation
  ) into v_is_recovery;

  if v_is_recovery then
    -- Both, together: `device_heads_overlap_chk` requires that the pointer and
    -- its expiry travel as a pair.
    new.previous_generation := null;
    new.overlap_ends_at := null;
  end if;

  return new;
end;
$$;

comment on function kitluy_devices.recovery_grants_no_overlap is
  'A reflash RECOVERY grants the previous credential no overlap, so the certificate on the replaced SD card stops verifying the instant the new one is finalized. Ordinary renewal is untouched. This invalidates rather than revokes: owner decision §2.5 forbids machine-initiated revocation (credential_revocation_policy_no_machine_chk), and every revocation reason requires four eyes. Handoff 39 §9, handoff 54 §8.';

drop trigger if exists trg_device_heads_recovery_no_overlap on kitluy_devices.device_credential_heads;
create trigger trg_device_heads_recovery_no_overlap
  before update on kitluy_devices.device_credential_heads
  for each row execute function kitluy_devices.recovery_grants_no_overlap();

reset role;
