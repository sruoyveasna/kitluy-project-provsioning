/**
 * What a Hub is told after it pairs.
 *
 * ===========================================================================
 * THE PROPERTY THAT MATTERS
 * ===========================================================================
 * Pairing and activation are two outcomes, and the device must be told both
 * truthfully. Before group 0198 the response said "awaiting trust" from a fixed
 * sentence, because nothing ever advanced a paired device — true then, and a lie
 * the moment activation started working.
 *
 * So the tests below are mostly about the SECOND fact:
 *
 *   1. A pairing that succeeds stays a success even when activation is refused.
 *      The Hub IS assigned to its Store either way, and turning a good pair into
 *      an error would send an operator hunting a problem with their code.
 *   2. The governed refusal reaches the device VERBATIM.
 *      `KLUY-DEVICE-NO-CERTIFICATE` and `KLUY-DEVICE-TIME-RESTRICTED` demand
 *      completely different next actions, and a surface that flattened them to
 *      "not active yet" would make the difference invisible.
 *   3. An unconfigured deployment still pairs. `advanceTrust` is optional.
 */
import { describe, expect, it } from "vitest";

import { createHubPairingRouter, HUB_PAIRING_PREFIX } from "../src/hub-pairing-routes.js";
import type { TrustAdvanceOutcome } from "../src/device-trust-advance.js";
import type {
  HubPairingComposition,
  HubPairingCompositionResult,
  PairedHubMaterial,
} from "../src/hub-pairing-composition.js";
import type { BootstrapRouteRequest } from "../src/provisioning-routes.js";

const DEVICE = "11111111-1111-4111-8111-111111111111";

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

const composition = { pair: () => Promise.resolve(PAIRED) } as unknown as HubPairingComposition;

const request = (): BootstrapRouteRequest => ({
  method: "POST",
  path: HUB_PAIRING_PREFIX,
  headers: { "content-type": "application/json" },
  sourceIp: "10.0.0.9",
  rawBody: JSON.stringify({ deviceRecordId: DEVICE, code: "ABCD8291" }),
});

const route = (advance?: TrustAdvanceOutcome) =>
  createHubPairingRouter({
    composition,
    ...(advance === undefined ? {} : { advanceTrust: () => Promise.resolve(advance) }),
  });

describe("a Hub that pairs AND activates", () => {
  it("reports itself active, from the governed answer rather than a fixed sentence", async () => {
    const response = await route({
      kind: "advanced",
      lifecycleState: "active",
      trustedTimeStatus: "trusted",
    }).handle(request());

    expect(response.status).toBe(200);
    expect(response.body.activated).toBe(true);
    expect(response.body.lifecycleState).toBe("active");
    expect(response.body.trustedTime).toBe("trusted");
    expect(String(response.body.detail)).toContain("active");
  });
});

describe("a Hub that pairs but cannot activate yet", () => {
  it("is STILL a successful pairing", async () => {
    const response = await route({
      kind: "blocked",
      lifecycleState: "awaiting_trust",
      trustedTimeStatus: "trusted",
      refusalCode: "KLUY-DEVICE-NO-CERTIFICATE",
      detail: "no certificate",
    }).handle(request());

    // 200, not an error. The Store assignment is real.
    expect(response.status).toBe(200);
    expect(response.body.assignmentId).toBe(PAIRED.data?.assignmentId);
  });

  it("passes the governed refusal through VERBATIM", async () => {
    const response = await route({
      kind: "blocked",
      lifecycleState: "awaiting_trust",
      trustedTimeStatus: "trusted",
      refusalCode: "KLUY-DEVICE-NO-CERTIFICATE",
      detail: "no certificate",
    }).handle(request());

    // The code names WHICH gate is shut. Flattening it to "not active" would
    // make a certificate problem indistinguishable from a clock problem.
    expect(response.body.activationRefusal).toBe("KLUY-DEVICE-NO-CERTIFICATE");
    expect(response.body.activated).toBe(false);
  });

  it("distinguishes a clock refusal from a certificate refusal", async () => {
    const clock = await route({
      kind: "blocked",
      lifecycleState: "awaiting_trust",
      trustedTimeStatus: "restricted_forward_jump",
      refusalCode: "KLUY-DEVICE-TIME-RESTRICTED",
      detail: "restricted",
    }).handle(request());

    expect(clock.body.activationRefusal).toBe("KLUY-DEVICE-TIME-RESTRICTED");
    expect(clock.body.trustedTime).toBe("restricted_forward_jump");
  });
});

describe("deployments that cannot advance a device", () => {
  it("still pairs when no advance step is configured", async () => {
    const response = await route().handle(request());

    expect(response.status).toBe(200);
    expect(response.body.activated).toBe(false);
    // Nothing was attempted, so nothing is claimed about the clock.
    expect(response.body.trustedTime).toBeNull();
    expect(response.body.activationRefusal).toBeNull();
  });

  it("still pairs when the advance step FAILS outright", async () => {
    const response = await route({ kind: "failed", detail: "database unreachable" }).handle(
      request(),
    );

    expect(response.status).toBe(200);
    expect(response.body.activated).toBe(false);
    // A failure is not a refusal: there is no governed code to report, and
    // inventing one would describe a gate that never answered.
    expect(response.body.activationRefusal).toBeNull();
    expect(String(JSON.stringify(response.body))).not.toContain("database unreachable");
  });
});
