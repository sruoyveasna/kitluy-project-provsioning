/**
 * KitLuy POS Desktop — renderer shell.
 *
 * One Electron product with four separately assigned, permissioned terminal
 * profiles (owner-locked T1-T4, POS spec v4.0.0). The POS operates through the
 * Store Hub over the Store LAN; it NEVER writes normal Store operations
 * directly to Supabase.
 *
 * WS-12-T001: the shell renders the T1 bootstrap report produced by the main
 * process (the §5 state vocabulary). Without a report — no preload bridge, a
 * browser dev session, or a bootstrap that has not run — it FAILS CLOSED to
 * the unassigned surface exactly as the scaffold always has. The renderer
 * never selects a Tenant, Store, Location, Hub, environment, profile or
 * assignment generation; it displays what the runtime verified.
 *
 * T1-FACE-PORT-001: with a report, the screen is the designed product — the
 * Terminal launcher (assignment shown, PIN modal) for every state before the
 * PIN session, and the Laundry T1 face (`vertical/laundry/face`, ported from
 * `kitluy-laundry-pos-desk-app` over the same intake and PIN bridges) once the
 * runtime is `ready` / `offline_ready` under a Terminal PIN session. Without a
 * report the scaffold shell stays: it is the fail-closed face.
 */
import { useEffect, useState } from "react";
import type { KitluyLocale } from "@kitluy/localization";
import type { LaundryTerminalProfile } from "@kitluy-verticals/phase1-laundry";
import { LAUNDRY_TERMINAL_PROFILES } from "@kitluy-verticals/phase1-laundry";
import { AppShell, DataSurface, KitluyErrorBoundary, LocaleProvider } from "@kitluy/web-ui";

import type { T1BootstrapReport } from "./bootstrap/states.js";
import { TerminalLauncher } from "./terminal-launcher.js";
import { LaundryT1Face } from "./vertical/laundry/face/index.js";

export const PRODUCT_NAME = "kitluy-pos-desktop-app" as const;

/** The renderer's own version, baked in by Vite; "dev" under the test runner. */
export const APPLICATION_VERSION: string =
  typeof __KITLUY_POS_VERSION__ === "string" ? __KITLUY_POS_VERSION__ : "dev";

export const MESSAGES = {
  "km-KH": {
    notAssigned:
      "ឧបករណ៍នេះមិនទាន់ត្រូវបានចាត់តាំងទេ — កិច្ចសន្យា Store Hub កំពុងរង់ចាំ (DEVICE_NOT_ASSIGNED)។",
    scaffold: "គ្មានរបាយការណ៍ចាប់ផ្តើមទេ — គ្មានប្រតិបត្តិការពិតទេ។",
  },
  "en-US": {
    notAssigned:
      "This device is not assigned — the Store Hub assignment contract is pending (DEVICE_NOT_ASSIGNED).",
    scaffold: "No bootstrap report is present — no real operations exist.",
  },
} as const;

// Canonical logical terminal-profile identifiers (KLD-2026-07-26-002 Group 2).
// Labels are presentation only — a profile identifier is not a permission.
const PROFILE_LABELS: Record<LaundryTerminalProfile, string> = {
  "laundry.t1.intake_cashier": "T1 — POS Cashier / Intake",
  "laundry.t2.customer_display": "T2 — Customer Display Screen",
  "laundry.t3.ready_scan_in": "T3 — Clean & Ready Scan-In",
  "laundry.t4.pickup_scan_out": "T4 — Customer Pickup Scan-Out",
};

/** The face takes the screen only when every terminal-level check has passed AND a PIN session is open. */
export function isLaundryFaceReady(report: T1BootstrapReport): boolean {
  return (
    (report.state === "ready" || report.state === "offline_ready") && report.staff !== undefined
  );
}

/** A Pi Terminal (the edge-bridge path) is a touch kiosk: no pointer is drawn. */
export function kioskInputMode(report: T1BootstrapReport | undefined): "touch" | null {
  return report?.link?.transport === "edge_bridge" ? "touch" : null;
}

export function App(props: { readonly report?: T1BootstrapReport }) {
  const [locale, setLocale] = useState<KitluyLocale>("km-KH");
  const report = props.report;
  const kiosk = kioskInputMode(report);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (kiosk === null) document.body.removeAttribute("data-kitluy-kiosk");
    else document.body.setAttribute("data-kitluy-kiosk", kiosk);
  }, [kiosk]);

  if (report !== undefined && isLaundryFaceReady(report)) {
    return (
      <KitluyErrorBoundary>
        <LaundryT1Face report={report} applicationVersion={APPLICATION_VERSION} />
      </KitluyErrorBoundary>
    );
  }

  if (report !== undefined) {
    return (
      <LocaleProvider locale={locale}>
        <KitluyErrorBoundary>
          <TerminalLauncher report={report} locale={locale} onLocale={setLocale} />
        </KitluyErrorBoundary>
      </LocaleProvider>
    );
  }

  return (
    <LocaleProvider locale={locale}>
      <KitluyErrorBoundary>
        <AppShell productName="POS Desktop">
          <nav aria-label="language">
            <button onClick={() => setLocale("km-KH")} aria-pressed={locale === "km-KH"}>
              ខ្មែរ
            </button>{" "}
            <button onClick={() => setLocale("en-US")} aria-pressed={locale === "en-US"}>
              English
            </button>
          </nav>
          <h1>KitLuy POS — Terminal Profiles</h1>
          <ul>
            {LAUNDRY_TERMINAL_PROFILES.map((p) => (
              <li key={p}>
                {PROFILE_LABELS[p]}
                {" — "}
                <em>locked</em>
              </li>
            ))}
          </ul>
          <p>{MESSAGES[locale].notAssigned}</p>
          <p>
            <em>{MESSAGES[locale].scaffold}</em>
          </p>
          <DataSurface state="unavailable" />
        </AppShell>
      </KitluyErrorBoundary>
    </LocaleProvider>
  );
}
