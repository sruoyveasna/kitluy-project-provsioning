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
