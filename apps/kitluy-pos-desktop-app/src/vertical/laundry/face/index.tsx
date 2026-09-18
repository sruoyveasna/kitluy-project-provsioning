/**
 * The Laundry T1 face — the designed counter experience, mounted by the POS
 * shell for the `laundry.t1.intake_cashier` profile once the runtime has
 * verified the device credential, the Store Hub link, the configuration and
 * the Terminal PIN session (T1-FACE-PORT-001).
 *
 * PROVENANCE: `src/app/App.tsx` + `ScreenRouter.tsx` of the donor
 * `kitluy-laundry-pos-desk-app@8b2f107`, reduced to the T1 route. The donor's
 * terminal-select, PIN login, shift-open, storage and handoff providers are
 * REJECTED / SUPERSEDED / GATED per the disposition register; react-query is
 * gone with the Supabase hooks.
 *
 * The face renders from two inputs only: the read-only bootstrap report the
 * shell already holds, and the ports over the preload bridges. Without the
 * bridges it renders its unavailable face and never touches a fixture.
 */
import { useMemo } from "react";

import "./styles/fonts.css";
import "./styles/base.css";
import "./styles/savor-theme.css";
import "./styles/kitluy-global.css";

import type { T1BootstrapReport } from "../../../bootstrap/states.js";
import { AppStateProvider } from "./app/AppContext";
import { ThemeProvider } from "./app/ThemeProvider";
import { RouteErrorBoundary } from "./components/common/RouteErrorBoundary";
import { T1POS } from "./features/t1-pos/T1POS";
import type { TerminalFacts } from "./features/t1-pos/laundry-savor/LaundryTopBar";
import { bridgeFacePorts, type FacePorts } from "./ports";

export { bridgeFacePorts } from "./ports";
export type { FacePorts } from "./ports";

export const LAUNDRY_T1_PROFILE_CODE = "laundry.t1.intake_cashier" as const;

/** What the top bar shows: identifiers and verified facts from the report, nothing inferred. */
export function terminalFactsFromReport(
  report: T1BootstrapReport,
  applicationVersion: string,
): TerminalFacts {
  return {
    profileLabel: "POS Cashier / Intake",
    profileCode: LAUNDRY_T1_PROFILE_CODE,
    hubDeviceId: report.hub?.hubDeviceId ?? null,
    hubHost: report.hub === undefined ? null : `${report.hub.hostname}:${String(report.hub.port)}`,
    configurationVersion: report.configuration?.configurationVersion ?? null,
    configurationFreshness: report.configuration?.freshness ?? null,
    hubReachable: report.state === "ready",
    applicationVersion,
  };
}

export function LaundryT1Face(props: {
  readonly report: T1BootstrapReport;
  readonly applicationVersion: string;
  /** Test seam; production resolves the preload bridges. */
  readonly ports?: FacePorts;
}) {
  const ports = useMemo(() => props.ports ?? bridgeFacePorts(), [props.ports]);
  const terminal = useMemo(
    () => terminalFactsFromReport(props.report, props.applicationVersion),
    [props.report, props.applicationVersion],
  );
  if (ports === undefined) {
    return (
      <p data-laundry-face="unavailable">
        The Laundry counter is not available on this workstation: the terminal bridges are absent.
      </p>
    );
  }
  return (
    <ThemeProvider>
      <AppStateProvider ports={ports}>
        <RouteErrorBoundary>
          <T1POS terminal={terminal} />
        </RouteErrorBoundary>
      </AppStateProvider>
    </ThemeProvider>
  );
}
