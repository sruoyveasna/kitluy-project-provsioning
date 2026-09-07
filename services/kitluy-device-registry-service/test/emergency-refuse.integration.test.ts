/**
 * THE COMPLETE POST-APPROVAL REFUSE BRANCH.
 *
 * WS-11-T003 Step 4 §7. The lifecycle suite proves the APPROVE branch; this suite
 * proves the REFUSE branch with the same production runtime and the same
 * governance expectations.
 *
 * ===========================================================================
 * WHY THIS IS A SEPARATE SUITE
 * ===========================================================================
 * A single authorization can only take ONE terminal verdict. Once APPROVED or
 * REFUSED or LAPSED, the state machine returns ALREADY_DECIDED forever. So the
 * REFUSE path needs its OWN authorization, its OWN credential, and its OWN
 * humans — and proving both branches in one describe block would be longer than
 * the 30-stage lifecycle itself.
 *
 * ===========================================================================
 * WHAT THE REFUSE BRANCH MUST PROVE
 * ===========================================================================
 *   1. A DISTINCT second human gives the REFUSE.
 *   2. That human holds the correct post-approval permission.
 *   3. The evidence is separate, valid, and consumed exactly once.
 *   4. The authorization and scope digest are unchanged.
 *   5. The explicit REFUSE verdict is recorded.
 *   6. The deadline is NOT extended or reset.
 *   7. The credential STAYS revoked (REFUSE does not restore).
 *   8. The authorization enters MANUAL_SECURITY_REVIEW.
 *   9. An escalation exists.
 *  10. Duplicate REFUSE is idempotent (ALREADY_DECIDED).
 *  11. Conflicting subsequent APPROVE is refused.
 *  12. No synthetic approver or automatic reversal occurs.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
import {
  createEmergencyActor,
  disposeEmergencyActor,
  readEvidence,
  recordEmergencyEvidence,
  EMERGENCY_POST_APPROVE_ACTION,
  type EmergencyActor,
} from "./support/emergency-success-fixture.js";

const LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const ENV = { DEVICE_REGISTRY_DATABASE_URL: LOCAL_DSN, KITLUY_ENV: "local" } as const;
const RUN = randomUUID().slice(0, 8);
const EMERGENCY_PREFIX = "/v1/device-credentials/emergency-revocations";

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
if (!live) console.warn("SKIPPED: emergency refuse suite — local database unreachable");

let currentPrincipal = randomUUID();
const switchingAuthenticator: RequestAuthenticator = {
  authenticate: () =>
    Promise.resolve({
      authenticated: true as const,
      principal: { userId: currentPrincipal, method: "TEST_INJECTED_AUTHENTICATOR" },
    }),
};

describe.skipIf(!live)("post-approval REFUSE branch, end to end", () => {
  let runtime: DeviceRevocationRuntime;
  let keeper: pg.Pool;
  let keeperClient: pg.PoolClient;

  let firstResponder: EmergencyActor;
  let refuser: EmergencyActor;

  let credentialId = "";
  let authorizationId = "";
  let postApprovalDueAt = "";
  let scopeDigest = "";
  let refuseEvidenceId = "";

  const call = (request: Partial<RouteRequest>): Promise<RouteResponse> =>
    runtime.revocationRouter.handle({
      method: request.method ?? "POST",
      path: request.path ?? EMERGENCY_PREFIX,
      headers: request.headers ?? {},
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
        label: `refuse-${RUN}`,
      });
      credentialId = target.credentialId;

      firstResponder = await createEmergencyActor(keeperClient, {
        environment: DEVELOPMENT,
        actionClasses: ["fleet.device_credential.emergency_revoke", EMERGENCY_POST_APPROVE_ACTION],
        label: `refuse-responder-${RUN}`,
      });
      refuser = await createEmergencyActor(keeperClient, {
        environment: DEVELOPMENT,
        actionClasses: [EMERGENCY_POST_APPROVE_ACTION],
        label: `refuser-${RUN}`,
      });
      await keeperClient.query("commit");
    } catch (error) {
      await keeperClient.query("rollback").catch(() => undefined);
      throw error;
    }
  }, 180_000);

  afterAll(async () => {
    if (firstResponder !== undefined) {
      await disposeEmergencyActor(keeperClient, firstResponder).catch(() => undefined);
    }
    if (refuser !== undefined) {
      await disposeEmergencyActor(keeperClient, refuser).catch(() => undefined);
    }
    keeperClient?.release();
    await runtime?.shutdown().catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  it("stage 1: the emergency is created by the first responder", async () => {
    currentPrincipal = firstResponder.userId;
    const evidence = await recordEmergencyEvidence(runtime.pool, firstResponder, {
      environment: DEVELOPMENT,
    });
    const response = await call({
      body: {
        credentialId,
        reasonCode: "DEVICE_STOLEN",
        explanation: `refuse suite ${RUN} incident`,
        incidentReference: `INC-REFUSE-${RUN}`,
        reauthEvidenceId: evidence,
        idempotencyKey: `refuse-${RUN}`,
      },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.outcome).toBe("REVOKED_IMMEDIATELY");
    authorizationId = String(response.body.authorizationId ?? "");
    postApprovalDueAt = String(response.body.postApprovalDueAt ?? "");
    expect(authorizationId).not.toBe("");
    expect(response.body.revokedCredentialCount).toBe(1);
  });

  it("stage 2: the credential is revoked and the obligation is PENDING", async () => {
    const { rows } = await keeperClient.query<{ state: string; revoked_at: Date | null }>(
      `select state::text as state, revoked_at from kitluy_devices.device_credentials
      where credential_id = $1::uuid`,
      [credentialId],
    );
    expect(rows[0]?.revoked_at).not.toBeNull();
    expect(rows[0]?.state).toBe("revoked");

    const status = await runtime.service.readEmergencyStatus(authorizationId);
    expect(status?.postApprovalDecision).toBe("PENDING");
    expect(status?.decidedAt).toBeNull();
    scopeDigest = status?.scopeDigest ?? "";
    expect(scopeDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stage 3: the FIRST RESPONDER cannot REFUSE their own emergency", async () => {
    currentPrincipal = firstResponder.userId;
    const evidence = await recordEmergencyEvidence(runtime.pool, firstResponder, {
      environment: DEVELOPMENT,
      actionClass: EMERGENCY_POST_APPROVE_ACTION,
    });
    const response = await call({
      path: `${EMERGENCY_PREFIX}/${authorizationId}/post-approval`,
      body: { decision: "REFUSE", reauthEvidenceId: evidence, note: "self refusal attempt" },
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(response.body)).toContain("SELF");
    const status = await runtime.service.readEmergencyStatus(authorizationId);
    expect(status?.postApprovalDecision, "self-refusal must leave it PENDING").toBe("PENDING");
  });

  it("stage 4: a SECOND, DISTINCT human REFUSES it", async () => {
    currentPrincipal = refuser.userId;
    refuseEvidenceId = await recordEmergencyEvidence(runtime.pool, refuser, {
      environment: DEVELOPMENT,
      actionClass: EMERGENCY_POST_APPROVE_ACTION,
    });
    const response = await call({
      path: `${EMERGENCY_PREFIX}/${authorizationId}/post-approval`,
      body: { decision: "REFUSE", reauthEvidenceId: refuseEvidenceId, note: `refuse ${RUN}` },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.outcome).toBe("MANUAL_SECURITY_REVIEW");
    expect(response.body.authorizationId).toBe(authorizationId);
    expect(response.body.postApprovalDecision).toBe("REFUSED");
  });

  it("stage 5: the verdict is recorded against the SECOND human", async () => {
    const { rows } = await keeperClient.query<{
      decider: string | null;
      verdict: string;
      reauth: string | null;
    }>(
      `select actor_user_id::text as decider, verdict::text as verdict,
              reauth_evidence_id::text as reauth
       from kitluy_devices.device_emergency_post_approval_verdicts
      where authorization_id = $1::uuid`,
      [authorizationId],
    );
    expect(rows.length, "exactly one verdict").toBe(1);
    expect(rows[0]?.decider).toBe(refuser.userId);
    expect(rows[0]?.decider).not.toBe(firstResponder.userId);
    expect(rows[0]?.verdict).toBe("REFUSED");
    expect(rows[0]?.reauth).toBe(refuseEvidenceId);
  });

  it("stage 6: the refusal evidence was consumed exactly once", async () => {
    const evidence = await readEvidence(keeperClient, refuseEvidenceId);
    expect(evidence?.lifecycleState).toBe("CONSUMED");
    expect(evidence?.consumedAt).not.toBeNull();
    // Group 0152 binds the post-approval spend to the VERDICT it decided, and
    // the verdict row carries the authorization id (stage 5), so the chain
    // evidence -> verdict -> authorization is complete and exactly one link
    // long at each step. Assert the binding the governed path actually makes.
    const { rows: verdictRows } = await keeperClient.query<{ id: string }>(
      `select verdict_id::text as id from kitluy_devices.device_emergency_post_approval_verdicts
      where authorization_id = $1::uuid`,
      [authorizationId],
    );
    expect(verdictRows.length).toBe(1);
    const { rows } = await keeperClient.query<{ n: string }>(
      `select count(*)::text as n from kitluy_auth.reauthentication_evidence
      where evidence_id = $1::uuid and consumed_for_authorization = $2::uuid`,
      [refuseEvidenceId, verdictRows[0]?.id ?? ""],
    );
    expect(rows[0]?.n, "the spend is bound to exactly one verdict").toBe("1");
    const { rows: total } = await keeperClient.query<{ n: string }>(
      `select count(*)::text as n from kitluy_auth.reauthentication_evidence
      where evidence_id = $1::uuid and consumed_at is not null`,
      [refuseEvidenceId],
    );
    expect(total[0]?.n, "the evidence was spent once and only once").toBe("1");
  });

  it("stage 7: the deadline was NOT extended or reset", async () => {
    const status = await runtime.service.readEmergencyStatus(authorizationId);
    expect(status?.postApprovalDueAt.toISOString()).toBe(new Date(postApprovalDueAt).toISOString());
    expect(status?.decidedAt).not.toBeNull();
  });

  it("stage 8: the credential remains revoked after REFUSE", async () => {
    const { rows } = await keeperClient.query<{ state: string; revoked_at: Date | null }>(
      `select state::text as state, revoked_at from kitluy_devices.device_credentials
      where credential_id = $1::uuid`,
      [credentialId],
    );
    expect(rows[0]?.revoked_at).not.toBeNull();
    expect(rows[0]?.state).toBe("revoked");
  });

  it("stage 9: the authorization scope digest is unchanged", async () => {
    const { rows } = await keeperClient.query<{ digest: string }>(
      `select scope_digest as digest
       from kitluy_devices.device_emergency_revocation_authorizations
      where authorization_id = $1::uuid`,
      [authorizationId],
    );
    expect(rows[0]?.digest).toBe(scopeDigest);
  });

  it("stage 10: the obligation is CLOSED and the decision is terminal", async () => {
    const status = await runtime.service.readEmergencyStatus(authorizationId);
    expect(status?.postApprovalDecision).toBe("REFUSED");

    const second = await call({
      path: `${EMERGENCY_PREFIX}/${authorizationId}/post-approval`,
      body: {
        decision: "REFUSE",
        reauthEvidenceId: await recordEmergencyEvidence(runtime.pool, refuser, {
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
  });

  it("stage 11: a conflicting subsequent APPROVE is refused", async () => {
    currentPrincipal = refuser.userId;
    const approveEvidence = await recordEmergencyEvidence(runtime.pool, refuser, {
      environment: DEVELOPMENT,
      actionClass: EMERGENCY_POST_APPROVE_ACTION,
    });
    const response = await call({
      path: `${EMERGENCY_PREFIX}/${authorizationId}/post-approval`,
      body: { decision: "APPROVE", reauthEvidenceId: approveEvidence, note: "too late" },
    });
    expect(response.body.outcome).toBe("ALREADY_DECIDED");
    const status = await runtime.service.readEmergencyStatus(authorizationId);
    expect(status?.postApprovalDecision, "the REFUSE verdict must survive").toBe("REFUSED");
  });

  it("stage 12: the LAPSE path refuses to decide an already-decided authorization", async () => {
    const result = await runtime.service.lapseEmergencyPostApproval(authorizationId);
    expect(result.outcome).toBe("ALREADY_DECIDED");
    const status = await runtime.service.readEmergencyStatus(authorizationId);
    expect(status?.postApprovalDecision, "the human verdict must survive").toBe("REFUSED");
  });

  it("stage 13: MANUAL_SECURITY_REVIEW escalation exists", async () => {
    const { rows } = await keeperClient.query<{
      verdict: string;
      escalation_reason: string | null;
      late: boolean;
    }>(
      `select verdict::text as verdict, escalation_reason, late
       from kitluy_devices.device_emergency_post_approval_verdicts
      where authorization_id = $1::uuid`,
      [authorizationId],
    );
    expect(rows[0]?.verdict).toBe("REFUSED");
    // A REFUSE verdict enters manual security review; escalation_reason may be
    // set by the governed function to indicate the review trigger.
    expect(rows[0]?.escalation_reason ?? "").not.toBe("");
    expect(rows[0]?.late).toBe(false);
  });

  it("stage 14: no runtime identity can restore the revoked credential", async () => {
    const { rows } = await keeperClient.query<{ role: string }>(
      `select r.rolname as role
       from (values ('kitluy_issuance_service'),('kitluy_worker_service'),
                    ('authenticated'),('anon'),('service_role')) as r(rolname)
      where has_table_privilege(r.rolname, 'kitluy_devices.device_credentials', 'UPDATE')`,
    );
    expect(rows, `roles able to UPDATE credentials directly: ${JSON.stringify(rows)}`).toEqual([]);
  });
});
