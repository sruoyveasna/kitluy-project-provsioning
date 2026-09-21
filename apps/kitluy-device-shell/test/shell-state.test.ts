import { describe, expect, it } from "vitest";
import {
  assetTagFromFingerprint,
  deriveScreen,
  deviceLabelOf,
  pairingBelongsTo,
  registrationBelongsTo,
  type ShellSnapshot,
} from "../src/model/shell-state.js";

const FINGERPRINT = "abcdef0123456789aaaa";
const ONLINE = { hasLink: true, hasRoute: true } as const;
const OFFLINE = { hasLink: false, hasRoute: false } as const;

function snapshot(over: Partial<ShellSnapshot>): ShellSnapshot {
  return {
    registration: null,
    pairing: null,
    network: ONLINE,
    keyFingerprint: FINGERPRINT,
    deviceRecordId: "dev-1",
    // A board whose Hub already holds its PIN (KLD-2026-09-19-PIN-AFTER-PAIRING-001).
    devicePin: { state: "registered" },
    ...over,
  };
}

describe("deriveScreen", () => {
  it("null snapshot (pre-IPC) is booting", () => {
    expect(deriveScreen(null)).toEqual({ kind: "booting" });
  });

  // KLD-2026-09-19-PIN-AFTER-PAIRING-001 -------------------------------------
  it("a fresh board does NOT ask for a PIN before it is paired and connected", () => {
    for (const over of [
      { devicePin: { state: "absent" as const } },
      { devicePin: null },
      { devicePin: undefined },
    ]) {
      expect(deriveScreen(snapshot({ registration: null, ...over })).kind).toBe(
        "waiting_for_approval",
      );
      expect(
        deriveScreen(
          snapshot({
            registration: { phase: "APPROVED", deviceId: "dev-1", keyFingerprint: FINGERPRINT },
            ...over,
          }),
        ).kind,
      ).toBe("approved_unassigned");
    }
  });

  it("paired and SERVING with the Hub saying setup_required asks for the PIN — before the install", () => {
    const paired = {
      registration: { phase: "APPROVED" as const, deviceId: "dev-1", keyFingerprint: FINGERPRINT },
      pairing: { phase: "PAIRED" as const, deviceRecordId: "dev-1" },
      devicePin: { state: "absent" as const },
      application: {
        phase: "IDLE" as const,
        installedVersion: null,
        lastOutcome: null,
        lastReason: null,
      },
    };
    expect(
      deriveScreen(
        snapshot({ ...paired, edge: { phase: "SERVING", terminalPinState: "setup_required" } }),
      ),
    ).toMatchObject({ kind: "pin_setup" });
    // Not yet connected: the install waits, no PIN screen (the Hub cannot take it).
    expect(
      deriveScreen(
        snapshot({ ...paired, edge: { phase: "PAIRING_REQUIRED", terminalPinState: null } }),
      ).kind,
    ).toBe("installing");
    expect(deriveScreen(snapshot({ ...paired, edge: null })).kind).toBe("installing");
    // The Hub holds one already (a re-flashed board that recovered): straight on.
    expect(
      deriveScreen(snapshot({ ...paired, edge: { phase: "SERVING", terminalPinState: "set" } }))
        .kind,
    ).toBe("installing");
    // Just registered: the board's posture bridges the seconds until the Hub's status is re-read.
    expect(
      deriveScreen(
        snapshot({
          ...paired,
          devicePin: { state: "registered" },
          edge: { phase: "SERVING", terminalPinState: "setup_required" },
        }),
      ).kind,
    ).toBe("installing");
  });

  it("a halted board is halted even when the Hub would ask for a PIN", () => {
    expect(
      deriveScreen(
        snapshot({
          registration: { phase: "CONTAINED", deviceId: "dev-1", keyFingerprint: FINGERPRINT },
          pairing: { phase: "PAIRED", deviceRecordId: "dev-1" },
          devicePin: { state: "absent" },
          edge: { phase: "SERVING", terminalPinState: "setup_required" },
        }),
      ),
    ).toMatchObject({ kind: "halted", reason: "contained" });
  });

  it("paired and installing shows the install, with the journal's phase; committed is assigned", () => {
    const paired = {
      registration: { phase: "APPROVED" as const, deviceId: "dev-1", keyFingerprint: FINGERPRINT },
      pairing: { phase: "PAIRED" as const, deviceRecordId: "dev-1" },
    };
    for (const phase of ["IDLE", "ACTIVATING", "HEALTH_PENDING"] as const) {
      expect(
        deriveScreen(
          snapshot({
            ...paired,
            application: { phase, installedVersion: null, lastOutcome: null, lastReason: null },
          }),
        ),
      ).toMatchObject({ kind: "installing", phase, failed: false });
    }
    expect(
      deriveScreen(
        snapshot({
          ...paired,
          application: {
            phase: "ROLLED_BACK",
            installedVersion: null,
            lastOutcome: "ROLLED_BACK",
            lastReason: "x",
          },
        }),
      ),
    ).toMatchObject({ kind: "installing", phase: "ROLLED_BACK", failed: true });
    expect(
      deriveScreen(
        snapshot({
          ...paired,
          application: {
            phase: "COMMITTED",
            installedVersion: "1",
            lastOutcome: "INSTALLED",
            lastReason: null,
          },
        }),
      ).kind,
    ).toBe("assigned");
    expect(deriveScreen(snapshot({ ...paired, application: null })).kind).toBe("assigned");
  });

  it("no registration file yet reads as NOT_REGISTERED waiting", () => {
    const screen = deriveScreen(snapshot({ registration: null }));
    expect(screen.kind).toBe("waiting_for_approval");
    if (screen.kind === "waiting_for_approval") expect(screen.sub).toBe("NOT_REGISTERED");
  });

  it("AWAITING_APPROVAL is a healthy waiting state, not halted", () => {
    const screen = deriveScreen(
      snapshot({ registration: { phase: "AWAITING_APPROVAL", keyFingerprint: FINGERPRINT } }),
    );
    expect(screen.kind).toBe("waiting_for_approval");
    if (screen.kind === "waiting_for_approval") {
      expect(screen.sub).toBe("AWAITING_APPROVAL");
      expect(screen.deviceLabel).toBe(assetTagFromFingerprint(FINGERPRINT));
    }
  });

  it("APPROVED without a pairing shows the code-entry screen", () => {
    const screen = deriveScreen(
      snapshot({ registration: { phase: "APPROVED", keyFingerprint: FINGERPRINT } }),
    );
    expect(screen.kind).toBe("approved_unassigned");
  });

  it("APPROVED with a live pairing that belongs to this device is assigned", () => {
    const screen = deriveScreen(
      snapshot({
        registration: { phase: "APPROVED", keyFingerprint: FINGERPRINT },
        pairing: { phase: "PAIRED", deviceRecordId: "dev-1" },
      }),
    );
    expect(screen.kind).toBe("assigned");
  });

  it("a pairing file from ANOTHER device does not make this one assigned", () => {
    const screen = deriveScreen(
      snapshot({
        registration: { phase: "APPROVED", keyFingerprint: FINGERPRINT },
        pairing: { phase: "PAIRED", deviceRecordId: "someone-else" },
      }),
    );
    expect(screen.kind).toBe("approved_unassigned");
  });

  it("TRUST_REVIEW_REQUIRED and CONTAINED are halted with distinct reasons", () => {
    const trust = deriveScreen(
      snapshot({ registration: { phase: "TRUST_REVIEW_REQUIRED", keyFingerprint: FINGERPRINT } }),
    );
    const contained = deriveScreen(
      snapshot({ registration: { phase: "CONTAINED", keyFingerprint: FINGERPRINT } }),
    );
    expect(trust).toMatchObject({ kind: "halted", reason: "trust_review" });
    expect(contained).toMatchObject({ kind: "halted", reason: "contained" });
  });

  it("flags no-network on the waiting screen when there is no default route", () => {
    const screen = deriveScreen(
      snapshot({
        registration: { phase: "AWAITING_APPROVAL", keyFingerprint: FINGERPRINT },
        network: OFFLINE,
      }),
    );
    expect(screen.kind).toBe("waiting_for_approval");
    if (screen.kind === "waiting_for_approval") expect(screen.noNetwork).toBe(true);
  });

  it("UNREACHABLE always reads as no-network", () => {
    const screen = deriveScreen(
      snapshot({
        registration: { phase: "UNREACHABLE", keyFingerprint: FINGERPRINT },
        network: ONLINE,
      }),
    );
    expect(screen.kind).toBe("waiting_for_approval");
    if (screen.kind === "waiting_for_approval") {
      expect(screen.sub).toBe("UNREACHABLE");
      expect(screen.noNetwork).toBe(true);
    }
  });
});

