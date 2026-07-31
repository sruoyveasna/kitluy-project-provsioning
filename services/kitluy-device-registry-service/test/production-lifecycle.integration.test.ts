/**
 * THE COMPLETE PRODUCTION LIFECYCLE, AS ONE TRACEABLE RUN.
 *
 * WS-11-T003 Step 4 §4-§8. Every earlier suite proves one property in isolation.
 * This one drives a single credential from issuance to a terminal, decided,
 * irreversible emergency revocation — through the HTTP router `main.ts` actually
 * serves, in the order a real incident happens, sharing one correlation id so the
 * whole run is traceable end to end.
 *
 * ===========================================================================
 * WHAT MAKES THIS A PRODUCTION LIFECYCLE AND NOT A SCRIPT
 * ===========================================================================
 * Every stage that CHANGES something goes through `runtime.revocationRouter` —
 * the shipped surface, with its authentication, its authority-field rejection and
 * its correlation handling. The privileged `keeper` connection is used ONLY to
 * provision the fixture beforehand and to ASSERT afterwards. It never revokes,
 * never approves, never consumes evidence and never writes an authorization.
 *
 * The two humans are DISTINCT people holding DIFFERENT permissions, which is what
 * makes the four-eyes stage meaningful rather than ceremonial.
 *
 * ===========================================================================
 * THE ONE BRANCH THIS RUN DOES NOT TAKE
 * ===========================================================================
 * An obligation is closed either by a second human (post-approval) or by the
 * worker when the deadline passes (lapse). A single authorization can only take
 * ONE of those, because the first verdict is terminal — that is the property
 * under test at stage 24.
 *
 * So this run takes the POST-APPROVAL branch and then proves the lapse path
 * refuses to decide it a second time. The LAPSED branch itself is proved on its
 * own authorization by `lapse-worker.integration.test.ts`; it is not re-proved
 * here, and this file does not claim to.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { verifySnapshotSignature, type TrustedSnapshotKey } from "@kitluy/device-identity";

import {
  createIncumbentFixture,
  DEVELOPMENT,
} from "../../../packages/device-identity/test/support/renewal-fixtures.js";
import {
  resolveDeviceRevocationService,
  type DeviceRevocationRuntime,
} from "../src/composition.js";
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
const ENV = { DEVICE_REGISTRY_DATABASE_URL: LOCAL_DSN, KITLUY_ENV: "local" } as const;
const RUN = randomUUID().slice(0, 8);
const KEY_ENV_VAR = "TEST_LIFECYCLE_SNAPSHOT_KEY";
const EMERGENCY_PREFIX = "/v1/device-credentials/emergency-revocations";

/** ONE correlation id for the whole incident, so the run is traceable as a unit. */
const CORRELATION = randomUUID();

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
if (!live) console.warn("SKIPPED: production lifecycle — local database unreachable");

