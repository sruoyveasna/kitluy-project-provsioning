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
  "hubPaired",
  "activated",
  "appInstalled",
  "pinSet",
  "active",
] as const;
export type RungKey = (typeof LADDER_RUNGS)[number];
export type RungState = "done" | "current" | "not_reported" | "blocked" | "unbuilt";

/**
 * Rungs nothing in this build can ever report.
 *
 * `not_reported` promises "nothing has been reported about it YET", and the
 * ladder says so in its own footnote. For these that is untrue: there is no
 * reporter on the device, no field in the API, and nothing to compute from, so
 * they can never advance no matter what the fleet does.
 *
 * It stayed invisible until a Terminal first reached `activated` on 2026-09-09,
 * at which point the ladder showed rung 5 complete above a rung 4 that was
 * permanently pending — an ordering that cannot happen and made a working
 * device look broken.
 *
 * `hubPaired` needs `terminal-client`, the governed application release, which
 * is not in the Terminal image. When it ships, delete the entry: the rung then
 * has a real reporter and goes back to meaning what it says.
 */
export const UNREPORTABLE_RUNGS: ReadonlySet<string> = new Set(["hubPaired"]);

export interface LadderRung {
  readonly key: RungKey;
  readonly state: RungState;
  readonly reason?: PairBlock;
  /** A device reference, when the rung was reported by one. */
  readonly detail?: string;
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

  const done: Record<RungKey, boolean> = {
    hubActive: hub.kind === "active",
    // A bound device means a code was consumed, which means one was issued:
    // a fact chain, not an inference about a later rung.
    issued: sessionLive || (session?.paired ?? false) || bound !== null,
    redeemed: (session?.paired ?? false) || bound !== null,
    // Nothing reports this. See UNREPORTABLE_RUNGS — it is rendered as
    // "not available in this build" rather than as a step still being waited on.
    hubPaired: false,
    activated: bound !== null && bound.lifecycle === "active",
    appInstalled: false,
    pinSet: false,
    active: false,
  };
  const detail: Partial<Record<RungKey, string>> = {};
  if (bound !== null) {
    detail.redeemed = bound.deviceReference;
    if (done.activated) detail.activated = bound.deviceReference;
  }

  let nextMarked = false;
  return LADDER_RUNGS.map((key): LadderRung => {
    // Checked BEFORE `current`, so an unbuildable rung never becomes the step
    // the operator is told to wait for — which is exactly how this misled.
    if (!done[key] && UNREPORTABLE_RUNGS.has(key)) {
      // Nothing after an unbuildable rung is "current" either. A step sitting
      // behind one that can never complete is not the thing being waited for,
      // and saying so would replace one untruth with another.
      nextMarked = true;
      return { key, state: "unbuilt" };
    }
    if (done[key]) {
      const d = detail[key];
      return d === undefined ? { key, state: "done" } : { key, state: "done", detail: d };
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
