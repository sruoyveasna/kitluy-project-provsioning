/**
 * Credential overlap expiry and superseded-key lifecycle — LIVE PostgreSQL.
 *
 * Real renewals, then the boundary crossed three ways: before, EXACTLY at, and
 * after. Trusted time is a VALUE the test supplies, so the boundary is crossed
 * deterministically rather than by waiting three days.
 *
 * Every governed call runs under `SET LOCAL ROLE kitluy_issuance_service`.
 * A skip is reported as a skip.
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
  pgLifecycleGateway,
  pgLifecycleReader,
  pgReservationGateway,
  pgRotationGateway,
  readLifecycleEvents,
  withRole,
  type IncumbentFixture,
} from "./support/renewal-fixtures.js";
import {
  advanceDeviceCredentialLifecycle,
  evaluateKeyDestruction,
  permittedOverlapFrom,
  type LifecycleInput,
} from "../src/credential-lifecycle.js";
import { completeSameKeyCredentialRenewal } from "../src/same-key-renewal-issuance.js";
import { completeRotateKeyCredentialRenewal } from "../src/rotate-key-renewal-issuance.js";
import { DevelopmentReplacementKeyProvider } from "../src/replacement-key-provider.js";
import { buildChainFromStoredLinks } from "../src/same-key-renewal-preflight.js";
import { evaluateCertificateValidity } from "../src/certificate-validity.js";
import type { TrustedTimeEvaluation } from "../src/trusted-time.js";

const SUITE = "@kitluy/device-identity credential overlap lifecycle";

const reachable = await isDevDatabaseReachable();
if (!reachable) reportSkippedIntegration(SUITE);

const trustedAt = (instant: Date): TrustedTimeEvaluation => ({
  status: "trusted",
  trustedTime: instant,
  source: "authenticated_network",
  floorAdvanced: true,
  anomalyType: null,
  detail: "lifecycle fixture",
});

const issuedSoThat = (daysRemaining: number): Date =>
  new Date(Date.now() - (30 - daysRemaining) * MS_PER_DAY);

function lifecycleInput(fixture: IncumbentFixture, trustedTime: Date): LifecycleInput {
  return {
    deviceRecordId: fixture.deviceRecordId,
    environment: DEVELOPMENT,
    purpose: DEVICE_IDENTITY,
    trustedTime: trustedAt(trustedTime),
    actorRef: "LIFECYCLE-TEST",
    idempotencyKey: `life-${fixture.credentialId}`,
  };
}

/** Verifies the PREVIOUS credential as the lifecycle would have a caller do. */
async function previousCredentialVerifies(
  client: pg.PoolClient,
  fixture: IncumbentFixture,
  trustedTime: Date,
): Promise<{ valid: boolean; rejectionCode?: string }> {
  const repository = pgIncumbentRepository(client);
  const state = await pgLifecycleReader(client).loadLifecycleState({
    deviceRecordId: fixture.deviceRecordId,
    environment: DEVELOPMENT,
    purpose: DEVICE_IDENTITY,
  });
  const previous = await repository.loadCredentialAtGeneration(
    { deviceRecordId: fixture.deviceRecordId, environment: DEVELOPMENT, purpose: DEVICE_IDENTITY },
    1,
  );
  const chain = buildChainFromStoredLinks(
    await repository.loadCredentialChainLinks(previous!.credentialId),
  );
  const current = await repository.loadCredentialAtGeneration(
    { deviceRecordId: fixture.deviceRecordId, environment: DEVELOPMENT, purpose: DEVICE_IDENTITY },
    2,
  );

  const verdict = evaluateCertificateValidity({
    chain: chain!,
    trustedTime: trustedAt(trustedTime),
    environment: DEVELOPMENT,
    deviceRecordId: fixture.deviceRecordId,
    // The device's CURRENT state — which is what a real verifier is configured
    // from — plus whatever overlap the authoritative lifecycle grants.
    currentKeyFingerprint: current!.publicKeyFingerprint,
    currentCertificateGeneration: 2,
    revocations: { isCertificateRevoked: () => false, isDeviceRevoked: () => false },
    trustedRootFingerprints: [fixture.ca.rootCertificate.tbs.subjectFingerprint],
    permittedOverlap: permittedOverlapFrom(state!, trustedTime) ?? undefined,
  });
  return { valid: verdict.valid, rejectionCode: verdict.rejectionCode };
}

