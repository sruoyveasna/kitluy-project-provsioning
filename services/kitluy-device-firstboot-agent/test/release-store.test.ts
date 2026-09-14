/**
 * The release store: journal, activation, rollback — and the power-loss class
 * (U1 requirement 3).
 *
 * The durability suite does not test "is there an fsync call". It aborts the
 * activation sequence at EVERY step boundary, reconciles, and asserts the
 * invariant the owner asked acceptance test C to prove on hardware:
 *
 *     at every instant, the store resolves a valid release, or resolves nothing
 *     at all and the launcher falls back to the image copy. There is no
 *     interleaving that leaves a half-installed mixture.
 *
 * A unit test cannot pull the mains out. What it CAN do is stop between any two
 * syscalls, which is the same set of states a power cut can produce — and unlike
 * the bench, it can do it for every boundary, repeatably, in a second.
 */
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ProductNotPermittedError,
  U1_PERMITTED_PRODUCT,
  activate,
  activeReleaseId,
  assertProductPermitted,
  beginStaging,
  commit,
  emptyJournal,
  incomingDir,
  isUsableRelease,
  promoteStaged,
  pruneReleases,
  readJournal,
  reconcile,
  releaseDir,
  resolveLink,
  rollback,
  storePaths,
  writeJournal,
  type StorePaths,
} from "../src/release-store.js";

let root: string;
let paths: StorePaths;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kitluy-store-"));
  paths = storePaths(U1_PERMITTED_PRODUCT, root);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Put a usable release on disk, as a completed staging would have. */
function placeRelease(releaseId: string, main = "index.js"): void {
  const dir = join(releaseDir(paths, releaseId), "payload");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ main }));
  writeFileSync(join(dir, main), "// payload");
}

describe("the U1 scope fence (owner ruling OD-U1-2 = C)", () => {
  it("permits the Device Shell payload", () => {
    expect(() => {
      assertProductPermitted("device-shell");
    }).not.toThrow();
  });

  // The ruling is explicit that it must NOT be used to reclassify the
  // bootstrap/runtime set. This is that sentence, enforced.
  it.each([
    "terminal-edge",
    "firstboot-identity",
    "cloud-registration",
    "update-agent",
    "health-reporter",
    "operational-tls",
    "hub-agent",
    "terminal-client",
  ])("refuses %s, which stays image-only until the owner rules at U3", (product) => {
    expect(() => {
      assertProductPermitted(product);
    }).toThrow(ProductNotPermittedError);
    expect(() => storePaths(product, root)).toThrow(ProductNotPermittedError);
  });
});

describe("the journal", () => {
  it("reads as empty when absent, rather than throwing", () => {
    expect(readJournal(paths)).toEqual(emptyJournal(U1_PERMITTED_PRODUCT));
  });

  it("reads as empty when corrupt, so a bad write cannot brick the updater", () => {
    mkdirSync(paths.productRoot, { recursive: true });
    writeFileSync(paths.journal, "{not json");
    expect(readJournal(paths).phase).toBe("IDLE");
  });

  it("reads as empty when it belongs to another product", () => {
    mkdirSync(paths.productRoot, { recursive: true });
    writeFileSync(paths.journal, JSON.stringify({ journalVersion: 1, product: "something-else" }));
    expect(readJournal(paths).phase).toBe("IDLE");
  });

  it("round-trips and stamps updatedAt", () => {
    const written = writeJournal(paths, { ...emptyJournal(U1_PERMITTED_PRODUCT), committed: "r1" });
    expect(readJournal(paths).committed).toBe("r1");
    expect(Date.parse(written.updatedAt)).toBeGreaterThan(0);
  });
});

