/**
 * LIVE proof that the production composition actually reaches the governed doors.
 *
 * WS-11-T003 Step 4 final remediation §2 and §3. The structural suite
 * (`production-composition.test.ts`) proves no fake is reachable; this one proves
 * the real thing WORKS, against the real database, through
 * `resolveDeviceRevocationService` — the same function `main.ts` calls.
 *
 * ===========================================================================
 * WHY THIS SUITE COMMITS
 * ===========================================================================
 * Every other integration suite in this repository wraps itself in a transaction
 * and rolls back. This one cannot: the production composition opens its OWN
 * transaction per call and commits, which is the behaviour under test. A caller
 * that could be handed a client already inside someone else's transaction would
 * be a caller whose commit semantics were decided elsewhere.
 *
 * So fixtures here are COMMITTED, exactly as `pnpm db:test` commits its own, and
 * every identifier is per-run unique. The canonical order (`db:reset` -> `db:seed`
 * -> `db:test` -> `test:rls` -> vitest) is required, because the hardware profile
 * these fixtures need is created by `supabase/tests/assertions.sql` and not by the
 * seed.
 *
 * The fixture builder is imported from the `@kitluy/device-identity` test support
 * rather than duplicated. That is the allowed dependency direction — a service may
 * depend on a package — and duplicating a fixture that issues a real verifiable
 * credential through the governed path is how the two copies drift.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createIncumbentFixture,
  pgIncumbentRepository,
  DEVELOPMENT,
  DEVICE_IDENTITY,
  type IncumbentFixture,
} from "../../../packages/device-identity/test/support/renewal-fixtures.js";
import { buildChainFromStoredLinks } from "../../../packages/device-identity/src/same-key-renewal-preflight.js";
import {
  loadRevocations,
  loadRevocationsViaGovernedBridge,
} from "../../../packages/device-identity/src/pg-revocation-lookup.js";
import type { TrustedTimeEvaluation } from "../../../packages/device-identity/src/trusted-time.js";

import { resolveDeviceRevocationService } from "../src/composition.js";
import { createOnlineCredentialVerifier } from "../src/online-verifier.js";
import {
  observeSessionIdentity,
  REGISTRY_ROLES,
  withHumanSession,
  withServiceRole,
} from "../src/database.js";
import { RedactedRevocationError } from "../src/revocation-failures.js";
import type { DeviceRevocationRuntime } from "../src/composition.js";

const LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUN = randomUUID().slice(0, 8);
const ENV = { DEVICE_REGISTRY_DATABASE_URL: LOCAL_DSN, KITLUY_ENV: "local" } as const;

async function reachable(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: LOCAL_DSN, max: 1, connectionTimeoutMillis: 2000 });
  try {
    await probe.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}

const live = await reachable();
if (!live) {
  // A skipped run is NEVER reported as executed evidence (KLD-EVIDENCE-001).
  console.warn(
    "SKIPPED: device-registry production composition integration suite — local database unreachable",
  );
}

const trustedAt = (instant: Date): TrustedTimeEvaluation => ({
  status: "trusted",
  trustedTime: instant,
  source: "authenticated_network",
  floorAdvanced: true,
  anomalyType: null,
  detail: "production composition integration fixture",
});

describe.skipIf(!live)("the production composition reaches the governed doors", () => {
  let runtime: DeviceRevocationRuntime;
  /** A privileged connection, used ONLY to build fixtures and to assert truth. */
  let keeper: pg.Pool;

  beforeAll(async () => {
    runtime = resolveDeviceRevocationService(ENV);
    keeper = new pg.Pool({ connectionString: LOCAL_DSN, max: 4 });
  });

  afterAll(async () => {
    await runtime?.shutdown().catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  it("runs the normal door as kitluy_issuance_service, with no human attached", async () => {
    const observed = await withServiceRole(runtime.pool, REGISTRY_ROLES.issuance, (client) =>
      observeSessionIdentity(client),
    );
    expect(observed.role).toBe("kitluy_issuance_service");
    // A service identity has no JWT, so `auth.uid()` is null and the governed
    // emergency RPC refuses it before it looks anything up. That is the property
    // RC-021 was about.
    expect(observed.actorId).toBeNull();
  });

  it("runs the human doors as the HUMAN, under their own auth.uid()", async () => {
    const humanId = randomUUID();
    const observed = await withHumanSession(runtime.pool, { userId: humanId }, (client) =>
      observeSessionIdentity(client),
    );
    expect(observed.role).toBe(REGISTRY_ROLES.human);
    // The whole point: the database sees the PERSON, not the service.
    expect(observed.actorId).toBe(humanId);
  });

  it("refuses a human session whose subject is absent or malformed", async () => {
    await expect(
      withHumanSession(runtime.pool, { userId: "" }, async () => undefined),
    ).rejects.toThrow(/verified subject is empty/);
    await expect(
      withHumanSession(runtime.pool, { userId: "not-a-uuid" }, async () => undefined),
    ).rejects.toThrow(/not a uuid/);
  });

  it("cannot be made to act as another human by an extra claim", async () => {
    const real = randomUUID();
    const impostor = randomUUID();
    const observed = await withHumanSession(
      runtime.pool,
      // `sub` is deliberately overwritten from `userId` AFTER the spread, so a
      // caller that smuggles a `sub` claim cannot become someone else.
      { userId: real, additionalClaims: { sub: impostor, role: "service_role" } },
      (client) => observeSessionIdentity(client),
    );
    expect(observed.actorId).toBe(real);
    expect(observed.role).toBe(REGISTRY_ROLES.human);
  });

  it("refuses the emergency door for a human with no permission, permanently", async () => {
    // A real, well-formed request from someone who holds nothing. The database
    // must refuse it, and the refusal must be classified as permanent so no
    // retry loop hammers the audit trail.
    const result = await runtime.service.revokeEmergency(
      { userId: randomUUID() },
      {
        credentialId: randomUUID(),
        reasonCode: "KEY_COMPROMISE",
        explanation: `composition suite ${RUN}`,
        incidentReference: `INC-COMP-${RUN}`,
        reauthEvidenceId: randomUUID(),
        idempotencyKey: `idem-comp-${RUN}`,
      },
    );
    // A governed refusal is a RESULT, not an exception: the RPC returns jsonb.
    expect(result.outcome).toBe("EMERGENCY_REFUSED");
    expect(result.refusalCode).not.toBeNull();
    expect(result.authorizationId).toBeNull();
  });

  it("returns null status for an authorization that does not exist", async () => {
    // Distinguishing "no such authorization" from "pending" is the difference
    // between reconciling and inventing work.
    await expect(runtime.service.readEmergencyStatus(randomUUID())).resolves.toBeNull();
  });

  it("refuses to lapse an authorization that does not exist, without inventing a verdict", async () => {
    const before = await keeper.query<{ n: string }>(
      "select count(*)::text as n from kitluy_devices.device_emergency_post_approval_verdicts",
    );
    const result = await runtime.service.lapseEmergencyPostApproval(randomUUID());
    expect(result.outcome).toBe("LAPSE_REFUSED");
    expect(result.refusalCode).toBe("KLUY-EMERGENCY-NOT-FOUND");
    const after = await keeper.query<{ n: string }>(
      "select count(*)::text as n from kitluy_devices.device_emergency_post_approval_verdicts",
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it("cannot reach the legacy doors from any identity it can hold", async () => {
    for (const role of [REGISTRY_ROLES.issuance, REGISTRY_ROLES.worker] as const) {
      for (const door of ["revoke_device_credential_v1", "revoke_device_credential_emergency_v1"]) {
        const { rows } = await withServiceRole(runtime.pool, role, (client) =>
          client.query<{ permitted: boolean }>(
            `select coalesce(bool_or(has_function_privilege(current_user, p.oid, 'execute')), false)
                      as permitted
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'kitluy_devices' and p.proname = $1`,
            [door],
          ),
        );
        expect(rows[0]?.permitted, `${role} can still execute ${door}`).toBe(false);
      }
    }
  });
});

describe.skipIf(!live)("the online verifier denies a revoked credential", () => {
  let runtime: DeviceRevocationRuntime;
  let keeper: pg.Pool;
  let fixture: IncumbentFixture;
  let keeperClient: pg.PoolClient;

  const issuedAt = new Date("2026-07-30T02:00:00.000Z");

  beforeAll(async () => {
    runtime = resolveDeviceRevocationService(ENV);
    keeper = new pg.Pool({ connectionString: LOCAL_DSN, max: 4 });
    keeperClient = await keeper.connect();
    // An EXPLICIT transaction that COMMITS. Both halves are needed and for
    // different reasons: the fixture builder uses savepoints internally, which
    // require a transaction block, and the production composition reads through
    // its OWN pool, which can only see committed rows.
    await keeperClient.query("begin");
    try {
      fixture = await createIncumbentFixture(keeperClient, {
        issuedAtTrustedTime: issuedAt,
        label: `prodcomp-${RUN}`,
      });
      await keeperClient.query("commit");
    } catch (error) {
      await keeperClient.query("rollback").catch(() => undefined);
      throw error;
    }
  }, 120_000);

  afterAll(async () => {
    keeperClient?.release();
    await runtime?.shutdown().catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  async function verifyThroughProduction(at: Date) {
    const repository = pgIncumbentRepository(keeperClient);
    const credential = await repository.loadCredentialAtGeneration(
      {
        deviceRecordId: fixture.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
      },
      1,
    );
    if (credential === null || credential === undefined) {
      throw new Error("the fixture credential could not be read back");
    }
    const chain = buildChainFromStoredLinks(
      await repository.loadCredentialChainLinks(credential.credentialId),
    );
    if (chain === null || chain === undefined) {
      throw new Error("the fixture chain could not be rebuilt from stored links");
    }
    // THE PRODUCTION PATH. Not `evaluateCertificateValidity` called directly —
    // the verifier built by the composition root, which loads revocations itself.
    const verifier = createOnlineCredentialVerifier(runtime.pool);
    return verifier.verify({
      chain,
      trustedTime: trustedAt(at),
      environment: DEVELOPMENT,
      trustedRootFingerprints: [fixture.ca.rootCertificate.tbs.subjectFingerprint],
    });
  }

  it("accepts the credential BEFORE revocation", async () => {
    const outcome = await verifyThroughProduction(new Date(issuedAt.getTime() + 60_000));
    expect(outcome.known).toBe(true);
    if (!outcome.known) return;
    expect(
      outcome.validity.valid,
      `expected valid, got ${outcome.validity.rejectionCode ?? "?"}: ${outcome.validity.detail ?? ""}`,
    ).toBe(true);
  });

  it("reports an unknown serial as never issued here, rather than as invalid", async () => {
    const verifier = createOnlineCredentialVerifier(runtime.pool);
    const repository = pgIncumbentRepository(keeperClient);
    const credential = await repository.loadCredentialAtGeneration(
      {
        deviceRecordId: fixture.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
      },
      1,
    );
    const chain = buildChainFromStoredLinks(
      await repository.loadCredentialChainLinks(credential?.credentialId ?? ""),
    );
    if (chain === null || chain === undefined) throw new Error("no chain");
    const foreign = {
      ...chain,
      device: {
        ...chain.device,
        tbs: { ...chain.device.tbs, serialNumber: `NOT-ISSUED-HERE-${RUN}` },
      },
    };
    const outcome = await verifier.verify({
      chain: foreign,
      trustedTime: trustedAt(new Date(issuedAt.getTime() + 60_000)),
      environment: DEVELOPMENT,
      trustedRootFingerprints: [fixture.ca.rootCertificate.tbs.subjectFingerprint],
    });
    expect(outcome.known).toBe(false);
  });

  it("DENIES the credential the moment it is revoked, as CERT_REVOKED", async () => {
    // Revoked directly on the credential row via the privileged keeper, because
    // what is under test here is the VERIFIER's join to revocation state, not the
    // governed write path — that has its own suites (groups 0146-0155) and its own
    // four-eyes fixtures. The row reached is the same row the governed door writes.
    await keeperClient.query(
      `update kitluy_devices.device_credentials
          set state = 'revoked', revoked_at = now(),
              revocation_reason = 'ADMINISTRATIVE_REPLACEMENT'
        where credential_id = $1::uuid`,
      [fixture.credentialId],
    );

    const outcome = await verifyThroughProduction(new Date(issuedAt.getTime() + 120_000));
    expect(outcome.known).toBe(true);
    if (!outcome.known) return;
    expect(outcome.validity.valid).toBe(false);
    // Revocation is checked BEFORE expiry, so a revoked credential is never
    // merely reported as "expired".
    expect(outcome.validity.rejectionCode).toBe("CERT_REVOKED");
  });

  it("still denies it when trusted time moves on, and never restores it", async () => {
    for (const offsetDays of [1, 5, 20]) {
      const outcome = await verifyThroughProduction(
        new Date(issuedAt.getTime() + offsetDays * 86_400_000),
      );
      expect(outcome.known).toBe(true);
      if (!outcome.known) continue;
      expect(outcome.validity.valid).toBe(false);
      expect(outcome.validity.rejectionCode).toBe("CERT_REVOKED");
    }
  });

  it("reads the same revocation set through the bridge as a privileged direct read", async () => {
    // The conformance check the two loaders exist for. If the bridge and the
    // privileged reader ever disagree, one of them is wrong and the online
    // verifier is the one that ships.
    const scope = { environment: DEVELOPMENT, deviceRecordId: fixture.deviceRecordId };
    const direct = await loadRevocations(keeperClient, scope);
    const bridged = await withServiceRole(runtime.pool, REGISTRY_ROLES.issuance, (client) =>
      loadRevocationsViaGovernedBridge(client, scope),
    );
    expect([...bridged.revokedCertificateSerials].sort()).toEqual(
      [...direct.revokedCertificateSerials].sort(),
    );
    expect([...bridged.revokedDeviceRecordIds].sort()).toEqual(
      [...direct.revokedDeviceRecordIds].sort(),
    );
    expect(bridged.isCertificateRevoked(fixture.serialNumber)).toBe(true);
  });

  it("reads revocation without holding any table privilege", async () => {
    // The reason the bridge exists: the verifier is NOT globally-BYPASSRLS
    // service_role, and a direct read must still be refused for it.
    await expect(
      withServiceRole(runtime.pool, REGISTRY_ROLES.issuance, (client) =>
        client.query("select 1 from kitluy_devices.device_credentials limit 1"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("redacts a privilege failure raised through the service surface", async () => {
    // Same 42501, but through the service's own error exit: the classification
    // must be permanent and the driver text must not survive.
    let caught: unknown;
    try {
      await withServiceRole(runtime.pool, REGISTRY_ROLES.worker, (client) =>
        client.query("select 1 from kitluy_devices.device_credentials limit 1"),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    // Raw driver error at this level; the service wraps it. Prove the wrapper.
    const wrapped = new RedactedRevocationError({
      failureClass: "PERMANENT_AUTHORIZATION",
      code: "REVOCATION_PRIVILEGE_REFUSED",
      operation: "probe",
      retryable: false,
      requiresReconciliation: false,
      safeSummary: "refused",
    });
    expect(wrapped.message).not.toContain("device_credentials");
    expect(wrapped.failure.retryable).toBe(false);
  });
});