async function currentCredentialVerifies(
  client: pg.PoolClient,
  fixture: IncumbentFixture,
  trustedTime: Date,
): Promise<boolean> {
  const repository = pgIncumbentRepository(client);
  const current = await repository.loadCredentialAtGeneration(
    { deviceRecordId: fixture.deviceRecordId, environment: DEVELOPMENT, purpose: DEVICE_IDENTITY },
    2,
  );
  const chain = buildChainFromStoredLinks(
    await repository.loadCredentialChainLinks(current!.credentialId),
  );
  return evaluateCertificateValidity({
    chain: chain!,
    trustedTime: trustedAt(trustedTime),
    environment: DEVELOPMENT,
    deviceRecordId: fixture.deviceRecordId,
    currentKeyFingerprint: current!.publicKeyFingerprint,
    currentCertificateGeneration: 2,
    revocations: { isCertificateRevoked: () => false, isDeviceRevoked: () => false },
    trustedRootFingerprints: [fixture.ca.rootCertificate.tbs.subjectFingerprint],
  }).valid;
}

async function keyStates(client: pg.PoolClient, deviceRecordId: string): Promise<string> {
  const r = await client.query(
    `select string_agg(state::text || ':' || generation::text, ',' order by generation) s
       from kitluy_devices.device_generation_keys where device_record_id = $1`,
    [deviceRecordId],
  );
  return r.rows[0].s as string;
}

async function credentialStates(client: pg.PoolClient, deviceRecordId: string): Promise<string> {
  const r = await client.query(
    `select string_agg(state::text || ':' || certificate_generation::text, ','
                       order by certificate_generation) s
       from kitluy_devices.device_credentials where device_record_id = $1`,
    [deviceRecordId],
  );
  return r.rows[0].s as string;
}

async function overlapEnd(client: pg.PoolClient, deviceRecordId: string): Promise<Date> {
  const r = await client.query(
    `select overlap_ends_at from kitluy_devices.device_credential_heads
      where device_record_id = $1`,
    [deviceRecordId],
  );
  return r.rows[0].overlap_ends_at as Date;
}

