/**
 * The POS runtime on a KitLuy Pi Terminal — T1-STORE-OPERATIONS-001, and the
 * Terminal PIN (TERMINAL-PIN-AND-REAL-POS-AUTH-001).
 *
 * Composition root and controller for the edge-bridge path: it runs
 * `bootstrapT1ThroughEdge` on a cadence, owns the ONE session this terminal
 * holds, hands the renderer intake operations only while the terminal is READY,
 * and publishes a public runtime-status file for the health reporter.
 *
 * THE SESSION IS A TERMINAL PIN SESSION, NOT A STAFF LOGIN
 * (KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001). The terminal's device
 * credential proves the device (the bridge's pinned mTLS, re-checked by the Hub
 * on every request); the 4-digit Terminal PIN, verified by the Store Hub,
 * unlocks it. The session the Hub issues names the terminal itself as the actor
 * and carries the T1 surface. `staff_authentication_required` is therefore read
 * on this path as "the terminal is locked": the state vocabulary is closed
 * (states.ts) and the report's `pin` says which posture the lock is in.
 *
 * WHAT NEVER HAPPENS HERE
 *   - no TLS, no key, no certificate: the Hub is reached through the root edge
 *     bridge, which pins the verified Hub certificate;
 *   - no Supabase, no cloud call of any kind: normal Store operations go to the
 *     Store Hub (PROJECT_HOME §3.5);
 *   - no staff login, no email, no password: there is no such route from here;
 *   - a PIN is never stored, logged or written to the status file.
 */
import { existsSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";

import type { T1ConfigurationRead } from "../src/bootstrap/bridge-types.js";
import { parseConfigurationSections } from "../src/bootstrap/configuration-sections.js";

import {
  bootstrapT1ThroughEdge,
  type EdgeBridgeStatusWire,
  type EdgeVerifiedConfiguration,
} from "../src/bootstrap/edge-machine.js";
import type { BootstrapLogger, EdgeOperationsSession } from "../src/bootstrap/ports.js";
import type { T1BootstrapReport } from "../src/bootstrap/states.js";
import type { IntakeOperations } from "../src/intake/ports.js";
import { bridgeCall, readBridgeStatus } from "./edge-bridge-client.js";
import { createEdgeOperationsSession, type HubCall } from "./edge-operations-session.js";
import { createIntakeOperationsWithCall } from "./t1-intake-client.js";
import {
  createTerminalPinClient,
  type TerminalPinClient,
  type TerminalPinRefusal,
  type TerminalPinSessionWire,
} from "./terminal-pin-client.js";

/** Read by the health reporter (root). Public facts only; 0644. */
export const POS_RUNTIME_STATUS_PATH = "/var/lib/kitluy/terminal/pos-runtime.json";
/** T1-FIRST-BOOT-PIN-001: the device PIN posture the root agent publishes. Never digits. */
export const DEVICE_PIN_POSTURE_PATH = "/var/lib/kitluy/terminal/device-pin.json";

export function readDevicePinPosture(
  path: string = DEVICE_PIN_POSTURE_PATH,
): "absent" | "sealed" | "registered" | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const state = (JSON.parse(readFileSync(path, "utf8")) as { state?: unknown }).state;
    return state === "sealed" || state === "registered" ? state : "absent";
  } catch {
    return undefined;
  }
}
/** v2: `terminalUnlocked` (there is no staff login on a Pi Terminal). */
export const POS_RUNTIME_STATUS_SCHEMA = "kitluy.pos-runtime-status.v2";

export interface PosRuntimeStatusRecord {
  readonly schema: typeof POS_RUNTIME_STATUS_SCHEMA;
  readonly product: "kitluy-terminal";
  readonly applicationVersion: string;
  readonly state: T1BootstrapReport["state"];
  readonly refusalCode: string | null;
  readonly hubDeviceId: string | null;
  readonly configuration: {
    readonly configurationVersion: number;
    readonly freshness: "current" | "cached_offline";
    readonly validUntil: string;
  } | null;
  /** Whether the terminal is unlocked by its PIN. Never the PIN. */
  readonly terminalUnlocked: boolean;
  readonly link: "edge_bridge";
  /** The device wall clock — DIAGNOSTIC ONLY, for the reporter's staleness check. */
  readonly observedAt: string;
}

