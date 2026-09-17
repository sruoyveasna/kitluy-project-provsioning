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
 * TERMINAL-PIN-AND-REAL-POS-AUTH-001 — the four named Terminal PIN operations.
 * Four-digit PINs go in; only a verdict comes back (never a session id, never a
 * PIN). No staff sign-in exists on a Pi Terminal
 * (KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001).
 */
export const T1_PIN_BRIDGE_KEY = "kitluyT1Pin" as const;

export type PinVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: string;
      readonly detail: string;
      readonly pin?: T1BootstrapReport["pin"];
    };

export interface T1PinBridge {
  setup(input: { readonly pin: string; readonly pinConfirmation: string }): Promise<PinVerdict>;
  unlock(input: { readonly pin: string }): Promise<PinVerdict>;
  change(input: {
    readonly currentPin: string;
    readonly newPin: string;
    readonly newPinConfirmation: string;
  }): Promise<PinVerdict>;
  lock(): Promise<{ readonly ok: true }>;
}

/** WS-12-T002-P02 §5 — the eight named intake operations, as the renderer sees them. */
export const T1_INTAKE_BRIDGE_KEY = "kitluyT1Intake" as const;