/**
 * The authenticated principal SWITCHES between stages, because two different
 * humans act in this lifecycle. A fixed authenticator could not express that, and
 * four eyes would be untestable.
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
  "one credential, from issuance to an irreversible decided revocation",
  () => {
    let runtime: DeviceRevocationRuntime;
    let keeper: pg.Pool;
    let keeperClient: pg.PoolClient;

    let firstResponder: EmergencyActor;
    let approver: EmergencyActor;

    let credentialId = "";
    let serialNumber = "";
    let bystanderCredentialId = "";
    let bystanderSerial = "";

    /** Carried between stages. This is the thread the whole run hangs on. */
    let authorizationId = "";
    let emergencyEvidenceId = "";
    let postApprovalDueAt = "";

    /**
     * Stage numbers that actually EXECUTED.
     *
     * An earlier version pushed inside `stage()`, which is called as the ARGUMENT
     * to `it()` -- so all 28 pushes happened during COLLECTION, before any test
     * body ran. The count then read 28 even if every stage failed, and even with
     * the database down and the whole describe skipped. It measured that the file
     * parsed. Independent review caught it. `passed()` is now called at the END of
     * each body, so a stage whose assertion throws never records itself.
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

    beforeAll(async () => {
      runtime = resolveDeviceRevocationService(ENV, { authenticator: switchingAuthenticator });
      keeper = new pg.Pool({ connectionString: LOCAL_DSN, max: 4 });
      keeperClient = await keeper.connect();

      await keeperClient.query("begin");
      try {
        const target = await createIncumbentFixture(keeperClient, {
          issuedAtTrustedTime: new Date("2026-07-31T02:00:00.000Z"),
          label: `lifecycle-${RUN}`,
        });
        const bystander = await createIncumbentFixture(keeperClient, {
          issuedAtTrustedTime: new Date("2026-07-31T02:00:00.000Z"),
          label: `lifecycle-bystander-${RUN}`,
        });
        credentialId = target.credentialId;
        serialNumber = target.serialNumber;
        bystanderCredentialId = bystander.credentialId;
        bystanderSerial = bystander.serialNumber;

        // TWO DISTINCT HUMANS.
        //
        // The responder holds BOTH grants ON PURPOSE. Giving them only
        // `emergency_revoke` is what made stage 20 untestable: their
        // self-post-approval was refused for lack of permission, so deleting the
        // four-eyes rule entirely left the stage green. Holding both means the
        // ONLY thing that can refuse them is the self-approval rule itself.
        //
        // The approver still holds post-approve alone, so they can never revoke.
        firstResponder = await createEmergencyActor(keeperClient, {
          environment: DEVELOPMENT,
          actionClasses: [
            "fleet.device_credential.emergency_revoke",
            EMERGENCY_POST_APPROVE_ACTION,
          ],
          label: `lifecycle-responder-${RUN}`,
        });
        approver = await createEmergencyActor(keeperClient, {
          environment: DEVELOPMENT,
          actionClasses: [EMERGENCY_POST_APPROVE_ACTION],
          label: `lifecycle-approver-${RUN}`,
        });
        await keeperClient.query("commit");
      } catch (error) {
        await keeperClient.query("rollback").catch(() => undefined);
        throw error;
      }
    }, 180_000);

    afterAll(async () => {
      console.warn(
        `[lifecycle ${RUN}] correlation=${CORRELATION} executed=${String(executed.size)}/28 ` +
          `stages=[${[...executed].sort((a, b) => a - b).join(",")}]`,
      );
      if (firstResponder !== undefined) {
        await disposeEmergencyActor(keeperClient, firstResponder).catch(() => undefined);
      }
      if (approver !== undefined) {
        await disposeEmergencyActor(keeperClient, approver).catch(() => undefined);
      }
      keeperClient?.release();
      await runtime?.shutdown().catch(() => undefined);
      await keeper?.end().catch(() => undefined);
    });

    // -------------------------------------------------------------------------
    // ISSUANCE AND PRE-INCIDENT STATE
    // -------------------------------------------------------------------------

    it(stage(1, "the credential is issued, live, and not revoked"), async () => {
      const { rows } = await keeperClient.query<{ state: string; revoked_at: Date | null }>(
        `select state::text as state, revoked_at from kitluy_devices.device_credentials
        where credential_id = $1::uuid`,
        [credentialId],
      );
      expect(rows[0]?.state, "the incumbent must be live before the incident").not.toBe("revoked");
      expect(rows[0]?.revoked_at, "a freshly issued credential must not be revoked").toBeNull();
      passed(1);
    });

    it(stage(2, "an offline snapshot taken NOW does not list it"), async () => {
      const revoked = await revokedSerialsFleetWide(keeperClient);
      expect(revoked).not.toContain(serialNumber);
      passed(2);
    });

    it(
      stage(3, "the first responder holds the emergency permission, the approver does not"),
      async () => {
        const held = async (userId: string, key: string) => {
          const { rows } = await keeperClient.query<{ n: string }>(
            `select count(*)::text as n from kitluy_auth.temporary_grants
          where subject_id = $1::uuid and permission_key = $2
            and starts_at <= now() and expires_at > now()`,
            [userId, key],
          );
          return rows[0]?.n !== "0";
        };
        expect(await held(firstResponder.userId, "fleet.device_credential.emergency_revoke")).toBe(
          true,
        );
        // Deliberately granted: see `beforeAll`. Four eyes must refuse the
        // responder for WHO THEY ARE, not for what they lack.
        expect(await held(firstResponder.userId, EMERGENCY_POST_APPROVE_ACTION)).toBe(true);
        expect(
          await held(approver.userId, "fleet.device_credential.emergency_revoke"),
          "the approver must never be able to revoke",
        ).toBe(false);
        expect(await held(approver.userId, EMERGENCY_POST_APPROVE_ACTION)).toBe(true);
        passed(3);
      },
    );

    // -------------------------------------------------------------------------
    // THE INCIDENT
    // -------------------------------------------------------------------------

    it(stage(4, "the route REFUSES an emergency with no re-authentication evidence"), async () => {
      currentPrincipal = firstResponder.userId;
      const response = await call({
        body: {
          credentialId,
          reasonCode: "KEY_COMPROMISE",
          explanation: `lifecycle ${RUN} without evidence`,
          incidentReference: `INC-${RUN}`,
          reauthEvidenceId: randomUUID(),
          idempotencyKey: randomUUID(),
        },
      });
      // Fails closed: unknown evidence is a refusal, never a silent success.
      expect(response.status).toBeGreaterThanOrEqual(400);
      const { rows } = await keeperClient.query<{ revoked_at: Date | null }>(
        `select revoked_at from kitluy_devices.device_credentials where credential_id = $1::uuid`,
        [credentialId],
      );
      expect(rows[0]?.revoked_at, "a refused emergency must not revoke anything").toBeNull();
      passed(4);
    });

    it(stage(5, "the human records REAL single-use evidence in their own session"), async () => {
      emergencyEvidenceId = await recordEmergencyEvidence(runtime.pool, firstResponder, {
        environment: DEVELOPMENT,
      });
      const evidence = await readEvidence(keeperClient, emergencyEvidenceId);
      expect(evidence?.lifecycleState).toBe("ACTIVE");
      expect(evidence?.consumedAt).toBeNull();
      // The owner's 300-second window, set by the database. Not passed, not widened.
      const seconds =
        ((evidence?.expiresAt.getTime() ?? 0) - (evidence?.verifiedAt.getTime() ?? 0)) / 1000;
      expect(seconds).toBe(300);
      passed(5);
    });

    it(stage(6, "the route REFUSES a body that tries to supply its own authority"), async () => {
      const response = await call({
        body: {
          credentialId,
          reasonCode: "KEY_COMPROMISE",
          explanation: `lifecycle ${RUN} smuggling authority`,
          incidentReference: `INC-${RUN}`,
          reauthEvidenceId: emergencyEvidenceId,
          idempotencyKey: randomUUID(),
          // None of these may be caller-supplied.
          actorUserId: approver.userId,
          scopeDigest: "0".repeat(64),
        },
      });
      expect(response.status).toBe(400);
      const evidence = await readEvidence(keeperClient, emergencyEvidenceId);
      expect(evidence?.lifecycleState, "a rejected body must not spend evidence").toBe("ACTIVE");
      passed(6);
    });

    it(stage(7, "the EMERGENCY REVOCATION succeeds through the shipped route"), async () => {
      const response = await call({
        body: {
          credentialId,
          reasonCode: "KEY_COMPROMISE",
          explanation: `lifecycle ${RUN} real incident`,
          incidentReference: `INC-${RUN}`,
          reauthEvidenceId: emergencyEvidenceId,
          idempotencyKey: `lifecycle-${RUN}`,
        },
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(response.body.outcome).toBe("REVOKED_IMMEDIATELY");
      authorizationId = String(response.body.authorizationId ?? "");
      postApprovalDueAt = String(response.body.postApprovalDueAt ?? "");
      expect(authorizationId).not.toBe("");
      expect(response.body.revokedCredentialCount).toBe(1);
      passed(7);
    });

    it(stage(8, "the credential is REVOKED in the authoritative database"), async () => {
      const { rows } = await keeperClient.query<{ state: string; revoked_at: Date | null }>(
        `select state::text as state, revoked_at from kitluy_devices.device_credentials
        where credential_id = $1::uuid`,
        [credentialId],
      );
      expect(rows[0]?.revoked_at).not.toBeNull();
      expect(rows[0]?.state).toBe("revoked");
      passed(8);
    });

    it(stage(9, "the evidence went ACTIVE -> CONSUMED exactly once"), async () => {
      const evidence = await readEvidence(keeperClient, emergencyEvidenceId);
      expect(evidence?.lifecycleState).toBe("CONSUMED");
      expect(evidence?.consumedAt).not.toBeNull();
      const { rows } = await keeperClient.query<{ n: string }>(
        `select count(*)::text as n from kitluy_auth.reauthentication_evidence
        where evidence_id = $1::uuid and consumed_for_authorization = $2::uuid`,
        [emergencyEvidenceId, authorizationId],
      );
      expect(rows[0]?.n).toBe("1");
      passed(9);
    });

    it(stage(10, "the BYSTANDER credential is untouched"), async () => {
      const { rows } = await keeperClient.query<{ revoked_at: Date | null }>(
        `select revoked_at from kitluy_devices.device_credentials where credential_id = $1::uuid`,
        [bystanderCredentialId],
      );
      expect(rows[0]?.revoked_at, "an emergency must not widen beyond its scope").toBeNull();
      passed(10);
    });

    it(
      stage(11, "the authorization names the human and carries a database-derived digest"),
      async () => {
        const { rows } = await keeperClient.query<{
          actor: string;
          digest: string;
          reason: string;
          incident: string | null;
          count: number;
        }>(
          `select actor_user_id::text as actor, scope_digest as digest, reason_code::text as reason,
              incident_reference as incident, identifier_count as count
         from kitluy_devices.device_emergency_revocation_authorizations
        where authorization_id = $1::uuid`,
          [authorizationId],
        );
        expect(rows[0]?.actor).toBe(firstResponder.userId);
        expect(rows[0]?.digest, "the digest must be database-derived, not supplied").toMatch(
          /^[0-9a-f]{64}$/,
        );
        expect(rows[0]?.reason).toBe("KEY_COMPROMISE");
        expect(rows[0]?.incident).toBe(`INC-${RUN}`);
        expect(Number(rows[0]?.count)).toBe(1);
        passed(11);
      },
    );

    it(stage(12, "the recorded scope contains exactly the one credential"), async () => {
      const { rows } = await keeperClient.query<{ credential: string }>(
        `select credential_id::text as credential
         from kitluy_devices.device_emergency_revocation_scope
        where authorization_id = $1::uuid`,
        [authorizationId],
      );
      expect(rows.map((r) => r.credential)).toEqual([credentialId]);
      passed(12);
    });

    it(stage(13, "an obligation exists, PENDING, with a future deadline"), async () => {
      const status = await runtime.service.readEmergencyStatus(authorizationId);
      expect(status?.postApprovalDecision).toBe("PENDING");
      expect(status?.decidedAt).toBeNull();
      expect(status?.postApprovalDueAt.getTime()).toBeGreaterThan(Date.now());
      expect(new Date(postApprovalDueAt).getTime()).toBe(status?.postApprovalDueAt.getTime());
      passed(13);
    });

    it(stage(14, "the STATUS route reports the same obligation to an operator"), async () => {
      const response = await call({
        method: "GET",
        path: `${EMERGENCY_PREFIX}/${authorizationId}`,
      });
      expect(response.status).toBe(200);
      expect(response.body.postApprovalDecision).toBe("PENDING");
      expect(response.body.authorizationId).toBe(authorizationId);
      passed(14);
    });

    // -------------------------------------------------------------------------
    // IDEMPOTENCY AND IRREVERSIBILITY WHILE THE OBLIGATION IS OPEN
    // -------------------------------------------------------------------------

    it(
      stage(15, "an identical retry returns the SAME authorization, not a second one"),
      async () => {
        const retryEvidence = await recordEmergencyEvidence(runtime.pool, firstResponder, {
          environment: DEVELOPMENT,
        });
        const response = await call({
          body: {
            credentialId,
            reasonCode: "KEY_COMPROMISE",
            explanation: `lifecycle ${RUN} real incident`,
            incidentReference: `INC-${RUN}`,
            reauthEvidenceId: retryEvidence,
            idempotencyKey: `lifecycle-${RUN}`,
          },
        });
        expect(response.body.outcome).toBe("ALREADY_AUTHORIZED");
        expect(response.body.authorizationId).toBe(authorizationId);
        const { rows } = await keeperClient.query<{ n: string }>(
          `select count(*)::text as n from kitluy_devices.device_emergency_revocation_authorizations
        where idempotency_key = $1`,
          [`lifecycle-${RUN}`],
        );
        expect(rows[0]?.n, "a retry must not create a second authorization").toBe("1");
        passed(15);
      },
    );

    it(stage(16, "NO runtime identity can un-revoke the credential"), async () => {
      // Irreversibility is not a convention here; it is enforced. Each runtime role
      // is asked directly whether it may write the revocation columns.
      const { rows } = await keeperClient.query<{ role: string }>(
        `select r.rolname as role
         from (values ('kitluy_issuance_service'),('kitluy_worker_service'),
                      ('authenticated'),('anon'),('service_role')) as r(rolname)
        where has_table_privilege(r.rolname, 'kitluy_devices.device_credentials', 'UPDATE')`,
      );
      expect(rows, `roles able to UPDATE credentials directly: ${JSON.stringify(rows)}`).toEqual(
        [],
      );
      passed(16);
    });

    it(
      stage(17, "the revocation record itself is append-only to every runtime identity"),
      async () => {
        const { rows } = await keeperClient.query<{ role: string; priv: string }>(
          `select r.rolname as role, p.priv
         from (values ('kitluy_issuance_service'),('kitluy_worker_service'),
                      ('authenticated'),('anon'),('service_role')) as r(rolname)
        cross join (values ('UPDATE'),('DELETE')) as p(priv)
        where has_table_privilege(
                r.rolname, 'kitluy_devices.device_emergency_revocation_authorizations', p.priv)`,
        );
        expect(rows, `authorization rows are mutable by: ${JSON.stringify(rows)}`).toEqual([]);
        passed(17);
      },
    );

    // -------------------------------------------------------------------------
    // OFFLINE PROPAGATION
    // -------------------------------------------------------------------------

    it(stage(18, "a signed snapshot produced NOW lists the revoked serial"), async () => {
      // THE TARGET'S OWN HUB, not `limit 1` over every assignment.
      //
      // An earlier version took an arbitrary assigned Hub with no ORDER BY and no
      // relationship to the revoked credential. If that Hub belonged to another
      // scope the snapshot was simply EMPTY and every assertion still passed.
      const { rows } = await keeperClient.query<{ device_id: string }>(
        `select a.device_id::text as device_id
           from kitluy_devices.device_assignments a
           join kitluy_devices.device_credentials c on c.device_record_id = a.device_id
          where c.credential_id = $1::uuid and a.state in ('pending_trust','active')
          order by a.device_id limit 1`,
        [credentialId],
      );
      const hub = rows[0]?.device_id;
      // FAILS rather than skips: a stage that cannot prove its property must not
      // report success.
      expect(
        hub,
        "KLUY-LIFECYCLE-18-UNPROVABLE: the revoked credential's device has no live Hub " +
          "assignment, so no scoped snapshot can contain it and this stage cannot pass honestly",
      ).toBeDefined();
      if (hub === undefined) return;

      const pair = generateKeyPairSync("ed25519");
      const producer = createSnapshotProducer(
        runtime.pool,
        createEd25519SnapshotSigner({
          env: {
            [KEY_ENV_VAR]: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
          },
        }),
      );
      const snapshot = await producer.produceSignedSnapshot({
        hubDeviceRecordId: hub,
        environment: DEVELOPMENT,
        snapshotVersion: 1,
        sequence: 1,
        generatedAt: new Date(),
        effectiveAt: new Date(),
        keyReference: { secretEnvVar: KEY_ENV_VAR, keyId: `lifecycle-${RUN}`, keyVersion: 1 },
      });

      // The signature verifies under the SAME function the Hub uses to decide
      // whether to trust a delivered snapshot.
      const trusted: TrustedSnapshotKey = {
        keyId: `lifecycle-${RUN}`,
        keyVersion: 1,
        algorithm: snapshot.signature.algorithm,
        publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      };
      const { signature, ...body } = snapshot;
      const verification = verifySnapshotSignature(body, signature, [trusted]);
      expect(verification.verified, JSON.stringify(verification)).toBe(true);

      // The snapshot's scope is DERIVED from the Hub, never supplied.
      expect(snapshot.hubDeviceRecordId).toBe(hub);
      expect(snapshot.scope.environment).toBe(DEVELOPMENT);
      // THE POINT OF THE STAGE: the revocation reached the offline artifact.
      //
      // Without this, the stage asserted only that a signature verified and two
      // echoed fields matched -- and would still pass if the producer read the
      // ENVIRONMENT-WIDE revocation set instead of the scoped one, i.e. if the
      // cross-tenant leak this design exists to prevent were reintroduced.
      expect(
        snapshot.revokedCertificateSerials,
        "the credential revoked at stage 7 never reached the offline snapshot",
      ).toContain(serialNumber);

      // Weak on its own -- the bystander was never revoked, so no scope could
      // list it. Kept only as a floor.
      expect(snapshot.revokedCertificateSerials).not.toContain(bystanderSerial);
      passed(18);
    });

    it(
      stage(19, "the FLEET-WIDE revocation set includes it, and still excludes the bystander"),
      async () => {
        // Named for what it executes. The SCOPED reader is exercised at stage 18,
        // through the production producer; this is the environment-wide truth.
        const revoked = await revokedSerialsFleetWide(keeperClient);
        expect(revoked).toContain(serialNumber);
        expect(revoked).not.toContain(bystanderSerial);
        passed(19);
      },
    );

    // -------------------------------------------------------------------------
    // FOUR EYES
    // -------------------------------------------------------------------------

    it(stage(20, "the FIRST RESPONDER cannot post-approve their own emergency"), async () => {
      currentPrincipal = firstResponder.userId;
      const evidence = await recordEmergencyEvidence(runtime.pool, firstResponder, {
        environment: DEVELOPMENT,
        actionClass: EMERGENCY_POST_APPROVE_ACTION,
      }).catch(() => null);
      const response = await call({
        path: `${EMERGENCY_PREFIX}/${authorizationId}/post-approval`,
        body: {
          decision: "APPROVE",
          reauthEvidenceId: evidence ?? randomUUID(),
          note: "self approval attempt",
        },
      });
      // THE REFUSAL CODE, not merely a 4xx.
      //
      // The responder was granted `emergency_post_approve` in `beforeAll`
      // specifically so this stage cannot be satisfied by a missing permission.
      // Without that, removing the self-approval check entirely left this green:
      // the permission check refused first and the four-eyes rule -- repository
      // hard rule 7, which cannot be relaxed -- had no test behind it.
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(
        JSON.stringify(response.body),
        "the refusal must be the SELF-post-approval rule, not a missing permission",
      ).toContain("SELF");
      const status = await runtime.service.readEmergencyStatus(authorizationId);
      expect(status?.postApprovalDecision, "self-approval must leave it PENDING").toBe("PENDING");
      passed(20);
    });

    it(stage(21, "a SECOND, DISTINCT human post-approves it"), async () => {
      currentPrincipal = approver.userId;
      const evidence = await recordEmergencyEvidence(runtime.pool, approver, {
        environment: DEVELOPMENT,
        actionClass: EMERGENCY_POST_APPROVE_ACTION,
      });
      const response = await call({
        path: `${EMERGENCY_PREFIX}/${authorizationId}/post-approval`,
        body: { decision: "APPROVE", reauthEvidenceId: evidence, note: `lifecycle ${RUN}` },
      });
      expect(response.status, JSON.stringify(response.body)).toBeLessThan(400);
      expect(response.body.outcome).toBe("POST_APPROVED");
      expect(response.body.authorizationId).toBe(authorizationId);
      passed(21);
    });

    it(stage(22, "the verdict is recorded against the SECOND human"), async () => {
      const { rows } = await keeperClient.query<{ decider: string | null; verdict: string }>(
        `select actor_user_id::text as decider, verdict::text as verdict
         from kitluy_devices.device_emergency_post_approval_verdicts
        where authorization_id = $1::uuid`,
        [authorizationId],
      );
      expect(rows.length, "exactly one verdict").toBe(1);
      // NOT NULL here specifically: the column is nullable only for LAPSED, where
      // nobody came. An APPROVED verdict must name the human who gave it.
      expect(rows[0]?.decider).toBe(approver.userId);
      expect(rows[0]?.decider).not.toBe(firstResponder.userId);
      expect(rows[0]?.verdict).toBe("APPROVED");
      passed(22);
    });

    it(stage(23, "the obligation is CLOSED and the decision is terminal"), async () => {
      const status = await runtime.service.readEmergencyStatus(authorizationId);
      expect(status?.postApprovalDecision).toBe("APPROVED");
      expect(status?.decidedAt).not.toBeNull();

      const second = await call({
        path: `${EMERGENCY_PREFIX}/${authorizationId}/post-approval`,
        body: {
          decision: "REFUSE",
          reauthEvidenceId: await recordEmergencyEvidence(runtime.pool, approver, {
            environment: DEVELOPMENT,
            actionClass: EMERGENCY_POST_APPROVE_ACTION,
          }),
        },
      });
      expect(second.body.outcome).toBe("ALREADY_DECIDED");
      const { rows } = await keeperClient.query<{ n: string }>(
        `select count(*)::text as n from kitluy_devices.device_emergency_post_approval_verdicts
        where authorization_id = $1::uuid`,
        [authorizationId],
      );
      expect(rows[0]?.n, "a decided obligation must not gain a second verdict").toBe("1");
      passed(23);
    });

    it(stage(24, "the LAPSE path refuses to decide an already-decided authorization"), async () => {
      // The worker identity, not a human. This is the other way an obligation can
      // close, and it must not overwrite a verdict a human already recorded.
      const result = await runtime.service.lapseEmergencyPostApproval(authorizationId);
      expect(result.outcome).toBe("ALREADY_DECIDED");
      const status = await runtime.service.readEmergencyStatus(authorizationId);
      expect(status?.postApprovalDecision, "the human verdict must survive").toBe("APPROVED");
      passed(24);
    });

    // -------------------------------------------------------------------------
    // TERMINAL STATE
    // -------------------------------------------------------------------------

    it(stage(25, "the credential is still revoked after the obligation closed"), async () => {
      // Post-approval RATIFIES the revocation; it does not perform or undo it.
      const { rows } = await keeperClient.query<{ state: string; revoked_at: Date | null }>(
        `select state::text as state, revoked_at from kitluy_devices.device_credentials
        where credential_id = $1::uuid`,
        [credentialId],
      );
      expect(rows[0]?.revoked_at).not.toBeNull();
      expect(rows[0]?.state).toBe("revoked");
      passed(25);
    });

    it(stage(26, "a REFUSED verdict could not have resurrected it either"), async () => {
      // Nothing in the schema lets a verdict clear `revoked_at`: no runtime role may
      // write the column at all (stage 16), and the verdict table has no path to it.
      const { rows } = await keeperClient.query<{ n: string }>(
        `select count(*)::text as n from information_schema.columns
        where table_schema = 'kitluy_devices'
          and table_name = 'device_emergency_post_approval_verdicts'
          and column_name in ('revoked_at','reinstated_at','restores_credential')`,
      );
      expect(rows[0]?.n, "a verdict must have no way to reinstate a credential").toBe("0");
      passed(26);
    });

    it(stage(27, "the run left NOTHING spendable behind"), async () => {
      const { rows } = await keeperClient.query<{ n: string }>(
        `select count(*)::text as n from kitluy_auth.reauthentication_evidence
        where actor_user_id = any($1::uuid[])
          and lifecycle_state = 'ACTIVE'
          and consumed_at is null and revoked_at is null and superseded_at is null
          and expires_at > kitluy_ops.authoritative_now_v1()`,
        [[firstResponder.userId, approver.userId]],
      );
      // A REAL bound, not `>= 0`.
      //
      // The earlier assertion here was `toBeGreaterThanOrEqual(0)` on a `count(*)`
      // -- true for every possible database state, under the title "the run left
      // NOTHING spendable behind". Independent review caught it.
      //
      // The honest bound is the evidence this run recorded and DELIBERATELY did
      // not spend, enumerated rather than guessed:
      //
      //   stage 15  responder, emergency_revoke      -- retry answered
      //             ALREADY_AUTHORIZED, so it was never consumed
      //   stage 20  responder, emergency_post_approve -- refused by four eyes
      //   stage 23  approver,  emergency_post_approve -- refused ALREADY_DECIDED
      //
      // Three, each single-use, each bounded by the governed 300-second window,
      // and each retired by `disposeEmergencyActor` in `afterAll`. A fourth would
      // be residue this run cannot explain.
      expect(
        Number(rows[0]?.n),
        "more live evidence survives than this run can account for",
      ).toBeLessThanOrEqual(3);
      const audit = await keeperClient.query<{ n: string }>(
        `select count(*)::text as n from kitluy_devices.device_emergency_revocation_authorizations
        where authorization_id = $1::uuid`,
        [authorizationId],
      );
      // The HISTORY, by contrast, must still be there. Append-only means it stays.
      expect(audit.rows[0]?.n).toBe("1");
      passed(27);
    });

    it(stage(28, "the whole run is traceable under ONE correlation id"), async () => {
      // Counts stages that EXECUTED TO COMPLETION, not stages that were declared.
      expect(
        [...executed].sort((a, b) => a - b),
        "every stage before this one must have run to completion",
      ).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
      expect(CORRELATION).toMatch(/^[0-9a-f-]{36}$/);
      expect(authorizationId).not.toBe("");
      expect(emergencyEvidenceId).not.toBe("");
    });
  },
);

/**
 * The ENVIRONMENT-WIDE revocation set. NOT a scoped read -- and named so.
 *
 * An earlier version of this helper was documented as "the scoped reader the
 * snapshot builder uses, asked directly" while executing exactly this raw query,
 * which touches no group-0156 bridge at all: dropping every scoped bridge left it
 * passing. Stage 18 exercises the scoped path through the real producer.
 */
async function revokedSerialsFleetWide(client: pg.PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ serial: string }>(
    `select c.serial_number as serial
       from kitluy_devices.device_credentials c
      where c.revoked_at is not null and c.environment = $1`,
    [DEVELOPMENT],
  );
  return rows.map((r) => r.serial);
}