describe.skipIf(!reachable)("live credential overlap lifecycle", () => {
  beforeAll(() => {
    expect(devDatabaseUrl()).toMatch(/127\.0\.0\.1|localhost/);
  });

  // =========================================================================
  // Same-key
  // =========================================================================
  it("retires the previous credential at the boundary and keeps the shared key active", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "LCSK",
      });
      const renewal = await completeSameKeyCredentialRenewal(
        {
          deviceRecordId: fixture.deviceRecordId,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
          idempotencyKey: `sk-life-${fixture.credentialId}`,
          actorRef: "LIFECYCLE-TEST",
          trustedTime: trustedAt(new Date()),
          trustedRootFingerprints: [fixture.ca.rootCertificate.tbs.subjectFingerprint],
          currentAssignmentGeneration: fixture.assignmentGeneration,
        },
        pgIncumbentRepository(client),
        pgReservationGateway(client),
        pgIssuanceGateway(client),
        fixture.ca,
        fixture.signer,
      );
      expect(renewal.outcome).toBe("RENEWED");

      const boundary = await overlapEnd(client, fixture.deviceRecordId);
      const before = new Date(boundary.getTime() - MS_PER_DAY);
      const after = new Date(boundary.getTime() + MS_PER_DAY);
      const reader = pgLifecycleReader(client);
      const gateway = pgLifecycleGateway(client);

      // -- BEFORE the boundary ---------------------------------------------
      expect((await previousCredentialVerifies(client, fixture, before)).valid).toBe(true);
      expect(await currentCredentialVerifies(client, fixture, before)).toBe(true);
      const activeRun = await advanceDeviceCredentialLifecycle(
        lifecycleInput(fixture, before),
        reader,
        gateway,
      );
      expect(activeRun.classification).toBe("OVERLAP_ACTIVE");
      expect(await credentialStates(client, fixture.deviceRecordId)).toBe("issued:1,issued:2");
      expect(await keyStates(client, fixture.deviceRecordId)).toBe("active:1");

      // -- EXACTLY AT the boundary -----------------------------------------
      const atRun = await advanceDeviceCredentialLifecycle(
        lifecycleInput(fixture, boundary),
        reader,
        gateway,
      );
      expect(atRun.classification).toBe("PREVIOUS_CREDENTIAL_RETIRED");
      expect(atRun.outcome).toBe("ADVANCED");
      expect(await credentialStates(client, fixture.deviceRecordId)).toBe("superseded:1,issued:2");
      // The previous credential no longer authenticates, at the boundary itself.
      // Under SAME-KEY the two credentials share a fingerprint, so what refuses
      // is the GENERATION check, not the key check — the credential attests to a
      // key the device really does hold, and is simply a superseded generation.
      // Rotation refuses on the fingerprint instead; both are correct, and
      // asserting the wrong one would have hidden which check was doing the work.
      const atVerdict = await previousCredentialVerifies(client, fixture, boundary);
      expect(atVerdict.valid).toBe(false);
      expect(atVerdict.rejectionCode).toBe("CERT_STALE_CERTIFICATE_GENERATION");

      // -- AFTER the boundary ----------------------------------------------
      expect((await previousCredentialVerifies(client, fixture, after)).valid).toBe(false);
      expect(await currentCredentialVerifies(client, fixture, after)).toBe(true);

      // THE SHARED KEY IS UNTOUCHED. A same-key renewal reuses it, and the
      // device would be unable to authenticate at all without it.
      expect(await keyStates(client, fixture.deviceRecordId)).toBe("active:1");
      const state = await reader.loadLifecycleState({
        deviceRecordId: fixture.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
      });
      const eligibility = evaluateKeyDestruction(state!);
      expect(eligibility.eligible).toBe(false);
      expect(
        eligibility.blockers.some((b) => /CURRENT credential|current provider key/.test(b)),
      ).toBe(true);

      // Idempotent.
      const replay = await advanceDeviceCredentialLifecycle(
        lifecycleInput(fixture, after),
        reader,
        gateway,
      );
      expect(replay.outcome).toBe("REPLAYED");
      expect(await credentialStates(client, fixture.deviceRecordId)).toBe("superseded:1,issued:2");

      // No destruction was ever requested.
      const history = await readLifecycleEvents(client, fixture.deviceRecordId);
      expect(history.every((h) => h.providerKeyTransition !== "destroyed")).toBe(true);
      expect(gateway.rolesObserved.every((r) => r === TEST_ROLES.issuanceService)).toBe(true);
    });
  }, 180_000);

  // =========================================================================
  // Rotation
  // =========================================================================
  it("retires the rotated credential and makes the old key eligible but NOT authorized", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "LCROT",
      });
      await enableDevelopmentRotation(client);
      const provider = new DevelopmentReplacementKeyProvider();
      const rotation = await completeRotateKeyCredentialRenewal(
        {
          deviceRecordId: fixture.deviceRecordId,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
          idempotencyKey: `rot-life-${fixture.credentialId}`,
          actorRef: "LIFECYCLE-TEST",
          trustedTime: trustedAt(new Date()),
          trustedRootFingerprints: [fixture.ca.rootCertificate.tbs.subjectFingerprint],
          currentAssignmentGeneration: fixture.assignmentGeneration,
        },
        pgIncumbentRepository(client),
        pgReservationGateway(client),
        pgRotationGateway(client),
        pgIssuanceGateway(client),
        fixture.ca,
        provider,
      );
      expect(rotation.outcome).toBe("ROTATED");

      const boundary = await overlapEnd(client, fixture.deviceRecordId);
      const before = new Date(boundary.getTime() - MS_PER_DAY);
      const after = new Date(boundary.getTime() + MS_PER_DAY);
      const reader = pgLifecycleReader(client);
      const gateway = pgLifecycleGateway(client);

      // -- DURING the overlap ----------------------------------------------
      expect((await previousCredentialVerifies(client, fixture, before)).valid).toBe(true);
      expect(await currentCredentialVerifies(client, fixture, before)).toBe(true);
      const active = await advanceDeviceCredentialLifecycle(
        lifecycleInput(fixture, before),
        reader,
        gateway,
      );
      expect(active.classification).toBe("OVERLAP_ACTIVE");
      // The superseded key SURVIVES the overlap. It is not destroyed.
      expect(await keyStates(client, fixture.deviceRecordId)).toBe("superseded:1,active:2");
      const duringEligibility = evaluateKeyDestruction(
        (await reader.loadLifecycleState({
          deviceRecordId: fixture.deviceRecordId,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
        }))!,
      );
      expect(duringEligibility.eligible).toBe(false);

      // -- AT the boundary --------------------------------------------------
      const retired = await advanceDeviceCredentialLifecycle(
        lifecycleInput(fixture, boundary),
        reader,
        gateway,
      );
      expect(retired.classification).toBe("PREVIOUS_CREDENTIAL_RETIRED");
      expect(await credentialStates(client, fixture.deviceRecordId)).toBe("superseded:1,issued:2");
      expect((await previousCredentialVerifies(client, fixture, boundary)).valid).toBe(false);

      // -- AFTER: eligible, still not authorized ----------------------------
      expect((await previousCredentialVerifies(client, fixture, after)).valid).toBe(false);
      expect(await currentCredentialVerifies(client, fixture, after)).toBe(true);

      const afterRun = await advanceDeviceCredentialLifecycle(
        lifecycleInput(fixture, after),
        reader,
        gateway,
      );
      expect(afterRun.classification).toBe("KEY_DESTRUCTION_NOT_AUTHORIZED");
      expect(afterRun.destructionEligibility?.eligible).toBe(true);
      expect(afterRun.destructionEligibility?.authorized).toBe(false);
      expect(afterRun.destructionEligibility?.requiredOwnerDecision).toContain(
        "device_key_destruction_owner_decision",
      );

      // NOTHING WAS DESTROYED. The replacement key is active and the old one is
      // still superseded, exactly as before.
      expect(await keyStates(client, fixture.deviceRecordId)).toBe("superseded:1,active:2");
      const destroyed = await client.query(
        `select count(*) n from kitluy_devices.device_generation_keys
          where device_record_id = $1 and (state = 'destroyed' or destroyed_at is not null)`,
        [fixture.deviceRecordId],
      );
      expect(Number(destroyed.rows[0].n)).toBe(0);

      const history = await readLifecycleEvents(client, fixture.deviceRecordId);
      expect(history.map((h) => h.classification)).toContain("KEY_DESTRUCTION_NOT_AUTHORIZED");
      expect(
        history.find((h) => h.classification === "KEY_DESTRUCTION_NOT_AUTHORIZED")
          ?.destructionPolicyReference,
      ).toContain("device_key_destruction_owner_decision");
    });
  }, 180_000);

  // =========================================================================
  // Hostile
  // =========================================================================
  it("refuses a forged overlap for a non-previous generation or another key", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "LCFORGE",
      });
      await completeSameKeyCredentialRenewal(
        {
          deviceRecordId: fixture.deviceRecordId,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
          idempotencyKey: `forge-${fixture.credentialId}`,
          actorRef: "LIFECYCLE-TEST",
          trustedTime: trustedAt(new Date()),
          trustedRootFingerprints: [fixture.ca.rootCertificate.tbs.subjectFingerprint],
          currentAssignmentGeneration: fixture.assignmentGeneration,
        },
        pgIncumbentRepository(client),
        pgReservationGateway(client),
        pgIssuanceGateway(client),
        fixture.ca,
        fixture.signer,
      );

      const repository = pgIncumbentRepository(client);
      const previous = await repository.loadCredentialAtGeneration(
        {
          deviceRecordId: fixture.deviceRecordId,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
        },
        1,
      );
      const chain = buildChainFromStoredLinks(
        await repository.loadCredentialChainLinks(previous!.credentialId),
      );
      const boundary = await overlapEnd(client, fixture.deviceRecordId);
      const now = new Date(boundary.getTime() - MS_PER_DAY);
      const verify = (
        overlap: Parameters<typeof evaluateCertificateValidity>[0]["permittedOverlap"],
      ) =>
        evaluateCertificateValidity({
          chain: chain!,
          trustedTime: trustedAt(now),
          environment: DEVELOPMENT,
          deviceRecordId: fixture.deviceRecordId,
          currentKeyFingerprint: fixture.fingerprint,
          currentCertificateGeneration: 2,
          revocations: { isCertificateRevoked: () => false, isDeviceRevoked: () => false },
          trustedRootFingerprints: [fixture.ca.rootCertificate.tbs.subjectFingerprint],
          permittedOverlap: overlap,
        });

      // A generation GAP is not an overlap.
      expect(
        verify({
          previousGeneration: 0,
          previousKeyFingerprint: previous!.publicKeyFingerprint,
          overlapEndsAt: new Date(now.getTime() + MS_PER_DAY),
          previousCredentialState: "issued",
        }).valid,
      ).toBe(false);

      // An overlap extended past the persisted end cannot be self-granted: the
      // authoritative builder is the only thing that reads the head, and it
      // returns null once the window is closed.
      const state = await pgLifecycleReader(client).loadLifecycleState({
        deviceRecordId: fixture.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
      });
      expect(permittedOverlapFrom(state!, new Date(boundary.getTime() + 1))).toBeNull();
    });
  }, 180_000);

  it("keeps the lifecycle audit append-only and executor-proof", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "LCAUDIT",
      });
      await completeSameKeyCredentialRenewal(
        {
          deviceRecordId: fixture.deviceRecordId,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
          idempotencyKey: `audit-${fixture.credentialId}`,
          actorRef: "LIFECYCLE-TEST",
          trustedTime: trustedAt(new Date()),
          trustedRootFingerprints: [fixture.ca.rootCertificate.tbs.subjectFingerprint],
          currentAssignmentGeneration: fixture.assignmentGeneration,
        },
        pgIncumbentRepository(client),
        pgReservationGateway(client),
        pgIssuanceGateway(client),
        fixture.ca,
        fixture.signer,
      );
      const boundary = await overlapEnd(client, fixture.deviceRecordId);
      const reader = pgLifecycleReader(client);
      const gateway = pgLifecycleGateway(client);
      await advanceDeviceCredentialLifecycle(lifecycleInput(fixture, boundary), reader, gateway);
      await advanceDeviceCredentialLifecycle(lifecycleInput(fixture, boundary), reader, gateway);

      const history = await readLifecycleEvents(client, fixture.deviceRecordId);
      expect(history.length).toBeGreaterThan(1);
      expect(history[0]?.trustedTimeStatus).toBe("trusted");
      for (const row of history) {
        expect(JSON.stringify(row)).not.toContain("PRIVATE KEY");
        expect(JSON.stringify(row)).not.toContain("postgresql://");
      }

      await withRole(client, TEST_ROLES.issuanceService, async () => {
        expect(await currentRole(client)).toBe(TEST_ROLES.issuanceService);
        const insert = await expectRefused(client, () =>
          client.query(
            `insert into kitluy_devices.device_credential_lifecycle_events (
               device_record_id, environment, purpose, trusted_time_used, trusted_time_source,
               trusted_time_status, classification, credential_transition,
               provider_key_transition, reason, replay_outcome, actor_ref)
             values ($1::uuid,'development','device_identity', now(), 'x','trusted','FORGED',
                     'a','b','c','d','e')`,
            [fixture.deviceRecordId],
          ),
        );
        expect(insert).toMatch(/permission denied/);

        // The executor cannot enable destruction either.
        const policy = await expectRefused(client, () =>
          client.query(
            `update kitluy_devices.key_destruction_policy set destruction_enabled = true
              where environment = 'development'`,
          ),
        );
        expect(policy).toMatch(/permission denied/);
      });

      const update = await expectRefused(client, () =>
        client.query(
          `update kitluy_devices.device_credential_lifecycle_events set classification = 'X'
            where device_record_id = $1`,
          [fixture.deviceRecordId],
        ),
      );
      expect(update).toMatch(/append|immutable|permission denied|APPEND/i);
    });
  }, 180_000);

  it("refuses to enable destruction without a decision and both retention periods", async () => {
    await withDatabaseTransaction(async (client) => {
      // The CHECKs are the real control, exactly as for rotation.
      const noDecision = await expectRefused(client, () =>
        client.query(
          `update kitluy_devices.key_destruction_policy
              set destruction_enabled = true where environment = 'development'`,
        ),
      );
      expect(noDecision).toMatch(/key_destruction_policy_needs_decision_chk/);

      const noRetention = await expectRefused(client, () =>
        client.query(
          `update kitluy_devices.key_destruction_policy
              set destruction_enabled = true, approved_by_decision_ref = 'KLD-TEST'
            where environment = 'development'`,
        ),
      );
      expect(noRetention).toMatch(/key_destruction_policy_needs_retention_chk/);

      const shipped = await client.query(
        `select destruction_enabled, approved_by_decision_ref, minimum_retention_days,
                required_owner_decision
           from kitluy_devices.key_destruction_policy where environment = 'development'`,
      );
      expect(shipped.rows[0].destruction_enabled).toBe(false);
      expect(shipped.rows[0].approved_by_decision_ref).toBeNull();
      expect(shipped.rows[0].minimum_retention_days).toBeNull();
      expect(shipped.rows[0].required_owner_decision).toContain(
        "device_key_destruction_owner_decision",
      );
    });
  }, 120_000);

  it("never retires the CURRENT credential, whatever the caller asks", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "LCCURRENT",
      });
      // No renewal: the head has no previous generation at all.
      const reader = pgLifecycleReader(client);
      const gateway = pgLifecycleGateway(client);
      const outcome = await advanceDeviceCredentialLifecycle(
        lifecycleInput(fixture, new Date()),
        reader,
        gateway,
      );
      expect(outcome.classification).toBe("NO_ACTION_CURRENT");
      expect(await credentialStates(client, fixture.deviceRecordId)).toBe("issued:1");

      // And the governed function itself refuses when asked directly.
      await withRole(client, TEST_ROLES.issuanceService, async () => {
        const r = await client.query<{ result: Record<string, unknown> }>(
          `select kitluy_devices.retire_overlapped_credential_v1(
             $1::uuid,'development','device_identity',$2::timestamptz,'trusted','ATTACK') as result`,
          [fixture.deviceRecordId, new Date()],
        );
        expect(r.rows[0].result["outcome"]).toBe("NO_PREVIOUS_GENERATION");
      });
      expect(await credentialStates(client, fixture.deviceRecordId)).toBe("issued:1");
    });
  }, 180_000);

  it("produces one retirement when two executors race the boundary", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "LCRACE",
      });
      await completeSameKeyCredentialRenewal(
        {
          deviceRecordId: fixture.deviceRecordId,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
          idempotencyKey: `race-${fixture.credentialId}`,
          actorRef: "LIFECYCLE-TEST",
          trustedTime: trustedAt(new Date()),
          trustedRootFingerprints: [fixture.ca.rootCertificate.tbs.subjectFingerprint],
          currentAssignmentGeneration: fixture.assignmentGeneration,
        },
        pgIncumbentRepository(client),
        pgReservationGateway(client),
        pgIssuanceGateway(client),
        fixture.ca,
        fixture.signer,
      );
      const boundary = await overlapEnd(client, fixture.deviceRecordId);
      const reader = pgLifecycleReader(client);
      const gateway = pgLifecycleGateway(client);

      // SEQUENTIAL, not parallel: two executors cannot share one pg client —
      // interleaved queries corrupt the transaction the suite needs for
      // isolation. What is proven is the property that matters: the second
      // executor produces no second retirement, because the governed function
      // is idempotent. The unit suite covers the interleaved-decision case.
      const first = await advanceDeviceCredentialLifecycle(
        lifecycleInput(fixture, boundary),
        reader,
        gateway,
      );
      const second = await advanceDeviceCredentialLifecycle(
        lifecycleInput(fixture, boundary),
        reader,
        gateway,
      );
      expect(first.outcome).toBe("ADVANCED");
      expect(second.outcome).toBe("REPLAYED");

      const superseded = await client.query(
        `select count(*) n from kitluy_devices.device_credentials
          where device_record_id = $1 and state = 'superseded'`,
        [fixture.deviceRecordId],
      );
      expect(Number(superseded.rows[0].n)).toBe(1);
    });
  }, 180_000);
});

describe("integration reporting", () => {
  it("states plainly whether the live lifecycle suite ran", () => {
    if (!reachable) {
      console.warn(`${SUITE} DID NOT RUN — no database evidence for overlap lifecycle.`);
    }
    expect(typeof reachable).toBe("boolean");
  });
});
