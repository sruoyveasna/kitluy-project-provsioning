import { describe, expect, it } from "vitest";

import { validateGrantedSeat } from "../electron/seat-validation.js";
import { SEAT_NOT_INSTALLABLE, submitPairingCode, type PairingTransportResult } from "../electron/pairing.js";

const good = {
  vertical: "laundry",
  terminalProfileKeys: ["laundry.t1.intake_cashier", "laundry.t2.customer_display"],
  desiredApplications: ["laundry.pos"],
  allowedSurfaces: [],
};

describe("validateGrantedSeat — the board records only a seat it can install", () => {
  it("accepts a coherent server-derived seat", () => {
    const r = validateGrantedSeat(good);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.seat).toEqual({
        primaryVertical: "laundry",
        terminalProfileKeys: good.terminalProfileKeys,
        desiredApplications: good.desiredApplications,
        allowedSurfaces: good.allowedSurfaces,
      });
  });

  it.each([
    ["no vertical", { ...good, vertical: undefined }, "SEAT_VERTICAL_MISSING"],
    ["uppercase vertical (DB spelling leaked)", { ...good, vertical: "LAUNDRY" }, "SEAT_VERTICAL_MALFORMED"],
    ["no profiles", { ...good, terminalProfileKeys: [] }, "SEAT_PROFILES_MISSING"],
    ["malformed profile", { ...good, terminalProfileKeys: ["T1"] }, "SEAT_PROFILE_MALFORMED"],
    ["profile from another vertical", { ...good, terminalProfileKeys: ["cafe_restaurant.t1.register"] }, "SEAT_PROFILE_OTHER_VERTICAL"],
    ["no applications (pre-v2 registry)", { ...good, desiredApplications: undefined }, "SEAT_APPLICATIONS_MISSING"],
    ["empty applications", { ...good, desiredApplications: [] }, "SEAT_APPLICATIONS_MISSING"],
    ["malformed application", { ...good, desiredApplications: ["pos"] }, "SEAT_APPLICATION_MALFORMED"],
    ["café POS on a laundry seat", { ...good, desiredApplications: ["cafe_restaurant.pos"] }, "SEAT_APPLICATION_OTHER_VERTICAL"],
    ["surfaces not a list", { ...good, allowedSurfaces: "settings" }, "SEAT_SURFACES_MALFORMED"],
    ["malformed surface", { ...good, allowedSurfaces: ["Settings"] }, "SEAT_SURFACES_MALFORMED"],
  ] as const)("refuses %s", (_name, seat, refusal) => {
    const r = validateGrantedSeat(seat as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal).toBe(refusal);
  });
});

describe("submitPairingCode — a seat that fails validation is NOT recorded (requirements 2, 10, 12)", () => {
  const paired = (context: Record<string, unknown>): PairingTransportResult => ({
    kind: "paired",
    deviceRecordId: "dev-1",
    assignmentId: "asg-1",
    assignmentGeneration: 1,
    activated: false,
    context: {
      digitalStoreReference: "STORE-1",
      storeLocationReference: "LOC-1",
      physicalTerminalLabel: "Counter 1",
      terminalProfileKeys: ["laundry.t1.intake_cashier"],
      vertical: "laundry",
      desiredApplications: ["laundry.pos"],
      allowedSurfaces: [],
      ...context,
    },
  });

  it("records the seat, with the v2 fields, when it is coherent", async () => {
    let persisted: unknown = null;
    const out = await submitPairingCode("K7M2QW9Z", {
      transport: { pair: async () => paired({}) },
      deviceRecordId: "dev-1",
      persist: (a) => { persisted = a; },
      now: () => new Date("2026-09-18T10:00:00.000Z"),
    });
    expect(out.status).toBe("PAIRED");
    expect(persisted).toMatchObject({ primaryVertical: "laundry", desiredApplications: ["laundry.pos"], allowedSurfaces: [] });
  });

  it("refuses and does not persist a seat whose application belongs to another vertical", async () => {
    let persisted = false;
    const out = await submitPairingCode("K7M2QW9Z", {
      transport: { pair: async () => paired({ desiredApplications: ["cafe_restaurant.pos"] }) },
      deviceRecordId: "dev-1",
      persist: () => { persisted = true; },
    });
    expect(out.status).toBe(SEAT_NOT_INSTALLABLE);
    expect(out.retryable).toBe(false);
    expect(persisted).toBe(false);
  });

  it("refuses a pre-v2 answer that states no applications — the board never guesses one", async () => {
    let persisted = false;
    const out = await submitPairingCode("K7M2QW9Z", {
      transport: { pair: async () => paired({ desiredApplications: undefined }) },
      deviceRecordId: "dev-1",
      persist: () => { persisted = true; },
    });
    expect(out.status).toBe(SEAT_NOT_INSTALLABLE);
    expect(persisted).toBe(false);
  });
});
