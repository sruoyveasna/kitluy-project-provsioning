/**
 * The POS runtime on a KitLuy Pi Terminal — T1-STORE-OPERATIONS-001.
 *
 * Composition root and controller for the edge-bridge path: it runs
 * `bootstrapT1ThroughEdge` on a cadence, owns the ONE staff session this
 * terminal holds, hands the renderer intake operations only while the terminal
 * is READY, and publishes a public runtime-status file for the health reporter.
 *
 * WHAT NEVER HAPPENS HERE
 *   - no TLS, no key, no certificate: the Hub is reached through the root edge
 *     bridge, which pins the verified Hub certificate;
 *   - no Supabase, no cloud call of any kind: normal Store operations go to the
 *     Store Hub (PROJECT_HOME §3.5);
 *   - the renderer never chooses a profile: sign-in is always into T1;
 *   - a passcode is never stored, logged or written to the status file.
 */
import { renameSync, writeFileSync, chmodSync } from "node:fs";

import { TERMINAL_PROFILE_T1_INTAKE_CASHIER } from "@kitluy/edge-contracts";

import {
  bootstrapT1ThroughEdge,
  type EdgeBridgeStatusWire,
  type EdgeVerifiedConfiguration,
} from "../src/bootstrap/edge-machine.js";
import type {
  BootstrapLogger,
  EdgeOperationsSession,
  StaffSessionWire,
} from "../src/bootstrap/ports.js";
import type { T1BootstrapReport } from "../src/bootstrap/states.js";
import type { IntakeOperations } from "../src/intake/ports.js";
import { bridgeCall, readBridgeStatus } from "./edge-bridge-client.js";
import { createEdgeOperationsSession, type HubCall } from "./edge-operations-session.js";
import { createIntakeOperationsWithCall } from "./t1-intake-client.js";

/** Read by the health reporter (root). Public facts only; 0644. */
export const POS_RUNTIME_STATUS_PATH = "/var/lib/kitluy/terminal/pos-runtime.json";
export const POS_RUNTIME_STATUS_SCHEMA = "kitluy.pos-runtime-status.v1";
/** Refresh a staff session when less than this remains of its lifetime. */
const STAFF_REFRESH_MARGIN_MS = 5 * 60 * 1000;

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
  /** Whether a staff member is signed in. Never who. */
  readonly staffSignedIn: boolean;
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
    staffSignedIn: report.staff !== undefined,
    link: "edge_bridge",
    observedAt: observedAt.toISOString(),
  };
}

export type StaffSignInResult =
  | { readonly ok: true; readonly report: T1BootstrapReport }
  | { readonly ok: false; readonly code: string; readonly detail: string };

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
}

export class PiTerminalRuntime {
  readonly #options: PiTerminalRuntimeOptions;
  readonly #call: HubCall;
  readonly #hub: EdgeOperationsSession;
  readonly #monotonic: () => number;
  #report: T1BootstrapReport | null = null;
  #configuration: EdgeVerifiedConfiguration | null = null;
  #staff: {
    readonly wire: StaffSessionWire;
    readonly lifetimeMs: number;
    readonly at: number;
  } | null = null;
  #listeners = new Set<(report: T1BootstrapReport) => void>();
  #running: Promise<T1BootstrapReport> | null = null;

  constructor(options: PiTerminalRuntimeOptions) {
    this.#options = options;
    this.#call = options.call ?? bridgeCall(options.socketPath);
    this.#hub = createEdgeOperationsSession(this.#call);
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
        staffSession: { acquire: (hub) => this.#acquireStaff(hub) },
        logger,
        monotonicNow: this.#monotonic,
      },
      { applicationVersion: this.#options.applicationVersion },
    );
    this.#report = report;
    this.#publish(report);
    for (const listener of this.#listeners) listener(report);
    return report;
  }

  async #acquireStaff(hub: EdgeOperationsSession) {
    const held = this.#staff;
    if (held === null) return null;
    const remaining = held.lifetimeMs - (this.#monotonic() - held.at);
    if (remaining < STAFF_REFRESH_MARGIN_MS) {
      const refreshed = await hub.refreshStaffSession(held.wire.sessionId);
      if (refreshed.outcome !== "ok") {
        // Expired, closed or refused: the session is gone, and the terminal
        // asks for a staff member again rather than guessing.
        this.#staff = null;
        return null;
      }
      this.#hold(refreshed.session);
    }
    const wire = this.#staff?.wire ?? held.wire;
    return {
      actorId: wire.actorId,
      displayName: wire.displayName,
      profileCodes: [wire.profileCode],
      effectivePermissions: wire.effectivePermissions,
      expiresAt: wire.expiresAt,
    };
  }

  #hold(wire: StaffSessionWire): void {
    const lifetime = new Date(wire.expiresAt).getTime() - new Date(wire.authorityTime).getTime();
    this.#staff = {
      wire,
      lifetimeMs: Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 0,
      at: this.#monotonic(),
    };
  }

  /**
   * Open a staff session INTO T1. Only while every terminal-level check has
   * passed: a terminal that is not serving never asks a person for a passcode.
   */
  async signIn(input: {
    readonly actorId: string;
    readonly passcode: string;
  }): Promise<StaffSignInResult> {
    const current = this.#report ?? (await this.refresh());
    if (
      current.state !== "staff_authentication_required" &&
      current.state !== "ready" &&
      current.state !== "offline_ready"
    ) {
      return {
        ok: false,
        code: current.refusalCode ?? current.state.toUpperCase(),
        detail: "the terminal is not ready for a staff sign-in",
      };
    }
    if (this.#staff !== null) await this.signOut();

    let opened;
    try {
      opened = await this.#hub.openStaffSession({
        actorId: input.actorId,
        passcode: input.passcode,
        profileCode: TERMINAL_PROFILE_T1_INTAKE_CASHIER,
      });
    } catch (error) {
      return {
        ok: false,
        code: "HUB_UNREACHABLE",
        detail: error instanceof Error ? error.message : "the Store Hub did not answer",
      };
    }
    if (opened.outcome !== "ok") return { ok: false, code: opened.result, detail: opened.detail };
    this.#hold(opened.session);

    const report = await this.refresh();
    if (report.state === "ready" || report.state === "offline_ready") return { ok: true, report };
    return {
      ok: false,
      code: report.refusalCode ?? report.state.toUpperCase(),
      detail: report.detail ?? "the staff session does not authorize T1",
    };
  }

  async signOut(): Promise<T1BootstrapReport> {
    const held = this.#staff;
    this.#staff = null;
    if (held !== null) {
      try {
        await this.#hub.closeStaffSession(held.wire.sessionId);
      } catch {
        // The Hub expires the session on its own; the terminal has let go.
      }
    }
    return this.refresh();
  }

  /** Intake only while READY with a staff session — otherwise null (fail closed). */
  intakeOperations(): IntakeOperations | null {
    const report = this.#report;
    const staff = this.#staff;
    if (report === null || staff === null) return null;
    if (report.state !== "ready" && report.state !== "offline_ready") return null;
    return createIntakeOperationsWithCall({ call: this.#call, sessionId: staff.wire.sessionId });
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
