/**
 * The Store Hub pairing console.
 *
 * ===========================================================================
 * WHAT THESE TESTS ARE PROTECTING
 * ===========================================================================
 * Three things, all of which are easy to break by accident and none of which a
 * type checker can catch:
 *
 *   1. The screen matches the layout the owner decision §2.3 mandates. It is a
 *      specified artefact, not a stylistic choice.
 *   2. The `Store` line is DERIVED. `bootstrap-ui.ts` hardcodes
 *      `Store assignment .. Unassigned`, which becomes a lie the moment a Hub
 *      pairs — this program must never acquire that bug.
 *   3. `LOCKED` tells the operator to fetch a NEW code. It is the one refusal
 *      where retyping is the wrong action, which is the entire reason the cloud
 *      route reports it separately from a wrong code.
 *
 * And one thing that matters more than all of them: a paired Hub is reported as
 * ASSIGNED AND AWAITING TRUST, never as ready. Activation is certificate-backed
 * and gated on BLK-005, so a console that said "ready" would be telling a shop a
 * Hub can serve terminals when it cannot.
 */
import { describe, expect, it } from "vitest";

import type { BootstrapState } from "../src/bootstrap-state.js";
import type { PairingState } from "../src/pairing-state.js";
import {
  interpret,
  looksLikeCode,
  render,
  type PairingAttempt,
} from "../src/bin/hub-pairing-ui.js";

const DEVICE = "dev-11111111";

const enrolled: BootstrapState = {
  phase: "ENROLLED_UNASSIGNED",
  identityReady: true,
  networkReady: true,
  agentVersion: "test",
  updatedAt: "2026-08-13T00:00:00.000Z",
  deviceRecordId: DEVICE,
  deviceLabel: "KL-1A2B3C4D",
};

const pairedState: PairingState = {
  phase: "PAIRED",
  deviceRecordId: DEVICE,
  assignmentId: "asg-1",
  updatedAt: "2026-08-13T00:00:00.000Z",
};

describe("the screen the owner decision §2.3 mandates", () => {
  it("renders the specified lines, in order", () => {
    const screen = render(enrolled, null);

    expect(screen).toContain("KitLuy Store Hub");
    expect(screen).toContain("Device ............ KL-1A2B3C4D");
    expect(screen).toContain("Fleet ............. Enrolled");
    expect(screen).toContain("Store ............. Unassigned");

    // Order matters: an operator reads top to bottom, and the spec fixes it.
    const deviceAt = screen.indexOf("Device ...");
    const fleetAt = screen.indexOf("Fleet ...");
    const storeAt = screen.indexOf("Store ...");
    expect(deviceAt).toBeLessThan(fleetAt);
    expect(fleetAt).toBeLessThan(storeAt);
  });

  it("never claims to be a Terminal", () => {
    // The Hub shipped the Terminal's screen until this program existed.
    expect(render(enrolled, null)).not.toContain("KitLuy Terminal");
  });

  it("admits what it does not know rather than guessing", () => {
    const screen = render(null, null);
    expect(screen).toContain("Device ............ Unknown");
    expect(screen).toContain("Fleet ............. Unknown");
  });

  it("says Not enrolled when there is no device record", () => {
    const screen = render({ ...enrolled, deviceRecordId: undefined }, null);
    expect(screen).toContain("Fleet ............. Not enrolled");
  });
});

describe("the Store line is derived, never hardcoded", () => {
  it("reports assigned AND awaiting trust once paired — never 'ready'", () => {
    const screen = render(enrolled, pairedState);

    expect(screen).toContain("Store ............. Assigned (awaiting trust)");
    // The load-bearing negative: pairing does not activate (BLK-005).
    expect(screen.toLowerCase()).not.toContain("ready");
    expect(screen.toLowerCase()).not.toContain("active");
  });

  it("shows a locked code so the operator knows to stop typing", () => {
    const screen = render(enrolled, { phase: "LOCKED", deviceRecordId: DEVICE, updatedAt: "x" });
    expect(screen).toContain("Unassigned (code locked)");
  });

  it("IGNORES a pairing that belongs to another device — a copied card is stale", () => {
    // The golden card is duplicated on purpose, so a copied `pairing-state.json`
    // will arrive on a device that never paired. Rendering it would tell an
    // operator their Hub is assigned to a Store it has never spoken to.
    const screen = render(enrolled, { ...pairedState, deviceRecordId: "dev-someone-else" });
    expect(screen).toContain("Store ............. Unassigned");
  });
});