describe("belongs-to guards and label", () => {
  it("assetTagFromFingerprint is KL- + 12 upper hex", () => {
    expect(assetTagFromFingerprint(FINGERPRINT)).toBe("KL-ABCDEF012345");
  });

  it("registrationBelongsTo needs a matching key", () => {
    expect(
      registrationBelongsTo({ phase: "APPROVED", keyFingerprint: FINGERPRINT }, FINGERPRINT),
    ).toBe(true);
    expect(registrationBelongsTo({ phase: "APPROVED", keyFingerprint: "other" }, FINGERPRINT)).toBe(
      false,
    );
    expect(registrationBelongsTo(null, FINGERPRINT)).toBe(false);
  });

  it("pairingBelongsTo needs a matching device record", () => {
    expect(pairingBelongsTo({ phase: "PAIRED", deviceRecordId: "dev-1" }, "dev-1")).toBe(true);
    expect(pairingBelongsTo({ phase: "PAIRED", deviceRecordId: "dev-2" }, "dev-1")).toBe(false);
  });

  it("falls back to the opaque device id when no usable fingerprint is present", () => {
    const label = deviceLabelOf(
      snapshot({
        registration: { phase: "AWAITING_APPROVAL", deviceId: "cloud-xyz" },
      }),
    );
    expect(label).toBe("cloud-xyz");
  });
});
