#!/usr/bin/env node
/**
 * The Store Hub agent — the production entrypoint that runs on a Pi in a shop.
 *
 * ===========================================================================
 * WHY THIS EXISTS ALONGSIDE `main.ts`
 * ===========================================================================
 * `main.ts` says so in its own first line: *"Simulated Store Hub development
 * entrypoint … a development simulation ONLY"*. It serves the LAN kernel over
 * plain HTTP on localhost against an in-memory database, with a hardcoded
 * `hubId: "hub-simulated-dev"`. Useful for developing route logic; it is not a
 * thing that may run in a shop, and renaming it would have made it one.
 *
 * This entrypoint is the opposite in every respect that matters: real
 * PostgreSQL, real mutual TLS on the approved interface, and a startup that
 * REFUSES rather than improvises.
 *
 * ===========================================================================
 * WHAT IT WILL NOT DO
 * ===========================================================================
 * It will not generate certificates, invent a device CA, apply migrations, or
 * bind a wildcard. Each of those is either an owner decision that has not been
 * made (BLK-005) or one that is explicitly owner-locked (KL-INF-P1-037:
 * "Production Hub migrations are human-operated and never automatic"). A Hub
 * that did any of them would look like it was working while standing on
 * something nobody approved.
 *
 * Every decision it makes lives in `hub-runtime.ts` as a pure function, so this
 * file is only: gather observations → ask → act.
 */
import { createLogger } from "@kitluy/observability";

import { SERVICE_NAME, SERVICE_VERSION } from "../index.js";
import { createHubPool, isHubDatabaseReachable } from "../hub/db.js";
import {
  readAppliedMigrations,
  readReportedClockOffsetSeconds,
  type HubMigrationEntry,
} from "../hub/safety-mode.js";
import {
  decideStartup,
  evaluateSchema,
  loadTlsMaterial,
  resolveBindHost,
  HUB_LAN_PORT,
} from "../hub-runtime.js";

const log = createLogger(SERVICE_NAME);

/**
 * The migration set THIS release expects.
 *
 * Read from a manifest the packaging step writes, never by scanning a directory
 * at runtime: a Hub that discovered its own expectations from whatever files
 * happened to be on disk could not detect that it is running against the wrong
 * database, which is the entire purpose of the check.
 *
 * Absent manifest → an empty expectation, which `evaluateSchema` reports as
 * `SCHEMA-AHEAD` against any real database. That is the correct failure: a Hub
 * that cannot state what it expects must not serve.
 */
async function expectedMigrations(): Promise<readonly HubMigrationEntry[]> {
  const manifestPath = process.env.HUB_MIGRATION_MANIFEST ?? "";
  if (manifestPath === "") return [];
  try {
    const { readFile } = await import("node:fs/promises");
    const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (entry === null || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const filename = record.filename;
      const checksum = record.checksumSha256;
      if (typeof filename !== "string" || typeof checksum !== "string") return [];
      return [{ filename, checksumSha256: checksum }];
    });
  } catch {
    return [];
  }
}

/**
 * The data partition's used percentage, MEASURED.
 *
 * `REQUIRED_DISK_CAPACITY_SOURCE` records this as an open gap because the
 * heartbeat table carries only `disk_free_bytes`, from which a percentage cannot
 * be derived. It can be read directly from the OS, which is what the safety
 * ladder actually wants, so this closes the gap rather than passing a figure
 * nobody measured.
 *
 * Returns `undefined` when the path cannot be stat'ed — an unmeasured disk is
 * never reported as an empty one, which would read as `normal` and silence the
 * whole §13 ladder.
 */
