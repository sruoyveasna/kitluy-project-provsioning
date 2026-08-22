/**
 * The approval route, and the refusals that must never become approvals.
 *
 * ===========================================================================
 * WHAT THESE TESTS ARE FOR
 * ===========================================================================
 * The governed door in migration 0197 already refuses a blank reason, a missing
 * verification reference, the wrong lifecycle state and an open trust incident.
 * These tests cover the layer ABOVE it — the one that decides whether the door
 * is reached at all, with which arguments, and on whose authority.
 *
 * That layer is where an approval surface goes wrong: by validating before
 * authorizing (an oracle over device ids), by trusting a caller-supplied
 * approver name (an audit record signed with someone else's name), or by
 * accepting a bare device id (the one-click "Trust Device" plan §4.4 forbids).
 */
import { describe, expect, it } from "vitest";

import { handleManagementRequest, type ManagementRouterDependencies } from "../src/http.js";

const ADMIN_USER = "b145d533-b905-47fc-a551-8ad07ecfe39b";
const DEVICE_ID = "9e43a581-8281-4637-865b-ac3bd1d3b665";
const ROUTE = `/management/v1/devices/${DEVICE_ID}/approve-enrollment`;

/**
 * Stubs the SAME shape `authorizeRequest` reads: one row from
 * `kitluy_auth.admin_user_profiles`, carrying the profile status and whether the
 * requested permission is granted. Copied from `management-routes.test.ts` so
 * the two suites cannot disagree about what an authorized Admin looks like.
 */
