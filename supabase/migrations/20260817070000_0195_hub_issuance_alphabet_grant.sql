-- kitluy:migration:0195
--
-- THE ISSUANCE SERVICE COULD NOT READ THE CODE ALPHABET
-- =============================================================================
-- Authority: KLD-2026-08-13-HUB-PAIRING-ROUTE-001 (group 0192, the
-- `kitluy_hub_issuance_service` identity); KLD-2026-08-13-HUB-PAIRING-SESSION-001
-- (group 0194, the session model).
--
-- Found by running the Partner Portal against the hosted development project for
-- the first time. Every issuance attempt failed with the unmapped fallback
-- `KLUY-HUBCODE-ISSUANCE-FAILED`, and the underlying error was:
--
--     permission denied for function hub_claim_code_alphabet_v1
--
-- WHY THE GRANT WAS MISSING, AND WHY IT LOOKED CORRECT
-- ---------------------------------------------------
-- Group 0192 granted the alphabet to `authenticated` and said so explicitly:
-- "group 0192 kept it readable by `authenticated` for precisely this reason."
-- That reasoning holds only if the Portal reads the alphabet AS THE ACTOR. It
-- does not. `openHubPairingSession` opens a transaction, drops to the
-- least-privilege identity with
--
--     set local role kitluy_hub_issuance_service
--
-- and only then reads the alphabet — deliberately, because the whole point of
-- that identity is that the governed door is reached with one capability and no
-- table access. From that moment the actor's grants are irrelevant, so the
-- function was unreachable to the only role that ever calls it.
--
-- WHY NO TEST CAUGHT IT
-- ---------------------
-- The management API's unit tests stub the pool, which is exactly the layer at
-- which the role matters, so they exercise the SQL text and never the privilege.
-- The device-side integration tests do reach a real database, but they run as
-- `postgres`, which holds the grant. Both halves passed while the composition
-- could not work — the failure needed the real role against a real database, and
-- that is what running the Portal finally did.
--
-- WHY THIS IS ADDITIVE
-- --------------------
-- Groups 0191-0194 are applied on `kitluy-project-pos`. An applied migration is
-- never edited (schema contract §4), so the grant 0192 should have carried is
-- made here instead.

begin;

-- The one capability that was missing. `hub_claim_code_alphabet_v1` is IMMUTABLE
-- and returns a constant — it exposes no row, no scope and no identity, so
-- granting it widens nothing beyond letting the issuance service read the 32
-- characters it must generate a code from.
--
-- The alternative — mirroring the alphabet into TypeScript — is what group 0193's
-- header rejects, and rightly: a second definition drifts from the one the
-- presenter validates against, and the failure mode is a code an operator cannot
-- type successfully.
grant execute on function kitluy_devices.hub_claim_code_alphabet_v1()
  to kitluy_hub_issuance_service;

-- Not granted, deliberately: `normalize_hub_claim_code_v1`. Issuance GENERATES a
-- code and never normalises one — normalisation belongs to presentation, which
-- runs as `kitluy_hub_pairing_service` and reaches it through the definer door.
-- A grant "for symmetry" would widen an identity beyond what it does.

do $$
begin
  if not has_function_privilege(
       'kitluy_hub_issuance_service',
       'kitluy_devices.hub_claim_code_alphabet_v1()',
       'execute') then
    raise exception
      'KLUY-MIGRATION-0195: the issuance service still cannot read the code alphabet';
  end if;
  raise notice
    'KLUY-MIGRATION-0195: kitluy_hub_issuance_service can now read the canonical code alphabet';
end$$;

commit;
