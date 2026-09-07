/**
 * Store Hub pairing — the "Store Hub" tab of one Store.
 *
 * Owner decision KLD-2026-08-13-HUB-PAIRING-SESSION-001, Milestone 3: a Partner
 * opens a pairing SESSION for their shop, reads the code aloud to whoever is
 * standing at the Store Hub, and that Hub joins the shop. There is deliberately
 * NO Hub picker (see the original screen's rationale, unchanged).
 *
 * Moved out of `App.tsx` when hash routing arrived. Behaviour is unchanged:
 * the Store now comes from the route (a remount on Store change clears the
 * code, which preserves "a code belongs to the Store it was opened for"), and
 * the code display is the shared `PairingCodeDisplay`.
 */
import { useCallback, useEffect, useState } from "react";
import type { KitluyLocale } from "@kitluy/localization";
import { DataSurface } from "@kitluy/web-ui";

import { MESSAGES, type MessageKey } from "./messages.js";
import type {
  IssuedCode,
  PairingClient,
  PairingOutcome,
  PairingSessionStatus,
  PartnerStore,
} from "./pairing-client.js";
import { canIssueFor, codeLife } from "./pairing-presentation.js";
import { hubReadiness } from "./terminal-presentation.js";
import { HubReadinessLine, PairingCodeDisplay, type CodeWording } from "./views.js";

/** Maps a client outcome to the one thing a Partner should be told. */
export function outcomeMessage(outcome: { kind: string }): MessageKey {
  if (outcome.kind === "unauthenticated") return "sessionExpired";
  if (outcome.kind === "denied") return "denied";
  if (outcome.kind === "not_found") return "notFound";
  return "unavailable";
}

const HUB_WORDING: CodeWording = {
  heading: "codeHeading",
  waiting: "waitingForHub",
  pairedDetail: "pairedDetail",
  replaced: "replaced",
};

/**
 * The issued code. Re-renders once a second so the countdown is honest, and
 * polls the session so "did it work?" has an answer on the screen that asked.
 */
function IssuedCodePanel({
  locale,
  issued,
  client,
}: {
  locale: KitluyLocale;
  issued: IssuedCode;
  client: PairingClient;
}) {
  const [now, setNow] = useState(() => new Date());
  const [status, setStatus] = useState<PairingSessionStatus | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      const outcome = await client.sessionStatus(issued.sessionId);
      if (!live) return;
      if (outcome.kind === "ok") {
        setStatus(outcome.value);
        if (outcome.value.paired || outcome.value.locked) return;
      }
      if (Date.parse(issued.expiresAt) <= Date.now()) return;
      timer = setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [client, issued.sessionId, issued.expiresAt]);

  return (
    <PairingCodeDisplay
      locale={locale}
      code={issued.code}
      life={codeLife(issued.expiresAt, now)}
      status={status}
      wording={HUB_WORDING}
    />
  );
}

export function HubPairingScreen({
  locale,
  client,
  store,
}: {
  locale: KitluyLocale;
  client: PairingClient;
  store: PartnerStore;
}) {
  const t = MESSAGES[locale];
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [locationId, setLocationId] = useState(store.locations[0]?.storeLocationId ?? "");
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = useCallback(async () => {
    if (locationId === "") return;
    setBusy(true);
    setProblem(null);
    setRefusal(null);
    // Clear the previous code BEFORE the call: opening a session revokes the
    // last one for this Store, so leaving it on screen would show a code that
    // has already stopped working.
    setIssued(null);
    try {
      const outcome: PairingOutcome<IssuedCode> = await client.issuePairingCode({
        digitalStoreId: store.digitalStoreId,
        storeLocationId: locationId,
      });
      if (outcome.kind === "ok") setIssued(outcome.value);
      else if (outcome.kind === "refused") setRefusal(outcome.message);
      else setProblem(outcomeMessage(outcome));
    } finally {
      setBusy(false);
    }
  }, [client, store.digitalStoreId, locationId]);

  if (problem !== null) {
    return (
      <section aria-label="pairing-unavailable">
        <div className="kl-page-head">
          <h1>{t.title}</h1>
        </div>
        <p role="alert" className="kl-notice kl-notice-critical">
          <span>{t[problem]}</span>
        </p>
        <DataSurface state="unavailable" />
      </section>
    );
  }

  const pairable = canIssueFor(store);

  return (
    <section aria-label="pairing">
      <div className="kl-page-head">
        <h1>{t.title}</h1>
        <p>{t.intro}</p>
      </div>
      <HubReadinessLine
        locale={locale}
        readiness={hubReadiness(store)}
        storeId={store.digitalStoreId}
      />

      <div className="kl-card" style={{ maxWidth: 640, marginBottom: 20 }}>
        <div className="kl-card-body">
          {store.locations.length === 0 ? (
            <p role="alert" className="kl-notice kl-notice-warn">
              <span>{t.noLocation}</span>
            </p>
          ) : (
            <div className="kl-field">
              <label htmlFor="location">{t.location}</label>
              <select
                className="kl-select"
                id="location"
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  setIssued(null);
                }}
              >
                {store.locations.map((l) => (
                  <option key={l.storeLocationId} value={l.storeLocationId}>
                    {l.locationReference}
                  </option>
                ))}
              </select>
            </div>
          )}

          {refusal === null ? null : (
            <p role="alert" className="kl-notice kl-notice-critical">
              <span>{refusal}</span>
            </p>
          )}

          <button
            type="button"
            className="kl-btn kl-btn-primary"
            onClick={() => void generate()}
            disabled={busy || !pairable}
          >
            {busy ? t.generating : t.generate}
          </button>
        </div>
      </div>

      {issued === null ? null : <IssuedCodePanel locale={locale} issued={issued} client={client} />}
    </section>
  );
}
