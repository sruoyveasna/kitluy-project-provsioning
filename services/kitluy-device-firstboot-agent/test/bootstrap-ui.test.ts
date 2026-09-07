/**
 * The Pi Terminal status screen, Factory Enrollment edition.
 *
 * ===========================================================================
 * WHAT THESE TESTS ARE PROTECTING
 * ===========================================================================
 *   1. The screen tells the Factory Enrollment truth
 *      (KLD-2026-09-03-FACTORY-ENROLLMENT-001 §5): device id, "Waiting for
 *      approval" or "Approved", Store always Unassigned, and the owner's own
 *      sentence for an approved-but-unpaired terminal.
 *   2. "Approved" is never rendered as "ready". An approved terminal is
 *      recognised and eligible for provisioning, nothing more.
 *   3. It reads registration-state.json, which is what the surviving identity
 *      path writes. A screen that only read the retired ticket agent's file
 *      would say "Unknown" for ever on every terminal built after the change.
 *   4. It never claims to be a Store Hub, and it never offers pairing.
 */
import { describe, expect, it } from "vitest";

import type { BootstrapState } from "../src/bootstrap-state.js";
import type { RegistrationState } from "../src/registration-state.js";
import { NOT_ASSIGNED_LINE, PAIRING_UNAVAILABLE_LINE, render } from "../src/bin/bootstrap-ui.js";
import { assetTagFromFingerprint } from "../src/registration-state.js";

const AT = "2026-09-03T00:00:00.000Z";
/** The shape the first real terminal produced on 2026-09-03. */
const CLOUD_ID = "d7a39b31-e7ba-4c32-8213-34f05db53aa1";
const FINGERPRINT = "6783d70cb6bf5e2a9c1d4f7b8e0a3c6d9f2b5e8a1c4d7f0b3e6a9c2d5f8b1e4a";

function registration(
  phase: RegistrationState["phase"],
  deviceId?: string,
  keyFingerprint?: string,
): RegistrationState {
  return {
    phase,
    updatedAt: AT,
    ...(deviceId === undefined ? {} : { deviceId }),
    ...(keyFingerprint === undefined ? {} : { keyFingerprint }),
  };
}

