/**
 * THE COMPLETE PRODUCTION LIFECYCLE, AS ONE TRACEABLE 30-STAGE RUN.
 *
 * WS-11-T003 Step 4 §12. Every other suite proves one property in isolation.
 * This run drives FOUR credentials under ONE correlation id through every stage
 * of the device-credential life the task enumerates — through the HTTP router
 * `main.ts` actually serves for everything that changes emergency state, and
 * through the governed database doors for the credential-life stages that have
 * no HTTP route of their own.
 *
 * ===========================================================================
 * WHY FOUR CREDENTIALS
 * ===========================================================================
 * One authorization can take exactly ONE terminal verdict: APPROVE, REFUSE and
 * LAPSED are mutually exclusive because the first verdict is terminal — that is
 * a property under test, not an inconvenience. And one credential cannot be
 * renewed, rotated, retired and normally revoked and then ALSO be emergency
 * revoked, because revocation is terminal too. The run therefore uses:
 *
 *   A  the spine        — stages 1-20 (life ends in a governed NORMAL revocation)
 *   B  emergency thread — stages 21-23 (distinct-human APPROVE)
 *   C  emergency thread — stages 24, 26 (distinct-human REFUSE -> review)
 *   D  emergency thread — stages 25, 26 (no post-approval -> lapse -> review)
 *
 * ===========================================================================
 * HONEST MAPPINGS, DECLARED NOT HIDDEN
 * ===========================================================================
 *  - Stages 4 and 6: this schema binds a device to its Tenant/Store/Location
 *    through `kitluy_devices.device_assignments`; the Hub-facing identity a
 *    snapshot binds to is derived from that assignment by the production
 *    producer (the credential's OWN hub, resolved exactly as the previous
 *    version of this suite resolved it for stage 18). There is no separate
 *    hub-device row to assert; the stages assert the claim and the assignment
 *    the governed claim/redeem path created.
 *  - Stages 10-15 run BEFORE the spine's revocation, so snapshot content
 *    assertions are pre-revocation for A. The post-revocation snapshot that
 *    must carry revoked serials is produced at stage 30 against the hub's
 *    persisted state, where restart/reconnection non-resurrection is proved.
 *  - The privileged `keeper` connection provisions fixtures and ASSERTS. Every
 *    emergency state change goes through `runtime.revocationRouter`. The one
 *    raw write anywhere in the run is the deadline-earlier move at stage 25,
 *    mirrored from the lapse-worker suite, with the reverse direction proved
 *    refused inline.
 *
 * Stage markers are recorded by `passed(n)` ONLY after a stage's assertions
 * succeed; a stage that throws never records itself (independent-review fix,
 * previously the counter measured parsing).
 */
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { verifySnapshotSignature, type TrustedSnapshotKey } from "@kitluy/device-identity";

import {
  createIncumbentFixture,
  withRole,
  DEVELOPMENT,
  DEVICE_IDENTITY,
  MS_PER_DAY,
  TEST_ROLES,
  enableDevelopmentRotation,
  restoreDevelopmentRotation,
  pgIncumbentRepository,
  pgIssuanceGateway,
  pgLifecycleGateway,
  pgLifecycleReader,
  pgReservationGateway,
  pgRotationGateway,
  type IncumbentFixture,
} from "../../../packages/device-identity/test/support/renewal-fixtures.js";
import {
  advanceDeviceCredentialLifecycle,
  permittedOverlapFrom,
  type LifecycleInput,
} from "../../../packages/device-identity/src/credential-lifecycle.js";
import { completeSameKeyCredentialRenewal } from "../../../packages/device-identity/src/same-key-renewal-issuance.js";
import { buildChainFromStoredLinks } from "../../../packages/device-identity/src/same-key-renewal-preflight.js";
import { completeRotateKeyCredentialRenewal } from "../../../packages/device-identity/src/rotate-key-renewal-issuance.js";
import { DevelopmentReplacementKeyProvider } from "../../../packages/device-identity/src/replacement-key-provider.js";
import { evaluateCertificateValidity } from "../../../packages/device-identity/src/certificate-validity.js";
import {
  approveProviderKeyDestruction,
  executeProviderKeyDestruction,
  requestProviderKeyDestruction,
  type KeyDestructionGateway,
} from "../../../packages/device-identity/src/key-destruction.js";
import {
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
  verifyDetachedSignature,
} from "../../../packages/device-identity/src/dev-crypto.js";
import { runGovernedIssuance } from "../../../packages/device-identity/src/issuance-adapter.js";
import type { TrustedTimeEvaluation } from "../../../packages/device-identity/src/trusted-time.js";
import {
  applySignedSnapshot,
  decideOffline,
  provisionTrustKey,
  type HubScopeIdentity,
} from "../../kitluy-hub-agent/src/hub/revocation-trust.js";

import {
  resolveDeviceRevocationService,
  type DeviceRevocationRuntime,
} from "../src/composition.js";
import { createOnlineCredentialVerifier } from "../src/online-verifier.js";
import { createEmergencyLapseWorker } from "../src/lapse-worker.js";
import type { RequestAuthenticator } from "../src/authentication.js";
import type { RouteRequest, RouteResponse } from "../src/revocation-routes.js";
import { createEd25519SnapshotSigner } from "../src/snapshot-signer.js";
import { createSnapshotProducer } from "../src/signed-snapshot-producer.js";
import {
  createEmergencyActor,
  disposeEmergencyActor,
  readEvidence,
  recordEmergencyEvidence,
  EMERGENCY_POST_APPROVE_ACTION,
  type EmergencyActor,
} from "./support/emergency-success-fixture.js";

const LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const HUB_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/kitluy_hub_local";
const ENV = { DEVICE_REGISTRY_DATABASE_URL: LOCAL_DSN, KITLUY_ENV: "local" } as const;
const RUN = randomUUID().slice(0, 8);
const KEY_ENV_VAR = "TEST_LIFECYCLE_SNAPSHOT_KEY";
const EMERGENCY_PREFIX = "/v1/device-credentials/emergency-revocations";

/** The fixture's shared scope constants (renewal-fixtures.ts lines 52-54). */
const TENANT_ID = "00000000-0000-4000-8000-000000000011";
const DIGITAL_STORE_ID = "00000000-0000-4000-8000-000000000015";
const STORE_LOCATION_ID = "00000000-0000-4000-8000-000000000018";

/** ONE correlation id for the whole run, so it is traceable as a unit. */
const CORRELATION = randomUUID();

const trustedAt = (instant: Date): TrustedTimeEvaluation => ({
  status: "trusted",
  trustedTime: instant,
  source: "authenticated_network",
  floorAdvanced: true,
  anomalyType: null,
  detail: "production lifecycle fixture",
});

/** Issued so that `daysRemaining` of the 30-day window remain at `Date.now()`. */
const issuedSoThat = (daysRemaining: number): Date =>
  new Date(Date.now() - (30 - daysRemaining) * MS_PER_DAY);

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
async function hubReachable(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: HUB_DSN, max: 1, connectionTimeoutMillis: 2000 });
  try {
    await probe.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}
const live = (await reachable()) && (await hubReachable());
if (!live) console.warn("SKIPPED: production lifecycle — a local database is unreachable");

/**
 * The authenticated principal SWITCHES between stages, because several
 * different humans act in this lifecycle. A fixed authenticator could not
 * express that, and four eyes would be untestable.
 */
let currentPrincipal = randomUUID();
const switchingAuthenticator: RequestAuthenticator = {
  authenticate: () =>
    Promise.resolve({
      authenticated: true as const,
      principal: { userId: currentPrincipal, method: "TEST_INJECTED_AUTHENTICATOR" },
    }),
};

