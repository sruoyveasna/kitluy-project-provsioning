/**
 * The update agent with TWO products (T1-STORE-OPERATIONS-001).
 *
 * Two things change at the entrypoint when the POS becomes a governed release,
 * and both are easy to get subtly wrong:
 *
 *   1. WHICH products a board installs. Decided by the units the IMAGE defines,
 *      so the Store Hub (which defines neither) installs nothing, and a Terminal
 *      image without the POS unit never restarts a unit it does not have.
 *   2. WHO starts an installed POS after a reboot. The unit is wanted by no
 *      target, on purpose; the agent starts it, ONCE per process, so a POS that
 *      cannot run hands the display back to the Device Shell and keeps it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  productsOnThisImage,
  resetTerminalClientStartForTests,
  startInstalledTerminalClientOnce,
  type SystemctlRunner,
} from "../src/bin/update-bootstrap.js";
import {
  activate,
  commit,
  releaseDir,
  storePaths,
  writeJournal,
  readJournal,
} from "../src/release-store.js";

let root: string;
let storeRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kt-update-products-"));
  storeRoot = join(root, "releases");
  resetTerminalClientStartForTests();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function unitDir(...units: string[]): string {
  const dir = join(root, `units-${String(Math.random()).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  for (const unit of units) writeFileSync(join(dir, unit), "[Unit]\n");
  return dir;
}

function installPos(releaseId: string): void {
  const paths = storePaths("kitluy-terminal", storeRoot);
  const payload = join(releaseDir(paths, releaseId), "payload");
  mkdirSync(payload, { recursive: true });
  writeFileSync(join(payload, "package.json"), JSON.stringify({ main: "main.js" }));
  writeFileSync(join(payload, "main.js"), "// pos");
  activate(paths, releaseId);
  commit(paths, releaseId, "0.1.0");
}

/** A systemctl double that records every call and answers from a script. */
function systemctlDouble(isActive: string, startOk = true) {
  const calls: string[][] = [];
  const runner: SystemctlRunner = (args) => {
    calls.push([...args]);
    if (args[0] === "is-active") return { ok: isActive === "active", output: isActive };
    if (args[0] === "start") return { ok: startOk, output: startOk ? "" : "Unit not found." };
    return { ok: false, output: "" };
  };
  return { calls, runner };
}

describe("which products this image installs", () => {
  it("a Store Hub image (no application units) installs nothing", () => {
    expect(productsOnThisImage([unitDir("kitluy-hub-agent.service")])).toEqual([]);
  });

  it("an image that defines only the Device Shell installs only the Device Shell", () => {
    expect(productsOnThisImage([unitDir("kitluy-device-shell.service")])).toEqual(["device-shell"]);
  });

  it("a Pi Terminal image installs both, Device Shell FIRST", () => {
    const dirs = [
      unitDir("kitluy-terminal-client.service"),
      unitDir("kitluy-device-shell.service"),
    ];
    expect(productsOnThisImage(dirs)).toEqual(["device-shell", "kitluy-terminal"]);
  });
});

describe("an installed POS is started after a reboot, once", () => {
  it("does nothing when no POS release is installed, and asks systemd nothing", () => {
    const { calls, runner } = systemctlDouble("inactive");
    expect(startInstalledTerminalClientOnce({ storeRoot, systemctl: runner })).toMatchObject({
      action: "NOT_NEEDED",
    });
    expect(calls).toEqual([]);
  });

  it("starts the unit, without blocking, when a committed release exists and the unit is down", () => {
    installPos("rel-a");
    const { calls, runner } = systemctlDouble("inactive");
    expect(startInstalledTerminalClientOnce({ storeRoot, systemctl: runner })).toEqual({
      action: "STARTED",
      releaseId: "rel-a",
    });
    expect(calls).toEqual([
      ["is-active", "kitluy-terminal-client.service"],
      ["start", "--no-block", "kitluy-terminal-client.service"],
    ]);
  });

  it("tries ONCE per process: a POS that failed keeps the Device Shell on screen", () => {
    installPos("rel-a");
    const first = systemctlDouble("inactive");
    startInstalledTerminalClientOnce({ storeRoot, systemctl: first.runner });
    // The POS failed; OnFailure= brought the Device Shell back. The next poll
    // must not take the display again.
    const second = systemctlDouble("failed");
    expect(startInstalledTerminalClientOnce({ storeRoot, systemctl: second.runner })).toMatchObject(
      {
        action: "NOT_NEEDED",
      },
    );
    expect(second.calls).toEqual([]);
  });

  it("leaves a running POS alone", () => {
    installPos("rel-a");
    const { calls, runner } = systemctlDouble("active");
    expect(startInstalledTerminalClientOnce({ storeRoot, systemctl: runner })).toMatchObject({
      action: "NOT_NEEDED",
    });
    expect(calls).toEqual([["is-active", "kitluy-terminal-client.service"]]);
  });

  it("never races an activation: HEALTH_PENDING belongs to the install pass", () => {
    installPos("rel-a");
    const paths = storePaths("kitluy-terminal", storeRoot);
    writeJournal(paths, { ...readJournal(paths), phase: "HEALTH_PENDING", target: "rel-a" });
    const { calls, runner } = systemctlDouble("inactive");
    expect(startInstalledTerminalClientOnce({ storeRoot, systemctl: runner })).toMatchObject({
      action: "NOT_NEEDED",
    });
    expect(calls).toEqual([]);
  });

  it("reports a start that systemd refused, rather than claiming it", () => {
    installPos("rel-a");
    const { runner } = systemctlDouble("inactive", false);
    expect(startInstalledTerminalClientOnce({ storeRoot, systemctl: runner })).toMatchObject({
      action: "START_FAILED",
      releaseId: "rel-a",
    });
  });
});
