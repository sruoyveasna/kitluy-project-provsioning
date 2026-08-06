/**
 * T1 bootstrap state surface — WS-12-T001.
 *
 * Renders the closed §5 state vocabulary. The freshness rule is visual as
 * well as semantic: cached configuration renders through the `stale`
 * DataSurface state with its verification instant, never through `fresh` —
 * cached data is never displayed as current.
 */
import type { KitluyLocale } from "@kitluy/localization";
import { DataSurface, type DataSurfaceState } from "@kitluy/web-ui";

import type { T1BootstrapReport, T1RuntimeState } from "./bootstrap/states.js";

const SURFACE_STATES: Record<T1RuntimeState, DataSurfaceState> = {
  starting: "loading",
  connecting_to_hub: "loading",
  configuration_loading: "loading",
  staff_authentication_required: "unavailable",
  ready: "fresh",
  offline_ready: "stale",
  stale_configuration: "unavailable",
  hub_unavailable: "unavailable",
  assignment_invalid: "unavailable",
  credential_invalid: "unavailable",
  profile_not_authorized: "unavailable",
  configuration_incompatible: "unavailable",
  recovery_required: "unavailable",
};

const STATE_LABELS: Record<T1RuntimeState, Record<KitluyLocale, string>> = {
  starting: { "km-KH": "កំពុងចាប់ផ្តើម…", "en-US": "Starting…" },
  connecting_to_hub: {
    "km-KH": "កំពុងភ្ជាប់ទៅ Store Hub…",
    "en-US": "Connecting to the Store Hub…",
  },
  configuration_loading: {
    "km-KH": "កំពុងផ្ទុកការកំណត់រចនាសម្ព័ន្ធដែលបានចុះហត្ថលេខា…",
    "en-US": "Loading the signed configuration…",
  },
  staff_authentication_required: {
    "km-KH": "តម្រូវឱ្យបុគ្គលិកផ្ទៀងផ្ទាត់មុនប្រតិបត្តិការ (STAFF_AUTHENTICATION_REQUIRED)។",
    "en-US": "Staff authentication is required before operations (STAFF_AUTHENTICATION_REQUIRED).",
  },
  ready: {
    "km-KH": "T1 រួចរាល់ — ការកំណត់រចនាសម្ព័ន្ធបច្ចុប្បន្ន។",
    "en-US": "T1 ready — configuration is current.",
  },
  offline_ready: {
    "km-KH":
      "T1 រួចរាល់ក្រៅបណ្តាញ — ប្រើការកំណត់រចនាសម្ព័ន្ធចុងក្រោយដែលបានផ្ទៀងផ្ទាត់ (មិនមែនបច្ចុប្បន្ន)។",
    "en-US": "T1 offline ready — using the last verified configuration (not current).",
  },
  stale_configuration: {
    "km-KH": "ការកំណត់រចនាសម្ព័ន្ធហួសសុពលភាព — មិនអាចប្រតិបត្តិការបានទេ (STALE_CONFIGURATION)។",
    "en-US": "The configuration is expired — operations cannot begin (STALE_CONFIGURATION).",
  },
  hub_unavailable: {
    "km-KH":
      "មិនអាចភ្ជាប់ Store Hub បានទេ — ប្រតិបត្តិការហាងមិនអាចចាប់ផ្តើមបានទេ (HUB_UNAVAILABLE)។",
    "en-US": "The Store Hub is unavailable — Store operations cannot begin (HUB_UNAVAILABLE).",
  },
  assignment_invalid: {
    "km-KH": "ការចាត់តាំងឧបករណ៍មិនត្រឹមត្រូវ (ASSIGNMENT_INVALID)។",
    "en-US": "The device assignment is invalid (ASSIGNMENT_INVALID).",
  },
  credential_invalid: {
    "km-KH": "អត្តសញ្ញាណប័ណ្ណឧបករណ៍មិនត្រឹមត្រូវ ឬត្រូវបានដកហូត (CREDENTIAL_INVALID)។",
    "en-US": "The terminal credential is invalid or revoked (CREDENTIAL_INVALID).",
  },
  profile_not_authorized: {
    "km-KH": "ប្រវត្តិរូបឧបករណ៍មិនមានសិទ្ធិ T1 ទេ (PROFILE_NOT_AUTHORIZED)។",
    "en-US": "The assigned profile is not authorized for T1 (PROFILE_NOT_AUTHORIZED).",
  },
  configuration_incompatible: {
    "km-KH": "ការកំណត់រចនាសម្ព័ន្ធមិនត្រូវគ្នា (CONFIGURATION_INCOMPATIBLE)។",
    "en-US": "The configuration is incompatible (CONFIGURATION_INCOMPATIBLE).",
  },
  recovery_required: {
    "km-KH": "តម្រូវឱ្យស្តារឡើងវិញ — ទាក់ទងអ្នកគ្រប់គ្រង (RECOVERY_REQUIRED)។",
    "en-US": "Recovery is required — contact an administrator (RECOVERY_REQUIRED).",
  },
};

export function T1BootstrapView(props: {
  readonly report: T1BootstrapReport;
  readonly locale: KitluyLocale;
}) {
  const { report, locale } = props;
  const surface = SURFACE_STATES[report.state];
  const cached = report.configuration?.freshness === "cached_offline";
  return (
    <section aria-label="terminal-state" data-t1-state={report.state}>
      <p>{STATE_LABELS[report.state][locale]}</p>
      {report.refusalCode !== undefined ? (
        <p>
          <code data-t1-refusal={report.refusalCode}>{report.refusalCode}</code>
        </p>
      ) : null}
      {report.configuration !== undefined ? (
        <p data-t1-config-freshness={report.configuration.freshness}>
          {locale === "km-KH" ? "កំណែការកំណត់រចនាសម្ព័ន្ធ" : "Configuration version"}{" "}
          {report.configuration.configurationVersion}
          {cached
            ? locale === "km-KH"
              ? " — ឃ្លាំងសម្ងាត់ (មិនមែនបច្ចុប្បន្ន)"
              : " — cached (not current)"
            : ""}
        </p>
      ) : null}
      <DataSurface
        state={surface}
        {...(cached && report.configuration !== undefined
          ? { dataAsOf: report.configuration.evaluatedAt }
          : {})}
      />
    </section>
  );
}
