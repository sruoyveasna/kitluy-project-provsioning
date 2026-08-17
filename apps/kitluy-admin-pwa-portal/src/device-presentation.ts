/**
 * Device presentation rules.
 *
 * ===========================================================================
 * THE TWO THINGS THIS FILE REFUSES TO DO
 * ===========================================================================
 * 1. It never presents an abnormal device as ordinary. `quarantined` and
 *    `restricted_investigation` are containment states — a device in one of
 *    them is under suspicion, and a fleet list that renders it in the same
 *    grey text as a healthy terminal is actively misleading during exactly the
 *    incident it exists to support.
 *
 * 2. It never invents liveness. The freshness threshold is an owner value the
 *    repository has NOT ruled, so a device with a heartbeat reads UNKNOWN.
 *    `NEVER_SEEN` is still shown, because "no heartbeat has ever arrived" is a
 *    fact rather than a threshold. Writing "Online" here would put a word an
 *    operator trusts on a screen with nothing behind it.
 */
import type { KitluyLocale } from "@kitluy/localization";
import type { FleetDeviceView } from "./management-client.js";
import { t } from "./messages.js";

export type DeviceCondition = "abnormal" | "attention" | "normal";

/**
 * Lifecycle states that are CONTAINMENT, not ordinary operation.
 * Mirrors `kitluy_devices.device_lifecycle_state`.
 */
const ABNORMAL_LIFECYCLES: ReadonlySet<string> = new Set([
  "quarantined",
  "restricted_investigation",
  "suspended",
]);

/** States where the device is out of service but not under suspicion. */
const RETIRED_LIFECYCLES: ReadonlySet<string> = new Set(["retired", "replaced"]);

export function deviceCondition(device: FleetDeviceView): DeviceCondition {
  if (ABNORMAL_LIFECYCLES.has(device.lifecycle)) return "abnormal";
  if (device.openIncidentCount > 0) return "abnormal";
  if (RETIRED_LIFECYCLES.has(device.lifecycle)) return "attention";
  if (device.requiresAttention) return "attention";
  return "normal";
}

export function conditionLabel(condition: DeviceCondition, locale: KitluyLocale): string {
  switch (condition) {
    case "abnormal":
      return t(locale, "abnormal");
    case "attention":
      return t(locale, "attention");
    case "normal":
      return t(locale, "normal");
  }
}

/** Colour is a redundant cue: the label already carries the meaning. */
export function conditionColor(condition: DeviceCondition): string {
  switch (condition) {
    case "abnormal":
      return "#b91c1c";
    case "attention":
      return "#b45309";
    case "normal":
      return "#374151";
  }
}

/**
 * Human text for a freshness value.
 *
 * `ONLINE`, `STALE` and `OFFLINE` are handled because the derivation supports
 * them once a policy is ruled — but they cannot occur while the policy is
 * unruled, and nothing in this portal produces them by default.
 */
export function freshnessLabel(freshness: string, locale: KitluyLocale): string {
  switch (freshness) {
    case "NEVER_SEEN":
      return t(locale, "neverSeen");
    case "UNKNOWN":
      return t(locale, "freshnessUnknown");
    case "ONLINE":
      return locale === "km-KH" ? "កំពុងភ្ជាប់" : "Online";
    case "STALE":
      return locale === "km-KH" ? "ទិន្នន័យចាស់" : "Stale";
    case "OFFLINE":
      return locale === "km-KH" ? "ផ្តាច់" : "Offline";
    default:
      // An unrecognised value is reported as unknown, never as healthy.
      return t(locale, "freshnessUnknown");
  }
}

/**
 * Order for the fleet list: everything abnormal first, then attention, then the
 * rest — each group by device reference so the order is stable between loads.
 *
 * A fleet screen sorted purely alphabetically buries the one quarantined device
 * on page three, which is the opposite of what the screen is for.
 */
export function sortForOperator(devices: readonly FleetDeviceView[]): readonly FleetDeviceView[] {
  const rank: Readonly<Record<DeviceCondition, number>> = { abnormal: 0, attention: 1, normal: 2 };
  return [...devices].sort((a, b) => {
    const byCondition = rank[deviceCondition(a)] - rank[deviceCondition(b)];
    if (byCondition !== 0) return byCondition;
    return a.deviceReference.localeCompare(b.deviceReference);
  });
}

/**
 * The device-class filter offered in the fleet list.
 *
 * `store_hub` earns its own entry because a Hub is the thing a Store cannot
 * operate without — `device_provisioning_codes.store_hub_device_id` is NOT NULL
 * and a Terminal cannot be provisioned until its Hub is active — so "show me the
 * Hubs" is the question an operator asks when a shop is stuck.
 */
export type DeviceClassFilter = "all" | "store_hub" | "pi_terminal";

export function filterByClass(
  devices: readonly FleetDeviceView[],
  filter: DeviceClassFilter,
): readonly FleetDeviceView[] {
  if (filter === "all") return devices;
  return devices.filter((d) => d.deviceClass === filter);
}

/**
 * What a Hub's assignment state means for whether the shop can work.
 *
 * Deliberately NOT collapsed into the generic condition badge: a Hub sitting at
 * `pending_trust` is not faulty — it paired correctly and is waiting on
 * certificate-backed activation (BLK-005) — but the Store still cannot provision
 * Terminals against it. An operator needs to tell "broken" from "waiting", and a
 * single "attention" colour cannot say which.
 *
 * Returns null for a device whose class is not `store_hub`, so a caller cannot
 * accidentally render Hub semantics against a Terminal.
 */
export function hubAssignmentSummary(
  device: FleetDeviceView,
): { readonly state: string; readonly serving: boolean } | null {
  if (device.deviceClass !== "store_hub") return null;
  const state = device.assignmentState ?? "unassigned";
  // `active` is the only state in which a Hub can serve Terminals. Everything
  // else — unassigned, pending_trust, revoked — means the shop is not ready,
  // and saying so is more useful than a green tick that means "not broken".
  return { state, serving: state === "active" };
}
