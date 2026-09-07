/**
 * END-TO-END ROUTE tests — the gate both independent reviewers said was open.
 *
 * WS-11-T003 Step 4 final completion §2: "A service method that has no route,
 * message consumer, command handler or real caller does not satisfy this gate."
 *
 * Every test here enters through `handleRequest` — the SAME function `main.ts`
 * serves on the socket — and the governed ones come out the other side having
 * changed a row in the authoritative database. Nothing calls a service method
 * directly.
 *
 * The suite COMMITS, for the reason the composition suite does: the production
 * path opens and commits its own transaction per call, and that is the behaviour
 * under test. Canonical order is required (`db:reset` → `db:seed` → `db:test` →
 * `test:rls` → vitest); the hardware profile the fixtures need comes from
 * `supabase/tests/assertions.sql`, not the seed.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createIncumbentFixture,
  DEVELOPMENT,
  DEVICE_IDENTITY,
  type IncumbentFixture,
} from "../../../packages/device-identity/test/support/renewal-fixtures.js";

import {
  resolveDeviceRevocationService,
  type DeviceRevocationRuntime,
} from "../src/composition.js";
import { handleRequest } from "../src/http.js";
import { refuseAllRequests, type RequestAuthenticator } from "../src/authentication.js";
import type { RouteRequest } from "../src/revocation-routes.js";

const LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
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
  console.warn("SKIPPED: device-registry route integration suite — local database unreachable");
}

/**
 * A TEST authenticator standing in for the edge that does not exist yet.
 *
 * Explicit, injected by the test, and named so it cannot be mistaken for
 * production behaviour: the shipped default is `refuseAllRequests`, and a
 * deployment must supply its own once BLK-005 item 8 / BLK-006 are settled.
 */
function authenticatorFor(userId: string): RequestAuthenticator {
  return {
    authenticate: () =>
      Promise.resolve({
        authenticated: true as const,
        principal: { userId, method: "TEST_INJECTED_AUTHENTICATOR" },
      }),
  };
}