describe("what the operator is told, and what is recorded", () => {
  const attempt = (over: Partial<PairingAttempt>): PairingAttempt => ({ status: 200, ...over });

  it("PAIRED records the assignment and says awaiting trust", () => {
    const out = interpret(
      attempt({ status: 200, assignmentId: "asg-9", tenantId: "t-1", digitalStoreId: "s-1" }),
      DEVICE,
    );

    expect(out.done).toBe(true);
    expect(out.state?.phase).toBe("PAIRED");
    expect(out.state?.assignmentId).toBe("asg-9");
    // Recorded against THIS device, so a copied file cannot speak for another.
    expect(out.state?.deviceRecordId).toBe(DEVICE);
    expect(out.message).toContain("awaiting trust");
    expect(out.message).not.toMatch(/\bready\b/i);
  });

  it("LOCKED tells the operator to get a NEW code, and stops prompting", () => {
    const out = interpret(attempt({ status: 403, result: "LOCKED" }), DEVICE);

    expect(out.message).toContain("generate a NEW pairing code");
    // Stops: retyping at a locked claim cannot succeed, so continuing to prompt
    // would waste an operator's time by design.
    expect(out.done).toBe(true);
    expect(out.state?.phase).toBe("LOCKED");
  });

  it("CODE_REFUSED keeps prompting and records NOTHING", () => {
    const out = interpret(attempt({ status: 403, result: "CODE_REFUSED" }), DEVICE);

    expect(out.done).toBe(false);
    // A wrong guess is not a state change. Writing one would also mean the screen
    // reported a failed attempt as though it were pairing progress.
    expect(out.state).toBeNull();
  });

  it("REDEMPTION_REFUSED sends the operator back for a new code", () => {
    const out = interpret(attempt({ status: 409, result: "REDEMPTION_REFUSED" }), DEVICE);
    expect(out.message).toContain("new pairing code");
    expect(out.state).toBeNull();
  });

  it("honours Retry-After on a rate limit", () => {
    const out = interpret(attempt({ status: 429, retryAfterSeconds: 42 }), DEVICE);
    expect(out.message).toContain("42 seconds");
    expect(out.done).toBe(false);
  });

  it("says the service is unconfigured on a 503, not that the code was wrong", () => {
    const out = interpret(attempt({ status: 503 }), DEVICE);
    // A 503 means this deployment has no pairing wiring. Blaming the code would
    // send an operator hunting a perfectly good one.
    expect(out.message).toContain("not available");
    expect(out.message).not.toContain("not valid");
  });

  it("treats a transport failure as retryable, not as a bad code", () => {
    const out = interpret(attempt({ status: 0 }), DEVICE);
    expect(out.done).toBe(false);
    expect(out.message).toContain("network");
  });

  it("never echoes anything that could be a code back to the screen", () => {
    for (const result of ["CODE_REFUSED", "LOCKED", "REDEMPTION_REFUSED"]) {
      const out = interpret(attempt({ status: 403, result }), DEVICE);
      expect(out.message).not.toMatch(/[0-9A-Z]{8}/);
    }
  });
});

describe("the local shape check", () => {
  it("accepts a valid Crockford code in either case", () => {
    expect(looksLikeCode("ABCD8291")).toBe(true);
    expect(looksLikeCode("abcd8291")).toBe(true);
    expect(looksLikeCode("  ABCD8291  ")).toBe(true);
  });

  it("rejects the characters Crockford excludes", () => {
    // I, L, O and U are excluded precisely so an operator reading a code aloud
    // cannot confuse them with 1, 0 and each other.
    for (const bad of ["IBCD8291", "ABCD829L", "OBCD8291", "ABCDU291"]) {
      expect(looksLikeCode(bad)).toBe(false);
    }
  });

  it("rejects the wrong length and the display hyphen", () => {
    expect(looksLikeCode("ABCD829")).toBe(false);
    expect(looksLikeCode("ABCD82911")).toBe(false);
    // `ABCD-8291` is a presentation form; a caller must strip it before sending.
    expect(looksLikeCode("ABCD-8291")).toBe(false);
  });
});
