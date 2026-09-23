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

/**
 * THE OWNER'S ORDER, as the Terminal actually lives it.
 *
 * `pinSet` sits between `hubConnected` and `appInstalled` because that is when
 * the PIN is created: right after the terminal is paired and its Store Hub link
 * serves, on the Device Shell, before the application is installed
 * (KLD-2026-09-19-PIN-AFTER-PAIRING-001, amending the first-boot ruling). The
 * update agent enforces it — a FIRST install of the POS waits while the Hub
 * answers `setup_required` — so a ladder that still listed the PIN last was
 * describing a sequence the devices no longer follow.
 *
 * Proven on hardware 2026-09-21 (board KL-173B26D44330, a card flashed from
 * scratch): `pin.setup -> 200` at 16:14:48, the install held with
 * TERMINAL_PIN_SETUP_PENDING at 16:14:48 and 16:15:03, INSTALLED at 16:15:59.
 *
 * The order is display only. No rung is ever inferred from its neighbour —
 * `deriveLadder` reads each from reported facts — so moving one changes what
 * the reader is told to wait for, never what is claimed to be true.
 */
export const LADDER_RUNGS = [
  "hubActive",
  "issued",
  "redeemed",
  "activated",
  "hubConnected",
  "pinSet",
  "appInstalled",
  "appRunning",
  "configurationLoaded",
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
 * `pinSet` left it the same day (TERMINAL-PIN-AND-REAL-POS-AUTH-001): the
 * Store Hub holds the PIN verifier and answers the Terminal its state, and the
 * Terminal reports that answer (runtime report v2). Empty, kept so the rule
 * that an unreportable rung is never "the next step" stays where it is.
 */
export const UNREPORTABLE_RUNGS: ReadonlySet<string> = new Set([]);

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
  "pinSet",
  "active",
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
  /** A reported posture worth a word next to the rung, in the reader's language. */
  readonly note?: LadderNote;
}

/** The Terminal PIN is locked after too many wrong entries, or awaits a reset. */
export type LadderNote = "pinLocked" | "pinResetRequired";

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
 *   pinSet               the STORE HUB's answer, carried by the Terminal: a PIN
 *                        verifier is established (state `set`) — its own
 *                        evidence, never derived from the application running
 *   active               every rung above it done, from the SAME fresh report,
 *                        and no security posture in the way: no containment
 *                        (the Hub would not be SERVING), the PIN not locked, not
 *                        awaiting a reset. The Terminal may not be operational
 *                        before its PIN is set (KLD-2026-09-03 §10, LOCKED), so
 *                        `active` can never be done while `pinSet` is not.
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
  const pin = fresh ? (runtime.hubLink?.terminalPin ?? null) : null;

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
    pinSet: pin !== null && pin.state === "set",
    active: false,
  };
  // KLD-2026-09-03-TERMINAL-PROVISIONING-001 §10 (LOCKED): "The Terminal must
  // not become fully operational until this required PIN setup succeeds." And
  // the owner mission §11: Operational is the conjunction of reported facts,
  // never a rung inferred from another. All from the same fresh report.
  done.active =
    done.hubConnected &&
    done.appInstalled &&
    done.appRunning &&
    done.configurationLoaded &&
    done.pinSet &&
    pin !== null &&
    pin.lockedUntil === null;
  const detail: Partial<Record<RungKey, string>> = {};
  const note: Partial<Record<RungKey, LadderNote>> = {};
  if (pin !== null && pin.lockedUntil !== null) note.pinSet = "pinLocked";
  if (pin !== null && pin.state === "reset_required") note.pinSet = "pinResetRequired";
  if (bound !== null) {
    detail.redeemed = bound.deviceReference;
    if (done.activated) detail.activated = bound.deviceReference;
  }
  // WHY THE HUB RUNG IS WHERE IT IS.
  //
  // On 2026-09-23 a Store Hub whose data volume would not unlock never started
  // its edge API. The Partner ladder said "Connected to the Store Hub — Next"
  // and nothing more, so a Hub that was DOWN looked exactly like a terminal
  // that could not FIND one. The owner spent an hour on the wrong fault and
  // concluded the Hub's IP must have changed — while the terminal had already
  // found the new address and was reporting, in its own log, "172.16.13.204:7443
  // did not complete a mutual-TLS handshake (connect ECONNREFUSED)".
  //
  // That sentence and that address now travel in the runtime report (v3), so
  // the rung says which address was tried and how it went. Shown while the rung
  // is NOT done — once the link serves, the address is noise on a working till.
  const hubEndpoint = fresh ? (runtime.hubLink?.endpoint ?? null) : null;
  const hubDetail = fresh ? (runtime.hubLink?.detail ?? null) : null;
  if (!done.hubConnected) {
    const where = hubEndpoint === null ? null : `${hubEndpoint.host}:${String(hubEndpoint.port)}`;
    const why = hubDetail === null || hubDetail === "" ? null : hubDetail;
    const line =
      where !== null && why !== null && !why.includes(where) ? `${where} — ${why}` : (why ?? where);
    if (line !== null) detail.hubConnected = line;
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
    const n = note[key];
    const noted = n === undefined ? {} : { note: n };
    // A rung that is NOT done may carry a detail too, and that is the whole
    // point of the 2026-09-23 change: "Connected to the Store Hub — Next" told
    // an owner nothing for an hour, while the terminal's own report said which
    // address it tried and how the attempt failed. Only `done` rungs used to
    // show a detail, so the explanation was collected and then dropped here.
    const d = detail[key];
    const detailed = d === undefined ? {} : { detail: d };
    if (done[key]) {
      const source = RUNTIME_RUNGS.has(key) ? { source: "device_reported" as const } : {};
      return { key, state: "done", ...detailed, ...source, ...noted };
    }
    if (stale && RUNTIME_RUNGS.has(key)) {
      // Something WAS reported, too long ago to still be true: neither done nor
      // "nothing reported yet". The first such rung is the one to look at.
      nextMarked = true;
      return { key, state: "stale", source: "device_reported", ...detailed };
    }
    if (!nextMarked && n !== undefined) {
      // A reported posture on the rung itself (a locked PIN, a reset): the step
      // to look at, said in words, not "nothing reported".
      nextMarked = true;
      return { key, state: "current", source: "device_reported", ...detailed, ...noted };
    }
    if (key === "hubActive") {
      nextMarked = true;
      return gate.allowed
        ? { key, state: "current", ...detailed }
        : { key, state: "blocked", reason: gate.reason };
    }
    if (!nextMarked) {
      nextMarked = true;
      return gate.allowed
        ? { key, state: "current", ...detailed }
        : { key, state: "blocked", reason: gate.reason };
    }
    return { key, state: "not_reported", ...detailed };
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
