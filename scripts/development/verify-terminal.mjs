#!/usr/bin/env node
/**
 * `pnpm release:verify:terminal` — automated post-update acceptance.
 *
 *   pnpm release:verify:terminal --target KL-1054DD1CCC8E --expect 0.4.12
 *   pnpm release:verify:terminal --target KL-… --expect 0.4.12 --ssh pi@172.16.13.204
 *
 * ===========================================================================
 * WHAT THE WORKSTATION CAN SEE WITHOUT SSH TODAY, AND WHAT IT CANNOT
 * ===========================================================================
 * The owner's goal is that normal development diagnosis does not require SSH.
 * U1 does not reach that yet, and it is worth being exact about why rather than
 * pretending otherwise:
 *
 *   WITHOUT SSH (checked here, always):
 *     - what the governed authority says this device is assigned
 *     - the assignment sequence, and that it only ever moves forward
 *     - the release's state, channel, environment and signature presence
 *     - that the artifact bytes are available and match the signed digest
 *
 *   NOT AVAILABLE WITHOUT SSH UNTIL U3:
 *     - what the device actually INSTALLED
 *     - whether the shell is running a RELEASE or the IMAGE FALLBACK
 *     - the last update result and any rollback reason
 *
 * That second list is device-side state today (`journal.json` and
 * `running-source.json`), and nothing carries it to the cloud. The heartbeat
 * route on the Hub already accepts `releaseVersion`, and the cloud
 * `device_health_reports` already has the column — wiring them is U3, and until
 * then `--ssh` is how acceptance reads those facts.
 *
 * `--ssh` IS A DIAGNOSTIC, NOT THE UPDATE MECHANISM. It reads two JSON files
 * and runs `systemctl is-active`. It never writes, never copies a payload and
 * never restarts anything.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  ReleaseTargetRefusal,
  assertReleaseCapable,
  resolveDeviceByAssetTag,
  resolveReleaseTarget,
} from "./release-target.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RELEASES_DIR = join(REPO_ROOT, "build", "releases");

const failures = [];
let checks = 0;
function check(name, ok, detail = "") {
  checks += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || detail === "" ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(name);
}
function die(message) {
  console.error(`\nREFUSED: ${message}\n`);
  process.exit(2);
}

const args = { target: "", expect: "", ssh: "", local: false };
for (let i = 2; i < process.argv.length; i += 1) {
  const next = process.argv[i + 1];
  if (process.argv[i] === "--target") {
    args.target = next ?? "";
    i += 1;
  } else if (process.argv[i] === "--expect") {
    args.expect = next ?? "";
    i += 1;
  } else if (process.argv[i] === "--ssh") {
    args.ssh = next ?? "";
    i += 1;
  } else if (process.argv[i] === "--local") args.local = true;
}
if (args.target.trim() === "") {
  die("--target <asset-tag> is required; it is also settable as KITLUY_DEV_TERMINAL_ASSET_TAG");
}

let target;
try {
  target = resolveReleaseTarget({ local: args.local });
} catch (error) {
  die(String(error.message ?? error));
}
console.log(`\n[verify] target ${target.label}`);
console.log(`[verify] device ${args.target}\n`);

const client = new pg.Client({ ...target.connectionConfig });
await client.connect();

try {
  await assertReleaseCapable(client, target.label);
  const device = await resolveDeviceByAssetTag(client, args.target.trim());

  console.log("the governed authority");
  const { rows } = await client.query(
    `select kitluy_releases.current_device_assignment_v1($1::uuid) as a`,
    [device.id],
  );
  const assignment = rows[0]?.a ?? null;
  check("the device has a current assignment", assignment !== null);
  if (assignment === null) throw new Error("nothing assigned");

  check("the assignment carries a signature", (assignment.envelope?.signature ?? "") !== "");
  check(
    "the release is development/internal",
    assignment.manifest.environment === "development" && assignment.manifest.channel === "internal",
    `${assignment.manifest.environment}/${assignment.manifest.channel}`,
  );
  check(
    "the assignment sequence is a positive integer",
    Number.isInteger(assignment.assignmentSequence) && assignment.assignmentSequence >= 1,
    String(assignment.assignmentSequence),
  );
  if (args.expect !== "") {
    check(
      `the assigned version is ${args.expect}`,
      assignment.manifest.version === args.expect,
      assignment.manifest.version,
    );
  }

  console.log("\nthe artifact this workstation would serve");
  const artifact = join(RELEASES_DIR, assignment.releaseId, "artifact.tar.gz");
  const present = existsSync(artifact);
  check("the artifact bytes are on this workstation", present, artifact);
  if (present) {
    const bytes = readFileSync(artifact);
    check(
      "the bytes match the SIGNED digest",
      createHash("sha256").update(bytes).digest("hex") === assignment.manifest.artifactDigestSha256,
    );
    check(
      "the size matches the signed manifest",
      bytes.length === assignment.manifest.artifactSizeBytes,
      `${String(bytes.length)} vs ${String(assignment.manifest.artifactSizeBytes)}`,
    );
  }

  if (args.ssh === "") {
    console.log(
      "\n[verify] device-side state not checked — pass --ssh <user@host> for acceptance.",
    );
    console.log(
      "[verify] (installed version, running source and rollback reason reach the cloud at U3.)",
    );
  } else {
    console.log(`\nthe device itself (diagnostic, over ssh ${args.ssh})`);
    const onDevice = (command) => {
      try {
        return execFileSync(
          "ssh",
          ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", args.ssh, command],
          { encoding: "utf8" },
        ).trim();
      } catch (error) {
        return `__FAILED__ ${String(error.message ?? error).split("\n")[0]}`;
      }
    };

    const shellActive = onDevice("systemctl is-active kitluy-device-shell.service || true");
    check("the Device Shell unit is active", shellActive === "active", shellActive);

    const runningRaw = onDevice(
      "cat /var/lib/kitluy/terminal/running-source.json 2>/dev/null || echo '{}'",
    );
    let running = {};
    try {
      running = JSON.parse(runningRaw);
    } catch {
      running = {};
    }
    // THE CHECK THE OWNER ASKED FOR: the fallback must never be mistaken for a
    // successful update. A board running the image copy after a publish is a
    // FAILED acceptance, not a passed one.
    check(
      "the shell is running a RELEASE, not the image fallback",
      running.source === "RELEASE",
      String(running.source ?? "unreported"),
    );

    const journalRaw = onDevice(
      "cat /persistent/shared/kitluy/releases/device-shell/journal.json 2>/dev/null || echo '{}'",
    );
    let journal = {};
    try {
      journal = JSON.parse(journalRaw);
    } catch {
      journal = {};
    }
    check(
      "the journal records a committed release",
      journal.phase === "COMMITTED",
      String(journal.phase),
    );
    check(
      "the committed release is the assigned one",
      journal.committed === assignment.releaseId,
      `${String(journal.committed)} vs ${assignment.releaseId}`,
    );
    if (args.expect !== "") {
      check(
        `the device reports version ${args.expect}`,
        journal.committedVersion === args.expect,
        String(journal.committedVersion),
      );
    }
    check(
      "no rollback is recorded for this release",
      !(journal.failedRolledBackReleaseIds ?? []).includes(assignment.releaseId),
      JSON.stringify(journal.lastResult ?? null),
    );
    check(
      "the accepted assignment sequence matches the authority",
      journal.lastAssignmentSequence === assignment.assignmentSequence,
      `${String(journal.lastAssignmentSequence)} vs ${String(assignment.assignmentSequence)}`,
    );

    const edge = onDevice("cat /var/lib/kitluy/terminal/edge-status.json 2>/dev/null || echo '{}'");
    let edgeStatus = {};
    try {
      edgeStatus = JSON.parse(edge);
    } catch {
      edgeStatus = {};
    }
    // The update must not have cost the terminal its Hub.
    check(
      "the terminal is still SERVING its Store Hub",
      edgeStatus.phase === "SERVING",
      String(edgeStatus.phase ?? "unreported"),
    );
  }
} catch (error) {
  if (error instanceof ReleaseTargetRefusal) die(error.message);
  console.error("\nUNEXPECTED:", String(error.message ?? error));
  failures.push("unexpected error");
} finally {
  await client.end();
}

console.log("");
if (failures.length > 0) {
  console.error(`terminal verification: ${String(failures.length)} of ${String(checks)} FAILED`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`terminal verification: ${String(checks)}/${String(checks)} passed`);
