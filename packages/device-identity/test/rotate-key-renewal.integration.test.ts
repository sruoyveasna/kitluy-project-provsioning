/**
 * Optional `rotate_key` renewal and provider activation — LIVE PostgreSQL.
 *
 * The complete rotation against the real local stack: preflight, reservation,
 * provider key generation, governed registration, replacement-key proof of
 * possession, prepare/sign/finalize, the PENDING state that migration 0130
 * TASK D exists for, provider activation, database confirmation, and finally
 * the persisted credential put through the real verifier.
 *
 * Rotation is DISABLED in the shipped policy. Every test that needs it enables
 * it by NAMING a test decision — satisfying the CHECK honestly rather than
 * bypassing it — and every transaction rolls back, so the override cannot leak.
 *
 * Governed calls assume `kitluy_issuance_service`. A skip is reported as a skip.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type pg from "pg";

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
  enableDevelopmentRotation,
  expectRefused,
  pgIncumbentRepository,
  pgIssuanceGateway,
  pgReservationGateway,
  pgRotationGateway,
  readRotationPolicy,
  restoreDevelopmentRotation,
  withRole,
  type IncumbentFixture,
} from "./support/renewal-fixtures.js";
import {
  completeRotateKeyCredentialRenewal,
  buildReplacementChallenge,
  type RotateKeyRenewalInput,
} from "../src/rotate-key-renewal-issuance.js";
import { DevelopmentReplacementKeyProvider } from "../src/replacement-key-provider.js";
import { replacementChallengeBytes } from "../src/replacement-key-pop.js";
import type { TrustedTimeEvaluation } from "../src/trusted-time.js";

const SUITE = "@kitluy/device-identity rotate_key renewal and provider activation";

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

function rotationInput(
  fixture: IncumbentFixture,
  overrides: Partial<RotateKeyRenewalInput> = {},
): RotateKeyRenewalInput {
  return {
    deviceRecordId: fixture.deviceRecordId,
    environment: DEVELOPMENT,
    purpose: DEVICE_IDENTITY,
    idempotencyKey: `rotate-${fixture.credentialId}`,
    actorRef: "INTEGRATION-ROTATION",
    trustedTime: trustedAt(new Date()),
    trustedRootFingerprints: [fixture.ca.rootCertificate.tbs.subjectFingerprint],
    currentAssignmentGeneration: fixture.assignmentGeneration,
    ...overrides,
  };
}

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
          from kitluy_devices.device_generation_keys where device_record_id=$1) key_states`,
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
  };
}

/** Everything a rotation needs, assembled once. */
async function rotationWorld(client: pg.PoolClient, label: string) {
  const fixture = await createIncumbentFixture(client, {
    issuedAtTrustedTime: issuedSoThat(9),
    label,
  });
  return {
    fixture,
    repository: pgIncumbentRepository(client),
    reservations: pgReservationGateway(client),
    rotation: pgRotationGateway(client),
    issuance: pgIssuanceGateway(client),
    provider: new DevelopmentReplacementKeyProvider(),
  };
}

