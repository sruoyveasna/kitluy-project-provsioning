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

/**
 * Plain words for a lifecycle state.
 *
 * ===========================================================================
 * WHY THE RAW ENUM WAS THE WRONG THING TO SHOW
 * ===========================================================================
 * The list rendered `device.lifecycle` directly, so an operator read
 * `manufactured` — a word that sounds like a factory step and gives no hint
 * that a person is being waited on. The single most common question this screen
 * has to answer is "is anything waiting for me?", and the answer was written in
 * a vocabulary only the database uses.
 *
 * These are DISPLAY strings. The enum stays canonical; nothing here is ever sent
 * back to the server or compared against a stored value.
 */
export function lifecycleLabel(lifecycle: string, locale: KitluyLocale): string {
  const km = locale === "km-KH";
  switch (lifecycle) {
    case "manufactured":
      // The important one: this device is waiting for a human decision.
      return km ? "រង់ចាំការអនុម័ត" : "Waiting for approval";
    case "enrolled":
      return km ? "បានអនុម័ត" : "Approved";
    case "active":
      return km ? "កំពុងដំណើរការ" : "Active";
    case "quarantined":
      return km ? "ត្រូវបានដាក់ឱ្យនៅដាច់ដោយឡែក" : "Quarantined";
    case "restricted_investigation":
      return km ? "កំពុងស៊ើបអង្កេត" : "Under investigation";
    case "suspended":
      return km ? "ត្រូវបានផ្អាក" : "Suspended";
    case "retired":
      return km ? "ឈប់ប្រើ" : "Retired";
    case "replaced":
      return km ? "ត្រូវបានជំនួស" : "Replaced";
    default:
      // An unrecognised state is shown VERBATIM rather than softened into
      // something friendly — inventing a reassuring word for a state this build
      // does not know about is exactly how a screen starts lying.
      return lifecycle;
  }
}

/** Lifecycle states where a person is being waited on. */
const AWAITING_DECISION: ReadonlySet<string> = new Set(["manufactured"]);

export interface FleetSummary {
  readonly total: number;
  /** Devices waiting for a HET approval decision. The number that needs a person. */
  readonly awaitingApproval: number;
  readonly withIncidents: number;
  readonly contained: number;
  readonly hubs: number;
}

/**
 * The counts a fleet screen should answer before any table is read.
 *
 * Computed over the devices ON THIS PAGE, like the class filter — a truncated
 * page cannot speak for the whole fleet, and the caller shows the truncation
 * notice alongside.
 */
export function summariseFleet(devices: readonly FleetDeviceView[]): FleetSummary {
  let awaitingApproval = 0;
  let withIncidents = 0;
  let contained = 0;
  let hubs = 0;
  for (const d of devices) {
    if (AWAITING_DECISION.has(d.lifecycle)) awaitingApproval += 1;
    if (d.openIncidentCount > 0) withIncidents += 1;
    if (ABNORMAL_LIFECYCLES.has(d.lifecycle)) contained += 1;
    if (d.deviceClass === "store_hub") hubs += 1;
  }
  return { total: devices.length, awaitingApproval, withIncidents, contained, hubs };
}

/**
 * Whether ANY device has ever reported its own status.
 *
 * Liveness reporting is not built — the device agent answers
 * `HEARTBEAT_NOT_IMPLEMENTED` and `last_observed_at` is null for every device in
 * the fleet. So the honest screen says "no device reports yet" ONCE, at the top,
 * instead of printing an ambiguous "Unknown" on every row and leaving an
 * operator to wonder whether that means offline.
 */
export function anyDeviceHasReported(devices: readonly FleetDeviceView[]): boolean {
  return devices.some((d) => d.lastSeenAt !== null);
}
