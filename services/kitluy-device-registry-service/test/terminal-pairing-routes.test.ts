/**
 * The Pi Terminal pairing HTTP surface.
 *
 * The same properties `hub-pairing-routes.test.ts` protects, for the terminal
 * route: a malformed code and a wrong code are indistinguishable; LOCKED stays
 * distinguishable in the message only; unknown fields and a malformed device id
 * are request problems; and a paired terminal is handed the owner's §7 context
 * with `activated` stated explicitly.
 */
import { describe, expect, it } from "vitest";

import { httpStatusFor } from "@kitluy/api-errors";

import type { BootstrapRouteRequest } from "../src/provisioning-routes.js";
import type {
  PairedTerminalMaterial,
  TerminalPairingComposition,
  TerminalPairingCompositionResult,
} from "../src/terminal-pairing-composition.js";
import {
  createTerminalPairingRouter,
  TERMINAL_PAIRING_PREFIX,
} from "../src/terminal-pairing-routes.js";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const GOOD_CODE = "ABCD8291";

function request(
  body: unknown,
  overrides: Partial<BootstrapRouteRequest> = {},
): BootstrapRouteRequest {
  return {
    method: "POST",
    path: TERMINAL_PAIRING_PREFIX,
    headers: { "content-type": "application/json" },
    sourceIp: "10.0.0.7",
    rawBody: JSON.stringify(body),
    ...overrides,
  };
}

function stub(
  outcome: TerminalPairingCompositionResult<PairedTerminalMaterial>,
): TerminalPairingComposition {
  return { pair: () => Promise.resolve(outcome) } as unknown as TerminalPairingComposition;
}

const PAIRED: TerminalPairingCompositionResult<PairedTerminalMaterial> = {
  result: "PAIRED",
  correlationId: "corr-1",
  data: {
    deviceRecordId: DEVICE,
    sessionId: "22222222-2222-4222-8222-222222222222",
    assignmentId: "33333333-3333-4333-8333-333333333333",
    assignmentGeneration: 1,
    storeAssignment: "pending_trust",
    activated: false,
    context: {
      contextVersion: "kitluy.terminal-pairing-context.v1",
      tenantId: "44444444-4444-4444-8444-444444444444",
      tenantReference: "HET — HET Demo",
      digitalStoreId: "55555555-5555-4555-8555-555555555555",
      digitalStoreReference: "DEMO-LAUNDRY-001 — Demo Laundry",
      storeLocationId: "66666666-6666-4666-8666-666666666666",
      storeLocationReference: "BKK1 — Boeung Keng Kang 1",
      storeHubDeviceId: "77777777-7777-4777-8777-777777777777",
      storeHubReference: "KL-6C4917D5C6DA",
      physicalTerminalId: "88888888-8888-4888-8888-888888888888",
      physicalTerminalLabel: "Front Counter 01",
      terminalProfileKeys: ["laundry.t1.intake_cashier", "laundry.t2.customer_display"],
      terminalAssignments: [
        { terminalAssignmentId: "9", terminalProfileKey: "laundry.t1.intake_cashier" },
        { terminalAssignmentId: "10", terminalProfileKey: "laundry.t2.customer_display" },
      ],
      vertical: "laundry",
      desiredApplications: ["laundry.pos"],
      allowedSurfaces: [],
      requiredAppFamily: null,
      releaseChannel: null,
      environment: "development",
    },
  },
};

const refused = (
  result: TerminalPairingCompositionResult<PairedTerminalMaterial>["result"],
): TerminalPairingCompositionResult<PairedTerminalMaterial> => ({ result, correlationId: "c" });

const router = (outcome = PAIRED) => createTerminalPairingRouter({ composition: stub(outcome) });

describe("a paired Pi Terminal is told everything the owner's §7 lists, and nothing it chose", () => {
  it("returns the context from server rows and states activated: false", async () => {
    const res = await router().handle(request({ deviceRecordId: DEVICE, code: GOOD_CODE }));
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.activated).toBe(false);
    expect(body.storeAssignment).toBe("pending_trust");
    const context = body.context as Record<string, unknown>;
    expect(context.digitalStoreReference).toBe("DEMO-LAUNDRY-001 — Demo Laundry");
    expect(context.storeHubReference).toBe("KL-6C4917D5C6DA");
    expect(context.physicalTerminalLabel).toBe("Front Counter 01");
    expect(context.terminalProfileKeys).toEqual([
      "laundry.t1.intake_cashier",
      "laundry.t2.customer_display",
    ]);
    // The composition now emits the registry key, not the DB spelling (0215 stores upper-case).
    expect(context.vertical).toBe("laundry");
    expect(context.requiredAppFamily).toBeNull();
    // v2: the server-derived application and the Partner-configured surfaces
    // reach the Pi in the same context; the vertical is the registry key.
    expect(context.desiredApplications).toEqual(["laundry.pos"]);
    expect(context.allowedSurfaces).toEqual([]);
    expect(context.vertical).toBe("laundry");
    expect(context.releaseChannel).toBeNull();
    expect(body.detail).toContain("awaiting trust");
  });

  it("reports an advanced device as active from what the doors said", async () => {
    const r = createTerminalPairingRouter({
      composition: stub(PAIRED),
      advanceTrust: () =>
        Promise.resolve({
          kind: "advanced",
          lifecycleState: "active",
          trustedTimeStatus: "trusted",
          certificate: { kind: "issued" },
        } as never),
    });
    const res = await r.handle(request({ deviceRecordId: DEVICE, code: GOOD_CODE }));
    const body = res.body as Record<string, unknown>;
    expect(body.activated).toBe(true);
    expect(body.lifecycleState).toBe("active");
  });
});

