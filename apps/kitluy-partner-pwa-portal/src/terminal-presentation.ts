/**
 * The parts of the Terminals screen that could lie, kept pure.
 *
 *   * Whether a session may be opened: only against an ACTIVE Store Hub, and
 *     never when the Hub's readiness was not reported (fail closed).
 *   * The provisioning ladder: what has actually been reported done, what is
 *     next, what is blocked, and — honestly — what nothing has reported yet.
 *   * Which face the code panel shows: success wins over the clock.
 */
import type { CodeLife } from "./pairing-presentation.js";
import type {
  PhysicalTerminal,
  TerminalSessionSummary,
  TerminalSessionStatus,
} from "./terminals-client.js";

export type HubReadiness =
  | { readonly kind: "active"; readonly deviceReference: string | null }
  | { readonly kind: "pending_trust"; readonly deviceReference: string | null }
  | { readonly kind: "none" }
  | { readonly kind: "other"; readonly state: string; readonly deviceReference: string | null }
  | { readonly kind: "unreported" };

export function hubReadiness(store: {
  readonly hub?: { readonly deviceReference: string | null; readonly state: string } | undefined;
}): HubReadiness {
  const hub = store.hub;
  if (hub === undefined) return { kind: "unreported" };
  if (hub.state === "active") return { kind: "active", deviceReference: hub.deviceReference };
  if (hub.state === "pending_trust") {
    return { kind: "pending_trust", deviceReference: hub.deviceReference };
  }
  if (hub.state === "none") return { kind: "none" };
  return { kind: "other", state: hub.state, deviceReference: hub.deviceReference };
}

export type PairBlock = "hubNotActive" | "hubNone" | "hubUnreported";

/** Mirrors `canIssueFor`: the screen explains instead of offering a dead button. */
export function canOpenTerminalSession(
  hub: HubReadiness,
): { readonly allowed: true } | { readonly allowed: false; readonly reason: PairBlock } {
  switch (hub.kind) {
    case "active":
      return { allowed: true };
    case "none":
      return { allowed: false, reason: "hubNone" };
    case "unreported":
      return { allowed: false, reason: "hubUnreported" };
    default:
      return { allowed: false, reason: "hubNotActive" };
  }
}

export const LADDER_RUNGS = [
  "hubActive",
  "issued",
  "redeemed",
  "activated",
  "hubConnected",
  "appInstalled",
  "appRunning",
  "configurationLoaded",
  "pinSet",
  "active",
] as const;
export type RungKey = (typeof LADDER_RUNGS)[number];
export type RungState = "done" | "current" | "not_reported" | "blocked" | "unbuilt" | "stale";

/**
 * Rungs nothing in this build can ever report.
 *
 * `not_reported` promises "nothing has been reported about it YET". For these
 * that is untrue: there is no reporter, no field and nothing to compute from.
 *
 * `hubPaired` left this set on 2026-09-17 (T1-STORE-OPERATIONS-001): the
 * Terminal now reports its own Store Hub link, and the rung became
 * `hubConnected`, done from that report and nothing else.
 *
 * `pinSet` is here because the Terminal PIN is SPECIFIED and NOT BUILT
 * (KLD-2026-09-03-TERMINAL-PROVISIONING-001 §10-§14): no verifier, no setup
 * screen, no reporter. When it is built, delete the entry.
 */
export const UNREPORTABLE_RUNGS: ReadonlySet<string> = new Set(["pinSet"]);

/**
 * Rungs that come from the Terminal's own runtime report. Each is done ONLY
 * from a fresh report — never from an earlier rung, and never from a report
 * the cloud received too long ago to still be true.
 */
export const RUNTIME_RUNGS: ReadonlySet<RungKey> = new Set([
  "hubConnected",
  "appInstalled",
  "appRunning",
  "configurationLoaded",
]);

/**
 * How old a runtime report may be and still count. The Terminal reports every
 * 60 seconds (the health reporter's beat); three missed beats is not a blip.
 * Aged by the CLOUD's receipt clock (`ageSeconds`), never the device's claim.
 */
export const RUNTIME_FRESH_SECONDS = 180;

/** POS states in which a configuration has been obtained and verified. */
const CONFIGURATION_LOADED_STATES: ReadonlySet<string> = new Set([
  "staff_authentication_required",
  "ready",
  "offline_ready",
]);

export interface LadderRung {
  readonly key: RungKey;
  readonly state: RungState;
  readonly reason?: PairBlock;
  /** A device reference or a reported version, when the rung was reported by one. */
  readonly detail?: string;
  /** Set when the rung's evidence is the Terminal's own report, not a cloud door. */
  readonly source?: "device_reported";
}

export interface SessionFacts {
  readonly state: string;
  readonly paired: boolean;
  readonly locked: boolean;
  readonly expiresAt: string;
}

export function sessionFacts(
  s: TerminalSessionSummary | TerminalSessionStatus | null,
): SessionFacts | null {
  if (s === null) return null;
  const paired = "paired" in s ? s.paired : s.state === "consumed";
  return { state: s.state, paired, locked: s.locked, expiresAt: s.expiresAt };
}

