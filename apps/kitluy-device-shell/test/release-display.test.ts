/**
 * What the screen says about the software it is running (U1 requirement 4).
 *
 * The owner's sentence was "do not silently present the fallback copy as though
 * the assigned release is running". These are the ways that could happen, and
 * the assertion is that none of them does.
 *
 * The case that matters most is `a release is installed but the image copy is
 * running` — the board is healthy, the screen looks right, and the change that
 * was published is simply not there. Without a caption a developer spends an
 * afternoon on it; with one they restart the unit.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readRelease, type DeviceRoots } from "../electron/device-state-files.js";
import { releaseCaption, type ShellSnapshot } from "../src/model/shell-state.js";

let root: string;
let roots: DeviceRoots;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kt-release-"));
  mkdirSync(join(root, "state", "terminal"), { recursive: true });
  mkdirSync(join(root, "releases"), { recursive: true });
  roots = {
    stateDir: join(root, "state"),
    netDir: join(root, "net"),
    routePath: join(root, "route"),
    releaseStoreDir: join(root, "releases"),
  };
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function witness(source: string, app: string): void {
  writeFileSync(
    join(roots.stateDir, "terminal", "running-source.json"),
    JSON.stringify({ source, app, at: new Date().toISOString() }),
  );
}
function journal(fields: Record<string, unknown>): void {
  writeFileSync(join(roots.releaseStoreDir, "journal.json"), JSON.stringify(fields));
}
/**
 * A real `ShellSnapshot`, not a cast. An earlier version used `as ShellSnapshot`
 * over an object with an invented `network` shape; vitest transpiles without
 * checking, so it passed the suite and failed `pnpm typecheck`. Building the
 * value properly is both correct and what caught that.
 */
function snapshotWith(release: ReturnType<typeof readRelease>): ShellSnapshot {
  return {
    registration: null,
    pairing: null,
    network: { hasLink: false, hasRoute: false },
    release,
  };
}

describe("readRelease", () => {
  it("returns null on an image with no release runtime at all", () => {
    expect(readRelease(roots)).toBeNull();
  });

  it("reports a running release and its version", () => {
    witness("RELEASE", "/persistent/shared/kitluy/releases/device-shell/rel-r1/payload");
    journal({ committed: "r1", committedVersion: "0.4.12", phase: "COMMITTED" });
    const release = readRelease(roots);
    expect(release?.source).toBe("RELEASE");
    expect(release?.runningVersion).toBe("0.4.12");
    expect(release?.stale).toBe(false);
  });

  it("NEVER reports a running version when the image copy is running", () => {
    witness("IMAGE_FALLBACK", "/usr/lib/kitluy/lib/device-shell");
    journal({ committed: "r1", committedVersion: "0.4.12", phase: "COMMITTED" });
    const release = readRelease(roots);
    expect(release?.source).toBe("IMAGE_FALLBACK");
    // The whole point: 0.4.12 is INSTALLED, not RUNNING.
    expect(release?.runningVersion).toBeNull();
    expect(release?.installedVersion).toBe("0.4.12");
    expect(release?.stale).toBe(true);
  });

  it("reports stale when a different release is installed than the one running", () => {
    witness("RELEASE", "/persistent/shared/kitluy/releases/device-shell/rel-r1/payload");
    journal({ committed: "r2", committedVersion: "0.4.13", phase: "COMMITTED" });
    const release = readRelease(roots);
    expect(release?.stale).toBe(true);
    expect(release?.runningVersion).toBeNull();
  });

  it("reports UNKNOWN rather than guessing before the launcher has written", () => {
    journal({ committed: "r1", committedVersion: "0.4.12", phase: "COMMITTED" });
    expect(readRelease(roots)?.source).toBe("UNKNOWN");
  });

  it("carries a rollback reason through", () => {
    witness("IMAGE_FALLBACK", "/usr/lib/kitluy/lib/device-shell");
    journal({
      phase: "ROLLED_BACK",
      lastResult: { outcome: "ROLLED_BACK", reason: "the health gate failed" },
    });
    const release = readRelease(roots);
    expect(release?.lastOutcome).toBe("ROLLED_BACK");
    expect(release?.fallbackReason).toBe("the health gate failed");
  });

  it("never throws on corrupt files", () => {
    writeFileSync(join(roots.stateDir, "terminal", "running-source.json"), "{not json");
    writeFileSync(join(roots.releaseStoreDir, "journal.json"), "{also not");
    expect(() => readRelease(roots)).not.toThrow();
  });
});

describe("releaseCaption", () => {
  it("says nothing on a board that has never had a release", () => {
    witness("IMAGE_FALLBACK", "/usr/lib/kitluy/lib/device-shell");
    journal({ phase: "IDLE" });
    expect(releaseCaption(snapshotWith(readRelease(roots)))).toBeNull();
  });

  it("shows the version plainly when a release is running", () => {
    witness("RELEASE", "/persistent/shared/kitluy/releases/device-shell/rel-r1/payload");
    journal({ committed: "r1", committedVersion: "0.4.12", phase: "COMMITTED" });
    const caption = releaseCaption(snapshotWith(readRelease(roots)));
    expect(caption?.text).toBe("0.4.12");
    expect(caption?.tone).toBe("normal");
  });

  it("DEMANDS ATTENTION when the image copy runs with an update installed", () => {
    witness("IMAGE_FALLBACK", "/usr/lib/kitluy/lib/device-shell");
    journal({ committed: "r1", committedVersion: "0.4.12", phase: "COMMITTED" });
    const caption = releaseCaption(snapshotWith(readRelease(roots)));
    expect(caption?.tone).toBe("attention");
    expect(caption?.text).toContain("Image software");
    expect(caption?.text).toContain("0.4.12");
    // It must not read as though 0.4.12 were running.
    expect(caption?.text).toContain("restart");
  });

  it("demands attention after a rollback", () => {
    witness("IMAGE_FALLBACK", "/usr/lib/kitluy/lib/device-shell");
    journal({
      phase: "ROLLED_BACK",
      lastResult: { outcome: "ROLLED_BACK", reason: "gate failed" },
    });
    const caption = releaseCaption(snapshotWith(readRelease(roots)));
    expect(caption?.tone).toBe("attention");
    expect(caption?.text).toContain("Image software");
  });

  it("says a restart is needed when a newer release is installed", () => {
    witness("RELEASE", "/persistent/shared/kitluy/releases/device-shell/rel-r1/payload");
    journal({ committed: "r2", committedVersion: "0.4.13", phase: "COMMITTED" });
    const caption = releaseCaption(snapshotWith(readRelease(roots)));
    expect(caption?.tone).toBe("attention");
    expect(caption?.text).toContain("restart");
  });

  it("says nothing when the snapshot carries no release view", () => {
    expect(releaseCaption(snapshotWith(null))).toBeNull();
  });
});
