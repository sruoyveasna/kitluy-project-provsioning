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

/** Safe projection of the staff session. Never carries a verifier or token. */
export interface StaffSessionSummary {
  readonly actorId: string;
  readonly displayName: string;
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
}