export function statusRecordOf(
  report: T1BootstrapReport,
  applicationVersion: string,
  observedAt: Date,
): PosRuntimeStatusRecord {
  return {
    schema: POS_RUNTIME_STATUS_SCHEMA,
    product: "kitluy-terminal",
    applicationVersion,
    state: report.state,
    refusalCode: report.refusalCode ?? null,
    hubDeviceId: report.hub?.hubDeviceId ?? null,
    configuration:
      report.configuration === undefined
        ? null
        : {
            configurationVersion: report.configuration.configurationVersion,
            freshness: report.configuration.freshness,
            validUntil: report.configuration.validUntil,
          },
    terminalUnlocked: report.staff !== undefined,
    link: "edge_bridge",
    observedAt: observedAt.toISOString(),
  };
}

export type PinActionResult =
  | { readonly ok: true; readonly report: T1BootstrapReport }
  | {
      readonly ok: false;
      readonly code: string;
      readonly detail: string;
      readonly pin?: T1BootstrapReport["pin"];
    };

export interface PiTerminalRuntimeOptions {
  readonly socketPath: string;
  readonly applicationVersion: string;
  /** Null to write no status file (tests). */
  readonly statusPath: string | null;
  readonly monotonicNow?: () => number;
  /** Diagnostic wall clock for `observedAt` only. */
  readonly wallClock?: () => Date;
  readonly logger?: BootstrapLogger;
  /** Seams. Production derives both from `socketPath`. */
  readonly call?: HubCall;
  readonly bridgeStatus?: () => Promise<EdgeBridgeStatusWire>;
  /** Where the device PIN posture is read from; null reads none (tests). */
  readonly devicePinPosturePath?: string | null;
}

/** The states in which the terminal-level checks have passed and a PIN may be asked for. */
const PIN_STATES: ReadonlySet<T1BootstrapReport["state"]> = new Set([
  "staff_authentication_required",
  "ready",
  "offline_ready",
]);

export class PiTerminalRuntime {
  readonly #options: PiTerminalRuntimeOptions;
  readonly #call: HubCall;
  readonly #hub: EdgeOperationsSession;
  readonly #pin: TerminalPinClient;
  readonly #monotonic: () => number;
  #report: T1BootstrapReport | null = null;
  #configuration: EdgeVerifiedConfiguration | null = null;
  /** The Terminal PIN session the Hub issued, in memory only. */
  #session: TerminalPinSessionWire | null = null;
  /** The Hub's latest answer about the PIN. Never a PIN. */
  #pinPosture: T1BootstrapReport["pin"] | undefined = undefined;
  #listeners = new Set<(report: T1BootstrapReport) => void>();
  #running: Promise<T1BootstrapReport> | null = null;

  constructor(options: PiTerminalRuntimeOptions) {
    this.#options = options;
    this.#call = options.call ?? bridgeCall(options.socketPath);
    this.#hub = createEdgeOperationsSession(this.#call);
    this.#pin = createTerminalPinClient(this.#call);
    this.#monotonic = options.monotonicNow ?? (() => performance.now());
  }

  get report(): T1BootstrapReport | null {
    return this.#report;
  }

