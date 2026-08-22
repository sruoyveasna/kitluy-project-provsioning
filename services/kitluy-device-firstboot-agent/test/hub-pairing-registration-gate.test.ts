/**
 * Which identity may pair, and — more importantly — which may not.
 *
 * ===========================================================================
 * THE DEFECT THIS EXISTS TO PREVENT
 * ===========================================================================
 * Two things must both stay true, and they pull in opposite directions:
 *
 *   1. A board admitted through the CLOUD path must be able to pair. Before
 *      `resolvePairableDeviceId`, the console read only `bootstrap-state.json`
 *      — written solely by the ticket-based fleet agent — so an approved Hub
 *      sat on "Waiting for fleet enrolment" for ever while the cloud held it
 *      as `enrolled`. The operator had no way to tell that from a fault.
 *
 *   2. A board that is merely REGISTERED must NOT be able to pair. Registration
 *      grants nothing; HET approval is the gate. If `AWAITING_APPROVAL` were
 *      accepted here, a device could attach itself to a Store while still
 *      untrusted and the approval step would be decorative — exactly what
 *      KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001 exists to stop.
 *
 * The second is the one worth guarding hardest: failing (1) is a visible
 * annoyance, failing (2) is a silent hole in the trust model.
 */
import { describe, expect, it } from "vitest";

import type { BootstrapState } from "../src/bootstrap-state.js";
import type { PairingState } from "../src/pairing-state.js";
import type { RegistrationPhase, RegistrationState } from "../src/registration-state.js";
import {
  looksLikeCode,
  normalisePairingCode,
  render,
  resolvePairableDeviceId,
} from "../src/bin/hub-pairing-ui.js";

const CLOUD_ID = "9e43a581-8281-4637-865b-ac3bd1d3b665";
const FLEET_ID = "11111111-2222-3333-4444-555555555555";

function registration(phase: RegistrationPhase, deviceId?: string): RegistrationState {
  return {
    phase,
    updatedAt: "2026-08-19T06:00:00.000Z",
    ...(deviceId === undefined ? {} : { deviceId }),
  };
}

const enrolledBootstrap = {
  phase: "ENROLLED_UNASSIGNED",
  deviceRecordId: FLEET_ID,
} as unknown as BootstrapState;

describe("an approved board may pair", () => {
  it("uses the cloud deviceId when registration is APPROVED", () => {
    expect(resolvePairableDeviceId(null, registration("APPROVED", CLOUD_ID))).toBe(CLOUD_ID);
  });
});

describe("a board that is not yet approved may NOT pair", () => {
  const refused: RegistrationPhase[] = [
    "NOT_REGISTERED",
    "REGISTERING",
    "AWAITING_APPROVAL",
    "TRUST_REVIEW_REQUIRED",
    "CONTAINED",
    "UNREACHABLE",
  ];

  for (const phase of refused) {
    it(`refuses ${phase}, even when a deviceId is present`, () => {
      // The id EXISTS in several of these states — a pending device is told its
      // own opaque id so an admin can be quoted it. Holding an id is not being
      // approved, and this is the line where that distinction is enforced.
      expect(resolvePairableDeviceId(null, registration(phase, CLOUD_ID))).toBeUndefined();
    });
  }

  it("refuses an APPROVED state that carries no deviceId at all", () => {
    expect(resolvePairableDeviceId(null, registration("APPROVED"))).toBeUndefined();
  });

  it("refuses when there is no state of either kind", () => {
    expect(resolvePairableDeviceId(null, null)).toBeUndefined();
  });
});

describe("the ticket-based path is unchanged", () => {
  it("still pairs from bootstrap state alone", () => {
    expect(resolvePairableDeviceId(enrolledBootstrap, null)).toBe(FLEET_ID);
  });

  it("prefers bootstrap state when a device somehow holds both", () => {
    // The older, ticket-backed identity wins: a device holding both should
    // present the identity it actually enrolled with.
    expect(resolvePairableDeviceId(enrolledBootstrap, registration("APPROVED", CLOUD_ID))).toBe(
      FLEET_ID,
    );
  });

  it("does not invent an id from a bootstrap state that has none", () => {
    const notEnrolled = { phase: "NETWORK_WAIT" } as unknown as BootstrapState;
    expect(resolvePairableDeviceId(notEnrolled, null)).toBeUndefined();
  });
});