describe("the Phase A screen", () => {
  it("renders the owner's rows for a pending device", () => {
    const screen = render(null, registration("AWAITING_APPROVAL", CLOUD_ID, FINGERPRINT), {
      networkUp: true,
      imageVersion: "0.2.0-dev",
    });

    expect(screen).toContain("KitLuy Terminal");
    // The name the Admin Portal lists, then the opaque cloud id.
    expect(screen).toContain("Device ............ KL-6783D70CB6BF");
    expect(screen).toContain(`Cloud id .......... ${CLOUD_ID}`);
    expect(screen).toContain("Image version ..... 0.2.0-dev");
    expect(screen).toContain("KitLuy ............ Waiting for approval");
    expect(screen).toContain("Store ............. Unassigned");
    expect(screen).toContain("Network ........... Connected");
    // Pending is a healthy waiting condition, and the headline says so.
    expect(screen).toContain("WAITING FOR HET APPROVAL");
    expect(screen).toContain("No action is needed here.");

    // Order matters: an operator reads top to bottom.
    expect(screen.indexOf("Device ...")).toBeLessThan(screen.indexOf("Cloud id"));
    expect(screen.indexOf("Cloud id")).toBeLessThan(screen.indexOf("KitLuy ..."));
    expect(screen.indexOf("KitLuy ...")).toBeLessThan(screen.indexOf("Store ..."));
  });

  it("renders an approved device as approved AND unassigned, in the owner's words", () => {
    const screen = render(null, registration("APPROVED", "KL-6EFCC7C6CC2A"));

    expect(screen).toContain("KitLuy ............ Approved");
    expect(screen).toContain("Store ............. Unassigned");
    expect(screen).toContain(NOT_ASSIGNED_LINE);
    expect(screen).toContain(PAIRING_UNAVAILABLE_LINE);
    // Approved is NOT ready. Nothing on the screen may suggest operation.
    expect(screen.toLowerCase()).not.toContain("ready");
    expect(screen.toLowerCase()).not.toContain("operational");
  });

  it("renders a contained device as stopped, not as a network fault", () => {
    const screen = render(null, registration("CONTAINED", "KL-6EFCC7C6CC2A"));
    expect(screen).toContain("KitLuy ............ Stopped by KitLuy");
    expect(screen).toContain("Contact HET support.");
  });

  it("admits what it does not know rather than guessing", () => {
    const screen = render(null, null);
    expect(screen).toContain("KitLuy ............ Unknown");
    expect(screen).toContain("Network ........... Unknown");
    expect(screen).toContain("Store ............. Unassigned");
    expect(screen).not.toContain("Cloud id");
    expect(screen).not.toContain("Device ...");
    expect(screen).toContain("Image version ..... Unknown");
    // No registration means no headline — nothing to explain yet.
    expect(screen).not.toContain(NOT_ASSIGNED_LINE);
  });

  it("reports the route check when no agent has recorded network state", () => {
    expect(render(null, registration("UNREACHABLE"), { networkUp: false })).toContain(
      "Network ........... Offline",
    );
    expect(render(null, registration("UNREACHABLE"), { networkUp: false })).toContain(
      "KitLuy ............ No connection",
    );
  });

  it("still honours the retired ticket path's file when a device holds one", () => {
    const legacy: BootstrapState = {
      phase: "ENROLLED_UNASSIGNED",
      identityReady: true,
      networkReady: false,
      agentVersion: "test",
      updatedAt: AT,
      deviceRecordId: "dev-1",
      deviceLabel: "KL-1A2B3C4D",
      imageVersion: "0.2.0-dev",
    };
    const screen = render(legacy, null, { networkUp: true });
    expect(screen).toContain("Device ............ KL-1A2B3C4D");
    expect(screen).toContain("Image version ..... 0.2.0-dev");
    // The agent's recorded state wins over the caller's route check.
    expect(screen).toContain("Network ........... Offline");
  });

  it("names the board exactly as the registration client does", () => {
    // One derivation for both: the tag the client sent at registration and the
    // tag the screen shows must be the same string, or the person at the Pi
    // and the person at the Admin Portal have no common name for the board.
    expect(assetTagFromFingerprint(FINGERPRINT)).toBe("KL-6783D70CB6BF");
    const screen = render(null, registration("APPROVED", CLOUD_ID, FINGERPRINT));
    expect(screen).toContain("Device ............ KL-6783D70CB6BF");
  });

  it("falls back to the ticket path's label only when no registration named the board", () => {
    const legacy: BootstrapState = {
      phase: "ENROLLED_UNASSIGNED",
      identityReady: true,
      networkReady: true,
      agentVersion: "test",
      updatedAt: AT,
      deviceRecordId: "dev-1",
      deviceLabel: "KL-1A2B3C4D",
    };
    const named = render(legacy, registration("AWAITING_APPROVAL", CLOUD_ID, FINGERPRINT));
    expect(named).toContain("Device ............ KL-6783D70CB6BF");
    expect(named).not.toContain("KL-1A2B3C4D");
    const unnamed = render(legacy, registration("AWAITING_APPROVAL", CLOUD_ID));
    expect(unnamed).toContain("Device ............ KL-1A2B3C4D");
  });

  it("never claims to be a Store Hub and never offers pairing", () => {
    for (const phase of ["AWAITING_APPROVAL", "APPROVED", "CONTAINED"] as const) {
      const screen = render(null, registration(phase, "KL-X"));
      expect(screen).not.toContain("Store Hub");
      expect(screen).not.toContain("Enter pairing code");
      expect(screen).not.toContain("Fleet ...");
    }
  });
});
