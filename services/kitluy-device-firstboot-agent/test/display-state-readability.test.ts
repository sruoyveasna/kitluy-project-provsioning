/**
 * The unprivileged Device Shell must be able to READ the device's display state.
 *
 * ===========================================================================
 * WHY THIS SUITE EXISTS
 * ===========================================================================
 * `kitluy-terminal-session.service` runs the Pi Terminal Device Shell as
 * `User=kitluy-terminal`, with no supplementary group that would reach root's
 * files. The agents that WRITE the display state run as root. So the mode on
 * these three files is the entire access-control decision between them, and it
 * is not written down anywhere the shell can see.
 *
 * At 0640 root:root, `registration-state.json` and `pairing-state.json` were
 * unreadable to the shell. Nothing crashes when that happens — the shell's
 * `readObject` catches the EACCES and returns null, `deriveScreen` reads a null
 * registration as `NOT_REGISTERED`, and an APPROVED board sits on "waiting for
 * approval" for ever with the cloud disagreeing. A silent, total failure that no
 * unit test on either side would have caught, because each side is correct
 * alone.
 *
 * These files are display state by construction: a phase, a public asset tag,
 * server-issued ids and an operator sentence. Never a key, never a credential,
 * and — stated in `pairing-state.ts` — never the presented pairing code. World
 * -readable is the right posture for them, and `bootstrap-state.json` has been
 * 0644 since it was written for exactly this reason.
 *
 * The private key is the counter-example and stays 0600, asserted by
 * `firstboot-executable.test.ts`. This suite is about the files that must be
 * shared, not the one that must not be.
 */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeBootstrapState } from "../src/bootstrap-state.js";
import { writePairingState } from "../src/pairing-state.js";
import { writeRegistrationState } from "../src/registration-state.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kitluy-display-state-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const modeOf = (path: string): number => statSync(path).mode & 0o777;

describe("display state the Device Shell reads", () => {
  it("writes registration state a non-root reader can open", () => {
    const path = join(dir, "registration-state.json");
    writeRegistrationState({ phase: "APPROVED", updatedAt: new Date().toISOString() }, path);
    // The `& 0o004` bit IS the requirement: any user that can traverse
    // /var/lib/kitluy (0751) can read it. Asserting the exact mode as well keeps
    // the intent legible rather than merely satisfied.
    expect(modeOf(path) & 0o004).toBe(0o004);
    expect(modeOf(path)).toBe(0o644);
  });

  it("writes pairing state a non-root reader can open", () => {
    const path = join(dir, "pairing-state.json");
    writePairingState({ phase: "UNPAIRED", updatedAt: new Date().toISOString() }, path);
    expect(modeOf(path) & 0o004).toBe(0o004);
    expect(modeOf(path)).toBe(0o644);
  });

  it("keeps bootstrap state readable too, which it already was", () => {
    const path = join(dir, "bootstrap-state.json");
    writeBootstrapState(
      { phase: "ENROLLED_UNASSIGNED", updatedAt: new Date().toISOString() },
      path,
    );
    expect(modeOf(path) & 0o004).toBe(0o004);
  });

  it("leaves no group- or world-WRITABLE display state behind", () => {
    // Readable is the point; writable would let the kiosk user forge the state
    // the same kiosk renders, and the agents are the only writers.
    const paths = [
      join(dir, "registration-state.json"),
      join(dir, "pairing-state.json"),
      join(dir, "bootstrap-state.json"),
    ];
    writeRegistrationState({ phase: "APPROVED", updatedAt: new Date().toISOString() }, paths[0]!);
    writePairingState({ phase: "UNPAIRED", updatedAt: new Date().toISOString() }, paths[1]!);
    writeBootstrapState(
      { phase: "ENROLLED_UNASSIGNED", updatedAt: new Date().toISOString() },
      paths[2]!,
    );
    for (const path of paths) {
      expect(modeOf(path) & 0o022).toBe(0);
    }
  });
});