  onReport(listener: (report: T1BootstrapReport) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Run the startup sequence once. Concurrent callers share one run. */
  refresh(): Promise<T1BootstrapReport> {
    this.#running ??= this.#run().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  /**
   * A run that STARTS after now. Sharing an in-flight run is right for the
   * 30-second cadence, and wrong after an unlock or a lock: a run that began
   * before the session changed reports the terminal as it was, and the person at
   * the counter would be told their correct PIN did not work.
   */
  async #refreshFromNow(): Promise<T1BootstrapReport> {
    const inFlight = this.#running;
    if (inFlight !== null) await inFlight.catch(() => undefined);
    return this.refresh();
  }

  async #run(): Promise<T1BootstrapReport> {
    const logger = this.#options.logger ?? {
      log: (event: string, fields: Record<string, string | number | boolean>) => {
        console.log(JSON.stringify({ event, ...fields }));
      },
    };
    const report = await bootstrapT1ThroughEdge(
      {
        bridgeStatus:
          this.#options.bridgeStatus ?? (() => readBridgeStatus(this.#options.socketPath)),
        hub: this.#hub,
        configurationCache: {
          loadCurrent: () => this.#configuration,
          persist: (record) => {
            this.#configuration = record;
          },
        },
        staffSession: { acquire: () => this.#acquireSession() },
        logger,
        monotonicNow: this.#monotonic,
      },
      { applicationVersion: this.#options.applicationVersion },
    );
    const posture = this.#withDevicePin(this.#pinPosture);
    const withPin: T1BootstrapReport =
      posture === undefined || !PIN_STATES.has(report.state) ? report : { ...report, pin: posture };
    this.#report = withPin;
    this.#publish(withPin);
    for (const listener of this.#listeners) listener(withPin);
    return withPin;
  }

  /**
   * Step 7 of the bootstrap: the session that authorizes T1, if this terminal
   * holds one. The Hub is asked, every run, what it thinks of the PIN and of the
   * held session — a session the Hub closed (a reset, a lock from elsewhere) is
   * let go here, never kept on the terminal's say-so.
   */
  async #acquireSession() {
    const held = this.#session;
    try {
      const status = await this.#pin.status(held?.sessionId ?? null);
      if (status.outcome === "ok") {
        this.#pinPosture = status.pin;
        if (held !== null && status.session !== null && status.session.state !== "open") {
          this.#session = null;
          return null;
        }
      }
    } catch {
      // The status read is evidence, not authority: a missed read changes
      // nothing, and the held session is still judged by its own expiry below.
    }
    if (held === null) return null;
    return {
      actorId: held.actorId,
      displayName: held.displayName,
      profileCodes: [held.profileCode],
      effectivePermissions: held.effectivePermissions,
      expiresAt: held.expiresAt,
    };
  }

  /** Every PIN action needs a terminal whose terminal-level checks have passed. */
  async #gate(): Promise<PinActionResult | null> {
    const current = this.#report ?? (await this.refresh());
    if (!PIN_STATES.has(current.state)) {
      return {
        ok: false,
        code: current.refusalCode ?? current.state.toUpperCase(),
        detail: "the terminal is not ready for its PIN",
      };
    }
    return null;
  }

