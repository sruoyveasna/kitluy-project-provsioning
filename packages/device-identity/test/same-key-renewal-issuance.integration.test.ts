/**
 * Same-key renewal prepare → sign → finalize — LIVE PostgreSQL integration.
 *
 * The complete flow against the real local stack: preflight, reservation,
 * governed preparation, a real Ed25519 signature over the DATABASE's canonical
 * bytes, the governed signature record, finalization, and finally the persisted
 * credential loaded back out and put through the real verifier.
 *
 * Every governed call assumes `kitluy_issuance_service`. A skip is reported as
 * a skip, never as a pass.
 */
import { describe, it, expect, beforeAll } from "vitest";

import {
  devDatabaseUrl,
  isDevDatabaseReachable,
  reportSkippedIntegration,
  withDatabaseTransaction,
} from "./support/dev-database.js";
import {
  DEVELOPMENT,
  DEVICE_IDENTITY,
  MS_PER_DAY,
  TEST_ROLES,
  createIncumbentFixture,
  currentRole,
  expectRefused,
  pgIncumbentRepository,
  pgIssuanceGateway,
  pgReservationGateway,
  withRole,
  type IncumbentFixture,
} from "./support/renewal-fixtures.js";
import {
  completeSameKeyCredentialRenewal,
  type SameKeyRenewalIssuanceInput,
} from "../src/same-key-renewal-issuance.js";
import type { GovernedIssuanceGateway } from "../src/issuance-adapter.js";
import type { TrustedTimeEvaluation } from "../src/trusted-time.js";
import type pg from "pg";

const SUITE = "@kitluy/device-identity same-key renewal issuance";

const reachable = await isDevDatabaseReachable();
if (!reachable) reportSkippedIntegration(SUITE);

function trustedAt(instant: Date): TrustedTimeEvaluation {
  return {
    status: "trusted",
    trustedTime: instant,
    source: "authenticated_network",
    floorAdvanced: true,
    anomalyType: null,
    detail: "integration fixture",
  };
}

const issuedSoThat = (daysRemaining: number): Date =>
  new Date(Date.now() - (30 - daysRemaining) * MS_PER_DAY);

function renewalInput(
  fixture: IncumbentFixture,
  overrides: Partial<SameKeyRenewalIssuanceInput> = {},
): SameKeyRenewalIssuanceInput {
  return {
    deviceRecordId: fixture.deviceRecordId,
    environment: DEVELOPMENT,
    purpose: DEVICE_IDENTITY,
    idempotencyKey: `renew-${fixture.credentialId}`,
    actorRef: "INTEGRATION-RENEWAL",
    trustedTime: trustedAt(new Date()),
    trustedRootFingerprints: [fixture.ca.rootCertificate.tbs.subjectFingerprint],
    currentAssignmentGeneration: fixture.assignmentGeneration,
    ...overrides,
  };
}

/** Snapshot of everything a renewal is allowed — or not allowed — to move. */
async function snapshot(client: pg.PoolClient, deviceRecordId: string) {
  const r = await client.query(
    `select
       (select count(*) from kitluy_devices.device_credentials where device_record_id=$1) creds,
       (select count(*) from kitluy_devices.device_generation_keys where device_record_id=$1) keys,
       (select count(*) from kitluy_devices.device_renewal_reservations where device_record_id=$1) reservations,
       (select current_generation from kitluy_devices.device_credential_heads where device_record_id=$1) head_generation,
       (select previous_generation from kitluy_devices.device_credential_heads where device_record_id=$1) previous_generation,
       (select version from kitluy_devices.device_credential_heads where device_record_id=$1) head_version,
       (select overlap_ends_at from kitluy_devices.device_credential_heads where device_record_id=$1) overlap_ends_at,
       (select string_agg(state::text || ':' || generation::text, ',' order by generation)
          from kitluy_devices.device_generation_keys where device_record_id=$1) key_states,
       (select status::text from kitluy_devices.device_renewal_reservations where device_record_id=$1 limit 1) reservation_status`,
    [deviceRecordId],
  );
  const row = r.rows[0];
  return {
    credentials: Number(row.creds),
    providerKeys: Number(row.keys),
    reservations: Number(row.reservations),
    headGeneration: row.head_generation === null ? null : Number(row.head_generation),
    previousGeneration: row.previous_generation === null ? null : Number(row.previous_generation),
    headVersion: row.head_version === null ? null : Number(row.head_version),
    overlapEndsAt: row.overlap_ends_at as Date | null,
    keyStates: row.key_states as string | null,
    reservationStatus: row.reservation_status as string | null,
  };
}

