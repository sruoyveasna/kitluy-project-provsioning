/**
 * The Store Hub pairing HTTP surface.
 *
 * The properties that matter most here are the ones easiest to destroy by
 * accident at the route layer:
 *
 *   1. A MALFORMED code and a WRONG code must be indistinguishable. If the shape
 *      check answered `VALIDATION_FAILED` and a wrong code answered
 *      `SCOPE_PERMISSION_DENIED`, a guesser would learn the alphabet and the
 *      length for free — without spending one of its five attempts at the door.
 *   2. LOCKED must stay distinguishable from CODE_REFUSED in the MESSAGE, because
 *      an operator who keeps typing at a locked claim is wasting their time,
 *      while remaining the same canonical error code so the distinction carries
 *      no extra information about the code itself.
 *   3. The rate limiter must run before parsing, must count malformed attempts,
 *      and must NOT be keyed on anything the caller chooses.
 *   4. `activated` must be present and false. Pairing assigns; it does not
 *      activate (BLK-005).
 */
import { describe, expect, it } from "vitest";

import { httpStatusFor } from "@kitluy/api-errors";

import { createHubPairingRouter, HUB_PAIRING_PREFIX } from "../src/hub-pairing-routes.js";
import type {
  HubPairingComposition,
  HubPairingCompositionResult,
  PairedHubMaterial,
} from "../src/hub-pairing-composition.js";
import { BootstrapRateLimiter, type BootstrapRouteRequest } from "../src/provisioning-routes.js";

const DEVICE = "11111111-1111-4111-8111-111111111111";
/** Valid Crockford Base32, eight characters. */
const GOOD_CODE = "ABCD8291";

function request(
  body: unknown,
  overrides: Partial<BootstrapRouteRequest> = {},
): BootstrapRouteRequest {
  return {
    method: "POST",
    path: HUB_PAIRING_PREFIX,
    headers: { "content-type": "application/json" },
    sourceIp: "10.0.0.1",
    rawBody: JSON.stringify(body),
    ...overrides,
  };
}

/** A composition stub: the ROUTE layer is what is under test here. */
function stub(outcome: HubPairingCompositionResult<PairedHubMaterial>): HubPairingComposition {
  return { pair: () => Promise.resolve(outcome) } as unknown as HubPairingComposition;
}

const PAIRED: HubPairingCompositionResult<PairedHubMaterial> = {
  result: "PAIRED",
  correlationId: "corr-1",
  data: {
    deviceRecordId: DEVICE,
    assignmentId: "22222222-2222-4222-8222-222222222222",
    tenantId: "33333333-3333-4333-8333-333333333333",
    digitalStoreId: "44444444-4444-4444-8444-444444444444",
    storeLocationId: "55555555-5555-4555-8555-555555555555",
    storeAssignment: "pending_trust",
    activated: false,
  },
};

const refusedOutcome = (
  result: HubPairingCompositionResult<PairedHubMaterial>["result"],
): HubPairingCompositionResult<PairedHubMaterial> => ({ result, correlationId: "corr-2" });

function router(outcome = PAIRED, limiter?: BootstrapRateLimiter) {
  return createHubPairingRouter({
    composition: stub(outcome),
    ...(limiter === undefined ? {} : { rateLimiter: limiter }),
  });
}

describe("a paired Hub is told the truth about its state", () => {
  it("returns the assignment and says activated:false", async () => {
    const response = await router().handle(request({ deviceRecordId: DEVICE, code: GOOD_CODE }));

    expect(response.status).toBe(200);
    expect(response.body.storeAssignment).toBe("pending_trust");
    // Explicitly present and false. A Hub reading `activated` as absent-and-
    // therefore-fine would believe it can serve terminals; it cannot until
    // certificates exist (BLK-005).
    expect(response.body.activated).toBe(false);
    expect(response.body.assignmentId).toBe(PAIRED.data?.assignmentId);
  });

  it("never returns an audit detail", async () => {
    const response = await router({
      result: "CODE_REFUSED",
      correlationId: "corr-3",
      auditDetail: "wrong or malformed code",
    }).handle(request({ deviceRecordId: DEVICE, code: GOOD_CODE }));

    expect(JSON.stringify(response.body)).not.toContain("wrong or malformed");
  });
});

describe("a malformed code and a wrong code are indistinguishable", () => {
  it("gives a code containing I, L, O or U the SAME answer as a wrong code", async () => {
    // `IOIO1234` is eight alphanumerics, so it passes the transport shape and is
    // refused for its ALPHABET — which must look exactly like being wrong.
    const wrong = await router(refusedOutcome("CODE_REFUSED")).handle(
      request({ deviceRecordId: DEVICE, code: GOOD_CODE }),
    );
    const badAlphabet = await router(refusedOutcome("CODE_REFUSED")).handle(
      request({ deviceRecordId: DEVICE, code: "IOIO1234" }),
    );

    expect(badAlphabet.status).toBe(wrong.status);
    expect(badAlphabet.body).toEqual(wrong.body);
  });

  it("gives a code of the WRONG LENGTH the same answer too, not a 400", async () => {
    const short = await router(refusedOutcome("CODE_REFUSED")).handle(
      request({ deviceRecordId: DEVICE, code: "ABC" }),
    );

    // Refused as a code. `VALIDATION_FAILED` here would reveal the length for
    // free, and would not cost the caller an attempt at the door.
    expect(short.status).toBe(httpStatusFor("SCOPE_PERMISSION_DENIED"));
    expect(short.status).not.toBe(httpStatusFor("VALIDATION_FAILED"));
  });

  it("still refuses a NON-STRING code as a bad request, because that is not an attempt", async () => {
    const response = await router().handle(request({ deviceRecordId: DEVICE, code: 12345678 }));
    expect(response.status).toBe(httpStatusFor("VALIDATION_FAILED"));
  });
});

