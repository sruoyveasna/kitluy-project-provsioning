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
    ...over,
  };
}

describe("deriveScreen", () => {
  it("null snapshot (pre-IPC) is booting", () => {
    expect(deriveScreen(null)).toEqual({ kind: "booting" });
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