describe.skipIf(!live)("the governed routes are reachable and fail closed", () => {
  let runtime: DeviceRevocationRuntime;
  let keeper: pg.Pool;

  beforeAll(async () => {
    runtime = resolveDeviceRevocationService(ENV, {
      authenticator: authenticatorFor(randomUUID()),
    });
    keeper = new pg.Pool({ connectionString: LOCAL_DSN, max: 4 });
  });
  afterAll(async () => {
    await runtime?.shutdown().catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  const call = (request: Partial<RouteRequest>) =>
    handleRequest(
      {
        method: request.method ?? "POST",
        path: request.path ?? "/v1/device-credentials/revocations",
        headers: request.headers ?? {},
        body: request.body,
      },
      { ready: true, revocationRouter: runtime.revocationRouter },
    );

  it("still serves health and version, unauthenticated", async () => {
    await expect(call({ method: "GET", path: "/health/live" })).resolves.toMatchObject({
      status: 200,
    });
    await expect(call({ method: "GET", path: "/version" })).resolves.toMatchObject({ status: 200 });
  });

  it("REFUSES every governed route when no authenticator is configured", async () => {
    // The shipped default. A service that cannot say who is calling must not run
    // a governed emergency revocation.
    const unconfigured = resolveDeviceRevocationService(ENV, {
      authenticator: refuseAllRequests(),
    });
    try {
      for (const [method, path] of [
        ["POST", "/v1/device-credentials/revocations"],
        ["POST", "/v1/device-credentials/emergency-revocations"],
        ["GET", `/v1/device-credentials/emergency-revocations/${randomUUID()}`],
      ] as const) {
        const response = await handleRequest(
          { method, path, headers: {}, body: {} },
          { ready: true, revocationRouter: unconfigured.revocationRouter },
        );
        expect(response.status, `${method} ${path}`).toBe(503);
        expect(JSON.stringify(response.body)).toContain("AUTHENTICATION_NOT_CONFIGURED");
      }
    } finally {
      await unconfigured.shutdown().catch(() => undefined);
    }
  });

  it("fails closed with 503 when the router is absent entirely", async () => {
    const response = await handleRequest(
      { method: "POST", path: "/v1/device-credentials/revocations", headers: {}, body: {} },
      { ready: true },
    );
    // 503, not 404: "not configured" and "no such route" are different facts.
    expect(response.status).toBe(503);
  });

  it("REFUSES a body that tries to supply actor or authority", async () => {
    for (const field of ["actorUserId", "userId", "sub", "permissionKey"]) {
      const response = await call({
        path: "/v1/device-credentials/emergency-revocations",
        body: { [field]: randomUUID(), credentialId: randomUUID() },
      });
      expect(response.status, field).toBe(400);
      expect(JSON.stringify(response.body)).toContain("CALLER_SUPPLIED_AUTHORITY_REFUSED");
    }
  });

  it("validates the request schema before touching the database", async () => {
    const response = await call({
      path: "/v1/device-credentials/emergency-revocations",
      body: { credentialId: "not-a-uuid" },
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain("VALIDATION_FAILED");
  });

  it("rejects an emergency reason outside the five approved ones", async () => {
    const response = await call({
      path: "/v1/device-credentials/emergency-revocations",
      body: {
        credentialId: randomUUID(),
        reasonCode: "BECAUSE_I_SAID_SO",
        explanation: "no",
        incidentReference: `INC-${RUN}`,
        reauthEvidenceId: randomUUID(),
      },
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain("reasonCode");
  });

  it("returns 404 for an unknown route and 405 for a wrong method", async () => {
    await expect(call({ method: "GET", path: "/v1/nope" })).resolves.toMatchObject({ status: 404 });
    await expect(
      call({ method: "DELETE", path: "/v1/device-credentials/revocations" }),
    ).resolves.toMatchObject({ status: 405 });
  });

  it("emits a correlation id on every governed response", async () => {
    const supplied = randomUUID();
    const response = await call({
      path: "/v1/device-credentials/emergency-revocations",
      headers: { "x-kitluy-correlation-id": supplied },
      body: { credentialId: "bad" },
    });
    expect((response.body as Record<string, unknown>).correlationId).toBe(supplied);

    const generated = await call({
      path: "/v1/device-credentials/emergency-revocations",
      body: { credentialId: "bad" },
    });
    expect(String((generated.body as Record<string, unknown>).correlationId)).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it("REACHES THE GOVERNED EMERGENCY DOOR and is permanently refused", async () => {
    // The end-to-end proof: HTTP in, governed DATABASE refusal out.
    //
    // The status is 422 rather than 403 and that is correct — the credential id
    // is random, so the database refuses on the REQUEST (no such credential)
    // before it ever reaches the authority question. The first version of this
    // test asserted 403 and was simply wrong about which refusal it had
    // provoked; the route's own split (403 for authority, 422 for request) is
    // exercised by the refusal-code mapping unit tests.
    //
    // What matters here, and is asserted, is that the request travelled all the
    // way to the governed function: only the database emits a `KLUY-` code.
    const response = await call({
      path: "/v1/device-credentials/emergency-revocations",
      body: {
        credentialId: randomUUID(),
        reasonCode: "KEY_COMPROMISE",
        explanation: `route suite ${RUN}`,
        incidentReference: `INC-ROUTE-${RUN}`,
        reauthEvidenceId: randomUUID(),
      },
    });
    const body = response.body as Record<string, unknown>;
    expect(response.status).toBe(422);
    expect(body.outcome).toBe("EMERGENCY_REFUSED");
    expect(body.permanent).toBe(true);
    expect(body.retryable).toBe(false);
    expect(String(body.refusalCode)).toMatch(/^KLUY-/);
  });

  it("returns 404 from the STATUS route for an authorization that does not exist", async () => {
    const response = await call({
      method: "GET",
      path: `/v1/device-credentials/emergency-revocations/${randomUUID()}`,
    });
    expect(response.status).toBe(404);
  });

  it("never leaks driver text, SQL or table names through a route", async () => {
    const response = await call({
      path: "/v1/device-credentials/revocations",
      body: {
        deviceRecordId: randomUUID(),
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        credentialGeneration: 1,
        reasonCode: "ADMINISTRATIVE_REPLACEMENT",
        reason: "leak probe",
        recoveryDisposition: "REPROVISION_REQUIRED",
        approvalRequestId: randomUUID(),
        approvedBy: "probe@routes",
      },
    });
    const serialized = JSON.stringify(response.body);
    for (const leak of ["device_credentials", "PL/pgSQL", "select ", "kitluy_devices."]) {
      expect(serialized, `leaked ${leak}`).not.toContain(leak);
    }
  });
});

describe.skipIf(!live)("a real revocation through the route reaches the database", () => {
  let runtime: DeviceRevocationRuntime;
  let keeper: pg.Pool;
  let keeperClient: pg.PoolClient;
  let fixture: IncumbentFixture;
  const operator = randomUUID();

  beforeAll(async () => {
    runtime = resolveDeviceRevocationService(ENV, { authenticator: authenticatorFor(operator) });
    keeper = new pg.Pool({ connectionString: LOCAL_DSN, max: 4 });
    keeperClient = await keeper.connect();
    await keeperClient.query("begin");
    try {
      fixture = await createIncumbentFixture(keeperClient, {
        issuedAtTrustedTime: new Date("2026-07-31T02:00:00.000Z"),
        label: `routes-${RUN}`,
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

  it("REVOKES through the HTTP route and the credential is dead in the database", async () => {
    // Build the four-eyes approval the database requires, bound to the digest IT
    // derived (RC-019, group 0146). The route cannot forge this: the binding is
    // checked against stored rows.
    await keeperClient.query("begin");
    let scope: Record<string, unknown>;
    try {
      await keeperClient.query(
        // MEMBERSHIP-CHECKED AND RACE-TOLERANT.
        //
        // Suites run in parallel against one server and several borrow this same
        // authority. An unconditional GRANT makes two of them collide on
        // `pg_auth_members_role_member_index`, which fails a suite for a reason
        // that has nothing to do with what it is testing.
        `do $borrow$ begin
           if not pg_has_role(current_user, 'kitluy_credential_issuer', 'MEMBER') then
             execute format('grant kitluy_credential_issuer to %I', current_user);
           end if;
         exception when unique_violation then null;
         end $borrow$;`,
      );
      await keeperClient.query("set local role kitluy_credential_issuer");
      const { rows } = await keeperClient.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.authoritative_revocation_scope_v1($1::uuid, 'ADMINISTRATIVE_REPLACEMENT') as result`,
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
    expect(scope.resolved).toBe(true);

    const { rows: policy } = await keeperClient.query<{ id: string }>(
      `insert into kitluy_auth.approval_policies
         (policy_key, version, permission_key, environment, quorum, status, risk_class)
       values ($1, 1, 'device.credential.revoke', $2, 1, 'ACTIVE', 'A4') returning id`,
      [`cred.revocation.a4.routes.${randomUUID().slice(0, 8)}`, DEVELOPMENT],
    );
    const { rows: approval } = await keeperClient.query<{ id: string }>(
      `insert into kitluy_auth.approval_requests
         (policy_id, requester_id, resource_type, resource_id, environment, action,
          payload_hash, reason, status)
       values ($1::uuid, '00000000-0000-4000-8000-000000000007', 'device', $2::uuid, $3,
               'device_credential_revocation', $4, 'route suite', 'APPROVED') returning id`,
      [policy[0]?.id, fixture.deviceRecordId, DEVELOPMENT, String(scope.payload_hash ?? "")],
    );
    const approvalId = approval[0]?.id ?? "";
    await keeperClient.query(
      `insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
       values ($1::uuid, '00000000-0000-4000-8000-000000000009', 'APPROVE')`,
      [approvalId],
    );

    // THROUGH THE ROUTE. Not through the service object.
    const response = await handleRequest(
      {
        method: "POST",
        path: "/v1/device-credentials/revocations",
        headers: {},
        body: {
          revocationRequestId: `route-${randomUUID()}`,
          deviceRecordId: fixture.deviceRecordId,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
          credentialGeneration: 1,
          reasonCode: "ADMINISTRATIVE_REPLACEMENT",
          reason: "revoked over HTTP so the route can be proved to reach the door",
          recoveryDisposition: "REPROVISION_REQUIRED",
          approvalRequestId: approvalId,
          approvedBy: "approver@routes",
          incidentReference: `INC-ROUTE-${RUN}`,
          incidentScopeId:
            typeof scope.incident_scope_id === "string" ? scope.incident_scope_id : undefined,
        },
      },
      { ready: true, revocationRouter: runtime.revocationRouter },
    );

    const body = response.body as Record<string, unknown>;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.outcome).toBe("REVOKED");
    // The AUTHENTICATED subject was recorded, not a body field.
    expect(body.requestedBy).toBe(operator);

    // AND THE ROW IS ACTUALLY DEAD.
    const { rows } = await keeperClient.query<{ state: string; revoked_at: Date | null }>(
      `select state::text as state, revoked_at from kitluy_devices.device_credentials
        where credential_id = $1::uuid`,
      [fixture.credentialId],
    );
    expect(rows[0]?.state).toBe("revoked");
    expect(rows[0]?.revoked_at).not.toBeNull();
  });
});
