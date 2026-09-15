/**
 * "Am I paired, and to which fleet record?" — answered for BOTH device classes.
 *
 * A Store Hub pairs at its console and writes the canonical pairing state. A Pi
 * Terminal pairs on its graphical shell, which runs sandboxed to
 * /var/lib/kitluy/terminal and CANNOT write that file, so it writes its seat
 * there instead. `operational-tls` read only the Hub's file, so a Terminal that
 * had paired perfectly well would have sat at "waiting: not paired yet" for
 * ever once the agent was packaged for it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readPairedIdentity } from "../src/paired-identity.js";

const dirs: string[] = [];
function seat(contents: unknown): string {
  const d = mkdtempSync(join(tmpdir(), "kitluy-seat-"));
  dirs.push(d);
  mkdirSync(join(d, "terminal"), { recursive: true });
  const path = join(d, "terminal", "assignment.json");
  writeFileSync(path, typeof contents === "string" ? contents : JSON.stringify(contents));
  return path;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const SEAT = {
  deviceRecordId: "ed2ca426-593a-4c83-88a6-4cda76605eff",
  assignmentId: "a1",
  assignmentGeneration: 3,
  activated: false,
  digitalStoreReference: "DEMO-LAUNDRY-001",
  storeLocationReference: "DEMO-PP-01",
  physicalTerminalLabel: "T1",
  terminalProfileKeys: ["laundry.t1.intake_cashier"],
  updatedAt: "2026-09-09T07:00:00.000Z",
};

describe("a Terminal's seat answers the pairing question", () => {
  it("reads the device record id the Device Shell wrote", () => {
    const id = readPairedIdentity({ terminalAssignmentPath: seat(SEAT) });
    expect(id?.deviceRecordId).toBe(SEAT.deviceRecordId);
    expect(id?.source).toBe("terminal-assignment");
  });

  it("carries the seat's OWN assignment generation", () => {
    // Requesting against the wrong generation is refused by activate_device_v1
    // as KLUY-DEVICE-GENERATION-STALE, so this must not be assumed to be 1.
    expect(readPairedIdentity({ terminalAssignmentPath: seat(SEAT) })?.assignmentGeneration).toBe(
      3,
    );
  });

  it("does NOT require the seat to be activated", () => {
    // A device asks for a certificate in order to BECOME activated. Requiring
    // activation first would be circular and nothing would ever activate.
    expect(
      readPairedIdentity({ terminalAssignmentPath: seat({ ...SEAT, activated: false }) }),
    ).not.toBeNull();
  });

  it("falls back to generation 1 when the seat states none", () => {
    const { assignmentGeneration: _drop, ...withoutGeneration } = SEAT;
    expect(
      readPairedIdentity({ terminalAssignmentPath: seat(withoutGeneration) })?.assignmentGeneration,
    ).toBe(1);
  });

  it.each([
    ["a generation of zero", { ...SEAT, assignmentGeneration: 0 }],
    ["a negative generation", { ...SEAT, assignmentGeneration: -2 }],
    ["a non-integer generation", { ...SEAT, assignmentGeneration: 1.5 }],
  ])("refuses %s and uses 1", (_label, contents) => {
    expect(
      readPairedIdentity({ terminalAssignmentPath: seat(contents) })?.assignmentGeneration,
    ).toBe(1);
  });
});

describe("an unpaired or unreadable device answers null, never a guess", () => {
  it("is null when the seat file is absent", () => {
    const d = mkdtempSync(join(tmpdir(), "kitluy-seat-"));
    dirs.push(d);
    expect(readPairedIdentity({ terminalAssignmentPath: join(d, "absent.json") })).toBeNull();
  });

  it("is null for a seat that names no device record", () => {
    for (const bad of [{}, { deviceRecordId: "" }, { deviceRecordId: 42 }, [], null]) {
      expect(
        readPairedIdentity({ terminalAssignmentPath: seat(bad) }),
        JSON.stringify(bad),
      ).toBeNull();
    }
  });

  it("is null rather than throwing on a corrupt file", () => {
    expect(readPairedIdentity({ terminalAssignmentPath: seat("{not json") })).toBeNull();
  });
});

/**
 * The Store Hub branch (registry group 0226; REFLASH-HARDENING-001). The Hub
 * pairing state used to carry no generation, and this reader hard-coded 1 — so
 * a Hub re-paired at generation 3 requested at 1 and was refused
 * KLUY-CRED-STALE-ASSIGNMENT on hardware (2026-09-15).
 */
describe("a Store Hub's pairing state answers with the generation the cloud stated", () => {
  const NO_SEAT = "/nonexistent/kitluy/terminal/assignment.json";
  const HUB_DEVICE = "549a41c6-21e9-4838-8b48-34a3878ba290";

  function hubState(contents: unknown): string {
    const d = mkdtempSync(join(tmpdir(), "kitluy-hub-pairing-"));
    dirs.push(d);
    const path = join(d, "pairing-state.json");
    writeFileSync(path, typeof contents === "string" ? contents : JSON.stringify(contents));
    return path;
  }
  const PAIRED_HUB = {
    phase: "PAIRED",
    deviceRecordId: HUB_DEVICE,
    assignmentId: "5f857f6a-0000-4000-8000-000000000003",
    updatedAt: "2026-09-15T06:56:29.000Z",
  };

  it("uses the stated generation of a re-paired Hub, not 1", () => {
    const identity = readPairedIdentity({
      pairingStatePath: hubState({ ...PAIRED_HUB, assignmentGeneration: 3 }),
      terminalAssignmentPath: NO_SEAT,
    });
    expect(identity).toEqual({
      deviceRecordId: HUB_DEVICE,
      assignmentGeneration: 3,
      assignmentGenerationSource: "stated",
      source: "hub-pairing-state",
    });
  });

  it("falls back to 1 for a file written before the cloud reported it, and says it ASSUMED", () => {
    const identity = readPairedIdentity({
      pairingStatePath: hubState(PAIRED_HUB),
      terminalAssignmentPath: NO_SEAT,
    });
    expect(identity?.assignmentGeneration).toBe(1);
    expect(identity?.assignmentGenerationSource).toBe("assumed-legacy-default");
  });

  it.each([
    ["zero", 0],
    ["negative", -3],
    ["non-integer", 2.5],
    ["a string", "3"],
  ])("does not trust a %s generation", (_label, generation) => {
    const identity = readPairedIdentity({
      pairingStatePath: hubState({ ...PAIRED_HUB, assignmentGeneration: generation }),
      terminalAssignmentPath: NO_SEAT,
    });
    expect(identity?.assignmentGeneration).toBe(1);
    expect(identity?.assignmentGenerationSource).toBe("assumed-legacy-default");
  });

  it("marks a Terminal seat's own generation as stated", () => {
    expect(
      readPairedIdentity({ terminalAssignmentPath: seat(SEAT), pairingStatePath: "/nonexistent" })
        ?.assignmentGenerationSource,
    ).toBe("stated");
  });
});
