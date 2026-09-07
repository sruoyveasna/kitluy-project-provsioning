/**
 * The pairing action and the seat it records.
 *
 * The transport is injected, so these tests exercise the DECISIONS the shell
 * makes around it — what it refuses before the network, what it persists, and
 * what it tells the person at the Pi — without a Pi, a network or a registry.
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  NOT_REGISTERED,
  PERSIST_FAILED,
  submitPairingCode,
  type PairingTransport,
  type PairingTransportResult,
} from "../electron/pairing.js";
import {
  assignmentBelongsTo,
  readTerminalAssignment,
  writeTerminalAssignment,
  type TerminalAssignment,
} from "../electron/terminal-assignment.js";
import { deriveScreen } from "../src/model/shell-state.js";
import { readAssignment } from "../electron/device-state-files.js";

const DEVICE = "6f1c937a-3ca3-4bc1-4b96-014e5fba2ea2";
const CODE = "K7M2QW9Z";

const PAIRED: PairingTransportResult = {
  kind: "paired",
  deviceRecordId: DEVICE,
  assignmentId: "22222222-2222-4222-8222-222222222222",
  assignmentGeneration: 2,
  activated: false,
  context: {
    digitalStoreReference: "STORE-1",
    storeLocationReference: "LOC-1",
    physicalTerminalLabel: "Counter 1",
    terminalProfileKeys: ["T1"],
  },
};

function transportOf(result: PairingTransportResult, seen?: { code?: string }): PairingTransport {
  return {
    pair: async (input) => {
      if (seen !== undefined) seen.code = input.code;
      return result;
    },
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kitluy-shell-pairing-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("submitting a pairing code", () => {
  it("records the seat the cloud granted and reports PAIRED", async () => {
    const saved: TerminalAssignment[] = [];
    const outcome = await submitPairingCode(CODE, {
      transport: transportOf(PAIRED),
      deviceRecordId: DEVICE,
      persist: (a) => saved.push(a),
    });

    expect(outcome.status).toBe("PAIRED");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      deviceRecordId: DEVICE,
      assignmentId: "22222222-2222-4222-8222-222222222222",
      digitalStoreReference: "STORE-1",
      physicalTerminalLabel: "Counter 1",
    });
  });

  it("never records the pairing code, which is a live shared secret", async () => {
    const saved: TerminalAssignment[] = [];
    await submitPairingCode(CODE, {
      transport: transportOf(PAIRED),
      deviceRecordId: DEVICE,
      persist: (a) => saved.push(a),
    });
    expect(JSON.stringify(saved)).not.toContain(CODE);
  });

  it("does not claim activation just because pairing succeeded", async () => {
    // pending_trust is the ordinary answer. A terminal that showed itself ready
    // to sell on the strength of a pairing would be promising a certificate it
    // does not hold.
    const saved: TerminalAssignment[] = [];
    await submitPairingCode(CODE, {
      transport: transportOf(PAIRED),
      deviceRecordId: DEVICE,
      persist: (a) => saved.push(a),
    });
    expect(saved[0]?.activated).toBe(false);
  });

  it("refuses before the network when the board has not registered", async () => {
    const seen: { code?: string } = {};
    for (const id of [undefined, "", "   "]) {
      const outcome = await submitPairingCode(CODE, {
        transport: transportOf(PAIRED, seen),
        deviceRecordId: id,
        persist: () => {
          throw new Error("must not persist");
        },
      });
      expect(outcome.status).toBe(NOT_REGISTERED);
      expect(outcome.retryable).toBe(true);
    }
    // The transport was never reached, so no attempt budget was spent.
    expect(seen.code).toBeUndefined();
  });

  it("passes a refusal through with its code, message and retryability", async () => {
    const outcome = await submitPairingCode(CODE, {
      transport: transportOf({
        kind: "refused",
        result: "LOCKED",
        retryable: false,
        message: "too many failed attempts; ask for a new pairing code",
      }),
      deviceRecordId: DEVICE,
      persist: () => {
        throw new Error("must not persist a refusal");
      },
    });
    expect(outcome).toMatchObject({
      status: "LOCKED",
      retryable: false,
      message: "too many failed attempts; ask for a new pairing code",
    });
  });

  it("reports a granted-but-unsaved seat as a failure, not as success", async () => {
    // The seat is real; this board just cannot prove it after a reboot. Telling
    // the installer "done" would send them away from a terminal that shows an
    // empty keypad tomorrow. Not retryable: the session is already consumed.
    const outcome = await submitPairingCode(CODE, {
      transport: transportOf(PAIRED),
      deviceRecordId: DEVICE,
      persist: () => {
        throw new Error("EACCES");
      },
    });
    expect(outcome).toMatchObject({ status: PERSIST_FAILED, retryable: false });
  });
});

describe("the seat on disk", () => {
  const assignment: TerminalAssignment = {
    deviceRecordId: DEVICE,
    assignmentId: "a-1",
    assignmentGeneration: 1,
    activated: false,
    digitalStoreReference: "STORE-1",
    storeLocationReference: "LOC-1",
    physicalTerminalLabel: "Counter 1",
    terminalProfileKeys: ["T1"],
    updatedAt: new Date().toISOString(),
  };

  it("round-trips, owner-only", () => {
    const path = join(dir, "assignment.json");
    writeTerminalAssignment(assignment, path);
    expect(readTerminalAssignment(path)).toMatchObject({ deviceRecordId: DEVICE });
    // One reader, one writer, one user.
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("leaves no temp file behind", () => {
    const path = join(dir, "assignment.json");
    writeTerminalAssignment(assignment, path);
    expect(() => readFileSync(`${path}.tmp-${process.pid}`)).toThrow();
  });

  it("reads an absent or corrupt file as not assigned rather than as an error", () => {
    expect(readTerminalAssignment(join(dir, "nothing.json"))).toBeNull();
  });

  it("refuses a seat that names another board", () => {
    expect(assignmentBelongsTo(assignment, DEVICE)).toBe(true);
    expect(assignmentBelongsTo(assignment, "another-board")).toBe(false);
    expect(assignmentBelongsTo(assignment, undefined)).toBe(false);
    expect(assignmentBelongsTo(null, DEVICE)).toBe(false);
  });

  it("is what turns an approved board's screen into `assigned`", () => {
    const base = {
      registration: { phase: "APPROVED" as const, keyFingerprint: "abcdef012345aa" },
      pairing: null,
      network: { hasLink: true, hasRoute: true },
      deviceRecordId: DEVICE,
    };

    expect(deriveScreen({ ...base, assignment: null }).kind).toBe("approved_unassigned");
    expect(
      deriveScreen({
        ...base,
        assignment: {
          deviceRecordId: DEVICE,
          activated: false,
          digitalStoreReference: "STORE-1",
          storeLocationReference: "LOC-1",
          physicalTerminalLabel: "Counter 1",
        },
      }).kind,
    ).toBe("assigned");

    // A card copied from another board shows the keypad, not someone else's Store.
    expect(
      deriveScreen({
        ...base,
        assignment: {
          deviceRecordId: "another-board",
          activated: false,
          digitalStoreReference: "STORE-9",
          storeLocationReference: "LOC-9",
          physicalTerminalLabel: "Counter 9",
        },
      }).kind,
    ).toBe("approved_unassigned");
  });

  it("is found where the image says it lives, under the terminal directory", () => {
    writeTerminalAssignment(assignment, join(dir, "terminal", "assignment.json"));
    expect(readAssignment(dir)).toMatchObject({ deviceRecordId: DEVICE });
  });
});