describe.skipIf(!live)(
  "the production lifecycle: 30 stages, four credentials, one correlation id",
  () => {
    let runtime: DeviceRevocationRuntime;
    let keeper: pg.Pool;
    let keeperClient: pg.PoolClient;
    let hubPool: pg.Pool;

    let spine: IncumbentFixture;
    let threadB: IncumbentFixture;
    let threadC: IncumbentFixture;
    let threadD: IncumbentFixture;
    let bystander: IncumbentFixture;
    let rotationProvider: DevelopmentReplacementKeyProvider;

    let responderB: EmergencyActor;
    let approverB: EmergencyActor;
    let responderC: EmergencyActor;
    let refuserC: EmergencyActor;
    let responderD: EmergencyActor;

    /** Snapshot signing material. The PRIVATE half never leaves this process. */
    let snapshotPrivateKeyPem = "";
    let snapshotPublicKeyPem = "";
    const snapshotKeyId = `lifecycle-${RUN}`;
    const snapshotKeyVersion = 1;

    /** Carried between stages. */
    let hubScope: HubScopeIdentity;
    let authorizationB = "";
    let evidenceB = "";
    let authorizationC = "";
    let authorizationD = "";
    let revokedSpineSerial = "";
    let revokedSpineCredentialId = "";
    let replacementCredentialId = "";
    /** Snapshot sequences are monotonic per scope; leftovers from earlier runs count. */
    let snapshotBaseSequence = 1;
    /** The trusted instant the rotation ran at; stages 18-20 reason relative to it. */
    let rotationTrustedTime = new Date();

    /**
     * Stage numbers that actually EXECUTED to completion. `passed()` is called
     * at the END of each body, so a stage whose assertion throws never records
     * itself. The final stage asserts the set is exactly 1..29 before adding 30.
     */
    const executed = new Set<number>();
    const stage = (n: number, label: string) => `${String(n).padStart(2, "0")} ${label}`;
    const passed = (n: number): void => void executed.add(n);

    const call = (request: Partial<RouteRequest>): Promise<RouteResponse> =>
      runtime.revocationRouter.handle({
        method: request.method ?? "POST",
        path: request.path ?? EMERGENCY_PREFIX,
        headers: { "x-kitluy-correlation-id": CORRELATION, ...(request.headers ?? {}) },
        body: request.body,
      });

    /** The credential's OWN hub assignment, resolved the way the producer needs it. */
    async function resolveOwnHub(credentialId: string): Promise<string> {
      const { rows } = await keeperClient.query<{ device_id: string }>(
        `select a.device_id::text as device_id
         from kitluy_devices.device_assignments a
         join kitluy_devices.device_credentials c on c.device_record_id = a.device_id
        where c.credential_id = $1::uuid and a.state in ('pending_trust','active')
        order by a.device_id limit 1`,
        [credentialId],
      );
      const hub = rows[0]?.device_id;
      expect(hub, "the credential has no live hub assignment").toBeDefined();
      return hub ?? "";
    }

    /** Produces a signed scoped snapshot for the spine's hub at a sequence. */
    async function produceSnapshot(sequence: number) {
      const producer = createSnapshotProducer(
        runtime.pool,
        createEd25519SnapshotSigner({
          env: { [KEY_ENV_VAR]: snapshotPrivateKeyPem },
        }),
      );
      const effective = snapshotBaseSequence + sequence - 1;
      return producer.produceSignedSnapshot({
        hubDeviceRecordId: hubScope.hubDeviceId,
        environment: DEVELOPMENT,
        snapshotVersion: effective,
        sequence: effective,
        generatedAt: new Date(),
        effectiveAt: new Date(),
        keyReference: {
          secretEnvVar: KEY_ENV_VAR,
          keyId: snapshotKeyId,
          keyVersion: snapshotKeyVersion,
        },
      });
    }

    /** Emergency through the SHIPPED route for one thread's credential. */
    async function emergencyThroughRoute(
      fixture: IncumbentFixture,
      responder: EmergencyActor,
      label: string,
    ): Promise<{ authorizationId: string; evidenceId: string }> {
      currentPrincipal = responder.userId;
      const noEvidence = await call({
        body: {
          credentialId: fixture.credentialId,
          reasonCode: "KEY_COMPROMISE",
          explanation: `lifecycle ${RUN} ${label} without evidence`,
          incidentReference: `INC-${label}-${RUN}`,
          reauthEvidenceId: randomUUID(),
          idempotencyKey: randomUUID(),
        },
      });
      expect(noEvidence.status, "unknown evidence must be refused").toBeGreaterThanOrEqual(400);

      const evidenceId = await recordEmergencyEvidence(runtime.pool, responder, {
        environment: DEVELOPMENT,
      });
      const response = await call({
        body: {
          credentialId: fixture.credentialId,
          reasonCode: "KEY_COMPROMISE",
          explanation: `lifecycle ${RUN} ${label} real incident`,
          incidentReference: `INC-${label}-${RUN}`,
          reauthEvidenceId: evidenceId,
          idempotencyKey: `lifecycle-${label}-${RUN}`,
        },
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(response.body.outcome).toBe("REVOKED_IMMEDIATELY");
      expect(response.body.revokedCredentialCount).toBe(1);
      const authorizationId = String(response.body.authorizationId ?? "");
      expect(authorizationId).not.toBe("");
      return { authorizationId, evidenceId };
    }

    /** State of one credential in the authoritative database. */
    async function credentialState(
      credentialId: string,
    ): Promise<{ state: string; revoked_at: Date | null }> {
      const { rows } = await keeperClient.query<{ state: string; revoked_at: Date | null }>(
        `select state::text as state, revoked_at from kitluy_devices.device_credentials
      where credential_id = $1::uuid`,
        [credentialId],
      );
      return rows[0] ?? { state: "<missing>", revoked_at: null };
    }

    /**
     * Runs governed credential-life drivers the way their gateways require:
     * one open transaction (their savepoints and internal `set local role`
     * wrappers need it), committed so the lifecycle actually persists. The
     * session role stays postgres, exactly as the package suites run them —
     * gateways that need the issuance service wrap themselves.
     */
    async function governedTx<T>(fn: () => Promise<T>): Promise<T> {
      await keeperClient.query("begin");
      try {
        const out = await fn();
        await keeperClient.query("commit");
        return out;
      } catch (error) {
        await keeperClient.query("rollback").catch(() => undefined);
        throw error;
      }
    }

    /** The overlap boundary on the spine's head row. */
    async function overlapEndOf(deviceRecordId: string): Promise<Date> {
      const { rows } = await keeperClient.query<{ overlap_ends_at: Date }>(
        `select overlap_ends_at from kitluy_devices.device_credential_heads
        where device_record_id = $1::uuid`,
        [deviceRecordId],
      );
      const boundary = rows[0]?.overlap_ends_at;
      expect(boundary, "no overlap window on the head row").toBeDefined();
      return boundary ?? new Date(0);
    }

    /** Lifecycle input for the retirement driver, with trusted time as a VALUE. */
    function lifecycleInput(fixture: IncumbentFixture, trustedTime: Date): LifecycleInput {
      return {
        deviceRecordId: fixture.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        trustedTime: trustedAt(trustedTime),
        actorRef: "PRODUCTION-LIFECYCLE",
        idempotencyKey: `lc-adv-${RUN}-${fixture.credentialId}`,
      };
    }

    /**
     * Does the spine's credential at `generation` verify as a certificate at
     * `at`, with the overlap the authoritative lifecycle grants? Certificate
     * evaluation, not revocation: revocation is the online verifier's job.
     */
    async function generationVerifies(
      fixture: IncumbentFixture,
      generation: number,
      at: Date,
      currentGeneration: number,
    ): Promise<boolean> {
      const repository = pgIncumbentRepository(keeperClient);
      const state = await pgLifecycleReader(keeperClient).loadLifecycleState({
        deviceRecordId: fixture.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
      });
      const credential = await repository.loadCredentialAtGeneration(
        {
          deviceRecordId: fixture.deviceRecordId,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
        },
        generation,
      );
      expect(credential, `no credential at generation ${String(generation)}`).toBeDefined();
      const chain = buildChainFromStoredLinks(
        await repository.loadCredentialChainLinks(credential?.credentialId ?? ""),
      );
      expect(chain, "the stored chain links must rebuild").not.toBeNull();
      const current = await repository.loadCredentialAtGeneration(
        {
          deviceRecordId: fixture.deviceRecordId,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
        },
        currentGeneration,
      );
      const overlap = state === null ? null : permittedOverlapFrom(state, at);
      return evaluateCertificateValidity({
        chain: chain!,
        trustedTime: trustedAt(at),
        environment: DEVELOPMENT,
        deviceRecordId: fixture.deviceRecordId,
        currentKeyFingerprint: current?.publicKeyFingerprint ?? "",
        currentCertificateGeneration: currentGeneration,
        revocations: { isCertificateRevoked: () => false, isDeviceRevoked: () => false },
        trustedRootFingerprints: [fixture.ca.rootCertificate.tbs.subjectFingerprint],
        // After retirement the heads row clears the window; a null boundary is
        // "no overlap", never an object with a null end.
        ...(overlap !== null && overlap.overlapEndsAt ? { permittedOverlap: overlap } : {}),
      }).valid;
    }

    /** Verifies a generation through the PRODUCTION online verifier. */
    async function verifyGenerationOnline(generation: number, at: Date) {
      const repository = pgIncumbentRepository(keeperClient);
      const credential = await repository.loadCredentialAtGeneration(
        {
          deviceRecordId: spine.deviceRecordId,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
        },
        generation,
      );
      if (credential === null || credential === undefined) {
        throw new Error(`no credential at generation ${String(generation)}`);
      }
      const chain = buildChainFromStoredLinks(
        await repository.loadCredentialChainLinks(credential.credentialId),
      );
      if (chain === null || chain === undefined) {
        throw new Error("the chain could not be rebuilt from stored links");
      }
      const verifier = createOnlineCredentialVerifier(runtime.pool);
      return verifier.verify({
        chain,
        trustedTime: trustedAt(at),
        environment: DEVELOPMENT,
        trustedRootFingerprints: [spine.ca.rootCertificate.tbs.subjectFingerprint],
      });
    }

    /**
     * The destruction gateway: every governed call in its own transaction under
     * the issuance service, like the key-destruction suite's gateway but without
     * the shared-transaction savepoint — these calls must COMMIT.
     */
    function pgDestructionGateway(client: pg.PoolClient): KeyDestructionGateway {
      const governed = async (sql: string, params: unknown[]): Promise<Record<string, unknown>> => {
        await client.query("begin");
        try {
          const out = await withRole(client, TEST_ROLES.issuanceService, async () => {
            const result = await client.query<{ result: Record<string, unknown> }>(sql, params);
            return result.rows[0]?.result ?? {};
          });
          await client.query("commit");
          return out;
        } catch (error) {
          await client.query("rollback").catch(() => undefined);
          throw error;
        }
      };
      return {
        async evaluateEligibility(call) {
          return governed(
            `select kitluy_devices.evaluate_key_destruction_eligibility_v1(
             $1::uuid,$2,$3,$4::timestamptz,$5) as result`,
            [
              call.deviceRecordId,
              call.environment,
              call.providerKeyReference,
              call.trustedNow,
              call.trustedTimeStatus,
            ],
          );
        },
        async requestKeyDestruction(call) {
          return governed(
            `select kitluy_devices.request_key_destruction_v1(
             $1,$2::uuid,$3,$4,$5,$6,$7,$8::boolean,$9::timestamptz,$10) as result`,
            [
              call.requestKey,
              call.deviceRecordId,
              call.environment,
              call.purpose,
              call.providerKeyReference,
              call.requestedBy,
              call.requestReason,
              call.reauthenticated,
              call.trustedNow,
              call.trustedTimeStatus,
            ],
          );
        },
        async approveKeyDestruction(call) {
          return governed(
            `select kitluy_devices.approve_key_destruction_v1(
             $1::uuid,$2,$3,$4::boolean,$5::timestamptz,$6) as result`,
            [
              call.destructionRequestId,
              call.approvedBy,
              call.approvalReason,
              call.reauthenticated,
              call.trustedNow,
              call.trustedTimeStatus,
            ],
          );
        },
        async beginKeyDestructionExecution(call) {
          return governed(
            `select kitluy_devices.begin_key_destruction_execution_v1($1::uuid,$2) as result`,
            [call.destructionRequestId, call.executedBy],
          );
        },
        async confirmKeyDestruction(call) {
          return governed(
            `select kitluy_devices.confirm_key_destruction_v1(
             $1::uuid,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz) as result`,
            [
              call.destructionRequestId,
              call.providerResult,
              call.providerReceiptDigest,
              call.providerResponseRef,
              call.observedFingerprint,
              call.observedKeyReference,
              call.executedBy,
              call.startedAt,
              call.finishedAt,
            ],
          );
        },
      };
    }

    beforeAll(async () => {
      runtime = resolveDeviceRevocationService(ENV, { authenticator: switchingAuthenticator });
      keeper = new pg.Pool({ connectionString: LOCAL_DSN, max: 4 });
      keeperClient = await keeper.connect();
      hubPool = new pg.Pool({ connectionString: HUB_DSN, max: 2 });

      const pair = generateKeyPairSync("ed25519");
      snapshotPrivateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      snapshotPublicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();

      await keeperClient.query("begin");
      try {
        // A is issued inside the development renewal window so stage 16's
        // preflight accepts it at `new Date()` without touching any clock.
        spine = await createIncumbentFixture(keeperClient, {
          issuedAtTrustedTime: issuedSoThat(9),
          label: `lc-a-${RUN}`,
        });
        threadB = await createIncumbentFixture(keeperClient, {
          issuedAtTrustedTime: issuedSoThat(9),
          label: `lc-b-${RUN}`,
        });
        threadC = await createIncumbentFixture(keeperClient, {
          issuedAtTrustedTime: issuedSoThat(9),
          label: `lc-c-${RUN}`,
        });
        threadD = await createIncumbentFixture(keeperClient, {
          issuedAtTrustedTime: issuedSoThat(9),
          label: `lc-d-${RUN}`,
        });
        bystander = await createIncumbentFixture(keeperClient, {
          issuedAtTrustedTime: issuedSoThat(9),
          label: `lc-by-${RUN}`,
        });

        // The humans. B's responder holds BOTH grants ON PURPOSE (see the old
        // stage-20 comment: only the self-approval rule itself may refuse them).
        responderB = await createEmergencyActor(keeperClient, {
          environment: DEVELOPMENT,
          actionClasses: [
            "fleet.device_credential.emergency_revoke",
            EMERGENCY_POST_APPROVE_ACTION,
          ],
          label: `lc-resp-b-${RUN}`,
        });
        approverB = await createEmergencyActor(keeperClient, {
          environment: DEVELOPMENT,
          actionClasses: [EMERGENCY_POST_APPROVE_ACTION],
          label: `lc-appr-b-${RUN}`,
        });
        responderC = await createEmergencyActor(keeperClient, {
          environment: DEVELOPMENT,
          actionClasses: ["fleet.device_credential.emergency_revoke"],
          label: `lc-resp-c-${RUN}`,
        });
        refuserC = await createEmergencyActor(keeperClient, {
          environment: DEVELOPMENT,
          actionClasses: [EMERGENCY_POST_APPROVE_ACTION],
          label: `lc-refu-c-${RUN}`,
        });
        responderD = await createEmergencyActor(keeperClient, {
          environment: DEVELOPMENT,
          actionClasses: ["fleet.device_credential.emergency_revoke"],
          label: `lc-resp-d-${RUN}`,
        });
        await keeperClient.query("commit");
      } catch (error) {
        await keeperClient.query("rollback").catch(() => undefined);
        throw error;
      }

      hubScope = {
        tenantId: TENANT_ID,
        digitalStoreId: DIGITAL_STORE_ID,
        storeLocationId: STORE_LOCATION_ID,
        environment: DEVELOPMENT,
        hubDeviceId: "",
      };
    }, 240_000);

    afterAll(async () => {
      console.warn(
        `[lifecycle ${RUN}] correlation=${CORRELATION} executed=${String(executed.size)}/30 ` +
          `stages=[${[...executed].sort((a, b) => a - b).join(",")}]`,
      );
      for (const actor of [responderB, approverB, responderC, refuserC, responderD]) {
        if (actor !== undefined) {
          await disposeEmergencyActor(keeperClient, actor).catch(() => undefined);
        }
      }
      keeperClient?.release();
      await runtime?.shutdown().catch(() => undefined);
      await keeper?.end().catch(() => undefined);
      await hubPool?.end().catch(() => undefined);
    });

    // =========================================================================
    // PROVISIONING (stages 1-6)
    // =========================================================================

    it(stage(1, "Tenant creation"), async () => {
      const { rows } = await keeperClient.query<{ id: string }>(
        `select id::text as id from kitluy_core.tenants where id = $1::uuid`,
        [TENANT_ID],
      );
      expect(rows.length, "the fixture's tenant must exist").toBe(1);
      passed(1);
    });

    it(stage(2, "Digital Store creation"), async () => {
      const { rows } = await keeperClient.query<{ id: string; tenant: string }>(
        `select id::text as id, tenant_id::text as tenant from kitluy_core.digital_stores
      where id = $1::uuid`,
        [DIGITAL_STORE_ID],
      );
      expect(rows.length, "the fixture's digital store must exist").toBe(1);
      expect(rows[0]?.tenant, "the store belongs to the stage-1 tenant").toBe(TENANT_ID);
      passed(2);
    });

    it(stage(3, "Location creation"), async () => {
      const { rows } = await keeperClient.query<{ id: string; store: string }>(
        `select id::text as id, digital_store_id::text as store from kitluy_core.store_locations
      where id = $1::uuid`,
        [STORE_LOCATION_ID],
      );
      expect(rows.length, "the fixture's location must exist").toBe(1);
      expect(rows[0]?.store, "the location belongs to the stage-2 store").toBe(DIGITAL_STORE_ID);
      passed(3);
    });

    it(stage(4, "Store Hub provisioning"), async () => {
      // The governed claim path provisioned the spine's hub-facing identity:
      // create_device_claim_v1 + redeem_device_claim_v1 ran inside the fixture.
      const { rows } = await keeperClient.query<{ n: string }>(
        `select count(*)::text as n from kitluy_devices.device_claims
      where device_id = $1::uuid and redeemed_at is not null`,
        [spine.deviceRecordId],
      );
      expect(
        Number(rows[0]?.n),
        "no redeemed claim: the hub-facing provisioning path never ran for the spine",
      ).toBeGreaterThanOrEqual(1);
      passed(4);
    });

    it(stage(5, "Hub trusted public-key provisioning"), async () => {
      // The Hub trusts exactly this run's PUBLIC key. The private half never
      // leaves this process; the trust registry has no column for one.
      await provisionTrustKey(hubPool, {
        keyId: snapshotKeyId,
        keyVersion: snapshotKeyVersion,
        publicKeyPem: snapshotPublicKeyPem,
        state: "current",
        activatedAt: new Date(),
      });
      const { rows } = await hubPool.query<{ state: string; pem: string }>(
        `select state, public_key_pem as pem from edge_config.revocation_trust_key
      where key_id = $1 and key_version = $2`,
        [snapshotKeyId, snapshotKeyVersion],
      );
      expect(rows.length).toBe(1);
      expect(rows[0]?.state).toBe("current");
      expect(rows[0]?.pem).toContain("PUBLIC KEY");
      expect(rows[0]?.pem).not.toContain("PRIVATE");
      passed(5);
    });

    it(stage(6, "Hub assignment"), async () => {
      const hub = await resolveOwnHub(spine.credentialId);
      hubScope = { ...hubScope, hubDeviceId: hub };
      const { rows } = await keeperClient.query<{
        tenant: string;
        store: string;
        location: string;
        state: string;
      }>(
        `select tenant_id::text as tenant, digital_store_id::text as store,
              store_location_id::text as location, state::text as state
         from kitluy_devices.device_assignments
        where device_id = $1::uuid and state in ('pending_trust','active')`,
        [hubScope.hubDeviceId],
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]?.tenant).toBe(TENANT_ID);
      expect(rows[0]?.store).toBe(DIGITAL_STORE_ID);
      expect(rows[0]?.location).toBe(STORE_LOCATION_ID);
      // Snapshot sequences are monotonic per scope. Earlier runs of this suite
      // committed snapshots for this scope to the shared hub database, and a
      // sequence that is not NEWER is refused — so this run starts above the
      // held maximum, like a real producer that has been running for a while.
      const { rows: seqRows } = await hubPool.query<{ max: string | null }>(
        `select max(sequence_no)::text as max from edge_config.revocation_snapshot
        where tenant_id = $1::uuid and digital_store_id = $2::uuid
          and store_location_id = $3::uuid and environment = $4`,
        [TENANT_ID, DIGITAL_STORE_ID, STORE_LOCATION_ID, DEVELOPMENT],
      );
      snapshotBaseSequence = Number(seqRows[0]?.max ?? "0") + 1;
      passed(6);
    });

    // =========================================================================
    // IDENTITY (stages 7-9)
    // =========================================================================

    it(stage(7, "Device enrollment"), async () => {
      const { rows } = await keeperClient.query<{ id: string; state: string }>(
        `select id::text as id, lifecycle_state::text as state from kitluy_devices.devices
      where id = $1::uuid`,
        [spine.deviceRecordId],
      );
      expect(rows.length, "the spine device was never enrolled").toBe(1);
      expect(rows[0]?.state, "an enrolled device is not retired on arrival").not.toBe("retired");
      passed(7);
    });

    it(stage(8, "Initial credential issuance"), async () => {
      const initial = await credentialState(spine.credentialId);
      expect(initial.state, "the incumbent must be live before the run").not.toBe("revoked");
      expect(initial.revoked_at, "a freshly issued credential must not be revoked").toBeNull();
      expect(spine.serialNumber).not.toBe("");
      passed(8);
    });

    it(stage(9, "Online credential authentication"), async () => {
      // THE PRODUCTION PATH: the verifier built by the composition root, asked
      // with the credential's real chain rebuilt from its stored links.
      const outcome = await verifyGenerationOnline(1, new Date());
      expect(outcome.known, JSON.stringify(outcome)).toBe(true);
      if (!outcome.known) return;
      expect(
        outcome.validity.valid,
        `expected valid, got ${outcome.validity.rejectionCode ?? "?"}: ${outcome.validity.detail ?? ""}`,
      ).toBe(true);
      passed(9);
    });

    // =========================================================================
    // SNAPSHOT CHAIN (stages 10-15)
    // =========================================================================

    it(stage(10, "Signed scope-isolated snapshot production"), async () => {
      const snapshot = await produceSnapshot(1);
      // The scope is DERIVED from the hub, never supplied by the caller.
      expect(snapshot.hubDeviceRecordId).toBe(hubScope.hubDeviceId);
      expect(snapshot.scope.tenantId).toBe(TENANT_ID);
      expect(snapshot.scope.digitalStoreId).toBe(DIGITAL_STORE_ID);
      expect(snapshot.scope.storeLocationId).toBe(STORE_LOCATION_ID);
      expect(snapshot.scope.environment).toBe(DEVELOPMENT);
      // Nothing is revoked yet, so the scoped set must be empty of every serial
      // this run owns — a snapshot that listed one now would be leaking.
      expect(snapshot.revokedCertificateSerials).not.toContain(spine.serialNumber);
      expect(snapshot.revokedCertificateSerials).not.toContain(threadB.serialNumber);
      expect(snapshot.signature.signature.length).toBeGreaterThan(0);
      passed(10);
    });

    it(stage(11, "Snapshot transfer to assigned Hub"), async () => {
      const snapshot = await produceSnapshot(1);
      const applied = await applySignedSnapshot(hubPool, hubScope, snapshot, [
        {
          keyId: snapshotKeyId,
          keyVersion: snapshotKeyVersion,
          algorithm: snapshot.signature.algorithm,
          publicKeyPem: snapshotPublicKeyPem,
          state: "current",
        },
      ]);
      expect(applied.applied, JSON.stringify(applied)).toBe(true);
      passed(11);
    });

    it(stage(12, "Signature verification"), async () => {
      const snapshot = await produceSnapshot(1);
      const trusted: TrustedSnapshotKey = {
        keyId: snapshotKeyId,
        keyVersion: snapshotKeyVersion,
        algorithm: snapshot.signature.algorithm,
        publicKeyPem: snapshotPublicKeyPem,
        state: "current",
      };
      const { signature, ...body } = snapshot;
      const verification = verifySnapshotSignature(body, signature, [trusted]);
      expect(verification.verified, JSON.stringify(verification)).toBe(true);
      // ...and a snapshot with NO envelope fails closed, not with an exception.
      const missing = verifySnapshotSignature(body, undefined as never, [trusted]);
      expect(missing.verified).toBe(false);
      passed(12);
    });

    it(stage(13, "Tenant/Store/Location/environment verification"), async () => {
      const snapshot = await produceSnapshot(1);
      const trusted: TrustedSnapshotKey = {
        keyId: snapshotKeyId,
        keyVersion: snapshotKeyVersion,
        algorithm: snapshot.signature.algorithm,
        publicKeyPem: snapshotPublicKeyPem,
        state: "current",
      };
      // A snapshot naming ANOTHER tenant is refused on scope grounds BEFORE the
      // signature is even consulted (scope-before-signature is the design).
      const foreign = { ...snapshot, scope: { ...snapshot.scope, tenantId: randomUUID() } };
      const refused = await applySignedSnapshot(hubPool, hubScope, foreign, [trusted]);
      expect(refused.applied).toBe(false);
      if (!refused.applied) {
        expect(refused.reason).toBe("SCOPE_TENANT_MISMATCH");
      }
      // The hub's own snapshot applies.
      const own = await applySignedSnapshot(hubPool, hubScope, snapshot, [trusted]);
      expect(own.applied || (!own.applied && own.reason === "SEQUENCE_NOT_NEWER")).toBe(true);
      passed(13);
    });

    it(stage(14, "Governed atomic snapshot persistence"), async () => {
      const { rows } = await hubPool.query<{ state: string; seq: string }>(
        `select state, sequence_no::text as seq from edge_config.revocation_snapshot
      where tenant_id = $1::uuid and digital_store_id = $2::uuid
        and store_location_id = $3::uuid and environment = $4`,
        [TENANT_ID, DIGITAL_STORE_ID, STORE_LOCATION_ID, DEVELOPMENT],
      );
      const active = rows.filter((r) => r.state === "active");
      expect(active.length, "exactly one active snapshot after transfer").toBe(1);
      // Re-applying the SAME sequence is refused and preserves last-known-good.
      const snapshot = await produceSnapshot(1);
      const trusted: TrustedSnapshotKey = {
        keyId: snapshotKeyId,
        keyVersion: snapshotKeyVersion,
        algorithm: snapshot.signature.algorithm,
        publicKeyPem: snapshotPublicKeyPem,
        state: "current",
      };
      const stale = await applySignedSnapshot(hubPool, hubScope, snapshot, [trusted]);
      expect(stale.applied).toBe(false);
      expect(stale.lastKnownGoodPreserved).toBe(true);
      const after = await hubPool.query<{ state: string }>(
        `select state from edge_config.revocation_snapshot
      where tenant_id = $1::uuid and digital_store_id = $2::uuid
        and store_location_id = $3::uuid and environment = $4`,
        [TENANT_ID, DIGITAL_STORE_ID, STORE_LOCATION_ID, DEVELOPMENT],
      );
      expect(after.rows.filter((r) => r.state === "active").length).toBe(1);
      passed(14);
    });

    it(stage(15, "Offline credential authentication"), async () => {
      const decision = await decideOffline(hubPool, hubScope, spine.serialNumber, {
        now: new Date(),
        maxAgeHours: 72,
      });
      // The spine is not revoked yet, and the hub holds a fresh snapshot.
      expect(decision.decision, JSON.stringify(decision)).toBe("ALLOW");
      passed(15);
    });

    // =========================================================================
    // CREDENTIAL LIFE ON THE SPINE (stages 16-20)
    // =========================================================================

    it(stage(16, "Same-key renewal"), async () => {
      const renewal = await governedTx(() =>
        completeSameKeyCredentialRenewal(
          {
            deviceRecordId: spine.deviceRecordId,
            environment: DEVELOPMENT,
            purpose: DEVICE_IDENTITY,
            idempotencyKey: `lc-sk-${RUN}-${spine.credentialId}`,
            actorRef: "PRODUCTION-LIFECYCLE",
            trustedTime: trustedAt(new Date()),
            trustedRootFingerprints: [spine.ca.rootCertificate.tbs.subjectFingerprint],
            currentAssignmentGeneration: spine.assignmentGeneration,
          },
          pgIncumbentRepository(keeperClient),
          pgReservationGateway(keeperClient),
          pgIssuanceGateway(keeperClient),
          spine.ca,
          spine.signer,
        ),
      );
      expect(renewal.outcome, JSON.stringify(renewal)).toBe("RENEWED");
      // A renewal's overlap ENDS, and ending it is part of the renewal: the
      // previous credential retires at its own boundary. The boundary is read
      // BEFORE the rotation overwrites the head's window at stage 17.
      const sameKeyBoundary = await overlapEndOf(spine.deviceRecordId);
      const retired = await governedTx(() =>
        advanceDeviceCredentialLifecycle(
          lifecycleInput(spine, sameKeyBoundary),
          pgLifecycleReader(keeperClient),
          pgLifecycleGateway(keeperClient),
        ),
      );
      expect(retired.classification, JSON.stringify(retired)).toBe("PREVIOUS_CREDENTIAL_RETIRED");
      const { rows } = await keeperClient.query<{ s: string }>(
        `select string_agg(state::text || ':' || certificate_generation::text, ','
                         order by certificate_generation) s
         from kitluy_devices.device_credentials where device_record_id = $1::uuid`,
        [spine.deviceRecordId],
      );
      expect(rows[0]?.s, "the renewal retires the previous credential at its boundary").toBe(
        "superseded:1,issued:2",
      );
      passed(16);
    });

    it(stage(17, "Key rotation"), async () => {
      rotationProvider = new DevelopmentReplacementKeyProvider();
      // The renewed credential's window reset at stage 16, so at real `now` the
      // spine is OUTSIDE the 10-day renewal window. Trusted time is a VALUE: the
      // first rotation runs at +21 days and the second at +42, each with exactly
      // 9 days remaining — the same window position the package suites rotate
      // at. TWO rotations, because stage 29's destruction needs a SUPERSEDED
      // replacement key, and one rotation only supersedes the shared original.
      const rotateAt = async (daysAhead: number, tag: string) => {
        const at = new Date(Date.now() + daysAhead * MS_PER_DAY);
        const outcome = await completeRotateKeyCredentialRenewal(
          {
            deviceRecordId: spine.deviceRecordId,
            environment: DEVELOPMENT,
            purpose: DEVICE_IDENTITY,
            idempotencyKey: `lc-rot-${tag}-${RUN}-${spine.credentialId}`,
            actorRef: "PRODUCTION-LIFECYCLE",
            trustedTime: trustedAt(at),
            trustedRootFingerprints: [spine.ca.rootCertificate.tbs.subjectFingerprint],
            currentAssignmentGeneration: spine.assignmentGeneration,
          },
          pgIncumbentRepository(keeperClient),
          pgReservationGateway(keeperClient),
          pgRotationGateway(keeperClient),
          pgIssuanceGateway(keeperClient),
          spine.ca,
          rotationProvider,
        );
        return { at, outcome };
      };
      const second = await governedTx(async () => {
        // Rotation is owner-decision gated. The enable, the rotations and the
        // restore commit in ONE transaction, so the policy never observably
        // changes for any other session — the committed delta is the rotations
        // themselves, not a policy flip a concurrent suite could trip over.
        await enableDevelopmentRotation(keeperClient);
        const first = await rotateAt(21, "a");
        expect(first.outcome.outcome, JSON.stringify(first.outcome)).toBe("ROTATED");
        // The gen-2 overlap with gen 3 is ended before the second rotation, so
        // no unretired overlap is carried into it.
        const firstBoundary = await overlapEndOf(spine.deviceRecordId);
        const retireGen2 = await advanceDeviceCredentialLifecycle(
          lifecycleInput(spine, firstBoundary),
          pgLifecycleReader(keeperClient),
          pgLifecycleGateway(keeperClient),
        );
        expect(retireGen2.classification, JSON.stringify(retireGen2)).toBe(
          "PREVIOUS_CREDENTIAL_RETIRED",
        );
        const next = await rotateAt(42, "b");
        expect(next.outcome.outcome, JSON.stringify(next.outcome)).toBe("ROTATED");
        await restoreDevelopmentRotation(keeperClient);
        rotationTrustedTime = next.at;
        return next;
      });
      expect(second.outcome.outcome, JSON.stringify(second.outcome)).toBe("ROTATED");
      const { rows } = await keeperClient.query<{ s: string }>(
        `select string_agg(state::text || ':' || generation::text, ',' order by generation) s
         from kitluy_devices.device_generation_keys where device_record_id = $1::uuid`,
        [spine.deviceRecordId],
      );
      // The shared original and the first rotation key are superseded; the
      // second rotation key is active. Never two active, never none.
      expect(rows[0]?.s, "each rotation supersedes exactly one key").toBe(
        "superseded:1,superseded:3,active:4",
      );
      passed(17);
    });

    it(stage(18, "Credential overlap creation and verification"), async () => {
      const boundary = await overlapEndOf(spine.deviceRecordId);
      expect(
        boundary.getTime(),
        "rotation must grant an overlap window that extends past the rotation instant",
      ).toBeGreaterThan(rotationTrustedTime.getTime());
      // DURING the overlap both the previous and the current credential verify.
      const during = new Date(rotationTrustedTime.getTime() + MS_PER_DAY);
      expect(await generationVerifies(spine, 3, during, 4)).toBe(true);
      expect(await generationVerifies(spine, 4, during, 4)).toBe(true);
      passed(18);
    });

    it(stage(19, "Credential retirement"), async () => {
      const boundary = await overlapEndOf(spine.deviceRecordId);
      const retired = await governedTx(() =>
        advanceDeviceCredentialLifecycle(
          lifecycleInput(spine, boundary),
          pgLifecycleReader(keeperClient),
          pgLifecycleGateway(keeperClient),
        ),
      );
      expect(retired.classification, JSON.stringify(retired)).toBe("PREVIOUS_CREDENTIAL_RETIRED");
      // The previous credential no longer authenticates AT the boundary; the
      // current one still does. Retirement is not revocation: state, not time.
      expect(await generationVerifies(spine, 3, boundary, 4)).toBe(false);
      expect(await generationVerifies(spine, 4, boundary, 4)).toBe(true);
      passed(19);
    });

    it(stage(20, "Governed normal revocation"), async () => {
      // The spine's CURRENT credential is generation 3 (same-key, then rotation).
      const { rows: currentRows } = await keeperClient.query<{
        credential: string;
        serial: string;
      }>(
        `select credential_id::text as credential, serial_number as serial
         from kitluy_devices.device_credentials
        where device_record_id = $1::uuid and certificate_generation = 4`,
        [spine.deviceRecordId],
      );
      expect(currentRows.length, "the rotated credential must exist").toBe(1);
      revokedSpineCredentialId = currentRows[0]?.credential ?? "";
      revokedSpineSerial = currentRows[0]?.serial ?? "";

      // The DATABASE derives the affected set — the approval is bound to that
      // digest, never to a caller-supplied one. The borrow is handed back before
      // commit, exactly as the production-composition suite does it.
      let scope: Record<string, unknown> = {};
      await keeperClient.query("begin");
      try {
        await keeperClient.query(
          `do $borrow$ begin execute format('grant kitluy_credential_issuer to %I', current_user); end $borrow$;`,
        );
        await keeperClient.query("set local role kitluy_credential_issuer");
        const { rows } = await keeperClient.query<{ result: Record<string, unknown> }>(
          `select kitluy_devices.authoritative_revocation_scope_v1(
           $1::uuid, 'ADMINISTRATIVE_REPLACEMENT') as result`,
          [revokedSpineCredentialId],
        );
        scope = rows[0]?.result ?? {};
        await keeperClient.query("reset role");
        await keeperClient.query(
          `do $handback$ begin
           if pg_has_role(current_user, 'kitluy_credential_issuer', 'MEMBER') then
             execute format('revoke kitluy_credential_issuer from %I', current_user);
           end if;
         exception when insufficient_privilege then
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

      // A REAL four-eyes approval, bound to the database-derived digest.
      const { rows: policyRows } = await keeperClient.query<{ id: string }>(
        `insert into kitluy_auth.approval_policies
         (policy_key, version, permission_key, environment, quorum, status, risk_class)
       values ($1, 1, 'device.credential.revoke', $2, 1, 'ACTIVE', 'A4')
       returning id`,
        [`cred.revocation.a4.lifecycle.${RUN}`, DEVELOPMENT],
      );
      const { rows: approvalRows } = await keeperClient.query<{ id: string }>(
        `insert into kitluy_auth.approval_requests
         (policy_id, requester_id, resource_type, resource_id, environment, action,
          payload_hash, reason, status)
       values ($1::uuid, '00000000-0000-4000-8000-000000000007', 'device', $2::uuid, $3,
               'device_credential_revocation', $4, 'production lifecycle fixture', 'APPROVED')
       returning id`,
        [policyRows[0]?.id, spine.deviceRecordId, DEVELOPMENT, String(scope.payload_hash ?? "")],
      );
      const approvalId = approvalRows[0]?.id ?? "";
      await keeperClient.query(
        `insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
       values ($1::uuid, '00000000-0000-4000-8000-000000000009', 'APPROVE')`,
        [approvalId],
      );

      // THE PRODUCTION CALL: revokeNormal -> createPgRevocationGateway ->
      // revoke_device_credential_bound_v1, as kitluy_issuance_service.
      const result = await runtime.service.revokeNormal({
        revocationRequestId: `lc-normal-${RUN}`,
        deviceRecordId: spine.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        credentialGeneration: 4,
        reasonCode: "ADMINISTRATIVE_REPLACEMENT",
        reason: `lifecycle ${RUN}: the spine's life ends in a governed normal revocation`,
        recoveryDisposition: "REPROVISION_REQUIRED",
        requestedBy: "requester@lifecycle",
        source: "PRODUCTION_LIFECYCLE_SUITE",
        approvalRequestId: approvalId,
        approvedBy: "approver@lifecycle",
        incidentReference: `INC-LIFECYCLE-${RUN}`,
        incidentScopeId:
          typeof scope.incident_scope_id === "string" ? scope.incident_scope_id : null,
      });
      expect(result.outcome, JSON.stringify(result)).toBe("REVOKED");

      const { rows } = await keeperClient.query<{ state: string; gen: number }>(
        `select state::text as state, certificate_generation as gen
         from kitluy_devices.device_credentials
        where credential_id = $1::uuid`,
        [revokedSpineCredentialId],
      );
      expect(rows[0]?.gen).toBe(4);
      expect(rows[0]?.state).toBe("revoked");

      // CANNOT authenticate online: revocation is checked before expiry. The
      // verify runs inside the rotated credential's window (stage 17 ran at +42d).
      const denied = await verifyGenerationOnline(
        4,
        new Date(rotationTrustedTime.getTime() + MS_PER_DAY),
      );
      expect(denied.known).toBe(true);
      if (denied.known) {
        expect(denied.validity.valid, "a revoked credential must not authenticate online").toBe(
          false,
        );
        expect(denied.validity.rejectionCode).toBe("CERT_REVOKED");
      }
      // CANNOT be un-revoked by any runtime identity (the write path is absent).
      const { rows: writers } = await keeperClient.query<{ role: string }>(
        `select r.rolname as role
         from (values ('kitluy_issuance_service'),('kitluy_worker_service'),
                      ('authenticated'),('anon'),('service_role')) as r(rolname)
        where has_table_privilege(r.rolname, 'kitluy_devices.device_credentials', 'UPDATE')`,
      );
      expect(
        writers,
        `roles able to UPDATE credentials directly: ${JSON.stringify(writers)}`,
      ).toEqual([]);
      passed(20);
    });

    // =========================================================================
    // EMERGENCY THREADS (stages 21-26)
    // =========================================================================

    it(stage(21, "Governed emergency revocation"), async () => {
      const outcome = await emergencyThroughRoute(threadB, responderB, "B");
      authorizationB = outcome.authorizationId;
      evidenceB = outcome.evidenceId;
      const state = await credentialState(threadB.credentialId);
      expect(state.state).toBe("revoked");
      expect(state.revoked_at).not.toBeNull();
      // The evidence went ACTIVE -> CONSUMED exactly once, bound to B's authorization.
      const evidence = await readEvidence(keeperClient, evidenceB);
      expect(evidence?.lifecycleState).toBe("CONSUMED");
      const { rows } = await keeperClient.query<{ n: string }>(
        `select count(*)::text as n from kitluy_auth.reauthentication_evidence
      where evidence_id = $1::uuid and consumed_for_authorization = $2::uuid`,
        [evidenceB, authorizationB],
      );
      expect(rows[0]?.n).toBe("1");
      // The scope contains exactly B's credential: the bystander, C and D are untouched.
      const { rows: scope } = await keeperClient.query<{ credential: string }>(
        `select credential_id::text as credential
         from kitluy_devices.device_emergency_revocation_scope
        where authorization_id = $1::uuid`,
        [authorizationB],
      );
      expect(scope.map((r) => r.credential)).toEqual([threadB.credentialId]);
      for (const other of [threadC, threadD, bystander]) {
        expect((await credentialState(other.credentialId)).revoked_at).toBeNull();
      }
      // The fleet-wide truth now lists the revoked and still excludes the live.
      const revoked = await revokedSerialsFleetWide(keeperClient);
      expect(revoked).toContain(threadB.serialNumber);
      expect(revoked).not.toContain(threadC.serialNumber);
      expect(revoked).not.toContain(bystander.serialNumber);
      passed(21);
    });

    it(stage(22, "Durable lapse-job scheduling"), async () => {
      const { rows } = await keeperClient.query<{ n: string; environment: string }>(
        `select count(*)::text as n, min(environment) as environment
         from kitluy_ops.durable_jobs
        where job_kind = 'kitluy.devices.emergency-post-approval-lapse.v1'
          and dedupe_key like '%' || $1 || '%'`,
        [authorizationB],
      );
      expect(rows[0]?.n, "the emergency must schedule its own lapse obligation").toBe("1");
      expect(rows[0]?.environment).toBe(DEVELOPMENT);
      // The obligation is PENDING with a future deadline, visible on the status route.
      const status = await runtime.service.readEmergencyStatus(authorizationB);
      expect(status?.postApprovalDecision).toBe("PENDING");
      expect(status?.postApprovalDueAt.getTime()).toBeGreaterThan(Date.now());
      const route = await call({ method: "GET", path: `${EMERGENCY_PREFIX}/${authorizationB}` });
      expect(route.status).toBe(200);
      expect(route.body.postApprovalDecision).toBe("PENDING");
      passed(22);
    });

    it(stage(23, "Distinct-human APPROVE"), async () => {
      // The FIRST RESPONDER cannot post-approve their own emergency. They hold
      // BOTH grants, so only the self-approval rule itself can refuse them.
      currentPrincipal = responderB.userId;
      const selfEvidence = await recordEmergencyEvidence(runtime.pool, responderB, {
        environment: DEVELOPMENT,
        actionClass: EMERGENCY_POST_APPROVE_ACTION,
      }).catch(() => null);
      const selfResponse = await call({
        path: `${EMERGENCY_PREFIX}/${authorizationB}/post-approval`,
        body: { decision: "APPROVE", reauthEvidenceId: selfEvidence ?? randomUUID() },
      });
      expect(selfResponse.status).toBeGreaterThanOrEqual(400);
      expect(
        JSON.stringify(selfResponse.body),
        "the refusal must be the SELF rule, not a missing permission",
      ).toContain("SELF");

      // A SECOND, DISTINCT human approves. The verdict names them, and only them.
      currentPrincipal = approverB.userId;
      const evidence = await recordEmergencyEvidence(runtime.pool, approverB, {
        environment: DEVELOPMENT,
        actionClass: EMERGENCY_POST_APPROVE_ACTION,
      });
      const response = await call({
        path: `${EMERGENCY_PREFIX}/${authorizationB}/post-approval`,
        body: { decision: "APPROVE", reauthEvidenceId: evidence, note: `lifecycle ${RUN}` },
      });
      expect(response.status, JSON.stringify(response.body)).toBeLessThan(400);
      expect(response.body.outcome).toBe("POST_APPROVED");
      const { rows } = await keeperClient.query<{ decider: string | null; verdict: string }>(
        `select actor_user_id::text as decider, verdict::text as verdict
         from kitluy_devices.device_emergency_post_approval_verdicts
        where authorization_id = $1::uuid`,
        [authorizationB],
      );
      expect(rows.length).toBe(1);
      expect(rows[0]?.decider).toBe(approverB.userId);
      expect(rows[0]?.verdict).toBe("APPROVED");

      // Terminal: a conflicting second verdict is ALREADY_DECIDED, and B stays revoked.
      const second = await call({
        path: `${EMERGENCY_PREFIX}/${authorizationB}/post-approval`,
        body: {
          decision: "REFUSE",
          reauthEvidenceId: await recordEmergencyEvidence(runtime.pool, approverB, {
            environment: DEVELOPMENT,
            actionClass: EMERGENCY_POST_APPROVE_ACTION,
          }),
        },
      });
      expect(second.body.outcome).toBe("ALREADY_DECIDED");
      const lapseTooLate = await runtime.service.lapseEmergencyPostApproval(authorizationB);
      expect(lapseTooLate.outcome).toBe("ALREADY_DECIDED");
      expect((await credentialState(threadB.credentialId)).state).toBe("revoked");
      passed(23);
    });

    it(stage(24, "Distinct-human REFUSE"), async () => {
      const outcome = await emergencyThroughRoute(threadC, responderC, "C");
      authorizationC = outcome.authorizationId;
      const statusBefore = await runtime.service.readEmergencyStatus(authorizationC);
      const dueAt = statusBefore?.postApprovalDueAt;

      currentPrincipal = refuserC.userId;
      const evidence = await recordEmergencyEvidence(runtime.pool, refuserC, {
        environment: DEVELOPMENT,
        actionClass: EMERGENCY_POST_APPROVE_ACTION,
      });
      const response = await call({
        path: `${EMERGENCY_PREFIX}/${authorizationC}/post-approval`,
        body: { decision: "REFUSE", reauthEvidenceId: evidence, note: `refuse ${RUN}` },
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body.outcome).toBe("MANUAL_SECURITY_REVIEW");
      expect(response.body.postApprovalDecision).toBe("REFUSED");

      const { rows } = await keeperClient.query<{
        decider: string | null;
        verdict: string;
        escalation: string | null;
      }>(
        `select actor_user_id::text as decider, verdict::text as verdict, escalation_reason as escalation
         from kitluy_devices.device_emergency_post_approval_verdicts
        where authorization_id = $1::uuid`,
        [authorizationC],
      );
      expect(rows.length, "exactly one REFUSE verdict").toBe(1);
      expect(rows[0]?.decider).toBe(refuserC.userId);
      expect(rows[0]?.decider).not.toBe(responderC.userId);
      expect(rows[0]?.verdict).toBe("REFUSED");
      expect(rows[0]?.escalation ?? "", "a REFUSE must escalate").not.toBe("");
      // The deadline was NOT extended or reset by the refusal.
      const statusAfter = await runtime.service.readEmergencyStatus(authorizationC);
      expect(statusAfter?.postApprovalDueAt.toISOString()).toBe(dueAt?.toISOString());
      // REFUSE does not restore: C stays revoked.
      expect((await credentialState(threadC.credentialId)).state).toBe("revoked");
      passed(24);
    });

    it(stage(25, "Missing or late post-approval lapse"), async () => {
      const outcome = await emergencyThroughRoute(threadD, responderD, "D");
      authorizationD = outcome.authorizationId;
      // Nobody comes. The deadline is moved EARLIER — the only direction the
      // group-0152 trigger permits, and the reverse is proved refused inline.
      await keeperClient.query(
        `update kitluy_devices.device_emergency_revocation_authorizations
          set post_approval_due_at = executed_at - interval '1 minute'
        where authorization_id = $1::uuid`,
        [authorizationD],
      );
      await expect(
        keeperClient.query(
          `update kitluy_devices.device_emergency_revocation_authorizations
            set post_approval_due_at = post_approval_due_at + interval '10 years'
          where authorization_id = $1::uuid`,
          [authorizationD],
        ),
      ).rejects.toThrow();

      const result = await runtime.service.lapseEmergencyPostApproval(authorizationD);
      expect(result.outcome, JSON.stringify(result)).toBe("LAPSED");
      const { rows } = await keeperClient.query<{
        verdict: string;
        actor: string | null;
        escalation: string | null;
      }>(
        `select verdict::text as verdict, actor_user_id::text as actor, escalation_reason as escalation
         from kitluy_devices.device_emergency_post_approval_verdicts
        where authorization_id = $1::uuid`,
        [authorizationD],
      );
      expect(rows.length).toBe(1);
      expect(rows[0]?.verdict).toBe("LAPSED");
      // A lapse must never invent an approver.
      expect(rows[0]?.actor, "a lapse has NO human attributed").toBeNull();
      expect(rows[0]?.escalation ?? "", "a lapse must escalate").not.toBe("");
      // The lapse does not restore: D stays revoked.
      expect((await credentialState(threadD.credentialId)).state).toBe("revoked");
      passed(25);
    });

    it(stage(26, "MANUAL_SECURITY_REVIEW escalation"), async () => {
      // REFUSE (24) and LAPSED (25) both landed in manual security review with
      // escalation evidence, no duplicate escalation, and no restoration anywhere.
      const statusC = await runtime.service.readEmergencyStatus(authorizationC);
      const statusD = await runtime.service.readEmergencyStatus(authorizationD);
      expect(statusC?.postApprovalDecision).toBe("REFUSED");
      expect(statusD?.postApprovalDecision).toBe("LAPSED");
      const { rows } = await keeperClient.query<{ n: string }>(
        `select count(*)::text as n from kitluy_devices.device_emergency_post_approval_verdicts
      where authorization_id = any($1::uuid[])`,
        [[authorizationC, authorizationD]],
      );
      expect(rows[0]?.n, "exactly one terminal verdict per obligation").toBe("2");
      for (const thread of [threadC, threadD]) {
        expect((await credentialState(thread.credentialId)).state).toBe("revoked");
      }

      // Residue census: the run's unspent ACTIVE evidence is bounded and
      // enumerated (the deliberately unspent rows: B self-approval attempt, B's
      // conflicting post-decision REFUSE evidence). Everything else was consumed.
      const actors = [responderB, approverB, responderC, refuserC, responderD].map((a) => a.userId);
      const { rows: liveEvidence } = await keeperClient.query<{ n: string }>(
        `select count(*)::text as n from kitluy_auth.reauthentication_evidence
        where actor_user_id = any($1::uuid[])
          and lifecycle_state = 'ACTIVE'
          and consumed_at is null and revoked_at is null and superseded_at is null
          and expires_at > kitluy_ops.authoritative_now_v1()`,
        [actors],
      );
      expect(
        Number(liveEvidence[0]?.n),
        "more live evidence survives than this run can account for",
      ).toBeLessThanOrEqual(3);

      // Drain THIS run's three lapse jobs to terminal. Each emergency enqueued a
      // due-now job; decided obligations claim as NO_ACTION_REQUIRED (terminal),
      // and leaving them queued is exactly the residue that starves the older
      // lapse suite's claim batch in a shared database.
      const worker = createEmergencyLapseWorker({
        gateway: runtime.jobGateway,
        service: runtime.service,
        identity: {
          serviceIdentity: "kitluy-device-registry-service",
          workerInstanceId: `lifecycle-${RUN}`,
          environment: DEVELOPMENT,
          softwareVersion: "0.1.0",
        },
        lease: { leaseId: randomUUID(), leaseOwner: `lifecycle-${RUN}`, leaseSeconds: 60 },
        clock: { now: () => new Date() },
        jitter: { next: () => 0 },
        maxJobs: 50,
      });
      await worker.runOnce();
      const { rows: jobRows } = await keeperClient.query<{ status: string; n: string }>(
        `select status::text as status, count(*)::text as n
         from kitluy_ops.durable_jobs
        where job_kind = 'kitluy.devices.emergency-post-approval-lapse.v1'
          and subject_id = any($1::uuid[])
        group by status`,
        [[authorizationB, authorizationC, authorizationD]],
      );
      expect(
        jobRows,
        `this run's lapse jobs must all be terminal: ${JSON.stringify(jobRows)}`,
      ).toEqual([{ status: "completed", n: "3" }]);
      passed(26);
    });

    // =========================================================================
    // ENDINGS (stages 27-30)
    // =========================================================================

    it(stage(27, "Recovery disposition"), async () => {
      // The spine's normal revocation recorded its recovery disposition.
      const { rows } = await keeperClient.query<{ disposition: string }>(
        `select recovery_disposition::text as disposition
         from kitluy_devices.device_credential_revocations
        where device_record_id = $1::uuid
        order by occurred_at desc limit 1`,
        [spine.deviceRecordId],
      );
      expect(rows.length, "the revocation left no record").toBe(1);
      expect(rows[0]?.disposition).toBe("REPROVISION_REQUIRED");
      // There is NO governed path that reinstates a revoked credential: no
      // function in the schema can even be named for it.
      const { rows: reinstate } = await keeperClient.query<{ name: string }>(
        `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'kitluy_devices'
          and (p.proname like '%reinstate%' or p.proname like '%restore%' or p.proname like '%unrevoke%')`,
      );
      expect(
        reinstate,
        `a restore path exists: ${JSON.stringify(reinstate.map((r) => r.name))}`,
      ).toEqual([]);
      // And the disposition changed nothing about the terminal fact.
      const { rows: revokedRow } = await keeperClient.query<{ state: string }>(
        `select state::text as state from kitluy_devices.device_credentials
        where credential_id = $1::uuid`,
        [revokedSpineCredentialId],
      );
      expect(revokedRow[0]?.state).toBe("revoked");
      passed(27);
    });

    it(stage(28, "Replacement credential issuance"), async () => {
      // REPROVISION_REQUIRED means what it says: a NEW credential issues for the
      // spine's device through the same governed issuance door, and the revoked
      // one stays revoked.
      const provider = new DevelopmentDeviceKeyProvider();
      const keyHandle = `lc-repl-${RUN}` as Parameters<
        DevelopmentDeviceKeyProvider["generateDeviceKey"]
      >[0];
      await provider.generateDeviceKey(keyHandle, DEVELOPMENT);
      const publicKeyPem = provider.publicKeyPem(keyHandle) ?? "";
      const fingerprint = publicKeyFingerprint(publicKeyPem);
      const suffix = randomUUID();
      const requestId = `rq-repl-${RUN}-${suffix}`;
      const preimage = Buffer.from(
        `kitluy.csr.v1\n${spine.deviceRecordId}\n${fingerprint}`,
        "utf8",
      );
      const popSignature = provider.provePossession(keyHandle, preimage);
      const popServiceVerified = verifyDetachedSignature(publicKeyPem, preimage, popSignature);

      const issued = await governedTx(async () => {
        // The replacement credential is generation 5, and its key registers at
        // the SAME generation — generation 4 already holds the second rotation
        // key.
        await keeperClient.query(
          `select kitluy_devices.register_generation_key_v1($1::uuid, $2, $3, $4::integer, $5, $6, $7)`,
          [
            spine.deviceRecordId,
            DEVELOPMENT,
            DEVICE_IDENTITY,
            5,
            `dev-device:${String(keyHandle)}`,
            publicKeyPem,
            fingerprint,
          ],
        );
        return runGovernedIssuance(
          {
            requestId,
            deviceRecordId: spine.deviceRecordId,
            environment: DEVELOPMENT,
            purpose: DEVICE_IDENTITY,
            assignmentGeneration: spine.assignmentGeneration,
            publicKeyPem,
            publicKeyFingerprint: fingerprint,
            idempotencyKey: sha256HexLocal(`idem-repl-${RUN}-${suffix}`),
            canonicalPayloadHash: sha256HexLocal(`canonical-repl-${RUN}-${suffix}`),
            popAlgorithm: "ed25519",
            popSignedPreimageHash: createHash("sha256").update(preimage).digest("hex"),
            popSignature,
            popServiceVerified,
            issuerKeyId: spine.ca.intermediateKeyId,
            trustedTime: new Date(),
            trustedTimeStatus: "trusted",
            actorRef: `ISSUANCE-REPL-${RUN}`,
            hardwareTrustLevel: "development_software",
          },
          pgIssuanceGateway(keeperClient),
          spine.ca,
        );
      });
      expect(issued.outcome, JSON.stringify(issued)).toBe("ISSUED");

      const { rows } = await keeperClient.query<{ credential: string; state: string; gen: number }>(
        `select credential_id::text as credential, state::text as state, certificate_generation as gen
         from kitluy_devices.device_credentials
        where device_record_id = $1::uuid order by certificate_generation desc limit 1`,
        [spine.deviceRecordId],
      );
      expect(rows[0]?.state, "the replacement is live").toBe("issued");
      expect(
        Number(rows[0]?.gen),
        "the replacement is a NEW generation, not a revival",
      ).toBeGreaterThan(4);
      replacementCredentialId = rows[0]?.credential ?? "";
      expect(replacementCredentialId).not.toBe(revokedSpineCredentialId);
      // ...and the revoked generation stays revoked.
      const { rows: stillRevoked } = await keeperClient.query<{ state: string }>(
        `select state::text as state from kitluy_devices.device_credentials
        where credential_id = $1::uuid`,
        [revokedSpineCredentialId],
      );
      expect(stillRevoked[0]?.state).toBe("revoked");
      passed(28);
    });

    it(stage(29, "Provider-key destruction and reconciliation"), async () => {
      // The destruction target is the FIRST rotation key (credential generation
      // 3): state superseded, no issued credential references it (stage 19
      // retired it), no abandon reason — the only basis the confirm path's
      // constraint accepts — and key_generation populated, which the request
      // requires. Destruction is retention-gated: it needs a verified terminal
      // recovery (a recorded renewal reconciliation — the stage's reconciliation
      // half).
      const { rows: keys } = await keeperClient.query<{
        handle: string;
        fingerprint: string;
        keyGeneration: number | null;
        state: string;
      }>(
        `select key_handle as handle, public_key_fingerprint as fingerprint,
              key_generation as "keyGeneration", state::text as state
         from kitluy_devices.device_generation_keys
        where device_record_id = $1::uuid and generation = 3`,
        [spine.deviceRecordId],
      );
      expect(keys.length, "the first rotation key must exist").toBe(1);
      expect(keys[0]?.state).toBe("superseded");

      // The verified terminal recovery: one real reconciliation record through
      // the governed function, against the spine's latest renewal attempt.
      const { rows: reservations } = await keeperClient.query<{ attempt: string }>(
        `select renewal_attempt_id::text as attempt from kitluy_devices.device_renewal_reservations
        where device_record_id = $1::uuid order by created_at desc limit 1`,
        [spine.deviceRecordId],
      );
      expect(reservations.length, "the renewals left no attempt").toBe(1);
      await governedTx(async () => {
        await withRole(keeperClient, TEST_ROLES.issuanceService, async () => {
          await keeperClient.query(
            `select kitluy_devices.record_renewal_reconciliation_v1(
             $1::uuid,'CONSISTENT','CONSISTENT','CONSISTENT','NONE','NONE','NONE',null,
             'PRODUCTION-LIFECYCLE')`,
            [reservations[0]?.attempt],
          );
        });
      });
      const trustedNow = new Date(Date.now() + 400 * MS_PER_DAY);
      const { rows: eligibility } = await keeperClient.query<{
        result: { eligible: boolean; blockers: string[] };
      }>(
        `select kitluy_devices.evaluate_key_destruction_eligibility_v1(
         $1::uuid, $2, $3, $4::timestamptz, $5) as result`,
        [spine.deviceRecordId, DEVELOPMENT, keys[0]?.handle ?? "", trustedNow, "trusted"],
      );
      expect(
        eligibility[0]?.result.eligible,
        `destruction must be eligible after reconciliation: ${JSON.stringify(eligibility[0]?.result)}`,
      ).toBe(true);

      const gateway = pgDestructionGateway(keeperClient);
      const requested = await requestProviderKeyDestruction(gateway, {
        requestKey: `lc-kd-${RUN}`,
        deviceRecordId: spine.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        providerKeyReference: keys[0]?.handle ?? "",
        requestedBy: "operator:lifecycle-requester",
        requestReason: "the spine's life is over; its original key is destroyed under four eyes",
        reauthenticated: true,
        trustedNow,
        trustedTimeStatus: "trusted",
      });
      const requestId = String(
        (requested as { destructionRequestId?: unknown }).destructionRequestId ?? "",
      );
      expect(requestId, JSON.stringify(requested)).not.toBe("");

      // Four eyes: the approver is a DIFFERENT operator than the requester.
      await approveProviderKeyDestruction(gateway, {
        destructionRequestId: requestId,
        approvedBy: "operator:lifecycle-approver",
        approvalReason: "second pair of eyes, distinct from the requester",
        reauthenticated: true,
        trustedNow,
        trustedTimeStatus: "trusted",
      });

      // The custody side: the SAME replacement-key provider that minted the key
      // at stage 17. It re-checks reference, fingerprint and generation against
      // its own registry before it erases anything.
      const execution = await executeProviderKeyDestruction(gateway, rotationProvider, {
        destructionRequestId: requestId,
        executedBy: "worker:destruction",
        deviceRecordId: spine.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        providerKeyReference: keys[0]?.handle ?? "",
        publicKeyFingerprint: keys[0]?.fingerprint ?? "",
        keyGeneration: Number(keys[0]?.keyGeneration ?? 2),
      });
      expect(
        String((execution as { outcome?: unknown }).outcome ?? ""),
        JSON.stringify(execution),
      ).toBe("DESTROYED");

      // The terminal facts: the key row is destroyed, the reconciliation row
      // exists, and the revoked credential is still revoked.
      const { rows: keyAfter } = await keeperClient.query<{
        state: string;
        destroyed: Date | null;
      }>(
        `select state::text as state, destroyed_at as destroyed
         from kitluy_devices.device_generation_keys
        where device_record_id = $1::uuid and generation = 3`,
        [spine.deviceRecordId],
      );
      expect(keyAfter[0]?.state).toBe("destroyed");
      expect(keyAfter[0]?.destroyed).not.toBeNull();
      const { rows: reconciliations } = await keeperClient.query<{ n: string }>(
        `select count(*)::text as n from kitluy_devices.device_renewal_reconciliations
        where device_record_id = $1::uuid`,
        [spine.deviceRecordId],
      );
      expect(Number(reconciliations[0]?.n)).toBeGreaterThanOrEqual(1);
      const { rows: after } = await keeperClient.query<{ state: string }>(
        `select state::text as state from kitluy_devices.device_credentials
        where credential_id = $1::uuid`,
        [revokedSpineCredentialId],
      );
      expect(after[0]?.state, "provider destruction must never un-revoke").toBe("revoked");
      passed(29);
    });

    it(stage(30, "Hub restart and cloud reconnection"), async () => {
      // A post-revocation snapshot: the revoked serials of the whole run are in
      // it. This is also the post-revocation production proof for stages 10-15,
      // which ran pre-revocation by design (see the header).
      const snapshot = await produceSnapshot(2);
      expect(
        snapshot.revokedCertificateSerials,
        "the spine's revoked serial never reached the offline snapshot",
      ).toContain(revokedSpineSerial);
      expect(snapshot.revokedCertificateSerials).toContain(threadB.serialNumber);
      expect(snapshot.revokedCertificateSerials).not.toContain(bystander.serialNumber);

      const trusted: TrustedSnapshotKey = {
        keyId: snapshotKeyId,
        keyVersion: snapshotKeyVersion,
        algorithm: snapshot.signature.algorithm,
        publicKeyPem: snapshotPublicKeyPem,
        state: "current",
      };
      const applied = await applySignedSnapshot(hubPool, hubScope, snapshot, [trusted]);
      expect(applied.applied, JSON.stringify(applied)).toBe(true);

      // RESTART: a brand-new connection is the only state a restarted Hub has.
      // The persisted snapshot reloads; the revoked serial is still denied.
      const restarted = new pg.Pool({ connectionString: HUB_DSN, max: 1 });
      try {
        const denied = await decideOffline(restarted, hubScope, revokedSpineSerial, {
          now: new Date(),
          maxAgeHours: 72,
        });
        expect(denied.decision, JSON.stringify(denied)).toBe("DENY");
        const allowed = await decideOffline(restarted, hubScope, bystander.serialNumber, {
          now: new Date(),
          maxAgeHours: 72,
        });
        expect(allowed.decision, "unrelated valid credentials continue").toBe("ALLOW");
      } finally {
        await restarted.end();
      }

      // RECONNECTION cannot resurrect: replaying an OLDER sequence is refused,
      // last-known-good is preserved, and the serial stays denied.
      const older = await produceSnapshot(1);
      const replay = await applySignedSnapshot(hubPool, hubScope, older, [trusted]);
      expect(replay.applied).toBe(false);
      expect(replay.lastKnownGoodPreserved).toBe(true);
      const stillDenied = await decideOffline(hubPool, hubScope, revokedSpineSerial, {
        now: new Date(),
        maxAgeHours: 72,
      });
      expect(stillDenied.decision).toBe("DENY");

      // The run is traceable under ONE correlation id, and every stage before
      // this one ran to completion — counted by execution, not declaration.
      expect(
        [...executed].sort((a, b) => a - b),
        "every stage before this one must have run to completion",
      ).toEqual(Array.from({ length: 29 }, (_, i) => i + 1));
      expect(CORRELATION).toMatch(/^[0-9a-f-]{36}$/);
      expect(authorizationB).not.toBe("");
      expect(authorizationC).not.toBe("");
      expect(authorizationD).not.toBe("");
      passed(30);
    });
  },
);

// -----------------------------------------------------------------------------
// Suite-local helpers
// -----------------------------------------------------------------------------

/** The ENVIRONMENT-WIDE revocation set. NOT a scoped read — and named so. */
async function revokedSerialsFleetWide(client: pg.PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ serial: string }>(
    `select c.serial_number as serial
       from kitluy_devices.device_credentials c
      where c.revoked_at is not null and c.environment = $1`,
    [DEVELOPMENT],
  );
  return rows.map((r) => r.serial);
}

/** sha-256 hex, the form the governed issuance door derives ids from. */
function sha256HexLocal(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}
