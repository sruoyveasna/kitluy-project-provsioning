/**
 * Same-key renewal preflight — LIVE PostgreSQL integration suite.
 *
 * Runs against the local development stack via the existing harness. When the
 * stack is unreachable the suite SKIPS VISIBLY and says so: a run with no
 * database is not evidence, and "0 failed" must never be read as "it works".
 *
 * ===========================================================================
 * PRIVILEGE BOUNDARY
 * ===========================================================================
 * Every governed call assumes `kitluy_issuance_service` explicitly. Running as
 * `postgres` — which inherits that role through `service_role` — would exercise
 * the function while proving nothing about its privilege model, and the whole
 * point of these tables is who may write them.
 *
 * Every transaction is rolled back, so fixture devices, credentials, keys and
 * reservations never reach the order-sensitive SQL assertion suite.
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
  fleetCounts,
  pgIncumbentRepository,
  pgReservationGateway,
  withRole,
  type IncumbentFixture,
} from "./support/renewal-fixtures.js";
import {
  SAME_KEY_RENEWAL_MODE,
  prepareSameKeyCredentialRenewal,
  type SameKeyRenewalPreflightInput,
} from "../src/same-key-renewal-preflight.js";
import type { TrustedTimeEvaluation } from "../src/trusted-time.js";

const SUITE = "@kitluy/device-identity same-key renewal preflight";

const reachable = await isDevDatabaseReachable();
if (!reachable) reportSkippedIntegration(SUITE);

/** Trusted time as a VALUE. No host clock reaches any decision below. */
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

/** An issuance instant that leaves `daysRemaining` before the 30-day expiry. */
const issuedSoThat = (daysRemaining: number): Date =>
  new Date(Date.now() - (30 - daysRemaining) * MS_PER_DAY);

function preflightInput(
  fixture: IncumbentFixture,
  overrides: Partial<SameKeyRenewalPreflightInput> = {},
): SameKeyRenewalPreflightInput {
  return {
    deviceRecordId: fixture.deviceRecordId,
    environment: DEVELOPMENT,
    purpose: DEVICE_IDENTITY,
    idempotencyKey: `renew-${fixture.credentialId}`,
    actorRef: "INTEGRATION-TEST",
    trustedTime: trustedAt(new Date()),
    trustedRootFingerprints: [fixture.ca.rootCertificate.tbs.subjectFingerprint],
    currentAssignmentGeneration: fixture.assignmentGeneration,
    ...overrides,
  };
}