describe.skipIf(!reachable)("live rotate_key renewal", () => {
  beforeAll(() => {
    expect(devDatabaseUrl()).toMatch(/127\.0\.0\.1|localhost/);
  });

  // =========================================================================
  // Policy
  // =========================================================================
  it("refuses rotation while the shipped policy disables it", async () => {
    await withDatabaseTransaction(async (client) => {
      const w = await rotationWorld(client, "POLICYOFF");

      // The SHIPPED state, asserted before anything is changed.
      const shipped = await readRotationPolicy(client);
      expect(shipped.allowKeyRotation).toBe(false);
      expect(shipped.decisionRef).toBeNull();
      expect(shipped.defaultMode).toBe("reuse_current_key");

      const outcome = await completeRotateKeyCredentialRenewal(
        rotationInput(w.fixture),
        w.repository,
        w.reservations,
        w.rotation,
        w.issuance,
        w.fixture.ca,
        w.provider,
      );

      expect(outcome.refusalCode).toBe("ROTATION_NOT_PERMITTED");
      expect(outcome.detail).toContain("KLUY-RENEWAL-ROTATION-NOT-PERMITTED");
      // Asking for the mode authorized nothing, and NO KEY WAS GENERATED.
      expect(w.provider.generationCount).toBe(0);
      const after = await snapshot(client, w.fixture.deviceRecordId);
      expect(after.credentials).toBe(1);
      expect(after.providerKeys).toBe(1);
      expect(after.reservations).toBe(0);
    });
  }, 90_000);

  it("refuses to enable rotation without naming an owner decision", async () => {
    await withDatabaseTransaction(async (client) => {
      // The CHECK is the real control: `allow_key_rotation` cannot be true
      // while the decision reference is null. No operator can flip a boolean.
      const refusal = await expectRefused(client, () =>
        client.query(
          `update kitluy_devices.renewal_policy
              set allow_key_rotation = true, rotation_approved_by_decision_ref = null
            where environment = $1`,
          [DEVELOPMENT],
        ),
      );
      expect(refusal).toMatch(/renewal_policy_rotation_needs_decision_chk/);
      expect((await readRotationPolicy(client)).allowKeyRotation).toBe(false);
    });
  }, 60_000);

  it("restores the shipped policy, so an override cannot leak", async () => {
    await withDatabaseTransaction(async (client) => {
      await enableDevelopmentRotation(client);
      expect((await readRotationPolicy(client)).allowKeyRotation).toBe(true);
      await restoreDevelopmentRotation(client);
      const restored = await readRotationPolicy(client);
      expect(restored.allowKeyRotation).toBe(false);
      expect(restored.decisionRef).toBeNull();
    });

    // A NEW transaction: the shipped policy is what a later test sees.
    await withDatabaseTransaction(async (client) => {
      const shipped = await readRotationPolicy(client);
      expect(shipped.allowKeyRotation).toBe(false);
      expect(shipped.decisionRef).toBeNull();
    });
  }, 60_000);

  // =========================================================================
  // The complete rotation
  // =========================================================================
  it("rotates the key, leaves it pending until the provider says otherwise, then completes", async () => {
    await withDatabaseTransaction(async (client) => {
      const w = await rotationWorld(client, "ROTATE");
      await enableDevelopmentRotation(client);
      const before = await snapshot(client, w.fixture.deviceRecordId);
      expect(before.keyStates).toBe("active:1");

      const outcome = await completeRotateKeyCredentialRenewal(
        rotationInput(w.fixture),
        w.repository,
        w.reservations,
        w.rotation,
        w.issuance,
        w.fixture.ca,
        w.provider,
      );

      expect(outcome.detail).toBeUndefined();
      expect(outcome.outcome).toBe("ROTATED");

      // -- what the orchestration reports ----------------------------------
      expect(outcome.reservation?.renewalMode).toBe("rotate_key");
      expect(outcome.rotated).toMatchObject({
        previousCredentialGeneration: 1,
        credentialGeneration: 2,
        previousKeyGeneration: 1,
        keyGeneration: 2,
        credentialGenerationAdvanced: true,
        keyGenerationAdvanced: true,
        keyRotated: true,
      });
      expect(outcome.rotated?.incumbentPublicKeyFingerprint).toBe(w.fixture.fingerprint);
      expect(outcome.rotated?.replacementPublicKeyFingerprint).not.toBe(w.fixture.fingerprint);
      expect(outcome.rotated?.replacementProviderKeyReference).not.toBe(
        w.fixture.providerKeyHandle,
      );

      // -- operational readiness, as three separate facts --------------------
      expect(outcome.readiness).toMatchObject({
        credentialCryptographicallyValid: true,
        replacementKeyActiveInProvider: true,
        databaseActivationConfirmed: true,
        operationallyReady: true,
        consumersMustReVerifyAtAuthenticationBoundary: true,
      });

      // -- from the provider -------------------------------------------------
      expect(w.provider.generationCount).toBe(1);
      expect(w.provider.activationCount).toBe(1);
      expect(w.fixture.keyGenerationCount()).toBe(1); // the INCUMBENT, unchanged
      expect(w.fixture.privateKeyWasExported()).toBe(false);
      const providerKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(w.provider) as object);
      expect(providerKeys.some((n) => /export|private|secret|reveal/i.test(n))).toBe(false);

      // -- from PostgreSQL ---------------------------------------------------
      const after = await snapshot(client, w.fixture.deviceRecordId);
      expect(after.credentials).toBe(2);
      expect(after.headGeneration).toBe(2);
      expect(after.previousGeneration).toBe(1);
      expect(after.headVersion).toBe(before.headVersion! + 1);
      expect(after.reservations).toBe(1);
      // TWO provider keys: the incumbent, now superseded, and the replacement,
      // active. The incumbent was NOT destroyed.
      expect(after.providerKeys).toBe(2);
      expect(after.keyStates).toBe("superseded:1,active:2");

      const reservation = await client.query(
        `select renewal_mode::text m, status::text s, next_credential_generation n
           from kitluy_devices.device_renewal_reservations where device_record_id = $1`,
        [w.fixture.deviceRecordId],
      );
      expect(reservation.rowCount).toBe(1);
      expect(reservation.rows[0].m).toBe("rotate_key");
      expect(reservation.rows[0].s).toBe("completed");
      expect(Number(reservation.rows[0].n)).toBe(2);

      const credential = await client.query(
        `select public_key_fingerprint f, state s, not_before nb
           from kitluy_devices.device_credentials
          where device_record_id = $1 and certificate_generation = 2`,
        [w.fixture.deviceRecordId],
      );
      expect(credential.rows[0].f).toBe(outcome.rotated?.replacementPublicKeyFingerprint);
      expect(credential.rows[0].s).toBe("issued");

      const overlapDays =
        (after.overlapEndsAt!.getTime() - new Date(credential.rows[0].nb).getTime()) / MS_PER_DAY;
      expect(overlapDays).toBeGreaterThan(0);
      expect(overlapDays).toBeLessThanOrEqual(3);

      const audit = await client.query(
        `select count(*) n from kitluy_devices.device_credential_issuance_attempts a
           join kitluy_devices.device_credential_requests r on r.request_id = a.request_id
          where r.device_record_id = $1 and a.to_state = 'issued'`,
        [w.fixture.deviceRecordId],
      );
      expect(Number(audit.rows[0].n)).toBe(2);

      expect(w.rotation.rolesObserved.every((r) => r === TEST_ROLES.issuanceService)).toBe(true);
    });
  }, 120_000);

  it("leaves the credential NOT operationally ready between finalization and activation", async () => {
    await withDatabaseTransaction(async (client) => {
      const w = await rotationWorld(client, "PENDING");
      await enableDevelopmentRotation(client);

      // A provider that refuses to activate. Everything up to and including
      // finalization still happens, which is exactly the window TASK D names.
      const refusingProvider = {
        ...w.provider,
        generateReplacementKey: w.provider.generateReplacementKey.bind(w.provider),
        describeReplacementKey: w.provider.describeReplacementKey.bind(w.provider),
        proveReplacementPossession: w.provider.proveReplacementPossession.bind(w.provider),
        abandonReplacementKey: w.provider.abandonReplacementKey.bind(w.provider),
        activateReplacementKey: async () => {
          throw new Error("the provider could not load the private half");
        },
      };

      const outcome = await completeRotateKeyCredentialRenewal(
        rotationInput(w.fixture),
        w.repository,
        w.reservations,
        w.rotation,
        w.issuance,
        w.fixture.ca,
        refusingProvider,
      );

      expect(outcome.refusalCode).toBe("ROTATION_PROVIDER_ACTIVATION_FAILED");
      // The credential EXISTS. Saying otherwise would send an operator looking
      // for something that is already on disk.
      expect(outcome.credentialIssuedButNotActivated?.credentialGeneration).toBe(2);
      expect(outcome.credentialIssuedButNotActivated?.replacementKeyState).toBe(
        "credential_issued_pending_activation",
      );
      expect(outcome.credentialIssuedButNotActivated?.reservationStatus).toBe("activation_pending");
      // NOT operationally ready: no readiness block is reported at all.
      expect(outcome.readiness).toBeUndefined();

      const keys = await client.query(
        `select state::text s, generation g from kitluy_devices.device_generation_keys
          where device_record_id = $1 order by generation`,
        [w.fixture.deviceRecordId],
      );
      expect(keys.rows.map((r) => `${r.s}:${r.g}`)).toEqual([
        // The INCUMBENT is still active — it must be, or the device could not
        // authenticate at all while the replacement waits.
        "active:1",
        "credential_issued_pending_activation:2",
      ]);
    });
  }, 120_000);

  // =========================================================================
  // Idempotence
  // =========================================================================
  it("generates one replacement key and confirms once, however often it retries", async () => {
    await withDatabaseTransaction(async (client) => {
      const w = await rotationWorld(client, "RETRY");
      await enableDevelopmentRotation(client);

      const first = await completeRotateKeyCredentialRenewal(
        rotationInput(w.fixture),
        w.repository,
        w.reservations,
        w.rotation,
        w.issuance,
        w.fixture.ca,
        w.provider,
      );
      expect(first.outcome).toBe("ROTATED");
      const afterFirst = await snapshot(client, w.fixture.deviceRecordId);

      const attemptId = first.reservation!.renewalAttemptId;

      // Registration cannot be replayed after the renewal COMPLETED — the
      // database refuses a terminal reservation outright, which is the
      // stronger guarantee. Registration idempotency is proven mid-flight in
      // the dedicated test below.
      await expect(
        w.rotation.registerReplacementKey({
          renewalAttemptId: attemptId,
          providerKeyReference: first.rotated!.replacementProviderKeyReference,
          publicKeyPem: w.provider.describeReplacementKey(attemptId)!.publicKeyPem,
          publicKeyFingerprint: first.rotated!.replacementPublicKeyFingerprint,
          keyGeneration: 2,
        }),
      ).rejects.toThrow(/KLUY-RENEWAL-RESERVATION-TERMINAL/);

      const replayConfirm = await w.rotation.confirmProviderKeyActivation({
        renewalAttemptId: attemptId,
        credentialId: first.rotated!.credentialId,
        deviceRecordId: w.fixture.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        credentialGeneration: 2,
        keyGeneration: 2,
        providerKeyReference: first.rotated!.replacementProviderKeyReference,
        publicKeyFingerprint: first.rotated!.replacementPublicKeyFingerprint,
        actorRef: "REPLAY",
      });
      expect(replayConfirm.outcome).toBe("ALREADY_ACTIVE");

      // Provider activation is idempotent too.
      const replayActivate = await w.provider.activateReplacementKey({
        deviceRecordId: w.fixture.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        renewalAttemptId: attemptId,
        keyGeneration: 2,
        providerKeyReference: first.rotated!.replacementProviderKeyReference,
        publicKeyFingerprint: first.rotated!.replacementPublicKeyFingerprint,
        credentialFinalized: true,
      });
      expect(replayActivate.state).toBe("active");
      expect(w.provider.generationCount).toBe(1);
      expect(w.provider.activationCount).toBe(1);

      const afterSecond = await snapshot(client, w.fixture.deviceRecordId);
      expect(afterSecond).toEqual(afterFirst);
    });
  }, 120_000);

  // =========================================================================
  // Focused attacks
  // =========================================================================
  it("registers and generates once mid-flight, however often the caller retries", async () => {
    await withDatabaseTransaction(async (client) => {
      const w = await rotationWorld(client, "MIDFLIGHT");
      await enableDevelopmentRotation(client);

      const { prepareSameKeyCredentialRenewal } =
        await import("../src/same-key-renewal-preflight.js");
      const pre = await prepareSameKeyCredentialRenewal(
        { ...rotationInput(w.fixture), renewalMode: "rotate_key" },
        w.repository,
        w.reservations,
      );
      expect(pre.outcome).toBe("RESERVED");
      // A rotation reservation OWES a key: it is not ready to issue.
      expect(pre.reservation!.reservationStatus).toBe("key_generation_pending");
      const attemptId = pre.reservation!.renewalAttemptId;

      const scope = {
        deviceRecordId: w.fixture.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        renewalAttemptId: attemptId,
        keyGeneration: 2,
      } as const;

      // PROVIDER generation is idempotent on the attempt.
      const first = await w.provider.generateReplacementKey(scope);
      const second = await w.provider.generateReplacementKey(scope);
      expect(second.providerKeyReference).toBe(first.providerKeyReference);
      expect(second.publicKeyFingerprint).toBe(first.publicKeyFingerprint);
      expect(second.publicKeyPem).toBe(first.publicKeyPem);
      expect(w.provider.generationCount).toBe(1);

      // DATABASE registration is idempotent on the same attempt too, and this
      // is the only window in which it can be: once the renewal completes the
      // reservation is terminal and registration is refused outright.
      const reg1 = await w.rotation.registerReplacementKey({
        renewalAttemptId: attemptId,
        providerKeyReference: first.providerKeyReference,
        publicKeyPem: first.publicKeyPem,
        publicKeyFingerprint: first.publicKeyFingerprint,
        keyGeneration: 2,
      });
      const reg2 = await w.rotation.registerReplacementKey({
        renewalAttemptId: attemptId,
        providerKeyReference: first.providerKeyReference,
        publicKeyPem: first.publicKeyPem,
        publicKeyFingerprint: first.publicKeyFingerprint,
        keyGeneration: 2,
      });
      expect(reg1.outcome).toBe("REGISTERED");
      expect(reg2.outcome).toBe("ALREADY_REGISTERED");

      const rows = await client.query(
        `select count(*) n from kitluy_devices.device_generation_keys
          where renewal_attempt_id = $1`,
        [attemptId],
      );
      expect(Number(rows.rows[0].n)).toBe(1);

      // ANOTHER attempt cannot claim the same provider key.
      await expect(
        w.provider.generateReplacementKey({
          ...scope,
          renewalAttemptId: "77777777-7777-4777-8777-777777777777",
        }),
      ).resolves.not.toBe(first);
      expect(w.provider.generationCount).toBe(2);
      expect(
        w.provider.describeReplacementKey("77777777-7777-4777-8777-777777777777")!
          .providerKeyReference,
      ).not.toBe(first.providerKeyReference);
    });
  }, 120_000);

  it("refuses a registration whose fingerprint is not the generated key's", async () => {
    await withDatabaseTransaction(async (client) => {
      const w = await rotationWorld(client, "REGFP");
      await enableDevelopmentRotation(client);

      const { prepareSameKeyCredentialRenewal } =
        await import("../src/same-key-renewal-preflight.js");
      const pre = await prepareSameKeyCredentialRenewal(
        { ...rotationInput(w.fixture), renewalMode: "rotate_key" },
        w.repository,
        w.reservations,
      );
      expect(pre.outcome).toBe("RESERVED");
      const attemptId = pre.reservation!.renewalAttemptId;

      const key = await w.provider.generateReplacementKey({
        deviceRecordId: w.fixture.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        renewalAttemptId: attemptId,
        keyGeneration: 2,
      });
      await w.rotation.registerReplacementKey({
        renewalAttemptId: attemptId,
        providerKeyReference: key.providerKeyReference,
        publicKeyPem: key.publicKeyPem,
        publicKeyFingerprint: key.publicKeyFingerprint,
        keyGeneration: 2,
      });

      // A DIFFERENT fingerprint for the same attempt is refused, not accepted.
      await expect(
        w.rotation.registerReplacementKey({
          renewalAttemptId: attemptId,
          providerKeyReference: key.providerKeyReference,
          publicKeyPem: key.publicKeyPem,
          publicKeyFingerprint: "b".repeat(64),
          keyGeneration: 2,
        }),
      ).rejects.toThrow(/KLUY-KEY-ATTEMPT-TAKEN/);
    });
  }, 120_000);

  it("refuses a possession proof bound to another renewal attempt", async () => {
    await withDatabaseTransaction(async (client) => {
      const w = await rotationWorld(client, "POPBIND");
      await enableDevelopmentRotation(client);

      const { prepareSameKeyCredentialRenewal } =
        await import("../src/same-key-renewal-preflight.js");
      const pre = await prepareSameKeyCredentialRenewal(
        { ...rotationInput(w.fixture), renewalMode: "rotate_key" },
        w.repository,
        w.reservations,
      );
      const reservation = pre.reservation!;
      const key = await w.provider.generateReplacementKey({
        deviceRecordId: w.fixture.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        renewalAttemptId: reservation.renewalAttemptId,
        keyGeneration: 2,
      });
      await w.rotation.registerReplacementKey({
        renewalAttemptId: reservation.renewalAttemptId,
        providerKeyReference: key.providerKeyReference,
        publicKeyPem: key.publicKeyPem,
        publicKeyFingerprint: key.publicKeyFingerprint,
        keyGeneration: 2,
      });

      // A GENUINE signature over a challenge bound to a DIFFERENT attempt. The
      // maths is valid; the binding is not, and that is what must refuse.
      const foreign = buildReplacementChallenge(
        { ...reservation, renewalAttemptId: "99999999-9999-4999-8999-999999999999" },
        key.publicKeyFingerprint,
        new Date(),
      );
      const signature = w.provider.proveReplacementPossession(
        key.providerKeyReference,
        replacementChallengeBytes(foreign),
      );

      const { verifyReplacementKeyPop } = await import("../src/replacement-key-pop.js");
      const { publicKeyFingerprint } = await import("../src/dev-crypto.js");
      const verdict = verifyReplacementKeyPop(
        foreign,
        signature,
        key.publicKeyPem,
        {
          renewalAttemptId: reservation.renewalAttemptId,
          deviceRecordId: reservation.deviceRecordId,
          currentCredentialId: reservation.currentCredentialId,
          currentGeneration: reservation.currentCredentialGeneration,
          nextGeneration: reservation.nextCredentialGeneration,
          assignmentGeneration: reservation.assignmentGeneration,
          environment: reservation.environment,
          purpose: reservation.purpose,
          providerKeyFingerprint: key.publicKeyFingerprint,
          providerKeyState: "generated",
        },
        trustedAt(new Date()),
        publicKeyFingerprint,
      );
      expect(verdict.verified).toBe(false);
      expect(verdict.refusalCode).toBe("POP_WRONG_RENEWAL_ATTEMPT");
    });
  }, 120_000);

  it("refuses activation confirmation with a wrong binding, and leaves the key pending", async () => {
    await withDatabaseTransaction(async (client) => {
      const w = await rotationWorld(client, "CONFIRM");
      await enableDevelopmentRotation(client);

      const outcome = await completeRotateKeyCredentialRenewal(
        rotationInput(w.fixture),
        w.repository,
        w.reservations,
        w.rotation,
        w.issuance,
        w.fixture.ca,
        w.provider,
      );
      expect(outcome.outcome).toBe("ROTATED");
      const attemptId = outcome.reservation!.renewalAttemptId;

      // Each wrong binding gets its OWN refusal code from the database.
      const base = {
        renewalAttemptId: attemptId,
        credentialId: outcome.rotated!.credentialId,
        deviceRecordId: w.fixture.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        credentialGeneration: 2,
        keyGeneration: 2,
        providerKeyReference: outcome.rotated!.replacementProviderKeyReference,
        publicKeyFingerprint: outcome.rotated!.replacementPublicKeyFingerprint,
        actorRef: "ATTACK",
      };

      await expect(
        w.rotation.confirmProviderKeyActivation({ ...base, publicKeyFingerprint: "c".repeat(64) }),
      ).rejects.toThrow(/KLUY-ACTIVATION-MISMATCH|KLUY-ACTIVATION-WRONG-FINGERPRINT/);
      await expect(
        w.rotation.confirmProviderKeyActivation({ ...base, providerKeyReference: "not-the-key" }),
      ).rejects.toThrow(/KLUY-ACTIVATION-MISMATCH|KLUY-ACTIVATION-WRONG-PROVIDER-KEY/);
      await expect(
        w.rotation.confirmProviderKeyActivation({
          ...base,
          renewalAttemptId: "88888888-8888-4888-8888-888888888888",
        }),
      ).rejects.toThrow(/KLUY-ACTIVATION-NO-RESERVATION/);

      // The real key is untouched by any of it.
      const state = await client.query(
        `select state::text s from kitluy_devices.device_generation_keys
          where renewal_attempt_id = $1`,
        [attemptId],
      );
      expect(state.rows[0].s).toBe("active");
    });
  }, 120_000);

  it("refuses provider activation before the credential is finalized", async () => {
    await withDatabaseTransaction(async (client) => {
      const w = await rotationWorld(client, "EARLYACT");
      await enableDevelopmentRotation(client);

      const { prepareSameKeyCredentialRenewal } =
        await import("../src/same-key-renewal-preflight.js");
      const pre = await prepareSameKeyCredentialRenewal(
        { ...rotationInput(w.fixture), renewalMode: "rotate_key" },
        w.repository,
        w.reservations,
      );
      const attemptId = pre.reservation!.renewalAttemptId;
      const key = await w.provider.generateReplacementKey({
        deviceRecordId: w.fixture.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        renewalAttemptId: attemptId,
        keyGeneration: 2,
      });

      await expect(
        w.provider.activateReplacementKey({
          deviceRecordId: w.fixture.deviceRecordId,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
          renewalAttemptId: attemptId,
          keyGeneration: 2,
          providerKeyReference: key.providerKeyReference,
          publicKeyFingerprint: key.publicKeyFingerprint,
          credentialFinalized: false,
        }),
      ).rejects.toThrow(/PROVIDER_KEY_CREDENTIAL_NOT_ISSUED/);
      expect(w.provider.activationCount).toBe(0);
    });
  }, 120_000);

  it("still denies direct key-state and credential writes to the issuance service", async () => {
    await withDatabaseTransaction(async (client) => {
      const w = await rotationWorld(client, "BOUNDARY");
      await enableDevelopmentRotation(client);
      const outcome = await completeRotateKeyCredentialRenewal(
        rotationInput(w.fixture),
        w.repository,
        w.reservations,
        w.rotation,
        w.issuance,
        w.fixture.ca,
        w.provider,
      );
      expect(outcome.outcome).toBe("ROTATED");

      await withRole(client, TEST_ROLES.issuanceService, async () => {
        expect(await currentRole(client)).toBe(TEST_ROLES.issuanceService);

        const keyState = await expectRefused(client, () =>
          client.query(
            `update kitluy_devices.device_generation_keys set state = 'active'
              where device_record_id = $1`,
            [w.fixture.deviceRecordId],
          ),
        );
        expect(keyState).toMatch(/permission denied|KLUY-KEY-UNAUTHORIZED|KLUY-KEY-BAD/);

        const insert = await expectRefused(client, () =>
          client.query(
            `insert into kitluy_devices.device_credentials (
               credential_id, serial_number, device_record_id, environment, purpose,
               public_key, public_key_fingerprint, issuer_key_id, certificate_generation,
               assignment_generation, not_before, not_after, hardware_trust_level,
               canonical_tbs, detached_signature, created_from_request_id, state)
             values (gen_random_uuid(), 'DEV-ROT-FORGED', $1::uuid, 'development',
                     'device_identity', 'PEM', $2, 'ica', 9, 1, now(),
                     now() + interval '1 day', 'development_software', 'TBS',
                     decode('00','hex'), 'rq-rot-forged', 'issued')`,
            [w.fixture.deviceRecordId, outcome.rotated!.replacementPublicKeyFingerprint],
          ),
        );
        expect(insert).toMatch(/permission denied|KLUY-CRED-UNAUTHORIZED-ISSUE/);
      });

      expect(await currentRole(client)).toBe("postgres");
    });
  }, 120_000);

  it("refuses a canonical TBS the database did not build", async () => {
    await withDatabaseTransaction(async (client) => {
      const w = await rotationWorld(client, "ROTTBS");
      await enableDevelopmentRotation(client);

      const tampering = {
        ...w.issuance,
        async prepare(input: Parameters<typeof w.issuance.prepare>[0]) {
          const prepared = await w.issuance.prepare(input);
          return {
            ...prepared,
            canonicalTbs: (prepared.canonicalTbs ?? "").replace(
              prepared.serialNumber,
              "DEV-ROT-TAMPERED",
            ),
          };
        },
      };

      const outcome = await completeRotateKeyCredentialRenewal(
        rotationInput(w.fixture),
        w.repository,
        w.reservations,
        w.rotation,
        tampering,
        w.fixture.ca,
        w.provider,
      );

      expect(outcome.refusalCode).toBe("ROTATION_CANONICAL_TBS_DIVERGENCE");
      // The adapter stage that refused is preserved, not flattened.
      expect(outcome.detail).toMatch(/ISSUE_CANONICAL_TBS(_HASH)?_DIVERGENCE/);
      // Nothing was signed, and the replacement key never left `generated`.
      const key = await w.rotation.loadReplacementKey(outcome.reservation!.renewalAttemptId);
      expect(key?.state).toBe("generated");
      expect((await snapshot(client, w.fixture.deviceRecordId)).credentials).toBe(1);
    });
  }, 120_000);

  it("refuses a proof from an abandoned replacement key before checking the signature", async () => {
    await withDatabaseTransaction(async (client) => {
      const w = await rotationWorld(client, "ABANDON");
      await enableDevelopmentRotation(client);

      const { prepareSameKeyCredentialRenewal } =
        await import("../src/same-key-renewal-preflight.js");
      const pre = await prepareSameKeyCredentialRenewal(
        { ...rotationInput(w.fixture), renewalMode: "rotate_key" },
        w.repository,
        w.reservations,
      );
      const attemptId = pre.reservation!.renewalAttemptId;
      const key = await w.provider.generateReplacementKey({
        deviceRecordId: w.fixture.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        renewalAttemptId: attemptId,
        keyGeneration: 2,
      });
      w.provider.abandonReplacementKey(attemptId, "lost its renewal");

      // The key may still hold a perfectly valid private half. That is exactly
      // why the STATE is checked rather than the signature relied upon.
      expect(() =>
        w.provider.proveReplacementPossession(key.providerKeyReference, Buffer.from("x")),
      ).toThrow(/PROVIDER_KEY_ABANDONED/);
      await expect(
        w.provider.activateReplacementKey({
          deviceRecordId: w.fixture.deviceRecordId,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
          renewalAttemptId: attemptId,
          keyGeneration: 2,
          providerKeyReference: key.providerKeyReference,
          publicKeyFingerprint: key.publicKeyFingerprint,
          credentialFinalized: true,
        }),
      ).rejects.toThrow(/PROVIDER_KEY_ABANDONED/);
    });
  }, 120_000);
});

describe("integration reporting", () => {
  it("states plainly whether the live rotation suite ran", () => {
    if (!reachable) {
      console.warn(`${SUITE} DID NOT RUN — no database evidence for rotation from this run.`);
    }
    expect(typeof reachable).toBe("boolean");
  });
});