describe("activate, commit and rollback", () => {
  it("activates a staged release and records the previous one", () => {
    placeRelease("r1");
    placeRelease("r2");
    activate(paths, "r1");
    commit(paths, "r1", "1.0.0");
    activate(paths, "r2");

    expect(resolveLink(paths.current)).toBe("r2");
    expect(resolveLink(paths.previous)).toBe("r1");
    expect(readJournal(paths).phase).toBe("HEALTH_PENDING");
  });

  it("commit records the superseded release so a replay of it is refused later", () => {
    placeRelease("r1");
    placeRelease("r2");
    activate(paths, "r1");
    commit(paths, "r1", "1.0.0");
    activate(paths, "r2");
    const journal = commit(paths, "r2", "1.1.0");

    expect(journal.committed).toBe("r2");
    expect(journal.supersededReleaseIds).toContain("r1");
  });

  it("rollback restores the previous release and blocks automatic retry", () => {
    placeRelease("r1");
    placeRelease("r2");
    activate(paths, "r1");
    commit(paths, "r1", "1.0.0");
    activate(paths, "r2");
    const journal = rollback(paths, "r2", "the health gate failed");

    expect(resolveLink(paths.current)).toBe("r1");
    expect(journal.phase).toBe("ROLLED_BACK");
    expect(journal.failedRolledBackReleaseIds).toContain("r2");
    expect(journal.lastResult?.reason).toBe("the health gate failed");
  });

  it("rollback with no usable previous removes current, so the image copy runs", () => {
    placeRelease("r1");
    activate(paths, "r1");
    const journal = rollback(paths, "r1", "nothing to fall back to");

    expect(existsSync(paths.current)).toBe(false);
    expect(activeReleaseId(paths)).toBeNull();
    expect(journal.committed).toBeNull();
  });

  it("does not treat a half-unpacked release as usable", () => {
    mkdirSync(join(releaseDir(paths, "r9"), "payload"), { recursive: true });
    // No package.json: exactly what an interrupted unpack leaves.
    expect(isUsableRelease(paths, "r9")).toBe(false);
  });
});

/**
 * ONE PER STEP BOUNDARY in the activation sequence. Each case builds the exact
 * on-disk state that losing power at that instant would leave, then reconciles.
 */