/**
 * The ladder, from facts only. A rung is `done` when something reported it;
 * `not_reported` otherwise. Nothing here infers a later rung from an earlier
 * one, and a done rung is never demoted when the Hub later regresses.
 *
 * The runtime rungs read the Terminal's report field by field:
 *
 *   hubConnected         terminal-edge phase SERVING
 *   appInstalled         the kitluy-terminal release journal COMMITTED
 *   appRunning           the unit active AND the launcher's witness names the
 *                        INSTALLED release (installed is not running)
 *   configurationLoaded  the POS in a state that has verified a configuration
 *   pinSet               unbuilt
 *   active               NEVER done in this build: the Terminal must not become
 *                        fully operational before its PIN is set (LOCKED, §10)
 */
export function deriveLadder(
  input: {
    readonly hub: HubReadiness;
    readonly terminal: PhysicalTerminal;
    readonly session: SessionFacts | null;
  },
  now: Date,
): readonly LadderRung[] {
  const { hub, terminal, session } = input;
  const gate = canOpenTerminalSession(hub);
  const bound = terminal.boundDevice;
  const sessionLive =
    session !== null && session.state === "open" && Date.parse(session.expiresAt) > now.getTime();

  // A report only counts for the device bound to this seat, and only while fresh.
  const runtime = bound === null ? null : (terminal.runtime ?? null);
  const fresh = runtime !== null && runtime.ageSeconds <= RUNTIME_FRESH_SECONDS;
  const stale = runtime !== null && !fresh;
  const app = fresh ? runtime.application : null;
  const pos = fresh ? runtime.pos : null;

  const done: Record<RungKey, boolean> = {
    hubActive: hub.kind === "active",
    // A bound device means a code was consumed, which means one was issued:
    // a fact chain, not an inference about a later rung.
    issued: sessionLive || (session?.paired ?? false) || bound !== null,
    redeemed: (session?.paired ?? false) || bound !== null,
    activated: bound !== null && bound.lifecycle === "active",
    hubConnected: fresh && runtime.hubLink?.phase === "SERVING",
    appInstalled:
      app !== null && app.journalPhase === "COMMITTED" && app.installedReleaseId !== null,
    appRunning:
      app !== null &&
      app.unitActive &&
      app.installedReleaseId !== null &&
      app.runningReleaseId === app.installedReleaseId,
    configurationLoaded:
      pos !== null &&
      pos.configurationVersion !== null &&
      CONFIGURATION_LOADED_STATES.has(pos.state),
    // Specified, not built. See UNREPORTABLE_RUNGS.
    pinSet: false,
    // KLD-2026-09-03-TERMINAL-PROVISIONING-001 §10 (LOCKED): "The Terminal must
    // not become fully operational until this required PIN setup succeeds."
    active: false,
  };
  const detail: Partial<Record<RungKey, string>> = {};
  if (bound !== null) {
    detail.redeemed = bound.deviceReference;
    if (done.activated) detail.activated = bound.deviceReference;
  }
  if (done.appInstalled && app?.installedVersion) detail.appInstalled = app.installedVersion;
  if (done.appRunning && app?.installedVersion) detail.appRunning = app.installedVersion;
  if (done.configurationLoaded && pos !== null) {
    detail.configurationLoaded =
      pos.configurationFreshness === "cached_offline"
        ? `v${String(pos.configurationVersion)} (cached)`
        : `v${String(pos.configurationVersion)}`;
  }

  let nextMarked = false;
  return LADDER_RUNGS.map((key): LadderRung => {
    // Checked BEFORE `current`, so an unbuildable rung never becomes the step
    // the operator is told to wait for.
    if (!done[key] && UNREPORTABLE_RUNGS.has(key)) {
      nextMarked = true;
      return { key, state: "unbuilt" };
    }
    if (done[key]) {
      const d = detail[key];
      const source = RUNTIME_RUNGS.has(key) ? { source: "device_reported" as const } : {};
      return d === undefined
        ? { key, state: "done", ...source }
        : { key, state: "done", detail: d, ...source };
    }
    if (stale && RUNTIME_RUNGS.has(key)) {
      // Something WAS reported, too long ago to still be true: neither done nor
      // "nothing reported yet". The first such rung is the one to look at.
      nextMarked = true;
      return { key, state: "stale", source: "device_reported" };
    }
    if (key === "hubActive") {
      nextMarked = true;
      return gate.allowed
        ? { key, state: "current" }
        : { key, state: "blocked", reason: gate.reason };
    }
    if (!nextMarked) {
      nextMarked = true;
      return gate.allowed
        ? { key, state: "current" }
        : { key, state: "blocked", reason: gate.reason };
    }
    return { key, state: "not_reported" };
  });
}

export type CodePresentation = "paired" | "locked" | "expired" | "live";

/** Success wins over the clock; a lock beats an expiry; expiry beats live. */
export function codePresentation(
  status: { readonly paired: boolean; readonly locked: boolean } | null,
  life: CodeLife,
): CodePresentation {
  if (status?.paired === true) return "paired";
  if (status?.locked === true) return "locked";
  if (life.kind === "expired") return "expired";
  return "live";
}