  async #afterSession(
    answer:
      | {
          readonly outcome: "ok";
          readonly session: TerminalPinSessionWire;
          readonly pin: NonNullable<T1BootstrapReport["pin"]>;
        }
      | TerminalPinRefusal,
  ): Promise<PinActionResult> {
    if (answer.outcome !== "ok") {
      if (answer.pin !== undefined) this.#pinPosture = answer.pin;
      return {
        ok: false,
        code: answer.result,
        detail: answer.detail,
        ...(answer.pin === undefined ? {} : { pin: answer.pin }),
      };
    }
    this.#session = answer.session;
    this.#pinPosture = answer.pin;
    const report = await this.#refreshFromNow();
    if (report.state === "ready" || report.state === "offline_ready") return { ok: true, report };
    return {
      ok: false,
      code: report.refusalCode ?? report.state.toUpperCase(),
      detail: report.detail ?? "the Terminal PIN session does not authorize T1",
    };
  }

  /** §10: create the Terminal PIN, entered twice. Unlocks on success. */
  async setupPin(input: {
    readonly pin: string;
    readonly pinConfirmation: string;
  }): Promise<PinActionResult> {
    const gate = await this.#gate();
    if (gate !== null) return gate;
    try {
      return await this.#afterSession(await this.#pin.setup(input));
    } catch (error) {
      return { ok: false, code: "HUB_UNREACHABLE", detail: unreachable(error) };
    }
  }

  /** Unlock the terminal with its PIN: the T1 session for this device. */
  async unlock(input: { readonly pin: string }): Promise<PinActionResult> {
    const gate = await this.#gate();
    if (gate !== null) return gate;
    try {
      return await this.#afterSession(await this.#pin.unlock(input));
    } catch (error) {
      return { ok: false, code: "HUB_UNREACHABLE", detail: unreachable(error) };
    }
  }

  /** Change the PIN: the current one, then the new one twice. The session stays. */
  async changePin(input: {
    readonly currentPin: string;
    readonly newPin: string;
    readonly newPinConfirmation: string;
  }): Promise<PinActionResult> {
    const gate = await this.#gate();
    if (gate !== null) return gate;
    let answer;
    try {
      answer = await this.#pin.change(input);
    } catch (error) {
      return { ok: false, code: "HUB_UNREACHABLE", detail: unreachable(error) };
    }
    if (answer.outcome !== "ok") {
      if (answer.pin !== undefined) this.#pinPosture = answer.pin;
      return {
        ok: false,
        code: answer.result,
        detail: answer.detail,
        ...(answer.pin === undefined ? {} : { pin: answer.pin }),
      };
    }
    this.#pinPosture = answer.pin;
    return { ok: true, report: await this.#refreshFromNow() };
  }

  /** Lock the terminal: the session is closed on the Hub and let go here. */
  async lock(): Promise<T1BootstrapReport> {
    const held = this.#session;
    this.#session = null;
    if (held !== null) {
      try {
        await this.#pin.lock(held.sessionId);
      } catch {
        // The Hub expires the session on its own; the terminal has let go.
      }
    }
    return this.#refreshFromNow();
  }

  /**
   * The sections of the configuration this runtime VERIFIED (digest against
   * the Hub's signed envelope, validity window under Hub time — edge-machine).
   * Whole, read-only, in memory: a restart re-verifies before it answers again.
   * T1-REAL-OPERATIONS-001 (slice 1).
   */
  configurationRead(): T1ConfigurationRead {
    const verified = this.#configuration;
    if (verified === null) {
      return {
        status: "not_delivered",
        reason:
          "this terminal has not verified a configuration delivery from the Store Hub yet " +
          "(it is read at startup and on every refresh)",
      };
    }
    const sections = parseConfigurationSections(verified.wire.payloadJson);
    if (sections === null) {
      return {
        status: "not_delivered",
        reason:
          "the verified configuration payload is not a set of sections this terminal can read",
      };
    }
    return {
      status: "delivered",
      snapshotId: verified.wire.delivery.snapshotId,
      configurationVersion: verified.wire.delivery.configurationVersion,
      verifiedAtHubTime: verified.verifiedAtHubTime,
      sections,
    };
  }

  /** Intake only while READY and unlocked — otherwise null (fail closed). */
  intakeOperations(): IntakeOperations | null {
    const report = this.#report;
    const session = this.#session;
    if (report === null || session === null) return null;
    if (report.state !== "ready" && report.state !== "offline_ready") return null;
    return createIntakeOperationsWithCall({ call: this.#call, sessionId: session.sessionId });
  }

  /** The Hub's PIN answer, with the DEVICE's posture beside it (T1-FIRST-BOOT-PIN-001). */
  #withDevicePin(posture: T1BootstrapReport["pin"]): T1BootstrapReport["pin"] {
    if (posture === undefined) return undefined;
    const path = this.#options.devicePinPosturePath;
    if (path === null) return posture;
    const devicePin = readDevicePinPosture(path ?? DEVICE_PIN_POSTURE_PATH);
    return devicePin === undefined ? posture : { ...posture, devicePin };
  }

  #publish(report: T1BootstrapReport): void {
    const path = this.#options.statusPath;
    if (path === null) return;
    const record = statusRecordOf(
      report,
      this.#options.applicationVersion,
      (this.#options.wallClock ?? (() => new Date()))(),
    );
    try {
      const temporary = `${path}.tmp-${String(process.pid)}`;
      writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o644 });
      chmodSync(temporary, 0o644);
      renameSync(temporary, path);
    } catch {
      // A status that cannot be written must not stop the till; the reporter
      // then sees a stale record and says so.
    }
  }
}

function unreachable(error: unknown): string {
  return error instanceof Error ? error.message : "the Store Hub did not answer";
}
