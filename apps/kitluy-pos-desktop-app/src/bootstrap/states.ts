/**
 * T1 runtime state vocabulary — WS-12-T001.
 *
 * Authority: the WS-12-T001 owner package §5 (the thirteen explicit states,
 * verbatim); KLD-2026-08-06-WS12-TASKS-001 (T1 is a composition surface);
 * `@kitluy/web-ui` DataSurface rule (a cached value and a current value are
 * never displayed the same way).
 *
 * The vocabulary is CLOSED. A condition that maps to no state here is a
 * defect in the mapping, never a reason to invent a fourteenth state.
 */

export const T1_RUNTIME_STATES = [
  "starting",
  "connecting_to_hub",
  "configuration_loading",
  "staff_authentication_required",
  "ready",
  "offline_ready",
  "stale_configuration",
  "hub_unavailable",
  "assignment_invalid",
  "credential_invalid",
  "profile_not_authorized",
  "configuration_incompatible",
  "recovery_required",
] as const;

export type T1RuntimeState = (typeof T1_RUNTIME_STATES)[number];

export function isT1RuntimeState(value: string): value is T1RuntimeState {
  return (T1_RUNTIME_STATES as readonly string[]).includes(value);
}

/**
 * Configuration freshness is an explicit label, never an inference. `current`
 * means the snapshot was obtained from the assigned Store Hub during THIS
 * startup; `cached_offline` means the last valid signed snapshot is in use
 * because the Hub could not deliver one now (owner package §6). Cached data
 * is never presented as current.
 */
export type ConfigurationFreshness = "current" | "cached_offline";

/** Safe projection of the active configuration. Never carries the payload. */
export interface ActiveConfigurationSummary {
  readonly configurationVersion: number;
  readonly schemaVersion: number;
  readonly freshness: ConfigurationFreshness;
  readonly issuedAt: string;
  readonly validUntil: string;
  readonly evaluatedAt: string;
}

/** Safe projection of the resolved Store Hub. Never carries key material. */
export interface ResolvedHubSummary {
  readonly hubDeviceId: string;
  readonly hostname: string;
  readonly port: number;
}

/**
 * Safe projection of the session that authorizes T1. Never carries a verifier
 * or token. On a Pi Terminal (KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001)
 * this is the TERMINAL PIN session: the actor is the terminal device itself and
 * the display name is empty — there is no staff login on that path.
 */
export interface StaffSessionSummary {
  readonly actorId: string;
  readonly displayName: string;
}

/**
 * The Terminal PIN as the STORE HUB answered this terminal. Public posture only:
 * never a PIN, never a verifier. Present on the Pi Terminal composition once the
 * Hub has answered; absent on the WS-12-T001 workstation composition.
 */
export interface TerminalPinSummary {
  readonly state: "setup_required" | "set" | "reset_required";
  readonly lockedUntil: string | null;
  readonly attemptsBeforeLock: number;
}

/**
 * The one report the bootstrap produces. Everything in it is renderable and
 * loggable: identifiers, refusal codes and instants only — no private key,
 * token, certificate body, signature or receipt material may enter this
 * shape (owner package §7 log rule; enforced by the acceptance suite).
 */
export interface T1BootstrapReport {
  readonly state: T1RuntimeState;
  /** The states traversed, `starting` first. Evidence of the path taken. */
  readonly transitions: readonly T1RuntimeState[];
  readonly refusalCode?: string;
  readonly detail?: string;
  readonly hub?: ResolvedHubSummary;
  readonly configuration?: ActiveConfigurationSummary;
  readonly staff?: StaffSessionSummary;
  /**
   * How the Store Hub was reached and what could be proven on the way. Present
   * on the Pi Terminal composition (T1-STORE-OPERATIONS-001), where the POS
   * reaches the Hub through the root edge bridge and does not hold the Hub's
   * signing key; absent on the WS-12-T001 composition, which verifies every
   * Hub signature itself. Never a key, a signature or a fingerprint.
   */
  readonly link?: HubLinkSummary;
  readonly pin?: TerminalPinSummary;
}

export interface HubLinkSummary {
  readonly transport: "edge_bridge";
  /** The bridge forwards only over mutual TLS pinned to the verified Hub certificate. */
  readonly hubAuthentication: "terminal_edge_mtls_pinned";
  /**
   * The Hub's signatures over discovery, receipts and configuration delivery
   * are NOT verified on this path: the Hub's public key is not provisioned to
   * terminals (BLK-006). Said, never implied.
   */
  readonly hubSignatures: "not_verified_hub_key_not_provisioned";
}