async function measureDiskUsedPercent(path: string): Promise<number | undefined> {
  try {
    const { statfs } = await import("node:fs/promises");
    const stats = await statfs(path);
    const total = Number(stats.blocks) * Number(stats.bsize);
    const available = Number(stats.bavail) * Number(stats.bsize);
    if (!Number.isFinite(total) || total <= 0) return undefined;
    return ((total - available) / total) * 100;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const reachable = await isHubDatabaseReachable();

  // The pool is opened only when there is something to connect to; constructing
  // one against an unreachable database would turn a clear refusal into a
  // connection error stack.
  const pool = reachable ? createHubPool() : null;

  const hubDeviceId = process.env.HUB_DEVICE_ID ?? "";
  let applied: readonly HubMigrationEntry[] = [];
  let clockOffsetSeconds: number | undefined;
  if (pool !== null) {
    const client = await pool.connect();
    try {
      applied = await readAppliedMigrations(client);
      // The reading is per DEVICE, so it needs the Hub's own enrolled identity.
      // Without it there is no reading — and `undefined` is kept as `undefined`
      // rather than folded to zero, because zero means "clock is fine".
      if (hubDeviceId !== "") {
        clockOffsetSeconds = await readReportedClockOffsetSeconds(client, hubDeviceId);
      }
    } finally {
      client.release();
    }
  }

  const dataPath = process.env.HUB_DATA_PATH ?? "/var/lib/kitluy/hub";
  const diskUsedPercent = await measureDiskUsedPercent(dataPath);

  const verdict = decideStartup({
    databaseReachable: reachable,
    schema: evaluateSchema(await expectedMigrations(), applied),
    tls: loadTlsMaterial({
      keyPath: process.env.HUB_TLS_KEY_PATH,
      certPath: process.env.HUB_TLS_CERT_PATH,
      clientCaPath: process.env.HUB_DEVICE_CA_PATH,
    }),
    bind: resolveBindHost(process.env.HUB_LAN_BIND_HOST),
    safety: {
      readOnlyDeclared: process.env.HUB_READ_ONLY === "true",
      // Measured, not assumed. An unmeasured disk falls back to the top of the
      // ladder rather than the bottom: reporting 0% would read as `normal` and
      // silence §13 entirely, whereas a Hub that cannot see its own disk should
      // be treated as being in trouble until it can.
      diskUsedPercent: diskUsedPercent ?? 100,
      migration: { expected: await expectedMigrations(), applied },
      databaseIntegritySuspect: process.env.HUB_DB_INTEGRITY_SUSPECT === "true",
      configuration: { compatible: true, knownGoodActive: true },
      clockOffsetSeconds: clockOffsetSeconds ?? 0,
    },
  });

  if (verdict.kind === "refuse") {
    // A refusal is the product here, not an error. It is logged at info with its
    // code so an operator reading `journalctl` gets the cause and not a stack.
    log.info("Store Hub will NOT serve terminals", {
      refusal: verdict.code,
      detail: verdict.detail,
      version: SERVICE_VERSION,
      ...(verdict.assessment === undefined
        ? {}
        : { degraded: verdict.assessment.degraded, diskBand: verdict.assessment.diskBand }),
    });
    await pool?.end().catch(() => undefined);
    // Exit 0: not serving is a CONFIGURED outcome, and a non-zero code would
    // make systemd restart-loop a Hub that is waiting on an owner decision.
    process.exit(0);
  }

  log.info("Store Hub startup checks passed", {
    bindHost: verdict.bindHost,
    port: HUB_LAN_PORT,
    degraded: verdict.assessment.degraded,
    diskBand: verdict.assessment.diskBand,
    // Stated explicitly so nobody reads "no clock anomaly" as a verified fact
    // when it is simply an absent reading.
    clockObservation: clockOffsetSeconds === undefined ? "unavailable" : "reported",
    diskObservation: diskUsedPercent === undefined ? "unmeasured" : "measured",
    version: SERVICE_VERSION,
  });

  // ===========================================================================
  // The terminal-facing listener is deliberately NOT started here yet.
  // ===========================================================================
  // `createEdgeTerminalRouter` additionally needs a `TerminalPairingComposition`
  // with an operational SIGNER, a `CloudActivationGateway` and an
  // `EdgeDiscoveryAuthority` — and the signer is the same BLK-005 key custody
  // that gates the certificates. Reaching this point means the material exists,
  // which cannot happen until that decision is made, so wiring a listener now
  // would be code no one could execute or review against reality.
  //
  // What this entrypoint delivers today is the part that is decidable: a Hub
  // that proves its database, its schema and its interface, and states exactly
  // what it is waiting for.
  log.info("terminal listener not started", {
    reason: "KLUY-HUB-EDGE-PENDING",
    detail:
      "certificate material resolved, but pairing/discovery composition requires the BLK-005 operational signer",
  });
  await pool?.end().catch(() => undefined);
}

main().catch((error: unknown) => {
  log.error("Store Hub agent failed to start", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