describe("a wrong code and a malformed code are the same answer", () => {
  it("refuses a wrong code as a scope refusal, not a validation failure", async () => {
    const res = await router(refused("CODE_REFUSED")).handle(
      request({ deviceRecordId: DEVICE, code: GOOD_CODE }),
    );
    expect(res.status).toBe(httpStatusFor("SCOPE_PERMISSION_DENIED"));
  });

  it("refuses a code of the wrong shape with the SAME status", async () => {
    const res = await router().handle(request({ deviceRecordId: DEVICE, code: "no" }));
    expect(res.status).toBe(httpStatusFor("SCOPE_PERMISSION_DENIED"));
  });

  it("tells a locked-out installer to fetch a new code, in the message only", async () => {
    const res = await router(refused("LOCKED")).handle(
      request({ deviceRecordId: DEVICE, code: GOOD_CODE }),
    );
    expect(res.status).toBe(httpStatusFor("SCOPE_PERMISSION_DENIED"));
    expect(JSON.stringify(res.body)).toContain("new pairing code");
  });

  it("names the device's own state when it already holds an assignment", async () => {
    const res = await router(refused("ALREADY_ASSIGNED")).handle(
      request({ deviceRecordId: DEVICE, code: GOOD_CODE }),
    );
    expect(res.status).toBe(httpStatusFor("RESOURCE_VERSION_CONFLICT"));
    expect(JSON.stringify(res.body)).toContain("already assigned");
    expect(JSON.stringify(res.body)).not.toContain("ask for a new");
  });
});

describe("request problems are request problems", () => {
  it("refuses an unknown field", async () => {
    const res = await router().handle(
      request({ deviceRecordId: DEVICE, code: GOOD_CODE, digitalStoreId: "x" }),
    );
    expect(res.status).toBe(httpStatusFor("VALIDATION_FAILED"));
    expect(JSON.stringify(res.body)).toContain("unknown field");
  });

  it("refuses a malformed device id", async () => {
    const res = await router().handle(request({ deviceRecordId: "nope", code: GOOD_CODE }));
    expect(res.status).toBe(httpStatusFor("VALIDATION_FAILED"));
  });

  it("refuses a non-string code as a request problem, not a code problem", async () => {
    const res = await router().handle(request({ deviceRecordId: DEVICE, code: 12345678 }));
    expect(res.status).toBe(httpStatusFor("VALIDATION_FAILED"));
  });

  it("answers 404 for any other path and refuses a non-POST", async () => {
    const other = await router().handle(request({}, { path: "/v1/terminal-pairing/x" }));
    expect(other.status).toBe(httpStatusFor("RESOURCE_NOT_FOUND"));
    const get = await router().handle(request({}, { method: "GET" }));
    expect(get.status).toBe(httpStatusFor("VALIDATION_FAILED"));
  });

  it("requires a JSON content type", async () => {
    const res = await router().handle(
      request({ deviceRecordId: DEVICE, code: GOOD_CODE }, { headers: {} }),
    );
    expect(res.status).toBe(httpStatusFor("VALIDATION_FAILED"));
  });
});

describe("SEAT_NOT_DERIVABLE (TERMINAL-APPLICATION-ASSIGNMENT-001)", () => {
  it("is a 4xx validation refusal with a safe operator sentence and no internal detail", async () => {
    const res = await router({
      result: "SEAT_NOT_DERIVABLE",
      correlationId: "corr-1",
      auditDetail: "terminal_seat.application.none_derivable: internal",
    }).handle(request({ deviceRecordId: DEVICE, code: GOOD_CODE }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const text = JSON.stringify(res.body);
    expect(text).toContain("VALIDATION_FAILED");
    expect(text).toContain("cannot be installed as defined");
    expect(text).not.toContain("none_derivable");
  });
});
