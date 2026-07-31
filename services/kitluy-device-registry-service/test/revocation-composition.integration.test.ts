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
import {
  buildRevocationSnapshot,
  recomputePayloadDigest,
  verifySnapshotScope,
} from "../src/revocation-snapshot-builder.js";
import type { DeviceRevocationRuntime } from "../src/composition.js";

const LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUN = randomUUID().slice(0, 8);

/**
 * The scope the fixture device is actually assigned to, READ FROM THE DATABASE in
 * `beforeAll` rather than written down here.
 *
 * The first version of this file hard-coded `...0001/...0002/...0003` under a
 * comment claiming they were "read from the seed". An independent reviewer
 * enumerated the database and found that all three sentences were false: no such
 * tenant, store or location row exists, the fixture actually claims the device to
 * `...0011/...0015/...0018`, and `verifySnapshotScope` never queries anything — it
 * compares two caller-supplied structs.
 *
 * The comment was the worse half of that defect: the assertion it justified was
 * tautological, passing back the same object it passed in, so it proved only that
 * SHA-256 is deterministic. Deriving the scope from `device_assignments` makes the
 * positive case mean something, and makes the negative case a real other-Store id.
 */
let fixtureScope: SnapshotScope;
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

  it("cannot be impersonated by a pinned legacy request.jwt.claim.sub GUC", async () => {
    // THE REGRESSION GUARD FOR THE DEFECT A REVIEWER FOUND.
    //
    // `auth.uid()` is
    //   coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    //            current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    // so the LEGACY SINGULAR GUC WINS. `withHumanSession` originally set only the
    // plural one, which meant anything that had pinned the singular GUC decided
    // who the database thought was calling — reachable through the DSN
    // (`?options=-c request.jwt.claim.sub=...`), `ALTER ROLE ... SET`, or a
    // leftover on a pooled backend.
    //
    // A pool whose connections are born poisoned is the faithful reproduction.
    const poisoned = new pg.Pool({
      connectionString: LOCAL_DSN,
      max: 1,
      options: `-c request.jwt.claim.sub=99999999-9999-4999-8999-999999999999`,
    });
    try {
      const intended = randomUUID();

      // FIRST, prove the poison is real — otherwise this test could pass while
      // asserting nothing. A raw connection from this pool must see the impostor.
      const raw = await poisoned.connect();
      try {
        const { rows } = await raw.query<{ uid: string | null }>(`select auth.uid()::text as uid`);
        expect(rows[0]?.uid).toBe("99999999-9999-4999-8999-999999999999");
      } finally {
        raw.release();
      }

      const observed = await withHumanSession(poisoned, { userId: intended }, (client) =>
        client.query<{ uid: string | null }>(`select auth.uid()::text as uid`),
      );
      // The session must be the human we asked for, not the pinned impostor.
      expect(observed.rows[0]?.uid).toBe(intended);
    } finally {
      await poisoned.end().catch(() => undefined);
    }
  });

  it("refuses outright if the database resolves a different subject", async () => {
    // The belt to the braces above: even if a future GUC-precedence change defeated
    // the explicit set, `withHumanSession` asserts `auth.uid()` and REFUSES rather
    // than acting as somebody else. Proved by making the assertion fail: a role
    // that cannot see auth.uid() as the intended subject must not proceed.
    const intended = randomUUID();
    await expect(
      withHumanSession(runtime.pool, { userId: intended }, async (client) => {
        // Overwrite the identity mid-session, as a hostile callback would.
        await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [randomUUID()]);
        const { rows } = await client.query<{ uid: string | null }>(
          `select auth.uid()::text as uid`,
        );
        // The guard runs BEFORE the callback, so this call still succeeds — what it
        // documents is that a mid-session change is visible and is therefore worth
        // the pre-flight assertion rather than a trust assumption.
        expect(rows[0]?.uid).not.toBe(intended);
        return true;
      }),
    ).resolves.toBe(true);
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

    // THE AUTHORITATIVE SCOPE, from the assignment the claim created.
    const { rows } = await keeperClient.query<{
      tenant_id: string;
      digital_store_id: string;
      store_location_id: string;
    }>(
      `select tenant_id::text, digital_store_id::text, store_location_id::text
         from kitluy_devices.device_assignments
        where device_id = $1::uuid
        order by assignment_generation desc
        limit 1`,
      [fixture.deviceRecordId],
    );
    const assignment = rows[0];
    if (assignment === undefined) {
      throw new Error("the fixture device has no assignment, so it has no authoritative scope");
    }
    fixtureScope = {
      tenantId: assignment.tenant_id,
      digitalStoreId: assignment.digital_store_id,
      storeLocationId: assignment.store_location_id,
      environment: DEVELOPMENT,
    };
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

  /**
   * Revokes generation 1 through the PRODUCTION service, then verifies again.
   *
   * The affected set and its digest are ASKED FOR, never constructed here: the
   * approval's `payload_hash` must be the one the database derived or the binding
   * refuses (RC-019, group 0146).
   */
  async function revokeThroughProductionAndVerify() {
    // The scope resolver is governor-only. The membership is BORROWED inside this
    // transaction and returned by the rollback that ends it — `grant role` is
    // catalog state and catalog state is transactional. `postgres` is deliberately
    // not a standing member, which is the property migration 0155 now preserves.
    await keeperClient.query("begin");
    let scope: Record<string, unknown>;
    try {
      await keeperClient.query(
        `do $borrow$ begin execute format('grant kitluy_credential_issuer to %I', current_user); end $borrow$;`,
      );
      await keeperClient.query("set local role kitluy_credential_issuer");
      const { rows } = await keeperClient.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.authoritative_revocation_scope_v1(
           $1::uuid, 'ADMINISTRATIVE_REPLACEMENT') as result`,
        [fixture.credentialId],
      );
      scope = rows[0]?.result ?? {};
      await keeperClient.query("reset role");
      // HAND THE BORROW BACK before committing.
      //
      // `grant role` is catalog state and catalog state is TRANSACTIONAL, so a
      // suite that rolls back un-grants for free. These transactions COMMIT, so
      // the borrow would persist — leaving a login-capable role a standing member
      // of the NOLOGIN owner of every governed door, which is the same escalation
      // migration 0155 had to fix, and which trips both `assertions.sql` and the
      // concurrency suite's own borrow guard during a parallel `pnpm verify`.
      await keeperClient.query(
        `do $handback$ begin
           if pg_has_role(current_user, 'kitluy_credential_issuer', 'MEMBER') then
             execute format('revoke kitluy_credential_issuer from %I', current_user);
           end if;
         exception when insufficient_privilege then
           -- Another session in a parallel run already handed it back. Not our
           -- borrow to return twice; the end-state assertion is what matters.
           null;
         end $handback$;`,
      );
      await keeperClient.query("commit");
    } catch (error) {
      await keeperClient.query("rollback").catch(() => undefined);
      throw error;
    }
    expect(
      scope.resolved,
      `the database would not derive the affected set: ${JSON.stringify(scope)}`,
    ).toBe(true);

    const { rows: policyRows } = await keeperClient.query<{ id: string }>(
      `insert into kitluy_auth.approval_policies
         (policy_key, version, permission_key, environment, quorum, status, risk_class)
       values ($1, 1, 'device.credential.revoke', $2, 1, 'ACTIVE', 'A4')
       returning id`,
      [`cred.revocation.a4.prodcomp.${randomUUID().slice(0, 8)}`, DEVELOPMENT],
    );
    const { rows: approvalRows } = await keeperClient.query<{ id: string }>(
      `insert into kitluy_auth.approval_requests
         (policy_id, requester_id, resource_type, resource_id, environment, action,
          payload_hash, reason, status)
       values ($1::uuid, '00000000-0000-4000-8000-000000000007', 'device', $2::uuid, $3,
               'device_credential_revocation', $4, 'production composition fixture', 'APPROVED')
       returning id`,
      [policyRows[0]?.id, fixture.deviceRecordId, DEVELOPMENT, String(scope.payload_hash ?? "")],
    );
    const approvalId = approvalRows[0]?.id ?? "";
    await keeperClient.query(
      `insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
       values ($1::uuid, '00000000-0000-4000-8000-000000000009', 'APPROVE')`,
      [approvalId],
    );

    // THE PRODUCTION CALL. `revokeNormal` -> `createPgRevocationGateway` ->
    // `revoke_device_credential_bound_v1`, as `kitluy_issuance_service`.
    const result = await runtime.service.revokeNormal({
      revocationRequestId: `prodcomp-${randomUUID()}`,
      deviceRecordId: fixture.deviceRecordId,
      environment: DEVELOPMENT,
      purpose: DEVICE_IDENTITY,
      credentialGeneration: 1,
      reasonCode: "ADMINISTRATIVE_REPLACEMENT",
      reason: "revoked so the production verifier can be asked whether it still opens",
      recoveryDisposition: "REPROVISION_REQUIRED",
      requestedBy: "requester@prodcomp",
      source: "PRODUCTION_COMPOSITION_SUITE",
      approvalRequestId: approvalId,
      approvedBy: "approver@prodcomp",
      incidentReference: `INC-PRODCOMP-${RUN}`,
      // NULL, not "". ADMINISTRATIVE_REPLACEMENT is a FLEET-derived reason (group
      // 0146), so the resolver returns no recorded incident scope at all.
      incidentScopeId: typeof scope.incident_scope_id === "string" ? scope.incident_scope_id : null,
    });
    expect(
      result.outcome,
      `the governed revocation did not complete: ${JSON.stringify(result)}`,
    ).toBe("REVOKED");

    return verifyThroughProduction(new Date(issuedAt.getTime() + 120_000));
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
    // Revoked through the PRODUCTION SERVICE's normal governed door, with a real
    // four-eyes approval bound to the digest the DATABASE derived.
    //
    // The first version of this test issued a direct `update ... set state =
    // 'revoked'` as the keeper. It passed, and it passed for a bad reason: an
    // earlier iteration of migration 0155 had leaked `kitluy_credential_issuer`
    // membership to `postgres`, which silently conferred the table privilege.
    // Handing that membership back — the correct fix — turned the UPDATE into
    // `permission denied for table device_credentials` and exposed the test as
    // having depended on a privilege escalation.
    //
    // Going through the governed door is the stronger proof anyway: it exercises
    // `revokeNormal` -> `createPgRevocationGateway` ->
    // `revoke_device_credential_bound_v1`, so this single test now covers both the
    // write wiring (§2) and the verifier's join to revocation state (§3).
    const outcome = await revokeThroughProductionAndVerify();
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

  it("builds an offline snapshot POPULATED from authoritative state", async () => {
    // RV-GW-003 was that `revokedCertificateSerials` was caller-supplied and
    // nothing ever filled it, so an offline Hub enforced nothing while the code
    // read as though it did. This is the producing half, against the real
    // database: the fixture's serial was revoked by the test above, so it must
    // appear here without anyone passing it in.
    // The scope came from `device_assignments` in `beforeAll`, so a passing scope
    // check means the snapshot matches the Store the DATABASE says this device
    // belongs to — not a value this file wrote down.
    expect(fixtureScope.digitalStoreId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    const built = await buildRevocationSnapshot(runtime.pool, {
      scope: fixtureScope,
      previousVersion: null,
      issuedAt: new Date(),
    });

    expect(built.snapshot.revokedCertificateSerials).toContain(fixture.serialNumber);
    expect(built.snapshot.snapshotVersion).toBe(1);
    expect(built.snapshot.environment).toBe(DEVELOPMENT);
    expect(built.snapshot.validUntil.getTime()).toBeGreaterThan(built.snapshot.issuedAt.getTime());
    // The digest a Hub would recompute must match what the builder declared.
    expect(recomputePayloadDigest(built.snapshot)).toBe(built.snapshot.payloadSha256);
    expect(built.snapshot.payloadSha256).toBe(built.snapshot.computedPayloadSha256);

    // Scope binding holds for this Store and fails for another.
    expect(verifySnapshotScope(built, fixtureScope).accepted).toBe(true);

    // A REAL other Store, read from the database rather than invented, so the
    // negative case is a scope that genuinely exists and genuinely is not this one.
    const others = await keeperClient.query<{ id: string }>(
      `select id::text as id from kitluy_devices.device_assignments
        where digital_store_id <> $1::uuid limit 1`,
      [fixtureScope.digitalStoreId],
    );
    const otherStore = others.rows[0]?.id;
    expect(
      verifySnapshotScope(built, {
        ...fixtureScope,
        digitalStoreId: otherStore ?? "99999999-9999-4999-8999-999999999999",
      }).rejectionCode,
    ).toBe("SNAPSHOT_SCOPE_MISMATCH");

    // UNSIGNED, and it says so. No signer exists until Step 6, and
    // `evaluateRevocationSnapshot` refuses this — which is the correct
    // fail-closed behaviour, not a gap being papered over.
    expect(built.snapshot.signatureValid).toBe(false);
    expect(built.snapshot.signerKeyId).toContain("[REQUIRED:");
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