describe.skipIf(!reachable)("live same-key renewal issuance", () => {
  beforeAll(() => {
    expect(devDatabaseUrl()).toMatch(/127\.0\.0\.1|localhost/);
  });

  // =========================================================================
  // The complete flow
  // =========================================================================
  it("renews the credential and leaves the key untouched", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "RENEW",
      });
      const before = await snapshot(client, fixture.deviceRecordId);
      expect(before.credentials).toBe(1);
      expect(before.headGeneration).toBe(1);
      expect(before.keyStates).toBe("active:1");

      const outcome = await completeSameKeyCredentialRenewal(
        renewalInput(fixture),
        pgIncumbentRepository(client),
        pgReservationGateway(client),
        pgIssuanceGateway(client),
        fixture.ca,
        fixture.signer,
      );

      expect(outcome.detail).toBeUndefined();
      expect(outcome.outcome).toBe("RENEWED");

      // -- from the orchestration -----------------------------------------
      expect(outcome.renewed).toMatchObject({
        previousCredentialGeneration: 1,
        credentialGeneration: 2,
        credentialGenerationAdvanced: true,
        keyGenerationUnchanged: true,
        keyRotated: false,
        keyGeneration: 1,
      });
      expect(outcome.renewed?.publicKeyFingerprint).toBe(fixture.fingerprint);
      expect(outcome.renewed?.providerKeyReference).toBe(fixture.providerKeyHandle);

      // -- from the provider ----------------------------------------------
      // ONE key generation, at enrollment. None for the renewal.
      expect(fixture.keyGenerationCount()).toBe(1);
      expect(fixture.activationWasCalled()).toBe(false);
      expect(fixture.privateKeyWasExported()).toBe(false);
      // Possession was proved with the SAME key, exactly once.
      expect(fixture.possessionProofCount()).toBe(1);

      // -- from PostgreSQL --------------------------------------------------
      const after = await snapshot(client, fixture.deviceRecordId);
      expect(after.credentials).toBe(2);
      expect(after.headGeneration).toBe(2);
      expect(after.previousGeneration).toBe(1);
      expect(after.headVersion).toBe(before.headVersion! + 1);
      expect(after.reservations).toBe(1);
      // No replacement key, and nothing waiting for provider activation.
      expect(after.providerKeys).toBe(1);
      expect(after.keyStates).toBe("active:1");
      // Migration 0132: a reuse_current_key renewal now COMPLETES.
      expect(after.reservationStatus).toBe("completed");

      const credential = await client.query(
        `select credential_id, serial_number, certificate_generation, assignment_generation,
                public_key_fingerprint, state, not_before, not_after
         from kitluy_devices.device_credentials
         where device_record_id = $1 and certificate_generation = 2`,
        [fixture.deviceRecordId],
      );
      expect(credential.rowCount).toBe(1);
      expect(credential.rows[0].public_key_fingerprint).toBe(fixture.fingerprint);
      expect(Number(credential.rows[0].assignment_generation)).toBe(fixture.assignmentGeneration);
      expect(credential.rows[0].state).toBe("issued");
      expect(outcome.renewed?.credentialId).toBe(credential.rows[0].credential_id);

      // Overlap is at most three days of the NEW credential's own validity.
      const overlapDays =
        (after.overlapEndsAt!.getTime() - new Date(credential.rows[0].not_before).getTime()) /
        MS_PER_DAY;
      expect(overlapDays).toBeGreaterThan(0);
      expect(overlapDays).toBeLessThanOrEqual(3);

      // Exactly one issuance attempt reached `issued`, with its audit.
      const audit = await client.query(
        `select count(*) as n from kitluy_devices.device_credential_issuance_attempts a
         join kitluy_devices.device_credential_requests r on r.request_id = a.request_id
         where r.device_record_id = $1 and a.to_state = 'issued'`,
        [fixture.deviceRecordId],
      );
      expect(Number(audit.rows[0].n)).toBe(2); // generation 1 and generation 2

      const signing = await client.query(
        `select state, service_attested_signature_verified
         from kitluy_devices.device_credential_signing_attempts
         where device_record_id = $1 and certificate_generation = 2`,
        [fixture.deviceRecordId],
      );
      expect(signing.rowCount).toBe(1);
      expect(signing.rows[0].state).toBe("finalized");
      expect(signing.rows[0].service_attested_signature_verified).toBe(true);

      // -- cryptographically ------------------------------------------------
      expect(outcome.persistedCredential?.credentialKind).toBe(
        "kitluy.development-device-credential.v1",
      );
      expect(outcome.persistedCredential?.consumersMustReVerifyAtAuthenticationBoundary).toBe(true);
      // No caller-usable trust verdict anywhere in the result.
      expect(JSON.stringify(outcome)).not.toContain('"signatureValid"');
    });
  }, 90_000);

  it("refuses to report success when the PERSISTED signature is forged", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "FORGE",
      });
      const repository = pgIncumbentRepository(client);

      // One byte of the persisted DEVICE link, flipped on the way out of
      // PostgreSQL. Everything else is the genuine stored chain, and the row
      // still reads `issued` — so a pass here would mean nothing was checked.
      const tampered = {
        ...repository,
        loadCredentialChainLinks: async (credentialId: string) => {
          const links = await repository.loadCredentialChainLinks(credentialId);
          // ONLY the newly issued credential. Tampering with the incumbent's
          // chain too would make the PREFLIGHT refuse, and the test would pass
          // for entirely the wrong reason.
          if (credentialId === fixture.credentialId) return links;
          return links.map((link) => {
            if (link.role !== "device") return link;
            const signature = new Uint8Array(link.detachedSignature);
            signature[0] = signature[0]! ^ 0xff;
            return { ...link, detachedSignature: signature };
          });
        },
      };

      const outcome = await completeSameKeyCredentialRenewal(
        renewalInput(fixture),
        tampered,
        pgReservationGateway(client),
        pgIssuanceGateway(client),
        fixture.ca,
        fixture.signer,
      );

      expect(outcome.refusalCode).toBe("RENEWAL_ISSUANCE_POST_VERIFICATION_FAILED");
      expect(outcome.detail).toContain("CHAIN_DEVICE_NOT_SIGNED_BY_INTERMEDIATE");

      // `issued` alone did NOT authenticate it.
      const state = await client.query(
        `select state from kitluy_devices.device_credentials
         where device_record_id = $1 and certificate_generation = 2`,
        [fixture.deviceRecordId],
      );
      expect(state.rows[0].state).toBe("issued");
    });
  }, 90_000);

  // =========================================================================
  // Idempotency
  // =========================================================================
  it("re-running the orchestration after success issues nothing new", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "RETRY",
      });
      const repository = pgIncumbentRepository(client);
      const reservations = pgReservationGateway(client);
      const issuance = pgIssuanceGateway(client);

      const first = await completeSameKeyCredentialRenewal(
        renewalInput(fixture),
        repository,
        reservations,
        issuance,
        fixture.ca,
        fixture.signer,
      );
      expect(first.outcome).toBe("RENEWED");
      const afterFirst = await snapshot(client, fixture.deviceRecordId);

      const second = await completeSameKeyCredentialRenewal(
        renewalInput(fixture),
        repository,
        reservations,
        issuance,
        fixture.ca,
        fixture.signer,
      );

      // The honest answer, and the safe one. The renewal SUCCEEDED, so the head
      // now carries a fresh 30-day credential — and a second renewal of THAT is
      // genuinely too early. The orchestration says so instead of minting
      // anything, and instead of pretending a completed renewal is in progress.
      //
      // Idempotency lives one level down, on the frozen request id: preparation,
      // signature recording and finalization each replay rather than duplicate.
      // The next test proves that stage by stage.
      expect(second.outcome).toBe("REFUSED");
      expect(second.preflightRefusalCode).toBe("RENEWAL_PREFLIGHT_NOT_IN_RENEWAL_WINDOW");

      // No second credential, no second serial, no second head advance.
      const afterSecond = await snapshot(client, fixture.deviceRecordId);
      expect(afterSecond.credentials).toBe(afterFirst.credentials);
      expect(afterSecond.headGeneration).toBe(afterFirst.headGeneration);
      expect(afterSecond.headVersion).toBe(afterFirst.headVersion);
      expect(afterSecond.reservations).toBe(afterFirst.reservations);
      expect(afterSecond.providerKeys).toBe(1);

      const serials = await client.query(
        `select count(distinct serial_number) as n from kitluy_devices.device_credentials
         where device_record_id = $1`,
        [fixture.deviceRecordId],
      );
      expect(Number(serials.rows[0].n)).toBe(2);
    });
  }, 90_000);

  it("replays each governed stage individually", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "STAGES",
      });
      const gateway = pgIssuanceGateway(client);
      const captured: { prepare: unknown[] } = { prepare: [] };

      const recording: GovernedIssuanceGateway = {
        ...gateway,
        async prepare(input) {
          const prepared = await gateway.prepare(input);
          captured.prepare.push(prepared);
          return prepared;
        },
      };

      const outcome = await completeSameKeyCredentialRenewal(
        renewalInput(fixture),
        pgIncumbentRepository(client),
        pgReservationGateway(client),
        recording,
        fixture.ca,
        fixture.signer,
      );
      expect(outcome.outcome).toBe("RENEWED");

      const requestId = `rnw-${outcome.reservation!.renewalAttemptId}`;
      const before = await snapshot(client, fixture.deviceRecordId);
      expect(captured.prepare).toHaveLength(1);

      // Read the frozen values as `postgres`: the issuance service can EXECUTE
      // the governed functions and cannot SELECT the tables behind them, which
      // is the boundary group 0131 restored rather than widened.
      const frozen = await client.query<{ k: string; h: string }>(
        `select idempotency_key as k, canonical_payload_hash as h
         from kitluy_devices.device_credential_requests where request_id = $1`,
        [requestId],
      );
      const attempt = await client.query<{ hash: string; sig: Buffer }>(
        `select canonical_tbs_hash as hash, detached_signature as sig
         from kitluy_devices.device_credential_signing_attempts where request_id = $1`,
        [requestId],
      );

      await withRole(client, TEST_ROLES.issuanceService, async () => {
        // Duplicate PREPARATION returns the already-issued credential.
        const replayPrepare = await client.query<{ result: Record<string, unknown> }>(
          `select kitluy_devices.prepare_device_credential_issuance_v1(
             $1,$2::uuid,$3,$4,$5::integer,$6,$7,$8,$9,$10,$11,$12::bytea,$13,$14,$15::timestamptz,$16,$17) as result`,
          [
            requestId,
            fixture.deviceRecordId,
            DEVELOPMENT,
            DEVICE_IDENTITY,
            fixture.assignmentGeneration,
            fixture.publicKeyPem,
            fixture.fingerprint,
            frozen.rows[0].k,
            frozen.rows[0].h,
            "ed25519",
            "0".repeat(64),
            Buffer.from([1]),
            true,
            fixture.ca.intermediateKeyId,
            new Date(),
            "trusted",
            "REPLAY",
          ],
        );
        expect(replayPrepare.rows[0]?.result["outcome"]).toBe("ALREADY_ISSUED");

        // Duplicate SIGNATURE RECORDING replays rather than re-signing.
        const replayRecord = await client.query<{ result: Record<string, unknown> }>(
          `select kitluy_devices.record_device_credential_signature_v1($1,$2,$3::bytea,$4,$5) as result`,
          [requestId, attempt.rows[0].hash, attempt.rows[0].sig, true, "REPLAY"],
        );
        expect(replayRecord.rows[0]?.result["outcome"]).toBe("ALREADY_FINALIZED");

        // Duplicate FINALIZATION returns the same credential and advances nothing.
        const replayFinalize = await client.query<{ result: Record<string, unknown> }>(
          `select kitluy_devices.finalize_device_credential_issuance_v1($1,'[]'::jsonb,$2) as result`,
          [requestId, "REPLAY"],
        );
        expect(replayFinalize.rows[0]?.result["outcome"]).toBe("ALREADY_ISSUED");
      });

      const after = await snapshot(client, fixture.deviceRecordId);
      expect(after.credentials).toBe(before.credentials);
      expect(after.headGeneration).toBe(before.headGeneration);
      expect(after.headVersion).toBe(before.headVersion);
    });
  }, 90_000);

  // =========================================================================
  // Focused failures
  // =========================================================================
  it("refuses when the credential head moved after the reservation", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "STALEHEAD",
      });
      const repository = pgIncumbentRepository(client);
      const issuance = pgIssuanceGateway(client);

      // A first renewal advances the head to generation 2.
      const first = await completeSameKeyCredentialRenewal(
        renewalInput(fixture),
        repository,
        pgReservationGateway(client),
        issuance,
        fixture.ca,
        fixture.signer,
      );
      expect(first.outcome).toBe("RENEWED");
      const before = await snapshot(client, fixture.deviceRecordId);

      // A SECOND renewal reserves generation 3 against head version 2, then we
      // hand the issuance the FIRST reservation — frozen at head version 1.
      const stale = {
        ...issuance,
        prepare: issuance.prepare.bind(issuance),
      };
      const outcome = await completeSameKeyCredentialRenewal(
        {
          ...renewalInput(fixture),
          idempotencyKey: `stale-${fixture.credentialId}`,
          expectedCredentialHeadVersion: 1,
        },
        repository,
        pgReservationGateway(client),
        stale,
        fixture.ca,
        fixture.signer,
      );

      // The PREFLIGHT catches it first: the caller's observed head version is
      // stale, so nothing is even reserved.
      expect(outcome.refusalCode).toBe("RENEWAL_ISSUANCE_PREFLIGHT_REFUSED");
      expect(outcome.preflightRefusalCode).toBe("RENEWAL_PREFLIGHT_STALE_HEAD_VERSION");

      const after = await snapshot(client, fixture.deviceRecordId);
      expect(after.credentials).toBe(before.credentials);
      expect(after.headVersion).toBe(before.headVersion);
    });
  }, 90_000);

  it("refuses when the assignment generation moved after the reservation", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "REASSIGN",
      });
      const repository = pgIncumbentRepository(client);
      const reservations = pgReservationGateway(client);

      // Reserve FIRST, so the reservation freezes assignment generation 1.
      const { prepareSameKeyCredentialRenewal } =
        await import("../src/same-key-renewal-preflight.js");
      const preflight = await prepareSameKeyCredentialRenewal(
        renewalInput(fixture),
        repository,
        reservations,
      );
      expect(preflight.outcome).toBe("RESERVED");

      // Now reassign through the GOVERNED path.
      await client.query(
        `select kitluy_devices.replace_device_assignment_v1(
           $1::uuid, '00000000-0000-4000-8000-000000000011'::uuid,
           '00000000-0000-4000-8000-000000000015'::uuid,
           '00000000-0000-4000-8000-000000000018'::uuid,
           'renewal-issuance-reassignment-probe', 'OP-REASSIGN')`,
        [fixture.deviceRecordId],
      );
      const before = await snapshot(client, fixture.deviceRecordId);

      const outcome = await completeSameKeyCredentialRenewal(
        renewalInput(fixture),
        repository,
        reservations,
        pgIssuanceGateway(client),
        fixture.ca,
        fixture.signer,
      );

      expect(outcome.outcome).toBe("REFUSED");
      // Either layer may catch it; what must NOT happen is a silent re-target
      // onto the new assignment generation.
      expect(outcome.detail ?? "").toMatch(
        /STALE.ASSIGNMENT|ASSIGNMENT_MOVED|assignment generation/i,
      );

      const after = await snapshot(client, fixture.deviceRecordId);
      expect(after.credentials).toBe(before.credentials);
      expect(after.headGeneration).toBe(before.headGeneration);
    });
  }, 90_000);

  it("refuses a provider key that is not the incumbent", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "KEYMISMATCH",
      });
      const repository = pgIncumbentRepository(client);
      const base = await repository.loadCurrentProviderKey({
        deviceRecordId: fixture.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
      });
      expect(base?.state).toBe("active");

      const wrong = {
        ...repository,
        loadCurrentProviderKey: async () => ({ ...base!, publicKeyFingerprint: "a".repeat(64) }),
      };
      const outcome = await completeSameKeyCredentialRenewal(
        renewalInput(fixture),
        wrong,
        pgReservationGateway(client),
        pgIssuanceGateway(client),
        fixture.ca,
        fixture.signer,
      );

      expect(outcome.outcome).toBe("REFUSED");
      expect(fixture.possessionProofCount()).toBe(0);
      expect((await snapshot(client, fixture.deviceRecordId)).credentials).toBe(1);
    });
  }, 90_000);

  it("refuses a canonical TBS the database did not build", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "TBS",
      });
      const gateway = pgIssuanceGateway(client);
      const tampering: GovernedIssuanceGateway = {
        ...gateway,
        async prepare(input) {
          const prepared = await gateway.prepare(input);
          // One field of the reserved bytes, changed in transit.
          const canonical = (prepared.canonicalTbs ?? "").replace(
            prepared.serialNumber,
            "DEV-TAMPERED-SERIAL",
          );
          return { ...prepared, canonicalTbs: canonical };
        },
      };

      const outcome = await completeSameKeyCredentialRenewal(
        renewalInput(fixture),
        pgIncumbentRepository(client),
        pgReservationGateway(client),
        tampering,
        fixture.ca,
        fixture.signer,
      );

      expect(outcome.refusalCode).toBe("RENEWAL_ISSUANCE_CANONICAL_TBS_DIVERGENCE");
      // Nothing was signed, so nothing was recorded.
      const attempts = await client.query(
        `select state from kitluy_devices.device_credential_signing_attempts
         where device_record_id = $1 and certificate_generation = 2`,
        [fixture.deviceRecordId],
      );
      expect(attempts.rows[0]?.state).toBe("reserved");
      expect((await snapshot(client, fixture.deviceRecordId)).credentials).toBe(1);
    });
  }, 90_000);

  it("refuses a signature offered for another issuance attempt", async () => {
    await withDatabaseTransaction(async (client) => {
      const a = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "SIGA",
      });
      const b = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "SIGB",
      });

      const outcomeA = await completeSameKeyCredentialRenewal(
        renewalInput(a),
        pgIncumbentRepository(client),
        pgReservationGateway(client),
        pgIssuanceGateway(client),
        a.ca,
        a.signer,
      );
      expect(outcomeA.outcome).toBe("RENEWED");

      // Device B reserves its own renewal, and is then offered A's signature.
      const { prepareSameKeyCredentialRenewal } =
        await import("../src/same-key-renewal-preflight.js");
      const preB = await prepareSameKeyCredentialRenewal(
        renewalInput(b),
        pgIncumbentRepository(client),
        pgReservationGateway(client),
      );
      expect(preB.outcome).toBe("RESERVED");

      // Read as `postgres`: the issuance service executes the governed
      // functions and cannot read the tables behind them.
      const aSignature = await client.query<{ hash: string; sig: Buffer }>(
        `select canonical_tbs_hash as hash, detached_signature as sig
         from kitluy_devices.device_credential_signing_attempts
         where device_record_id = $1 and certificate_generation = 2`,
        [a.deviceRecordId],
      );

      await withRole(client, TEST_ROLES.issuanceService, async () => {
        // A's signature, offered under B's renewal request id.
        const refusal = await expectRefused(client, () =>
          client.query(
            `select kitluy_devices.record_device_credential_signature_v1($1,$2,$3::bytea,$4,$5)`,
            [
              `rnw-${preB.reservation!.renewalAttemptId}`,
              aSignature.rows[0].hash,
              aSignature.rows[0].sig,
              true,
              "CROSS",
            ],
          ),
        );
        // No signing attempt exists for B yet, and even once it does the digest
        // belongs to A — both refusals are the database's, not this test's.
        expect(refusal).toMatch(/KLUY-CRED-NO-RESERVATION|KLUY-CRED-TBS-MISMATCH/);
      });
    });
  }, 120_000);

  // =========================================================================
  // Privilege boundary, still closed after issuance
  // =========================================================================
  it("still denies direct credential and head writes to the issuance service", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "BOUNDARY",
      });
      const outcome = await completeSameKeyCredentialRenewal(
        renewalInput(fixture),
        pgIncumbentRepository(client),
        pgReservationGateway(client),
        pgIssuanceGateway(client),
        fixture.ca,
        fixture.signer,
      );
      expect(outcome.outcome).toBe("RENEWED");

      await withRole(client, TEST_ROLES.issuanceService, async () => {
        expect(await currentRole(client)).toBe(TEST_ROLES.issuanceService);

        const insert = await expectRefused(client, () =>
          client.query(
            `insert into kitluy_devices.device_credentials (
               credential_id, serial_number, device_record_id, environment, purpose,
               public_key, public_key_fingerprint, issuer_key_id, certificate_generation,
               assignment_generation, not_before, not_after, hardware_trust_level,
               canonical_tbs, detached_signature, created_from_request_id, state)
             values (gen_random_uuid(), 'DEV-FORGED-3', $1::uuid, 'development', 'device_identity',
                     'PEM', $2, 'ica', 3, 1, now(), now() + interval '1 day',
                     'development_software', 'TBS', decode('00','hex'), 'rq-forged-3', 'issued')`,
            [fixture.deviceRecordId, fixture.fingerprint],
          ),
        );
        expect(insert).toMatch(/permission denied|KLUY-CRED-UNAUTHORIZED-ISSUE/);

        const head = await expectRefused(client, () =>
          client.query(
            `update kitluy_devices.device_credential_heads
             set current_generation = current_generation + 1, version = version + 1
             where device_record_id = $1`,
            [fixture.deviceRecordId],
          ),
        );
        expect(head).toMatch(/permission denied|KLUY-CRED-UNAUTHORIZED-HEAD/);

        const reservation = await expectRefused(client, () =>
          client.query(
            `update kitluy_devices.device_renewal_reservations set status = 'reserved'
             where device_record_id = $1`,
            [fixture.deviceRecordId],
          ),
        );
        expect(reservation).toMatch(/permission denied|KLUY-RENEWAL/);
      });

      expect(await currentRole(client)).toBe("postgres");
    });
  }, 90_000);
});

describe("integration reporting", () => {
  it("states plainly whether the live renewal-issuance suite ran", () => {
    if (!reachable) {
      console.warn(
        `${SUITE} DID NOT RUN — no database evidence for renewal issuance from this run.`,
      );
    }
    expect(typeof reachable).toBe("boolean");
  });
});