describe("the code an operator actually types", () => {
  // Observed on real hardware: the Portal displays `4A5M MGSC` and the operator
  // typed exactly that. The console refused it, and the refusal looked like a
  // wrong code rather than a formatting rule nobody had been told about.
  const REAL = "4A5MMGSC";

  it("accepts the code exactly as the Partner Portal displays it", () => {
    expect(looksLikeCode("4A5M MGSC")).toBe(true);
    expect(normalisePairingCode("4A5M MGSC")).toBe(REAL);
  });

  it("accepts it unspaced, which is what used to be required", () => {
    expect(looksLikeCode(REAL)).toBe(true);
  });

  it("accepts lower case and stray surrounding whitespace", () => {
    expect(looksLikeCode("  4a5m mgsc  ")).toBe(true);
    expect(normalisePairingCode("  4a5m mgsc  ")).toBe(REAL);
  });

  it("accepts a dash, because people write the separator they are used to", () => {
    expect(looksLikeCode("4A5M-MGSC")).toBe(true);
  });

  it("still refuses a genuinely wrong code before any round trip", () => {
    // Alphabet and length checks are unchanged — this only made the input more
    // forgiving about presentation, not about correctness.
    expect(looksLikeCode("4A5M MGS")).toBe(false); // seven characters
    expect(looksLikeCode("4A5M MGSCX")).toBe(false); // nine
    expect(looksLikeCode("4A5M MGSI")).toBe(false); // I is not in the alphabet
    expect(looksLikeCode("4A5M MGSO")).toBe(false); // nor is O
    expect(looksLikeCode("")).toBe(false);
  });
});

describe("a cloud-approved Hub recognises its own pairing", () => {
  // Observed on real hardware: pairing SUCCEEDED server-side (`store-hub-paired`,
  // a `device_assignments` row in `pending_trust`) and the Hub screen still read
  // "Unassigned", because render() compared the pairing against the ticket-path
  // id — which a cloud-registered device does not have.
  const paired = {
    phase: "PAIRED",
    deviceRecordId: CLOUD_ID,
    updatedAt: "2026-08-19T08:37:42.000Z",
  } as unknown as PairingState;

  it("renders the Store as assigned, not Unassigned", () => {
    const html = render(null, paired, undefined, registration("APPROVED", CLOUD_ID));
    expect(html).toContain("Assigned");
    expect(html).not.toMatch(/Store \.+ Unassigned/);
  });

  it("still refuses a pairing that belongs to a DIFFERENT device", () => {
    // A copied card carries a stale pairing file. Rendering it would tell an
    // operator their Hub serves a Store it has never spoken to.
    const stale = { ...paired, deviceRecordId: FLEET_ID } as unknown as PairingState;
    const html = render(null, stale, undefined, registration("APPROVED", CLOUD_ID));
    expect(html).toContain("Unassigned");
  });

  it("does not claim a Store for a device that is only awaiting approval", () => {
    const html = render(null, paired, undefined, registration("AWAITING_APPROVAL", CLOUD_ID));
    expect(html).toContain("Unassigned");
  });
});

describe("the console shows one status, not two that contradict", () => {
  // Observed on hardware: a cloud-registered Hub printed
  //     KitLuy ... Approved
  //     Fleet .... Not enrolled
  // which reads as a contradiction unless you already know there are two
  // enrolment paths. The ticket path is retired on this image (plan §5.3), so
  // the row is shown only to a device that actually took it.
  it("omits the Fleet row for a cloud-registered Hub", () => {
    const html = render(null, null, undefined, registration("APPROVED", CLOUD_ID));
    expect(html).toContain("KitLuy ...");
    expect(html).not.toContain("Fleet ...");
    expect(html).not.toContain("Not enrolled");
  });

  it("still shows Fleet for a device that enrolled with a ticket", () => {
    // A Pi terminal keeps the older path, and its screen must not lose the row.
    const html = render(enrolledBootstrap, null, undefined, null);
    expect(html).toContain("Fleet ...");
    expect(html).toContain("Enrolled");
  });

  it("never prints 'Not enrolled' now that the row is conditional", () => {
    // The old wording only existed to describe a ticket enrolment that had not
    // happened. There is no state left where it is the useful thing to say.
    const notEnrolled = { phase: "NETWORK_WAIT" } as unknown as BootstrapState;
    expect(render(notEnrolled, null, undefined, null)).not.toContain("Not enrolled");
    expect(render(null, null, undefined, null)).not.toContain("Not enrolled");
  });
});
