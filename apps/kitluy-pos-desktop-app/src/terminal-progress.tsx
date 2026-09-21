/**
 * What the terminal shows WHILE IT IS STILL COMING UP — owner request
 * 2026-09-21, from the counter: "there is no processing UI or status shown when
 * it was in that set up or connecting to store hub stage… it made me think that
 * my device was error because at that time I am not able to access to the Pi
 * terminal".
 *
 * WHAT WENT WRONG ON THE COUNTER. Board KL-54A3320E1201 was rebooted after its
 * Ethernet cable moved. The POS painted a launcher whose four cards were locked,
 * with the true state in a 13-pixel line under them, and stayed that way for
 * 1 minute 47 seconds while the Store Hub link was refused for clock skew. Every
 * word on the screen was correct and the person still read it as a dead machine:
 * nothing moved, nothing said "working", nothing said how long.
 *
 * SO THIS PANEL SAYS THREE THINGS A PERSON ACTUALLY NEEDS: that the terminal is
 * working (a step that animates), WHICH step it is on (the signed state
 * vocabulary, unchanged), and HOW LONG it has been on it (a counter that keeps
 * moving). When a step is one a person can act on — an unreachable Hub is
 * usually an unplugged cable — it also says the one thing to check.
 *
 * WHAT IT IS NOT. It invents no state and hides no refusal: `T1BootstrapView`
 * still renders the state vocabulary and the refusal code inside it, so
 * `data-t1-state` and `data-t1-refusal` stay exactly where the acceptance tests
 * and the WS-12-T001 surface expect them. This is chrome around the truth, not
 * a second version of it.
 */
import { useEffect, useState } from "react";
import type { KitluyLocale } from "@kitluy/localization";

import type { T1BootstrapReport, T1RuntimeState } from "./bootstrap/states.js";
import { T1BootstrapView } from "./bootstrap-view.js";

/**
 * States in which the terminal is doing its work and the person only waits.
 * Everything else needs a decision, a cable or an administrator, and the panel
 * says so rather than spinning at somebody who could be fixing it.
 */
const WORKING_STATES: ReadonlySet<T1RuntimeState> = new Set([
  "starting",
  "connecting_to_hub",
  "configuration_loading",
]);

/**
 * The step a person waits through, in their own words. The state vocabulary is
 * not translated here — `T1BootstrapView` renders it underneath, verbatim.
 */
const HEADLINE: Record<"working" | "attention", Record<KitluyLocale, string>> = {
  working: {
    "km-KH": "កំពុងរៀបចំ Terminal…",
    "en-US": "Preparing this terminal…",
  },
  attention: {
    "km-KH": "កំពុងព្យាយាមម្ដងទៀត…",
    "en-US": "Still trying…",
  },
};

/** The one thing worth checking, when there is one. */
const HINTS: Partial<Record<T1RuntimeState, Record<KitluyLocale, string>>> = {
  hub_unavailable: {
    "km-KH":
      "ពិនិត្យខ្សែបណ្តាញ ឬ Wi-Fi ហើយ Store Hub ត្រូវតែបើក។ Terminal នេះនឹងព្យាយាមម្ដងទៀតដោយខ្លួនឯង។",
    "en-US":
      "Check the network cable or Wi-Fi, and that the Store Hub is on. This terminal keeps retrying by itself.",
  },
  stale_configuration: {
    "km-KH": "Terminal នេះត្រូវការភ្ជាប់ Store Hub ម្ដងទៀត ដើម្បីទទួលការកំណត់ថ្មី។",
    "en-US": "This terminal needs the Store Hub again to refresh its configuration.",
  },
  recovery_required: {
    "km-KH": "ទាក់ទងអ្នកគ្រប់គ្រង KitLuy។",
    "en-US": "Contact a KitLuy administrator.",
  },
};

const ELAPSED_LABEL: Record<KitluyLocale, (seconds: number) => string> = {
  "km-KH": (s) =>
    s < 60 ? `${String(s)} វិនាទី` : `${String(Math.floor(s / 60))} នាទី ${String(s % 60)} វិនាទី`,
  "en-US": (s) =>
    s < 60 ? `${String(s)} seconds` : `${String(Math.floor(s / 60))} min ${String(s % 60)} s`,
};

const WAITED: Record<KitluyLocale, string> = {
  "km-KH": "រង់ចាំ",
  "en-US": "waiting",
};

/**
 * Seconds on the CURRENT step. It restarts when the step changes, because "two
 * minutes on this step" is the useful number — not two minutes since power-on,
 * which keeps climbing through steps that already succeeded.
 */
export function useElapsedSeconds(resetKey: string, now: () => number = Date.now): number {
  const [startedAt, setStartedAt] = useState(now);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setStartedAt(now());
    setSeconds(0);
  }, [resetKey, now]);
  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.floor((now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt, now]);
  return seconds;
}

export function TerminalProgressPanel(props: {
  readonly report: T1BootstrapReport;
  readonly locale: KitluyLocale;
}) {
  const { report, locale } = props;
  const working = WORKING_STATES.has(report.state);
  const tone = working ? "working" : "attention";
  const elapsed = useElapsedSeconds(`${report.state}:${report.refusalCode ?? ""}`);
  const hint = HINTS[report.state]?.[locale];
  return (
    <section
      className={`kl-terminal-progress kl-terminal-progress--${tone}`}
      data-terminal-progress={report.state}
      data-progress-tone={tone}
      aria-live="polite"
      aria-busy={working}
    >
      <div className="kl-terminal-progress__mark" aria-hidden="true">
        <span className="kl-terminal-progress__dot" />
        <span className="kl-terminal-progress__dot" />
        <span className="kl-terminal-progress__dot" />
      </div>
      <div className="kl-terminal-progress__body">
        <h3 className="kl-terminal-progress__headline">{HEADLINE[tone][locale]}</h3>
        <div className="kl-terminal-progress__state">
          <T1BootstrapView report={report} locale={locale} />
        </div>
        {hint === undefined ? null : <p className="kl-terminal-progress__hint">{hint}</p>}
        <p className="kl-terminal-progress__elapsed" data-progress-elapsed={String(elapsed)}>
          {WAITED[locale]} · {ELAPSED_LABEL[locale](elapsed)}
        </p>
      </div>
    </section>
  );
}