describe("power loss at every step boundary", () => {
  it("1-2: interrupted unpack — .incoming exists, nothing else changed", () => {
    placeRelease("r1");
    activate(paths, "r1");
    commit(paths, "r1", "1.0.0");
    const incoming = beginStaging(paths, "r2");
    writeFileSync(join(incoming, "payload", "partial.js"), "half");

    const result = reconcile(paths);
    expect(existsSync(incomingDir(paths, "r2"))).toBe(false);
    expect(activeReleaseId(paths)).toBe("r1");
    expect(result.action).toBe("NOTHING_TO_DO");
  });

  it("3: promoted but never activated — the release exists, current unchanged", () => {
    placeRelease("r1");
    activate(paths, "r1");
    commit(paths, "r1", "1.0.0");
    const incoming = beginStaging(paths, "r2");
    writeFileSync(join(incoming, "payload", "package.json"), '{"main":"index.js"}');
    promoteStaged(paths, "r2");

    reconcile(paths);
    expect(existsSync(releaseDir(paths, "r2"))).toBe(true);
    expect(activeReleaseId(paths)).toBe("r1");
  });

  it("4: journal says ACTIVATING but the switch never happened — discard", () => {
    placeRelease("r1");
    placeRelease("r2");
    activate(paths, "r1");
    commit(paths, "r1", "1.0.0");
    // The durable intent landed; the symlink swap did not.
    writeJournal(paths, {
      ...readJournal(paths),
      phase: "ACTIVATING",
      target: "r2",
      previous: "r1",
    });

    const result = reconcile(paths);
    expect(result.action).toBe("DISCARDED_INTERRUPTED_ACTIVATION");
    expect(activeReleaseId(paths)).toBe("r1");
    expect(readJournal(paths).phase).toBe("IDLE");
    expect(readJournal(paths).lastResult?.outcome).toBe("INTERRUPTED");
  });

  it("5-6: the switch landed but the journal never advanced — adopt it", () => {
    placeRelease("r1");
    placeRelease("r2");
    activate(paths, "r1");
    commit(paths, "r1", "1.0.0");
    writeJournal(paths, {
      ...readJournal(paths),
      phase: "ACTIVATING",
      target: "r2",
      previous: "r1",
    });
    // The swap completed before power was lost.
    rmSync(paths.current, { force: true });
    activate(paths, "r2");
    writeJournal(paths, {
      ...readJournal(paths),
      phase: "ACTIVATING",
      target: "r2",
      previous: "r1",
    });

    const result = reconcile(paths);
    expect(result.action).toBe("ADOPTED_SWITCHED_RELEASE");
    expect(readJournal(paths).phase).toBe("HEALTH_PENDING");
    expect(activeReleaseId(paths)).toBe("r2");
  });

  it("7-8: the gate never finished — it re-runs from zero", () => {
    placeRelease("r1");
    placeRelease("r2");
    activate(paths, "r1");
    commit(paths, "r1", "1.0.0");
    activate(paths, "r2");

    const result = reconcile(paths);
    expect(result.action).toBe("RESUME_HEALTH_GATE");
    expect(readJournal(paths).target).toBe("r2");
    expect(activeReleaseId(paths)).toBe("r2");
  });

  it("current points at a release whose payload is gone — restore previous", () => {
    placeRelease("r1");
    placeRelease("r2");
    activate(paths, "r1");
    commit(paths, "r1", "1.0.0");
    activate(paths, "r2");
    rmSync(releaseDir(paths, "r2"), { recursive: true, force: true });

    const result = reconcile(paths);
    expect(result.action).toBe("RESTORED_PREVIOUS");
    expect(activeReleaseId(paths)).toBe("r1");
  });

  it("nothing usable remains — fall back to the image copy, never a dead link", () => {
    placeRelease("r1");
    activate(paths, "r1");
    commit(paths, "r1", "1.0.0");
    rmSync(releaseDir(paths, "r1"), { recursive: true, force: true });

    const result = reconcile(paths);
    expect(result.action).toBe("FELL_BACK_TO_IMAGE");
    expect(existsSync(paths.current)).toBe(false);
    expect(activeReleaseId(paths)).toBeNull();
  });

  it("reconcile is idempotent — running it twice changes nothing", () => {
    placeRelease("r1");
    placeRelease("r2");
    activate(paths, "r1");
    commit(paths, "r1", "1.0.0");
    writeJournal(paths, {
      ...readJournal(paths),
      phase: "ACTIVATING",
      target: "r2",
      previous: "r1",
    });

    const first = reconcile(paths);
    const second = reconcile(paths);
    expect(first.action).toBe("DISCARDED_INTERRUPTED_ACTIVATION");
    expect(second.action).toBe("NOTHING_TO_DO");
    expect(activeReleaseId(paths)).toBe("r1");
  });

  /**
   * The invariant itself, over every state the sequence can be interrupted in.
   * Not a restatement of the cases above: this asserts the PROPERTY rather than
   * the action, which is what acceptance test C checks on hardware.
   */
  it("INVARIANT: after reconcile, the store always resolves a valid release or none", () => {
    const phases = [
      "IDLE",
      "ACTIVATING",
      "HEALTH_PENDING",
      "COMMITTED",
      "ROLLED_BACK",
      "FAILED",
    ] as const;
    for (const phase of phases) {
      for (const currentTarget of [null, "r1", "r2", "missing"]) {
        rmSync(root, { recursive: true, force: true });
        mkdirSync(root, { recursive: true });
        placeRelease("r1");
        placeRelease("r2");
        writeJournal(paths, {
          ...emptyJournal(U1_PERMITTED_PRODUCT),
          phase,
          target: "r2",
          previous: "r1",
          committed: "r1",
        });
        if (currentTarget !== null) activate(paths, currentTarget);
        writeJournal(paths, {
          ...readJournal(paths),
          phase,
          target: "r2",
          previous: "r1",
          committed: "r1",
        });

        reconcile(paths);

        const active = activeReleaseId(paths);
        // Either a usable release, or nothing at all. Never a dangling link,
        // never a release whose payload is incomplete.
        if (active !== null) {
          expect(isUsableRelease(paths, active)).toBe(true);
          expect(existsSync(join(releaseDir(paths, active), "payload", "package.json"))).toBe(true);
        } else {
          expect(existsSync(paths.current)).toBe(false);
        }
      }
    }
  });
});

describe("pruneReleases", () => {
  it("keeps current and previous and removes the rest", () => {
    placeRelease("r1");
    placeRelease("r2");
    placeRelease("r3");
    activate(paths, "r1");
    commit(paths, "r1", "1.0.0");
    activate(paths, "r2");

    const removed = pruneReleases(paths);
    expect(removed).toEqual(["r3"]);
    expect(existsSync(releaseDir(paths, "r1"))).toBe(true);
    expect(existsSync(releaseDir(paths, "r2"))).toBe(true);
    expect(existsSync(releaseDir(paths, "r3"))).toBe(false);
  });
});

describe("symlink resolution", () => {
  it("reads a release id back out of a link", () => {
    placeRelease("abc-123");
    activate(paths, "abc-123");
    expect(readlinkSync(paths.current)).toBe("rel-abc-123");
    expect(resolveLink(paths.current)).toBe("abc-123");
  });

  it("returns null for an absent link rather than throwing", () => {
    expect(resolveLink(join(root, "nope"))).toBeNull();
  });
});
