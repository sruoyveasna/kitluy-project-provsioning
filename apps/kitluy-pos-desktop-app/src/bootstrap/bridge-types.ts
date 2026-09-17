/**
 * The one renderer-facing bridge contract — WS-12-T001.
 *
 * The preload script exposes exactly this surface. It is READ-ONLY: the
 * renderer can observe the bootstrap report, and nothing else — no channel
 * exists through which UI code could select a Tenant, Store, Location, Hub,
 * environment, profile or assignment generation.
 */
import type { T1BootstrapReport } from "./states.js";

export const T1_BRIDGE_KEY = "kitluyT1" as const;
export const T1_REPORT_CHANNEL = "kitluy:t1:report" as const;
export const T1_REPORT_CHANGED_CHANNEL = "kitluy:t1:report-changed" as const;

export interface T1RuntimeBridge {
  getReport(): Promise<T1BootstrapReport | null>;
  onReport(listener: (report: T1BootstrapReport) => void): () => void;
}

/**
 * T1-STORE-OPERATIONS-001 — the two named staff operations. A staff id and a
 * passcode go in; only a verdict comes back (never a session id).
 */
export const T1_STAFF_BRIDGE_KEY = "kitluyT1Staff" as const;

export type StaffVerdict =
  { readonly ok: true } | { readonly ok: false; readonly code: string; readonly detail: string };

export interface T1StaffBridge {
  signIn(input: { readonly actorId: string; readonly passcode: string }): Promise<StaffVerdict>;
  signOut(): Promise<{ readonly ok: true }>;
}

/** WS-12-T002-P02 §5 — the eight named intake operations, as the renderer sees them. */
export const T1_INTAKE_BRIDGE_KEY = "kitluyT1Intake" as const;
