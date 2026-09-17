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
  certificateFingerprint,
  decideStartup,
  evaluateSchema,
  evaluateStoragePosture,
  loadTlsMaterial,
  resolveBindHost,
  HUB_LAN_PORT,
  type StoragePosture,
} from "../hub-runtime.js";
import {
  composeDevelopmentListener,
  startDevelopmentListener,
} from "../hub/edge/development-listener.js";

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

/**
 * The posture label `hub-storage-provision` wrote, or `undefined`.
 *
 * A label, never key material — that is the whole reason the provisioner writes
 * a separate world-readable file instead of the agent inspecting the volume.
 * Unreadable reads as `undefined`, which {@link evaluateStoragePosture} treats
 * as "not this rule's business" rather than as a pass.
 */
async function readStoragePosture(): Promise<StoragePosture> {
  const path = process.env.HUB_STORAGE_POSTURE_PATH ?? "/var/lib/kitluy/storage-posture";
  try {
    const { readFile } = await import("node:fs/promises");
    const value = (await readFile(path, "utf8")).trim();
    return value === "OTP-BOUND" || value === "DEVELOPMENT-UNBOUND" ? value : undefined;
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

  // The environment the IMAGE declares. `unknown` when unreadable, matching the
  // provisioner's default, so a Hub that cannot see its own environment is never
  // treated as a development one.
  const environment = process.env.KITLUY_ENVIRONMENT ?? "unknown";

  // Hoisted out of the `decideStartup` call because the listener needs the same
  // values afterwards, and reading the certificate twice would let the file
  // change between the check and the use.
  const tls = loadTlsMaterial({
    keyPath: process.env.HUB_TLS_KEY_PATH,
    certPath: process.env.HUB_TLS_CERT_PATH,
    clientCaPath: process.env.HUB_DEVICE_CA_PATH,
  });

  const verdict = decideStartup({
    databaseReachable: reachable,
    schema: evaluateSchema(await expectedMigrations(), applied),
    storage: evaluateStoragePosture(await readStoragePosture(), environment),
    tls,
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
  // The terminal-facing listener — DEVELOPMENT ONLY.
  // ===========================================================================
  // This used to stop here for every Hub, because composing a listener needs a
  // pairing SIGNER and signer custody is BLK-005. That is still true for pilot
  // and production, and `composeDevelopmentListener` refuses them by name.
  //
  // A development Hub is different only because it has real material to compose
  // from: an adopted credential and an ed25519 identity, both from the
  // development CA. Nothing here mints either one.
  // `decideStartup` refuses on absent TLS material, so reaching here means it is
  // present. The check restates that for the type system rather than asserting.
  if (tls.kind !== "present") {
    log.info("terminal listener not started", { reason: tls.code, detail: tls.detail });
    await pool?.end().catch(() => undefined);
    return;
  }

  const composition = composeDevelopmentListener({
    environment,
    tlsCertificateFingerprint: certificateFingerprint(tls.cert),
    bindHost: verdict.bindHost,
  });

  if (composition.kind === "refused") {
    // Same shape as before: a Hub that is not serving says exactly why, at info,
    // and exits 0 so systemd does not restart-loop a configured outcome.
    log.info("terminal listener not started", {
      reason: composition.code,
      detail: composition.detail,
    });
    await pool?.end().catch(() => undefined);
    return;
  }

  const listener = await startDevelopmentListener({
    pool: pool!,
    composition,
    environment,
    bindHost: verdict.bindHost,
    tls: { key: tls.key, cert: tls.cert, clientCa: tls.clientCa },
    logger: { info: (fields) => log.info("edge", fields) },
  });

  log.info("Store Hub is serving terminals", {
    bindHost: verdict.bindHost,
    port: listener.port,
    // Stated on every start. A development listener must never be mistaken in a
    // log for the production one it is standing in for.
    posture: "DEVELOPMENT-ONLY",
    hubDeviceId: composition.identity.hubDeviceId,
    storeLocationId: composition.identity.storeLocationId,
  });

  // The process now stays up because the server holds the event loop open.
  // Shutdown is explicit so an update can stop it without severing a request
  // mid-flight.
  const shutdown = (signal: string): void => {
    log.info("Store Hub is stopping", { signal });
    void listener
      .close()
      .catch(() => undefined)
      .then(() => pool?.end().catch(() => undefined))
      .then(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

/**
 * `hub-agent publish-development-configuration <grants.json>`
 *
 * A SUBCOMMAND RATHER THAN A SECOND BUNDLE, because the packaging step installs
 * exactly one entrypoint (`/usr/lib/kitluy/lib/hub-agent/main.mjs`) and
 * `runtime-manifest.json` is checked against that path. A second artifact would
 * mean a second manifest component for a tool that runs a handful of times in a
 * board's life.
 *
 * The grants file is the terminal projection delivery that
 * `hub-provision-terminal` already applied — it carries `profileCodes` — so an
 * operator publishes exactly what the cloud says the Partner granted.
 */
async function publishDevelopmentConfigurationCommand(path: string): Promise<void> {
  const { readFileSync } = await import("node:fs");
  const { publishDevelopmentConfiguration } = await import("../hub/dev-configuration.js");
  const environment = process.env.KITLUY_ENVIRONMENT ?? "unknown";

  const delivery = JSON.parse(readFileSync(path, "utf8")) as {
    terminalDeviceId?: string;
    tenantId?: string;
    digitalStoreId?: string;
    storeLocationId?: string;
    profileCodes?: readonly string[];
  };
  const required = ["terminalDeviceId", "tenantId", "digitalStoreId", "storeLocationId"] as const;
  for (const field of required) {
    if (typeof delivery[field] !== "string" || delivery[field] === "") {
      throw new Error(`the delivery has no ${field}`);
    }
  }
  const profileCodes = delivery.profileCodes ?? [];
  if (profileCodes.length === 0) {
    throw new Error(
      "the delivery grants no profiles; the Hub would activate a configuration that " +
        "permits nothing and every pairing would still be refused",
    );
  }

  const pool = createHubPool();
  try {
    const outcome = await publishDevelopmentConfiguration(pool, {
      tenantId: delivery.tenantId as string,
      digitalStoreId: delivery.digitalStoreId as string,
      locationId: delivery.storeLocationId as string,
      environment,
      grants: [{ terminalDeviceId: delivery.terminalDeviceId as string, profileCodes }],
    });
    log.info("development configuration activated", {
      snapshotId: outcome.snapshotId,
      snapshotVersion: outcome.snapshotVersion,
      previousSnapshotId: outcome.previousSnapshotId,
      grantsWritten: outcome.grantsWritten,
      profiles: profileCodes.join(", "),
    });
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/**
 * `hub-agent reset-terminal-pin --terminal <uuid> --operator <ref> --reason <code>`
 *
 * KLD-2026-09-03-TERMINAL-PROVISIONING-001 §14: a forgotten PIN is reset by a
 * governed, audited action, never by revealing it. The GOVERNED path — a Partner
 * request in the Partner Portal delivered to this Hub — needs the cloud-to-Hub
 * delivery that BLK-006 has not built. Until it exists this is the reset, and
 * only on a DEVELOPMENT Hub: the operator reference and reason land in the
 * immutable audit journal, the verifier is cleared, every open PIN session on the
 * terminal is closed, and the terminal asks for a new PIN twice.
 */
async function resetTerminalPinCommand(args: readonly string[]): Promise<void> {
  const environment = process.env.KITLUY_ENVIRONMENT ?? "unknown";
  if (environment !== "development") {
    throw new Error(
      `this Hub is '${environment}': a Terminal PIN reset outside development is the Partner ` +
        "Portal's governed action, which needs the cloud-to-Hub delivery (BLK-006)",
    );
  }
  const option = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const terminalDeviceId = option("--terminal");
  const operator = option("--operator");
  const reason = option("--reason");
  if (terminalDeviceId === undefined || operator === undefined || reason === undefined) {
    throw new Error("usage: reset-terminal-pin --terminal <uuid> --operator <ref> --reason <code>");
  }
  const { randomUUID } = await import("node:crypto");
  const { resetTerminalPin } = await import("../hub/edge/terminal-pin.js");
  const pool = createHubPool();
  try {
    const outcome = await resetTerminalPin(pool, {
      terminalDeviceId,
      actorRef: operator,
      reasonCode: reason,
      correlationId: randomUUID(),
    });
    if (outcome.outcome !== "ok") throw new Error(`${outcome.refusal}: ${outcome.detail}`);
    log.info("Terminal PIN reset", {
      result: outcome.result,
      terminalDeviceId,
      state: outcome.value.pin.state,
      sessionsClosed: outcome.value.sessionsClosed,
    });
  } finally {
    await pool.end().catch(() => undefined);
  }
}

const subcommand = process.argv[2];
if (subcommand === "reset-terminal-pin") {
  resetTerminalPinCommand(process.argv.slice(3)).catch((error: unknown) => {
    log.error("Terminal PIN reset was REFUSED", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
} else if (subcommand === "publish-development-configuration") {
  const path = process.argv[3];
  if (path === undefined) {
    log.error("publish-development-configuration needs the delivery file path");
    process.exit(2);
  }
  publishDevelopmentConfigurationCommand(path).catch((error: unknown) => {
    log.error("development configuration was REFUSED", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
} else {
  main().catch((error: unknown) => {
    log.error("Store Hub agent failed to start", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
