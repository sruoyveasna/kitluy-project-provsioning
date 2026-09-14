/**
 * Fallback visibility (U1 requirement 4).
 *
 * The owner's sentence was "do not silently present the fallback copy as though
 * the assigned release is running". Every test here is a way that could happen,
 * and the assertion is that it does not.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { describeReleaseStatus, formatReleaseStatusLine } from "../src/release-status.js";
import {
  U1_PERMITTED_PRODUCT,
  activate,
  commit,
  emptyJournal,
  releaseDir,
  rollback,
  storePaths,
  writeJournal,
  type StorePaths,
} from "../src/release-store.js";

let root: string;
let paths: StorePaths;
let witnessPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kitluy-status-"));
  paths = storePaths(U1_PERMITTED_PRODUCT, root);
  witnessPath = join(root, "running-source.json");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function placeRelease(releaseId: string, version: string): void {
  const dir = join(releaseDir(paths, releaseId), "payload");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ main: "index.js" }));
  writeFileSync(join(dir, "index.js"), "// payload");
  writeFileSync(
    join(releaseDir(paths, releaseId), "manifest.json"),
    JSON.stringify({ manifest: { version } }),
  );
}

function witness(source: "RELEASE" | "IMAGE_FALLBACK", app: string): void {
  writeFileSync(witnessPath, JSON.stringify({ source, app, at: new Date().toISOString() }));
}

function status() {
  return describeReleaseStatus(paths, { runningSourcePath: witnessPath });
}

describe("the running source is the launcher's witness, never an inference", () => {
  it("reports RELEASE with the version actually started", () => {
    placeRelease("r1", "0.4.12");
    activate(paths, "r1");
    commit(paths, "r1", "0.4.12");
    witness("RELEASE", join(releaseDir(paths, "r1"), "payload"));

    const result = status();
    expect(result.runningSource).toBe("RELEASE");
    expect(result.runningReleaseId).toBe("r1");
    expect(result.runningVersion).toBe("0.4.12");
    expect(result.stale).toBe(false);
  });

  it("reports IMAGE FALLBACK, never the installed version, when the image copy ran", () => {
    placeRelease("r1", "0.4.12");
    activate(paths, "r1");
    commit(paths, "r1", "0.4.12");
    // The shell started BEFORE the release landed — the exact case that would
    // otherwise look like a successful update that did nothing.
    witness("IMAGE_FALLBACK", "/usr/lib/kitluy/lib/device-shell");

    const result = status();
    expect(result.runningSource).toBe("IMAGE_FALLBACK");
    expect(result.runningVersion).toBeNull();
    expect(result.runningReleaseId).toBeNull();
    // The installed release is still reported — as INSTALLED, not as running.
    expect(result.installedReleaseId).toBe("r1");
    expect(result.stale).toBe(true);
    expect(result.fallbackReason).toContain("restart");
  });

  it("reports UNKNOWN rather than guessing when the launcher has not written yet", () => {
    placeRelease("r1", "0.4.12");
    activate(paths, "r1");
    commit(paths, "r1", "0.4.12");
    expect(status().runningSource).toBe("UNKNOWN");
  });

  it("reports STALE when a newer release is installed than the one running", () => {
    placeRelease("r1", "0.4.11");
    placeRelease("r2", "0.4.12");
    activate(paths, "r1");
    commit(paths, "r1", "0.4.11");
    witness("RELEASE", join(releaseDir(paths, "r1"), "payload"));
    activate(paths, "r2");
    commit(paths, "r2", "0.4.12");

    const result = status();
    expect(result.runningReleaseId).toBe("r1");
    expect(result.installedReleaseId).toBe("r2");
    expect(result.stale).toBe(true);
  });
});

describe("the fallback always carries a reason", () => {
  it("names a rollback", () => {
    placeRelease("r1", "0.4.12");
    activate(paths, "r1");
    rollback(paths, "r1", "the health gate failed");
    witness("IMAGE_FALLBACK", "/usr/lib/kitluy/lib/device-shell");

    const result = status();
    expect(result.fallbackReason).toBe("the health gate failed");
    expect(result.lastUpdate?.outcome).toBe("ROLLED_BACK");
  });

  it("names a refusal", () => {
    writeJournal(paths, {
      ...emptyJournal(U1_PERMITTED_PRODUCT),
      lastResult: {
        outcome: "REFUSED",
        releaseId: "r9",
        version: null,
        reason: "ARTIFACT_DIGEST_MISMATCH",
        at: new Date().toISOString(),
      },
    });
    witness("IMAGE_FALLBACK", "/usr/lib/kitluy/lib/device-shell");
    expect(status().fallbackReason).toContain("ARTIFACT_DIGEST_MISMATCH");
  });

  it("says so plainly on a device that has never had a release", () => {
    witness("IMAGE_FALLBACK", "/usr/lib/kitluy/lib/device-shell");
    expect(status().fallbackReason).toBe("no release has been installed on this device yet");
  });
});

describe("the one-line journal form", () => {
  it("says IMAGE FALLBACK in words, with the reason", () => {
    placeRelease("r1", "0.4.12");
    activate(paths, "r1");
    rollback(paths, "r1", "the health gate failed");
    witness("IMAGE_FALLBACK", "/usr/lib/kitluy/lib/device-shell");

    const line = formatReleaseStatusLine(status());
    expect(line).toContain("running=IMAGE FALLBACK");
    expect(line).toContain("the health gate failed");
    expect(line).toContain("last=ROLLED_BACK");
  });

  it("names the running version when a release is running", () => {
    placeRelease("r1", "0.4.12");
    activate(paths, "r1");
    commit(paths, "r1", "0.4.12");
    witness("RELEASE", join(releaseDir(paths, "r1"), "payload"));
    expect(formatReleaseStatusLine(status())).toContain("running=RELEASE 0.4.12");
  });

  it("flags staleness so a restart is an obvious next step", () => {
    placeRelease("r1", "0.4.12");
    activate(paths, "r1");
    commit(paths, "r1", "0.4.12");
    witness("IMAGE_FALLBACK", "/usr/lib/kitluy/lib/device-shell");
    expect(formatReleaseStatusLine(status())).toContain("stale=yes(restart to apply)");
  });

  it("never throws on a corrupt witness file", () => {
    writeFileSync(witnessPath, "{not json");
    expect(() => formatReleaseStatusLine(status())).not.toThrow();
    expect(status().runningSource).toBe("UNKNOWN");
  });
});