describe.skipIf(!reachable)("live same-key renewal preflight", () => {
  beforeAll(() => {
    expect(devDatabaseUrl()).toMatch(/127\.0\.0\.1|localhost/);
  });

  // =========================================================================
  // The successful path
  // =========================================================================
  it("verifies a real incumbent chain and reserves a reuse_current_key renewal", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "HAPPY",
      });
      const before = await fleetCounts(client, fixture.deviceRecordId);
      const gateway = pgReservationGateway(client);

      const outcome = await prepareSameKeyCredentialRenewal(
        preflightInput(fixture),
        pgIncumbentRepository(client),
        gateway,
      );

      expect(outcome.refusalCode).toBeUndefined();
      expect(outcome.outcome).toBe("RESERVED");

      // -- from TypeScript / the provider --------------------------------
      // The chain that verified came out of PostgreSQL, byte for byte.
      expect(outcome.diagnostics?.credentialKind).toBe("kitluy.development-device-credential.v1");
      expect(outcome.diagnostics?.consumersMustReVerifyAtAuthenticationBoundary).toBe(true);
      expect(outcome.daysRemaining).toBeGreaterThan(8);
      expect(outcome.daysRemaining).toBeLessThanOrEqual(10);
      // The provider generated ONE key, for enrollment. Renewal generated none.
      expect(fixture.keyGenerationCount()).toBe(1);
      expect(fixture.privateKeyWasExported()).toBe(false);
      expect(outcome.reservation?.currentPublicKeyFingerprint).toBe(fixture.fingerprint);
      // The reservation was made under the issuance service role, not postgres.
      expect(gateway.rolesObserved).toEqual([TEST_ROLES.issuanceService]);

      // -- from PostgreSQL -----------------------------------------------
      const reservations = await client.query(
        `select renewal_attempt_id, renewal_mode, status, current_credential_id,
                current_credential_generation, next_credential_generation,
                credential_head_version, assignment_generation, environment, purpose
         from kitluy_devices.device_renewal_reservations where device_record_id = $1`,
        [fixture.deviceRecordId],
      );
      expect(reservations.rowCount).toBe(1);
      const row = reservations.rows[0];
      expect(row.renewal_mode).toBe(SAME_KEY_RENEWAL_MODE);
      // `issuance_pending` IS the reserved state for reuse_current_key: with no
      // key to generate, migration 0130 sends the attempt straight there.
      expect(row.status).toBe("issuance_pending");
      expect(row.current_credential_id).toBe(fixture.credentialId);
      expect(Number(row.current_credential_generation)).toBe(fixture.generation);
      expect(Number(row.next_credential_generation)).toBe(fixture.generation + 1);
      expect(Number(row.credential_head_version)).toBe(fixture.headVersion);
      expect(Number(row.assignment_generation)).toBe(fixture.assignmentGeneration);
      expect(row.environment).toBe(DEVELOPMENT);
      expect(row.purpose).toBe(DEVICE_IDENTITY);
      expect(outcome.reservation?.renewalAttemptId).toBe(row.renewal_attempt_id);

      // No replacement key is referenced, because none was generated.
      const replacementKeys = await client.query(
        `select count(*) as n from kitluy_devices.device_generation_keys
         where renewal_attempt_id = $1`,
        [row.renewal_attempt_id],
      );
      expect(Number(replacementKeys.rows[0].n)).toBe(0);

      // Nothing was issued, no key appeared, and the head did not advance.
      const after = await fleetCounts(client, fixture.deviceRecordId);
      expect(after.credentials).toBe(before.credentials);
      expect(after.providerKeys).toBe(before.providerKeys);
      expect(after.headGeneration).toBe(before.headGeneration);
      expect(after.headVersion).toBe(before.headVersion);
      expect(after.reservations).toBe(1);
    });
  }, 60_000);

  // =========================================================================
  // Privilege boundary
  // =========================================================================
  it("runs the governed reservation under kitluy_issuance_service and nothing more", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "ROLE",
      });

      await withRole(client, TEST_ROLES.issuanceService, async () => {
        // 1. The suite is actually running as the role it claims to test.
        expect(await currentRole(client)).toBe(TEST_ROLES.issuanceService);

        // 2. It CAN execute the governed reservation.
        const reserved = await client.query<{ result: Record<string, unknown> }>(
          `select kitluy_devices.reserve_device_credential_renewal_v1(
             $1::uuid, $2, $3, $4, $5::timestamptz, 'trusted',
             'reuse_current_key'::kitluy_devices.renewal_mode, 'ROLE-TEST') as result`,
          [
            fixture.deviceRecordId,
            DEVELOPMENT,
            DEVICE_IDENTITY,
            `role-${fixture.credentialId}`,
            new Date(),
          ],
        );
        expect(reserved.rows[0]?.result["outcome"]).toBe("RESERVED");

        // 3. It CANNOT insert a credential directly.
        const insertRefusal = await expectRefused(client, () =>
          client.query(
            `insert into kitluy_devices.device_credentials (
               credential_id, serial_number, device_record_id, environment, purpose,
               public_key, public_key_fingerprint, issuer_key_id, certificate_generation,
               assignment_generation, not_before, not_after, hardware_trust_level,
               canonical_tbs, detached_signature, created_from_request_id, state)
             values (gen_random_uuid(), 'DEV-FORGED', $1::uuid, 'development', 'device_identity',
                     'PEM', $2, 'ica', 99, 1, now(), now() + interval '1 day',
                     'development_software', 'TBS', '\\x00'::bytea, 'rq-forged', 'issued')`,
            [fixture.deviceRecordId, fixture.fingerprint],
          ),
        );
        expect(insertRefusal).toMatch(/permission denied|KLUY-CRED-UNAUTHORIZED-ISSUE/);

        // 4. It CANNOT advance a credential head directly.
        const headRefusal = await expectRefused(client, () =>
          client.query(
            `update kitluy_devices.device_credential_heads
             set current_generation = current_generation + 1, version = version + 1
             where device_record_id = $1`,
            [fixture.deviceRecordId],
          ),
        );
        expect(headRefusal).toMatch(/permission denied|KLUY-CRED-UNAUTHORIZED-HEAD/);

        // 5. It CANNOT move provider-key lifecycle state directly.
        const keyRefusal = await expectRefused(client, () =>
          client.query(
            `update kitluy_devices.device_generation_keys
             set state = 'superseded', superseded_at = now()
             where device_record_id = $1`,
            [fixture.deviceRecordId],
          ),
        );
        expect(keyRefusal).toMatch(/permission denied|KLUY-KEY-UNAUTHORIZED|KLUY-KEY-BAD/);

        // 6. It CANNOT climb into the NOLOGIN governor. NOLOGIN was never the
        //    guarantee — non-membership is.
        const escalation = await expectRefused(client, () =>
          client.query("set role kitluy_credential_issuer"),
        );
        expect(escalation).toMatch(/permission denied to set role/);
      });

      // 7. The session role is restored once the block exits.
      expect(await currentRole(client)).toBe("postgres");
    });
  }, 60_000);

  it("rolls back: the session role and every fixture row are gone afterwards", async () => {
    let deviceRecordId = "";
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "ROLLBACK",
      });
      deviceRecordId = fixture.deviceRecordId;
      await prepareSameKeyCredentialRenewal(
        preflightInput(fixture),
        pgIncumbentRepository(client),
        pgReservationGateway(client),
      );
      const inside = await fleetCounts(client, deviceRecordId);
      expect(inside.reservations).toBe(1);
    });

    // A NEW connection: the device, its credential and its reservation are all
    // gone, and the role is the session default again.
    await withDatabaseTransaction(async (client) => {
      expect(await currentRole(client)).toBe("postgres");
      const survived = await fleetCounts(client, deviceRecordId);
      expect(survived.credentials).toBe(0);
      expect(survived.providerKeys).toBe(0);
      expect(survived.reservations).toBe(0);
      expect(survived.headGeneration).toBeNull();
    });
  }, 60_000);

  // =========================================================================
  // Real-database failure cases
  // =========================================================================
  it("refuses eleven days remaining, in BOTH layers", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(11),
        label: "EARLY",
      });

      const outcome = await prepareSameKeyCredentialRenewal(
        preflightInput(fixture),
        pgIncumbentRepository(client),
        pgReservationGateway(client),
      );
      expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_NOT_IN_RENEWAL_WINDOW");
      expect(outcome.requiresRecovery).toBeUndefined();

      // The database refuses the same thing on its own, so the window is not
      // only a TypeScript opinion.
      const dbRefusal = await withRole(client, TEST_ROLES.issuanceService, () =>
        expectRefused(client, () =>
          client.query(
            `select kitluy_devices.reserve_device_credential_renewal_v1(
               $1::uuid, $2, $3, $4, $5::timestamptz, 'trusted',
               'reuse_current_key'::kitluy_devices.renewal_mode, 'EARLY') as result`,
            [
              fixture.deviceRecordId,
              DEVELOPMENT,
              DEVICE_IDENTITY,
              `early-${fixture.credentialId}`,
              new Date(),
            ],
          ),
        ),
      );
      expect(dbRefusal).toContain("KLUY-RENEWAL-TOO-EARLY");

      expect((await fleetCounts(client, fixture.deviceRecordId)).reservations).toBe(0);
    });
  }, 60_000);

  it("routes an expired incumbent to recovery, in BOTH layers", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(-2),
        label: "EXPIRED",
      });

      const outcome = await prepareSameKeyCredentialRenewal(
        preflightInput(fixture),
        pgIncumbentRepository(client),
        pgReservationGateway(client),
      );
      expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_CREDENTIAL_EXPIRED");
      expect(outcome.requiresRecovery).toBe(true);

      const dbRefusal = await withRole(client, TEST_ROLES.issuanceService, () =>
        expectRefused(client, () =>
          client.query(
            `select kitluy_devices.reserve_device_credential_renewal_v1(
               $1::uuid, $2, $3, $4, $5::timestamptz, 'trusted',
               'reuse_current_key'::kitluy_devices.renewal_mode, 'EXPIRED') as result`,
            [
              fixture.deviceRecordId,
              DEVELOPMENT,
              DEVICE_IDENTITY,
              `expired-${fixture.credentialId}`,
              new Date(),
            ],
          ),
        ),
      );
      expect(dbRefusal).toContain("KLUY-RENEWAL-EXPIRED-REQUIRES-RECOVERY");
    });
  }, 60_000);

  it("routes a contained device to recovery rather than renewing it", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "REVOKED",
      });

      // Containment is applied through the GOVERNED path, not by editing a row.
      await client.query(
        `select kitluy_devices.quarantine_device_v1(
           $1::uuid, 'manual_quarantine'::kitluy_devices.trust_incident_type,
           'CRITICAL', 'INTEGRATION-TEST', 'renewal preflight containment probe', '{}'::jsonb)`,
        [fixture.deviceRecordId],
      );

      const outcome = await prepareSameKeyCredentialRenewal(
        preflightInput(fixture),
        pgIncumbentRepository(client),
        pgReservationGateway(client),
      );
      expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_CREDENTIAL_REVOKED");
      expect(outcome.requiresRecovery).toBe(true);
      expect((await fleetCounts(client, fixture.deviceRecordId)).reservations).toBe(0);
    });
  }, 60_000);

  it("refuses a stale assignment generation, in BOTH layers", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "REASSIGN",
      });

      // The GOVERNED reassignment path. It supersedes the live assignment and
      // advances the device past the generation the credential froze — exactly
      // the situation `assignment_generation` exists to catch.
      await client.query(
        `select kitluy_devices.replace_device_assignment_v1(
           $1::uuid, '00000000-0000-4000-8000-000000000011'::uuid,
           '00000000-0000-4000-8000-000000000015'::uuid,
           '00000000-0000-4000-8000-000000000018'::uuid,
           'renewal-preflight-reassignment-probe', 'OP-REASSIGN')`,
        [fixture.deviceRecordId],
      );

      const current = await client.query(
        "select assignment_generation from kitluy_devices.devices where id = $1",
        [fixture.deviceRecordId],
      );
      const moved = Number(current.rows[0].assignment_generation);
      expect(moved).toBeGreaterThan(fixture.assignmentGeneration);

      const outcome = await prepareSameKeyCredentialRenewal(
        preflightInput(fixture, { currentAssignmentGeneration: moved }),
        pgIncumbentRepository(client),
        pgReservationGateway(client),
      );
      expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_STALE_ASSIGNMENT_GENERATION");

      const dbRefusal = await withRole(client, TEST_ROLES.issuanceService, () =>
        expectRefused(client, () =>
          client.query(
            `select kitluy_devices.reserve_device_credential_renewal_v1(
               $1::uuid, $2, $3, $4, $5::timestamptz, 'trusted',
               'reuse_current_key'::kitluy_devices.renewal_mode, 'REASSIGN') as result`,
            [
              fixture.deviceRecordId,
              DEVELOPMENT,
              DEVICE_IDENTITY,
              `reassign-${fixture.credentialId}`,
              new Date(),
            ],
          ),
        ),
      );
      expect(dbRefusal).toContain("KLUY-RENEWAL-STALE-ASSIGNMENT");
    });
  }, 60_000);

  it("refuses a device that has no credential head at all", async () => {
    await withDatabaseTransaction(async (client) => {
      const anyDevice = await client.query<{ id: string }>(
        `select d.id from kitluy_devices.devices d
         left join kitluy_devices.device_credential_heads h on h.device_record_id = d.id
         where h.device_record_id is null limit 1`,
      );
      const deviceRecordId = anyDevice.rows[0]?.id;
      expect(deviceRecordId).toBeDefined();

      const outcome = await prepareSameKeyCredentialRenewal(
        {
          deviceRecordId: deviceRecordId!,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
          idempotencyKey: `nohead-${deviceRecordId}`,
          actorRef: "INTEGRATION-TEST",
          trustedTime: trustedAt(new Date()),
          trustedRootFingerprints: [],
          currentAssignmentGeneration: 1,
        },
        pgIncumbentRepository(client),
        pgReservationGateway(client),
      );
      expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_NO_CREDENTIAL_HEAD");

      const dbRefusal = await withRole(client, TEST_ROLES.issuanceService, () =>
        expectRefused(client, () =>
          client.query(
            `select kitluy_devices.reserve_device_credential_renewal_v1(
               $1::uuid, $2, $3, $4, $5::timestamptz, 'trusted',
               'reuse_current_key'::kitluy_devices.renewal_mode, 'NOHEAD') as result`,
            [deviceRecordId, DEVELOPMENT, DEVICE_IDENTITY, `nohead-${deviceRecordId}`, new Date()],
          ),
        ),
      );
      expect(dbRefusal).toContain("KLUY-RENEWAL-NO-CURRENT-CREDENTIAL");
    });
  }, 60_000);

  it("refuses a caller-nominated incumbent that is not the head's", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "NOTHEAD",
      });
      // A SECOND real, issued credential — built rather than looked up, so the
      // test cannot degrade into nominating the fixture's own id and passing
      // for the wrong reason.
      const other = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "NOTHEAD2",
      });
      expect(other.credentialId).not.toBe(fixture.credentialId);

      const outcome = await prepareSameKeyCredentialRenewal(
        preflightInput(fixture, { assertedCurrentCredentialId: other.credentialId }),
        pgIncumbentRepository(client),
        pgReservationGateway(client),
      );
      expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_INCUMBENT_NOT_CURRENT");
      expect((await fleetCounts(client, fixture.deviceRecordId)).reservations).toBe(0);
    });
  }, 60_000);

  it("refuses a stale credential-head version", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "STALEHEAD",
      });
      const outcome = await prepareSameKeyCredentialRenewal(
        preflightInput(fixture, { expectedCredentialHeadVersion: fixture.headVersion + 7 }),
        pgIncumbentRepository(client),
        pgReservationGateway(client),
      );
      expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_STALE_HEAD_VERSION");
    });
  }, 60_000);

  it("refuses an inactive provider key and a fingerprint that is not the incumbent's", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "KEYSTATE",
      });

      // The registered key really is active after issuance — establish that
      // before contradicting it, or the two assertions below prove nothing.
      const active = await client.query(
        `select state, public_key_fingerprint from kitluy_devices.device_generation_keys
         where device_record_id = $1`,
        [fixture.deviceRecordId],
      );
      expect(active.rows[0].state).toBe("active");
      expect(active.rows[0].public_key_fingerprint).toBe(fixture.fingerprint);

      const repository = pgIncumbentRepository(client);
      const base = await repository.loadCurrentProviderKey({
        deviceRecordId: fixture.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
      });

      // The key row cannot be edited from here — no role in this test may write
      // it — so the two refusals are driven by overriding the READ, with the
      // real row proven above as the baseline.
      const inactive = {
        ...repository,
        loadCurrentProviderKey: async () => ({ ...base!, state: "superseded" }),
      };
      const inactiveOutcome = await prepareSameKeyCredentialRenewal(
        preflightInput(fixture),
        inactive,
        pgReservationGateway(client),
      );
      expect(inactiveOutcome.refusalCode).toBe("RENEWAL_PREFLIGHT_PROVIDER_KEY_NOT_ACTIVE");

      const mismatched = {
        ...repository,
        loadCurrentProviderKey: async () => ({
          ...base!,
          publicKeyFingerprint: "e".repeat(64),
        }),
      };
      const mismatchOutcome = await prepareSameKeyCredentialRenewal(
        preflightInput(fixture),
        mismatched,
        pgReservationGateway(client),
      );
      expect(mismatchOutcome.refusalCode).toBe(
        "RENEWAL_PREFLIGHT_PROVIDER_KEY_FINGERPRINT_MISMATCH",
      );

      expect((await fleetCounts(client, fixture.deviceRecordId)).reservations).toBe(0);
    });
  }, 60_000);

  it("returns the SAME attempt and generation on an idempotent retry", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "RETRY",
      });
      const repository = pgIncumbentRepository(client);
      const gateway = pgReservationGateway(client);
      const input = preflightInput(fixture);

      const first = await prepareSameKeyCredentialRenewal(input, repository, gateway);
      const second = await prepareSameKeyCredentialRenewal(input, repository, gateway);

      expect(first.outcome).toBe("RESERVED");
      expect(second.outcome).toBe("REPLAYED");
      expect(second.reservation?.renewalAttemptId).toBe(first.reservation?.renewalAttemptId);
      expect(second.reservation?.nextCredentialGeneration).toBe(
        first.reservation?.nextCredentialGeneration,
      );

      // A retry allocates NO second attempt and NO second next generation.
      const rows = await client.query(
        `select count(*) as n, count(distinct next_credential_generation) as gens
         from kitluy_devices.device_renewal_reservations where device_record_id = $1`,
        [fixture.deviceRecordId],
      );
      expect(Number(rows.rows[0].n)).toBe(1);
      expect(Number(rows.rows[0].gens)).toBe(1);
    });
  }, 60_000);

  it("refuses a competing reservation with KLUY-RENEWAL-ALREADY-RESERVED", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "COMPETE",
      });
      const repository = pgIncumbentRepository(client);
      const gateway = pgReservationGateway(client);

      const first = await prepareSameKeyCredentialRenewal(
        preflightInput(fixture),
        repository,
        gateway,
      );
      expect(first.outcome).toBe("RESERVED");

      // A DIFFERENT idempotency key for the same next generation is a competing
      // attempt, not a retry.
      const competing = await prepareSameKeyCredentialRenewal(
        preflightInput(fixture, { idempotencyKey: `compete-${fixture.credentialId}` }),
        repository,
        gateway,
      );
      expect(competing.refusalCode).toBe("RENEWAL_PREFLIGHT_ALREADY_RESERVED");
      expect(competing.detail).toContain("KLUY-RENEWAL-ALREADY-RESERVED");

      expect((await fleetCounts(client, fixture.deviceRecordId)).reservations).toBe(1);
    });
  }, 60_000);

  it("refuses a forged incumbent signature loaded from PostgreSQL", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "FORGED",
      });
      const repository = pgIncumbentRepository(client);
      const links = await repository.loadCredentialChainLinks(fixture.credentialId);
      expect(links).toHaveLength(3);

      // One byte of the DEVICE link's signature, flipped. Everything else is
      // the genuine stored chain — so a pass here would mean the signature was
      // never actually checked.
      const forged = {
        ...repository,
        loadCredentialChainLinks: async () =>
          links.map((link) => {
            if (link.role !== "device") return link;
            const signature = new Uint8Array(link.detachedSignature);
            signature[0] = signature[0]! ^ 0xff;
            return { ...link, detachedSignature: signature };
          }),
      };

      const outcome = await prepareSameKeyCredentialRenewal(
        preflightInput(fixture),
        forged,
        pgReservationGateway(client),
      );
      expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_CHAIN_VERIFICATION_FAILED");
      expect(outcome.detail).toContain("CHAIN_DEVICE_NOT_SIGNED_BY_INTERMEDIATE");
      // The row still says `issued`, and that changed nothing.
      const state = await client.query(
        "select state from kitluy_devices.device_credentials where credential_id = $1",
        [fixture.credentialId],
      );
      expect(state.rows[0].state).toBe("issued");
      expect((await fleetCounts(client, fixture.deviceRecordId)).reservations).toBe(0);
    });
  }, 60_000);
});

describe("integration reporting", () => {
  it("states plainly whether the live renewal-preflight suite ran", () => {
    if (!reachable) {
      console.warn(
        `${SUITE} DID NOT RUN — no database evidence for renewal preflight from this run.`,
      );
    }
    expect(typeof reachable).toBe("boolean");
  });
});