function deps(options: {
  readonly permitted?: boolean;
  readonly approvalConfigured?: boolean;
  readonly environment?: string;
  readonly onApprove?: (sql: string, params: readonly unknown[]) => unknown;
  readonly asked?: string[];
}): ManagementRouterDependencies {
  const permitted = options.permitted ?? true;
  const asked = options.asked ?? [];

  const db = {
    query(text: string, params?: readonly unknown[]): Promise<{ rows: unknown[] }> {
      if (text.includes("admin_user_profiles")) {
        // params[1] is the permission `authorizeRequest` was asked to evaluate.
        asked.push(String(params?.[1] ?? ""));
        return Promise.resolve({
          rows: [
            {
              profile_status: "ACTIVE",
              disabled_at: null,
              permitted,
              permissions: permitted ? ["fleet.device_enrollment.approve"] : [],
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    },
  };

  const pool = {
    connect: () =>
      Promise.resolve({
        query: (sql: string, params?: readonly unknown[]) => {
          if (options.onApprove !== undefined && sql.includes("approve_device_enrollment_v1")) {
            const result = options.onApprove(sql, params ?? []);
            if (result instanceof Error) throw result;
            return Promise.resolve({ rows: [{ result }] });
          }
          return Promise.resolve({ rows: [] });
        },
        release: () => undefined,
      }),
  };

  return {
    db: db as never,
    verifier: { verify: () => Promise.resolve({ userId: ADMIN_USER }) } as never,
    ...(options.approvalConfigured === false ? {} : { approval: { pool } as never }),
    environment: options.environment ?? "development",
  };
}

function post(body: unknown, url = ROUTE): Parameters<typeof handleManagementRequest>[1] {
  return {
    method: "POST",
    url,
    authorization: "Bearer token",
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

const VALID = { reason: "Board serial matched the sticker", verificationEvidenceRef: "HET-CHK-1" };

describe("authority is decided before anything else", () => {
  it("asks for the approval permission, not merely fleet read", async () => {
    const asked: string[] = [];
    await handleManagementRequest(
      deps({ asked, onApprove: () => ({ lifecycle_state: "enrolled" }) }),
      post(VALID),
    );
    expect(asked).toContain("fleet.device_enrollment.approve");
  });

  it("refuses an unpermitted caller with 403", async () => {
    const response = await handleManagementRequest(deps({ permitted: false }), post(VALID));
    expect(response.status).toBe(403);
  });

  it("refuses BEFORE validating the device id, so ids cannot be probed", async () => {
    // A malformed id with no permission must answer 403, never 404. If the route
    // validated first, an unauthorized caller could tell a well-formed device id
    // from a malformed one — a small but free oracle over the identifier space.
    const response = await handleManagementRequest(
      deps({ permitted: false }),
      post(VALID, "/management/v1/devices/not-a-uuid/approve-enrollment"),
    );
    expect(response.status).toBe(403);
  });
});

describe("the request body must state what was verified", () => {
  it("refuses a bare device id with no reason", async () => {
    const response = await handleManagementRequest(deps({}), post({}));
    expect(response.status).toBe(422);
  });

  it("refuses a reason with no verification evidence reference", async () => {
    const response = await handleManagementRequest(deps({}), post({ reason: "looks fine" }));
    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain("verification evidence");
  });

  it("refuses whitespace as a reason", async () => {
    const response = await handleManagementRequest(
      deps({}),
      post({ reason: "   ", verificationEvidenceRef: "HET-CHK-1" }),
    );
    expect(response.status).toBe(422);
  });

  it("refuses an unknown field rather than ignoring it", async () => {
    // A caller that believes it may set the lifecycle state is a caller to fix.
    const response = await handleManagementRequest(
      deps({}),
      post({ ...VALID, lifecycleState: "enrolled" }),
    );
    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain("lifecycleState");
  });

  it("refuses a body that is not a JSON object", async () => {
    const response = await handleManagementRequest(deps({}), post("not json"));
    expect(response.status).toBe(422);
  });
});

describe("the approver is taken from the token, never from the body", () => {
  it("names the verified user as the actor", async () => {
    let actor = "";
    await handleManagementRequest(
      deps({
        onApprove: (_sql, params) => {
          actor = String(params[1]);
          return { lifecycle_state: "enrolled" };
        },
      }),
      post(VALID),
    );
    // Not "whoever the body said". An approval is an immutable audit record, and
    // a caller able to name its own approver could sign someone else's name to it.
    expect(actor).toBe(`admin/${ADMIN_USER}`);
  });

  it("passes the reason and evidence through unchanged", async () => {
    let captured: readonly unknown[] = [];
    await handleManagementRequest(
      deps({
        onApprove: (_sql, params) => {
          captured = params;
          return { lifecycle_state: "enrolled" };
        },
      }),
      post(VALID),
    );
    expect(captured[2]).toBe(VALID.reason);
    expect(captured[4]).toBe(VALID.verificationEvidenceRef);
  });

  it("sends the service environment, so four-eyes is decided by deployment", async () => {
    let environment = "";
    await handleManagementRequest(
      deps({
        environment: "pilot",
        onApprove: (_sql, params) => {
          environment = String(params[3]);
          return { lifecycle_state: "enrolled" };
        },
      }),
      post(VALID),
    );
    expect(environment).toBe("pilot");
  });
});

describe("governed refusals reach the caller as decisions, not as faults", () => {
  it("maps an open trust incident to 422 with its code", async () => {
    const response = await handleManagementRequest(
      deps({
        onApprove: () =>
          new Error(
            "KLUY-APPROVE-OPEN-INCIDENT: device x has 1 open trust incident(s); clear them first",
          ),
      }),
      post(VALID),
    );
    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain("KLUY-APPROVE-OPEN-INCIDENT");
    // The operator-facing text must say what to DO, not repeat the SQL exception.
    expect(JSON.stringify(response.body)).toContain("containment door");
  });

  it("maps a wrong lifecycle state to 422", async () => {
    const response = await handleManagementRequest(
      deps({
        onApprove: () =>
          new Error("KLUY-APPROVE-WRONG-STATE: device x is quarantined; only a pending device"),
      }),
      post(VALID),
    );
    expect(response.status).toBe(422);
  });

  it("maps an unknown device to 404, not 422", async () => {
    const response = await handleManagementRequest(
      deps({ onApprove: () => new Error("KLUY-APPROVE-NO-DEVICE: no such device x") }),
      post(VALID),
    );
    expect(response.status).toBe(404);
  });

  it("answers 200 and says approval issued no certificate", async () => {
    const response = await handleManagementRequest(
      deps({ onApprove: () => ({ lifecycle_state: "enrolled" }) }),
      post(VALID),
    );
    expect(response.status).toBe(200);
    // BLK-005: an approved board is provisioning-ELIGIBLE and holds no
    // operational credential. A portal that read "enrolled" as "ready to serve
    // terminals" would be wrong, so the route says so in words.
    expect(JSON.stringify(response.body)).toContain("operational certificate");
  });
});

describe("route shape", () => {
  it("refuses GET on the approval route", async () => {
    const response = await handleManagementRequest(deps({}), {
      method: "GET",
      url: ROUTE,
      authorization: "Bearer token",
    });
    expect(response.status).toBe(405);
  });

  it("fails CLOSED with 503 when approval is not configured", async () => {
    // 404 would tell an Admin the feature does not exist. "Not configured on this
    // instance" and "no such route" are different facts.
    const response = await handleManagementRequest(
      deps({ approvalConfigured: false }),
      post(VALID),
    );
    expect(response.status).toBe(503);
  });
});
