/**
 * The pairing outcome the screen shows.
 *
 * `App.tsx` used to discard the transport's answer and always render "Pairing is
 * not available in this build yet". That was correct while Slice 1B had no
 * transport and became wrong the moment one shipped: on 2026-09-09 a terminal
 * paired successfully and told the person standing at it that the feature did
 * not exist. These tests exist so that cannot come back quietly.
 */
import { describe, expect, it } from "vitest";

import { pairingMessageKey } from "../src/model/shell-state.js";
import { messagesFor } from "../src/messages.js";

describe("every pairing outcome reaches the person at the terminal", () => {
  it("reports success as success", () => {
    expect(pairingMessageKey("PAIRED")).toBe("pairingPaired");
  });

  it.each([
    ["CODE_REFUSED", "pairingRefused"],
    ["CODE_MALFORMED", "pairingRefused"],
    ["LOCKED", "pairingLocked"],
    ["ALREADY_ASSIGNED", "pairingAlreadyAssigned"],
    ["NO_DEVICE_RECORD", "pairingNotRegistered"],
    ["PAIRING_UNREACHABLE", "pairingUnreachable"],
  ])("maps %s to %s", (status, key) => {
    expect(pairingMessageKey(status)).toBe(key);
  });

  it("keeps 'not available in this build' for a build with NO transport only", () => {
    // The distinction matters: this one means reflash, every other refusal
    // means try again. Conflating them is what wasted an evening.
    expect(pairingMessageKey("PAIRING_TRANSPORT_UNAVAILABLE")).toBe("pairingNotAvailable");
    expect(pairingMessageKey("CODE_REFUSED")).not.toBe("pairingNotAvailable");
    expect(pairingMessageKey("PAIRED")).not.toBe("pairingNotAvailable");
  });

  it("fails CLOSED on a status it has never seen", () => {
    // A code the registry adds later must not read as success.
    for (const unknown of ["SOMETHING_NEW", "", "paired", "OK"]) {
      expect(pairingMessageKey(unknown), unknown).toBe("pairingFailed");
    }
  });

  it("has real wording for every outcome in both languages", () => {
    const keys = [
      "pairingPaired",
      "pairingRefused",
      "pairingLocked",
      "pairingAlreadyAssigned",
      "pairingNotRegistered",
      "pairingUnreachable",
      "pairingNotAvailable",
      "pairingFailed",
    ] as const;
    for (const locale of ["km-KH", "en-US"] as const) {
      const m = messagesFor(locale);
      for (const key of keys) {
        expect(m[key], `${locale}/${key}`).toBeTruthy();
        expect(m[key].length, `${locale}/${key}`).toBeGreaterThan(4);
      }
    }
  });

  it("says something DIFFERENT for each distinct outcome in English", () => {
    // Four branches sharing one sentence would be the same bug wearing a hat.
    const m = messagesFor("en-US");
    const distinct = new Set([
      m.pairingPaired,
      m.pairingRefused,
      m.pairingLocked,
      m.pairingAlreadyAssigned,
      m.pairingNotRegistered,
      m.pairingUnreachable,
      m.pairingNotAvailable,
    ]);
    expect(distinct.size).toBe(7);
  });

  it("never tells a shop to check the network for a refusal that is not a network fault", () => {
    const m = messagesFor("en-US");
    expect(m.pairingRefused.toLowerCase()).not.toContain("network");
    expect(m.pairingLocked.toLowerCase()).not.toContain("network");
    expect(m.pairingAlreadyAssigned.toLowerCase()).not.toContain("network");
  });
});
