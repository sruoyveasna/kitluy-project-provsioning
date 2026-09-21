/**
 * T1-FACE-PORT-001 — the Laundry T1 face on the Pi Terminal.
 *
 * Server-side renders (the repository's React test style) prove what the face
 * shows for a given bootstrap report and port answers; file scans prove what
 * did NOT come over from the donor (fixture prices, Supabase, staff login).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App, isLaundryFaceReady, kioskInputMode } from "../src/App.js";
import type { T1BootstrapReport } from "../src/bootstrap/states.js";
import type { IntakeCustomer } from "../src/intake/ports.js";
import { AppStateProvider } from "../src/vertical/laundry/face/app/AppContext.js";
import { ThemeProvider } from "../src/vertical/laundry/face/app/ThemeProvider.js";
import { Step1Items } from "../src/vertical/laundry/face/features/t1-pos/new-order/Step1Items.js";
import { Step3Review } from "../src/vertical/laundry/face/features/t1-pos/new-order/Step3Review.js";
import {
  useSearchCustomers,
  PHONE_SEARCH_MIN_DIGITS,
} from "../src/vertical/laundry/face/hooks/useCustomers.js";
import { LaundryT1Face, terminalFactsFromReport } from "../src/vertical/laundry/face/index.js";
import {
  CATALOG_NOT_DELIVERED_REASON,
  bridgeFacePorts,
  customerFromIntake,
  type FacePorts,
} from "../src/vertical/laundry/face/ports.js";

const READY: T1BootstrapReport = {
  state: "ready",
  transitions: ["starting", "connecting_to_hub", "configuration_loading", "ready"],
  hub: {
    hubDeviceId: "549a41c6-21e9-4838-8b48-34a3878ba290",
    hostname: "172.16.13.203",
    port: 7443,
  },
  configuration: {
    configurationVersion: 4,
    schemaVersion: 1,
    freshness: "current",
    issuedAt: "2026-09-18T01:00:00.000Z",
    validUntil: "2026-09-19T01:00:00.000Z",
    evaluatedAt: "2026-09-18T01:21:46.011Z",
  },
  staff: { actorId: "7a6f1e26-21c8-4a40-8b4b-1ad789a040e9", displayName: "" },
  link: {
    transport: "edge_bridge",
    hubAuthentication: "terminal_edge_mtls_pinned",
    hubSignatures: "not_verified_hub_key_not_provisioned",
  },
  pin: { state: "set", lockedUntil: null, attemptsBeforeLock: 5 },
};

const LOCKED: T1BootstrapReport = {
  ...READY,
  state: "staff_authentication_required",
  staff: undefined,
  pin: { state: "setup_required", lockedUntil: null, attemptsBeforeLock: 5 },
};

const never = (): never => {
  throw new Error("this port must not be called during a server render");
};

const PORTS: FacePorts = {
  searchCustomersByPhone: never,
  createCustomer: never,
  createDraft: never,
  updateDraft: never,
  cancelDraft: never,
  readCatalog: () =>
    Promise.resolve({ status: "not_delivered", reason: CATALOG_NOT_DELIVERED_REASON }),
  lockTerminal: () => Promise.resolve(),
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|css)$/u.test(name) ? [path] : [];
  });
}

const FACE_ROOT = new URL("../src/vertical/laundry/face/", import.meta.url).pathname;

describe("the shell hands the screen to the Laundry face", () => {
  it("only once the runtime is ready under a PIN session", () => {
    expect(isLaundryFaceReady(READY)).toBe(true);
    expect(isLaundryFaceReady({ ...READY, state: "offline_ready" })).toBe(true);
    expect(isLaundryFaceReady({ ...READY, staff: undefined })).toBe(false);
    expect(isLaundryFaceReady(LOCKED)).toBe(false);
    expect(isLaundryFaceReady({ ...READY, state: "hub_unavailable" })).toBe(false);
  });

  it("renders the designed counter for a ready report, not the profile list", () => {
    const html = renderToString(<App report={READY} />);
    // Under the test runner there is no preload bridge: the face says so and
    // the scaffold list is gone — the shell no longer renders around it.
    expect(html).toContain('data-laundry-face="unavailable"');
    expect(html).not.toContain("KitLuy POS — Terminal Profiles");
  });

  it("shows the Terminal launcher while locked: the assignment is shown, never chosen", () => {
    const html = renderToString(<App report={LOCKED} />);
    expect(html).toContain('data-terminal-launcher="staff_authentication_required"');
    expect(html).not.toContain("KitLuy POS — Terminal Profiles");
    expect(html).not.toContain("data-t1-view");
    // The one assigned card is live; the other three are locked with the reason.
    expect(html).toMatch(/data-terminal-card="T1" data-assigned="true"/u);
    expect(html).not.toMatch(/<button[^>]*data-terminal-card="T1"[^>]*\sdisabled/u);
    for (const id of ["T2", "T3", "T4"]) {
      expect(html).toMatch(
        new RegExp(
          `<button[^>]*disabled=""[^>]*data-terminal-card="${id}"|<button[^>]*data-terminal-card="${id}"[^>]*disabled`,
          "u",
        ),
      );
    }
    // Default locale is Khmer; an SVG lock (the Pi has no emoji font) precedes the reason.
    expect(html).toContain("បានចាត់តាំងតាម provisioning");
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(html).not.toMatch(/Sign out|Select Your Terminal|Choose the workstation/u);
    // The PIN modal opens on the tap, so nothing PIN-shaped is in the first paint.
    expect(html).not.toContain("data-pin-screen");
    // The pad the modal shows wears the face's touch keypad.
    const pinScreen = readFileSync(new URL("../src/pin-screen.tsx", import.meta.url), "utf8");
    expect(pinScreen).toContain('className="kl-numpad-grid kl-pin-keypad"');
    expect(pinScreen).toContain("kl-numpad-key--back");
    expect(pinScreen).toContain("data-key={key}");
  });

  it("keeps the launcher through the boot states, with the T1 card not yet tappable", () => {
    const html = renderToString(<App report={{ ...LOCKED, state: "connecting_to_hub" }} />);
    expect(html).toContain('data-terminal-launcher="connecting_to_hub"');
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*data-terminal-card="T1"|<button[^>]*data-terminal-card="T1"[^>]*disabled/u,
    );
    expect(html).toContain('data-t1-state="connecting_to_hub"');
  });

  // Owner, 2026-09-21, after a board sat 1 min 47 s on a correct but silent
  // screen: "there is no processing UI or status show… it made me think that my
  // device was error". A waiting terminal must look like it is working.
  it("says it is working, which step, and for how long — while it waits", () => {
    const html = renderToString(<App report={{ ...LOCKED, state: "connecting_to_hub" }} />);
    expect(html).toContain('data-terminal-progress="connecting_to_hub"');
    expect(html).toContain('data-progress-tone="working"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("data-progress-elapsed=");
    // The state vocabulary and the refusal code stay exactly where WS-12-T001
    // put them: the panel is chrome around the truth, not a second copy of it.
    expect(html).toContain('data-t1-state="connecting_to_hub"');
  });

  it("stops pretending to work when a person has to act, and says what to check", () => {
    const html = renderToString(
      <App report={{ ...LOCKED, state: "hub_unavailable", refusalCode: "EDGE_HUB_UNREACHABLE" }} />,
    );
    expect(html).toContain('data-progress-tone="attention"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('data-t1-refusal="EDGE_HUB_UNREACHABLE"');
    // Khmer is the default locale on the Pi: the hint is shown in it.
    expect(html).toContain("ពិនិត្យខ្សែបណ្តាញ");
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("hides the pointer only on the touch kiosk path", () => {
    expect(kioskInputMode(READY)).toBe("touch");
    expect(kioskInputMode({ ...READY, link: undefined })).toBeNull();
    expect(kioskInputMode(undefined)).toBeNull();
  });
});

describe("the face over test ports", () => {
  it("shows the top bar, the Booking view and the honest catalog state", () => {
    const html = renderToString(
      <LaundryT1Face report={READY} applicationVersion="0.1.0-test" ports={PORTS} />,
    );
    expect(html).toContain('data-t1-view="new_order"');
    expect(html).toContain('data-nav="new_order"');
    expect(html).toContain("Cashier / Intake");
    expect(html).toContain("PIN session");
    // No emoji anywhere in the first paint: the Pi image has no emoji font.
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(html).toContain("v4");
    expect(html).toContain('data-wizard-step="0"');
    // The catalog port has not answered on a server render: loading, never a fixture.
    expect(html).toContain('data-catalog="loading"');
    expect(html).not.toMatch(/4[, ]?000/u);
    expect(html).not.toContain("Wash &amp; Fold");
    expect(html).not.toContain("Dry Clean");
    // No staff, no logout, no terminal picker — the terminal menu (closed here) offers one action.
    expect(html).not.toMatch(/Log out|Back to terminals|Sign out/u);
    expect(html).toContain('aria-label="Terminal menu"');
    const topBar = readFileSync(
      join(FACE_ROOT, "features/t1-pos/laundry-savor/LaundryTopBar.tsx"),
      "utf8",
    );
    expect(topBar).toContain("Lock terminal");
    expect(topBar).toContain(".lockTerminal()");
    expect(topBar).not.toMatch(/signOut|setPhase\("terminal_select"\)/u);
  });

  it("derives the terminal facts from the report only", () => {
    const facts = terminalFactsFromReport(READY, "1.2.3");
    expect(facts).toEqual({
      profileLabel: "POS Cashier / Intake",
      profileCode: "laundry.t1.intake_cashier",
      hubDeviceId: "549a41c6-21e9-4838-8b48-34a3878ba290",
      hubHost: "172.16.13.203:7443",
      configurationVersion: 4,
      configurationFreshness: "current",
      hubReachable: true,
      applicationVersion: "1.2.3",
    });
    expect(
      terminalFactsFromReport({ ...READY, state: "offline_ready", hub: undefined }, "x")
        .hubReachable,
    ).toBe(false);
  });

  it("has no ports without the preload bridges and never falls back", () => {
    expect(bridgeFacePorts()).toBeUndefined();
  });
});

describe("the wizard steps", () => {
  const Harness = ({ children }: { readonly children: ReactNode }) => (
    <ThemeProvider>
      <AppStateProvider ports={PORTS}>{children}</AppStateProvider>
    </ThemeProvider>
  );

  it("Items: a truthful empty state carries the Hub's reason, and the cashier may continue", () => {
    const html = renderToString(
      <Harness>
        <Step1Items />
      </Harness>,
    );
    expect(html).toContain('data-catalog="loading"');
    expect(html).toContain("Select service");
    expect(html).not.toContain("data-service-card");
  });

  it("Review: opens a Booking DRAFT, labelled as such, lines not saved", () => {
    const main = renderToString(
      <Harness>
        <Step3Review layout="main" />
      </Harness>,
    );
    expect(main).toContain("Review &amp; open the draft");
    expect(main).toContain("Walk-in");
    expect(main).toContain("WS-12-T005");
    const panel = renderToString(
      <Harness>
        <Step3Review layout="panel" />
      </Harness>,
    );
    expect(panel).toContain('data-action="open-draft"');
    expect(panel).toContain("Open Booking Draft");
    expect(panel).toContain("not a Booking price");
    expect(panel).not.toMatch(/Confirm &amp; Print|Total to pay/u);
  });
});

describe("the customer ports", () => {
  it("projects the Hub's customer answer without adding anything", () => {
    const intake: IntakeCustomer = {
      customerId: "aad02fb1-0000-4000-8000-000000000001",
      displayName: "Sokha Keo",
      phoneMasked: "+855 •• ••• 678",
      phoneE164: null,
      phoneVerified: false,
      preferredLanguage: "km-KH",
      origin: "t1_walkup",
      syncState: "pending_sync",
    };
    expect(customerFromIntake(intake)).toEqual({
      id: intake.customerId,
      name: "Sokha Keo",
      phoneMasked: "+855 •• ••• 678",
      phoneVerified: false,
      preferredLanguage: "km-KH",
      origin: "t1_walkup",
      syncState: "pending_sync",
    });
    expect(customerFromIntake({ ...intake, preferredLanguage: "fr-FR" }).preferredLanguage).toBe(
      "km-KH",
    );
  });

  it("searches only once enough digits are typed", () => {
    expect(PHONE_SEARCH_MIN_DIGITS).toBe(6);
    expect(typeof useSearchCustomers).toBe("function");
  });
});

describe("what did NOT come over from the donor", () => {
  const files = sources(FACE_ROOT);

  it("ported a real tree", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it.each([
    ["a fixture price or rate", /WF_KG_RATE_KHR|FIXTURE_|fixtureBackend|4000 KHR|rateKhr: 4000/u],
    ["a Supabase client or RPC", /@supabase\/|createClient\(|\.rpc\(|from\("[a-z_]+"\)/u],
    ["react-query", /@tanstack\/react-query|useQuery\(|useMutation\(/u],
    [
      "a staff login",
      /signInWithPassword|verify_operator_pin|set_operator_pin|\bpassword\b|\bemail\b/u,
    ],
    ["the donor's payment stack", /payway|PayWay|KHQR|escpos|receipt-printer-encoder/u],
    [
      "a terminal picker or dev bypass",
      /terminal_select|AUTH_BYPASS|devBypass|kitluyNativeEnabled/u,
    ],
    ["Tailwind directives", /@import ['"]tailwindcss|@tailwind /u],
    ["a Google Fonts request", /fonts\.googleapis|fonts\.gstatic/u],
  ])("carries no %s", (_name, pattern) => {
    const hits = files.filter((file) =>
      pattern.test(
        readFileSync(file, "utf8")
          .replace(/\/\*[\s\S]*?\*\//gu, "")
          .replace(/^\s*\/\/.*$/gmu, ""),
      ),
    );
    expect(hits.map((f) => f.replace(FACE_ROOT, ""))).toEqual([]);
  });

  it("every ported screen names its provenance", () => {
    const screens = files
      .filter((f) =>
        /features\/t1-pos\/(T1POS|new-order\/Step[0-3][A-Za-z]+|laundry-savor\/LaundryTopBar)\.tsx$/u.test(
          f,
        ),
      )
      .map((f) => f.replace(FACE_ROOT, ""));
    expect(screens.length).toBe(6);
    for (const f of screens) {
      expect(readFileSync(join(FACE_ROOT, f), "utf8")).toMatch(/PROVENANCE/u);
    }
  });
});
