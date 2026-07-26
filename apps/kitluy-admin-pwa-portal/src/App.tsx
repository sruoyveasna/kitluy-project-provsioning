/**
 * Admin PWA Portal — application shell.
 *
 * STATUS: SCAFFOLDED. This is an operational surface: it FAILS CLOSED — no
 * synthetic operational values are shown while the authoritative data and
 * authentication contracts are pending. Source spec: kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md.
 */
import { useState } from "react";
import type { KitluyLocale } from "@kitluy/localization";
import { activeVerticals } from "@kitluy/feature-flags";
import { AppShell, DataSurface, KitluyErrorBoundary, LocaleProvider } from "@kitluy/web-ui";

export const PRODUCT_NAME = "kitluy-admin-pwa-portal" as const;

export const MESSAGES = {
  "km-KH": {
    boundary: "ផ្ទាំងគ្រប់គ្រងផ្ទៃក្នុងសម្រាប់ HET តែប៉ុណ្ណោះ។",
    signedOut: "ការផ្ទៀងផ្ទាត់មិនទាន់ដំណើរការទេ — កិច្ចសន្យា Supabase Auth កំពុងរង់ចាំ។",
    scaffold: "គ្រោងសាងតែប៉ុណ្ណោះ — គ្មានទិន្នន័យប្រតិបត្តិការពិតទេ។",
  },
  "en-US": {
    boundary:
      "HET-internal privileged control plane. Never exposed as a Partner, Chain, Store staff or customer application; never reachable through public Partner signup (RB v4 §8.1).",
    signedOut: "Sign-in is not yet available — the Supabase Auth contract is pending.",
    scaffold: "Scaffold only — no real operational data exists.",
  },
} as const;

function SignedOutView({ locale }: { locale: KitluyLocale }) {
  // Unauthenticated route surface. There is deliberately no fake login: the
  // authentication contract is a pending canonical spec, so we fail closed.
  return (
    <section aria-label="signed-out">
      <h1>Admin PWA Portal</h1>
      <p>{MESSAGES[locale].boundary}</p>
      <p>{MESSAGES[locale].signedOut}</p>
      <p>
        <em>{MESSAGES[locale].scaffold}</em>
      </p>
      <p>Active verticals: {activeVerticals().join(", ")}</p>
      <DataSurface state="unavailable" />
    </section>
  );
}

export function App() {
  const [locale, setLocale] = useState<KitluyLocale>("km-KH");
  // Authenticated routes are structurally separated and unreachable until the
  // auth contract exists — session is always null in the scaffold.
  const session = null;
  return (
    <LocaleProvider locale={locale}>
      <KitluyErrorBoundary>
        <AppShell productName="Admin PWA Portal">
          <nav aria-label="language">
            <button onClick={() => setLocale("km-KH")} aria-pressed={locale === "km-KH"}>
              ខ្មែរ
            </button>{" "}
            <button onClick={() => setLocale("en-US")} aria-pressed={locale === "en-US"}>
              English
            </button>
          </nav>
          {session === null ? <SignedOutView locale={locale} /> : null}
        </AppShell>
      </KitluyErrorBoundary>
    </LocaleProvider>
  );
}
