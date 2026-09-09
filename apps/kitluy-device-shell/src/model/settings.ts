/**
 * The decidable parts of Terminal Settings, kept out of the components.
 *
 * Same split the rest of this app uses: `screens.tsx` paints, `model/` decides,
 * and the decisions are tested without a DOM. Everything here is pure.
 */
import type { NetworkStatusView, ScannedNetwork } from "../bridge.js";

export const SETTINGS_TABS = ["network", "printer", "device", "display"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/**
 * Signal strength as 0–4 bars.
 *
 * dBm is logarithmic and negative, and no shop worker reads it. The thresholds
 * are the conventional Wi-Fi ones: -50 excellent, -60 good, -67 the usable
 * floor for anything real-time, -75 weak.
 */
export function signalBars(dBm: number): 0 | 1 | 2 | 3 | 4 {
  if (!Number.isFinite(dBm)) return 0;
  if (dBm >= -50) return 4;
  if (dBm >= -60) return 3;
  if (dBm >= -67) return 2;
  if (dBm >= -75) return 1;
  return 0;
}

/**
 * Strongest first, one row per network.
 *
 * A scan returns one result per ACCESS POINT, so a shop with three ceiling
 * points shows the same name three times and the installer cannot tell which to
 * tap. Deduplicated by the real SSID bytes — not the printable form, or two
 * different networks whose names differ only by a control byte would collapse
 * into one and the wrong one would be joined.
 */
export function rankNetworks(found: readonly ScannedNetwork[]): ScannedNetwork[] {
  const best = new Map<string, ScannedNetwork>();
  for (const network of found) {
    if (network.ssidHex === "") continue;
    const seen = best.get(network.ssidHex);
    if (seen === undefined || network.signal > seen.signal) best.set(network.ssidHex, network);
  }
  return [...best.values()].sort((a, b) => {
    if (b.signal !== a.signal) return b.signal - a.signal;
    // A stable tiebreak, so the list does not reshuffle under a finger between
    // two equally strong networks.
    return a.ssid.localeCompare(b.ssid);
  });
}

export type ConnectionSummary =
  { readonly kind: "wired" } | { readonly kind: "wireless" } | { readonly kind: "none" };

/**
 * Which link is actually carrying traffic.
 *
 * Ethernet wins when it is routable, matching the image's own rule that "the
 * kernel decides, not a program" — the Settings screen must not claim the shop
 * is on Wi-Fi while the cable is doing the work.
 */
export function summariseConnection(status: NetworkStatusView | null): ConnectionSummary {
  if (status === null) return { kind: "none" };
  if (status.wired.present && status.wired.operstate === "routable") return { kind: "wired" };
  if (status.wireless.present && status.wireless.operstate === "routable") {
    return { kind: "wireless" };
  }
  return { kind: "none" };
}

export interface PrinterForm {
  readonly host: string;
  readonly port: string;
  readonly label: string;
}

export const EMPTY_PRINTER_FORM: PrinterForm = { host: "", port: "", label: "" };

export type PrinterFormError = "host" | "port" | null;

/**
 * Validate before the save button lights up.
 *
 * The main process validates again and is the real gate; this exists so the
 * person at the till learns about a typo while their hands are on the field
 * rather than after a round trip that says only "invalid".
 */
export function validatePrinterForm(form: PrinterForm): PrinterFormError {
  if (form.host.trim() === "" || !/^[A-Za-z0-9._:-]{1,253}$/.test(form.host.trim())) return "host";
  const port = form.port.trim();
  if (port === "") return null; // blank means the default 9100
  const parsed = Number(port);
  if (!/^\d+$/.test(port) || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return "port";
  }
  return null;
}

/** The keys a Device tab shows, in the order an operator reads them aloud. */
export const DEVICE_FIELD_ORDER = [
  "hostname",
  "serial",
  "deviceClass",
  "imageVersion",
  "environment",
] as const;