describe("LOCKED is actionable without being informative", () => {
  it("shares CODE_REFUSED's status but tells the operator to get a new code", async () => {
    const locked = await router(refusedOutcome("LOCKED")).handle(
      request({ deviceRecordId: DEVICE, code: GOOD_CODE }),
    );
    const refused = await router(refusedOutcome("CODE_REFUSED")).handle(
      request({ deviceRecordId: DEVICE, code: GOOD_CODE }),
    );

    expect(locked.status).toBe(refused.status);
    expect(JSON.stringify(locked.body)).toContain("ask for a new pairing code");
    expect(JSON.stringify(refused.body)).not.toContain("ask for a new pairing code");
  });
});

describe("transport discipline", () => {
  it("refuses an unknown body field rather than ignoring it", async () => {
    const response = await router().handle(
      request({ deviceRecordId: DEVICE, code: GOOD_CODE, tenantId: "sneaky" }),
    );
    expect(response.status).toBe(httpStatusFor("VALIDATION_FAILED"));
    expect(JSON.stringify(response.body)).toContain("tenantId");
  });

  it("refuses a body that names the scope, because scope is server-derived", async () => {
    for (const field of ["digitalStoreId", "storeLocationId", "assignmentId"]) {
      const response = await router().handle(
        request({ deviceRecordId: DEVICE, code: GOOD_CODE, [field]: "x" }),
      );
      expect(response.status).toBe(httpStatusFor("VALIDATION_FAILED"));
    }
  });

  it("requires application/json", async () => {
    const response = await router().handle(
      request(
        { deviceRecordId: DEVICE, code: GOOD_CODE },
        { headers: { "content-type": "text/plain" } },
      ),
    );
    expect(response.status).toBe(httpStatusFor("VALIDATION_FAILED"));
  });

  it("refuses a malformed device id", async () => {
    const response = await router().handle(
      request({ deviceRecordId: "not-a-uuid", code: GOOD_CODE }),
    );
    expect(response.status).toBe(httpStatusFor("VALIDATION_FAILED"));
  });

  it("refuses anything but POST", async () => {
    const response = await router().handle(
      request({ deviceRecordId: DEVICE, code: GOOD_CODE }, { method: "GET" }),
    );
    expect(response.status).toBe(httpStatusFor("VALIDATION_FAILED"));
  });

  it("refuses an oversized body BEFORE parsing it", async () => {
    // 17 KiB of text that is not JSON at all. If the size gate ran after the
    // parse, an unauthenticated caller could force unbounded JSON.parse work.
    const response = await router().handle(request({}, { rawBody: "x".repeat(17 * 1024) }));
    expect(response.status).toBe(httpStatusFor("VALIDATION_FAILED"));
    expect(JSON.stringify(response.body)).toContain("maximum size");
  });
});

describe("the rate limiter", () => {
  it("counts MALFORMED attempts, so garbage is not free", async () => {
    const limiter = new BootstrapRateLimiter();
    const r = router(PAIRED, limiter);

    // Burst capacity is 3 and the refill is slower than a test runs, so a fourth
    // request must be refused even though every one of these is malformed.
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const response = await r.handle(request({}, { rawBody: "not json at all" }));
      statuses.push(response.status);
    }

    expect(statuses[3]).toBe(httpStatusFor("RATE_LIMITED"));
  });

  it("is NOT keyed on the caller-supplied device id", async () => {
    const limiter = new BootstrapRateLimiter();
    const r = router(PAIRED, limiter);

    // Rotating the device id must not mint a fresh bucket. If it did, a guesser
    // would defeat the limiter by varying a field it fully controls.
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const response = await r.handle(
        request({ deviceRecordId: `1111111${i}-1111-4111-8111-111111111111`, code: GOOD_CODE }),
      );
      statuses.push(response.status);
    }

    expect(statuses[3]).toBe(httpStatusFor("RATE_LIMITED"));
  });

  it("sends Retry-After when it refuses", async () => {
    const limiter = new BootstrapRateLimiter();
    const r = router(PAIRED, limiter);
    let last = await r.handle(request({ deviceRecordId: DEVICE, code: GOOD_CODE }));
    for (let i = 0; i < 4; i += 1) {
      last = await r.handle(request({ deviceRecordId: DEVICE, code: GOOD_CODE }));
    }
    expect(last.status).toBe(httpStatusFor("RATE_LIMITED"));
    expect(last.headers?.["Retry-After"]).toBeDefined();
  });
});

describe("routing", () => {
  it("does not answer a path it does not own", async () => {
    const response = await router().handle(
      request({ deviceRecordId: DEVICE, code: GOOD_CODE }, { path: "/v1/hub-pairing/extra" }),
    );
    expect(response.status).toBe(httpStatusFor("RESOURCE_NOT_FOUND"));
  });
});
