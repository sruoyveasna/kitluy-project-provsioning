/**
 * KitLuy POS Desktop — renderer shell (SCAFFOLDED).
 *
 * One Electron product with four separately assigned, permissioned terminal
 * profiles (owner-locked T1-T4, POS spec v4.0.0). The POS operates through the
 * Store Hub over the Store LAN; it NEVER writes normal Store operations
 * directly to Supabase. This scaffold fails closed: no device assignment
 * contract exists yet, so no terminal mode can be entered.
 */
import { useState } from "react";
import type { KitluyLocale } from "@kitluy/localization";
import type { LaundryTerminalProfile } from "@kitluy-verticals/phase1-laundry";
import { LAUNDRY_TERMINAL_PROFILES } from "@kitluy-verticals/phase1-laundry";
import { AppShell, DataSurface, KitluyErrorBoundary, LocaleProvider } from "@kitluy/web-ui";

export const PRODUCT_NAME = "kitluy-pos-desktop-app" as const;

export const MESSAGES = {
  "km-KH": {
    notAssigned:
      "ឧបករណ៍នេះមិនទាន់ត្រូវបានចាត់តាំងទេ — កិច្ចសន្យា Store Hub កំពុងរង់ចាំ (DEVICE_NOT_ASSIGNED)។",
    scaffold: "គ្រោងសាងតែប៉ុណ្ណោះ — គ្មានប្រតិបត្តិការពិតទេ។",
  },
  "en-US": {
    notAssigned:
      "This device is not assigned — the Store Hub assignment contract is pending (DEVICE_NOT_ASSIGNED).",
    scaffold: "Scaffold only — no real operations exist.",
  },
} as const;

const PROFILE_LABELS: Record<LaundryTerminalProfile, string> = {
  t1_intake_cashier: "T1 — POS Cashier / Intake",
  t2_customer_display: "T2 — Customer Display Screen",
  t3_ready_scan_in: "T3 — Clean & Ready Scan-In",
  t4_pickup_scan_out: "T4 — Customer Pickup Scan-Out",
};

export function App() {
  const [locale, setLocale] = useState<KitluyLocale>("km-KH");
  // Device assignment comes from the Store Hub; no assignment exists in the
  // scaffold, so every profile is locked (fail closed — never a fake mode).
  const assignedProfile: LaundryTerminalProfile | null = null;
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
                {PROFILE_LABELS[p]} — <em>locked</em>
              </li>
            ))}
          </ul>
          <p>{MESSAGES[locale].notAssigned}</p>
          <p>
            <em>{MESSAGES[locale].scaffold}</em>
          </p>
          {assignedProfile === null ? <DataSurface state="unavailable" /> : null}
        </AppShell>
      </KitluyErrorBoundary>
    </LocaleProvider>
  );
}
