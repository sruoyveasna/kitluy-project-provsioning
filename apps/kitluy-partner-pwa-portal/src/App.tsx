/**
 * Partner PWA Portal — Store Hub pairing.
 *
 * ===========================================================================
 * WHAT THIS SCREEN IS FOR
 * ===========================================================================
 * Owner decision KLD-2026-08-13-HUB-PAIRING-SESSION-001, Milestone 3: a Partner
 * opens a pairing SESSION for their shop, reads the code aloud to whoever is
 * standing at the Store Hub, and that Hub joins the shop.
 *
 * There is deliberately NO Hub picker. The code belongs to the Store and any Hub
 * may use it — a Hub that has never paired belongs to nobody, so "their" unpaired
 * Hubs cannot be listed without listing everyone's, and the label on the Hub
 * console is derived on-device and stored nowhere, so it cannot be looked up
 * either. Asking a Partner which Hub they mean is a question with no honest
 * answer, so the screen does not ask it.
 *
 * ===========================================================================
 * THE PARTS THAT COULD LIE, AND WHERE THEY LIVE
 * ===========================================================================
 * The countdown, the code grouping and "can this Store be paired at all" are in
 * `pairing-presentation.ts`; response classification is in `pairing-client.ts`.
 * Both are unit-tested. What remains here is wiring, so the component has as
 * little untested judgement in it as possible.
 *
 * The code is rendered from state and never written anywhere else: not to
 * storage, not to a URL, not to a log. Only its digest exists server-side, so a
 * copy made here would be the only retrievable one in the system.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { KitluyLocale } from "@kitluy/localization";
import {
  AppShell,
  DataSurface,
  KitluyErrorBoundary,
  LocaleProvider,
  kitluyTokens,
} from "@kitluy/web-ui";

import { resolvePortalRuntime, type PortalRuntime } from "./config.js";
import { MESSAGES, type MessageKey } from "./messages.js";
import {
  createPairingClient,
  type PairingClient,
  type PairingSessionStatus,
  type IssuedCode,
  type PairingOutcome,
  type PartnerStore,
} from "./pairing-client.js";
import { canIssueFor, codeLife, groupCode } from "./pairing-presentation.js";
import { classifySignInError, validateCredentials, FAILURE_MESSAGE } from "./sign-in.js";

export const PRODUCT_NAME = "kitluy-partner-pwa-portal" as const;

/** Maps a client outcome to the one thing a Partner should be told. */
function outcomeMessage(outcome: { kind: string }): MessageKey {
  if (outcome.kind === "unauthenticated") return "sessionExpired";
  if (outcome.kind === "denied") return "denied";
  return "unavailable";
}

function SignInForm({
  locale,
  runtime,
  onSignedIn,
}: {
  locale: KitluyLocale;
  runtime: PortalRuntime;
  onSignedIn: () => void;
}) {
  const t = MESSAGES[locale];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<MessageKey | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const invalid = validateCredentials(email, password);
    if (invalid !== null) {
      setFailure(FAILURE_MESSAGE[invalid]);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const { error } = await runtime.client.auth.signInWithPassword({ email, password });
      if (error !== null) {
        setFailure(FAILURE_MESSAGE[classifySignInError(error)]);
        return;
      }
      onSignedIn();
    } catch (error) {
      setFailure(FAILURE_MESSAGE[classifySignInError(error)]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form aria-label="sign-in" onSubmit={submit}>
      <h1>{t.title}</h1>
      <p>{t.intro}</p>
      <p>
        <label htmlFor="email">{t.email}</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </p>
      <p>
        <label htmlFor="password">{t.password}</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </p>
      {failure === null ? null : <p role="alert">{t[failure]}</p>}
      <button type="submit" disabled={busy}>
        {busy ? t.signingIn : t.signIn}
      </button>
    </form>
  );
}

/**
 * The issued code.
 *
 * Re-renders once a second so the countdown is honest, and switches to the
 * expired message the moment the SERVER's deadline passes — a code that looks
 * live but is dead sends an operator to type it and be refused.
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
  const t = MESSAGES[locale];
  const [now, setNow] = useState(() => new Date());
  const [status, setStatus] = useState<PairingSessionStatus | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  /**
   * Watch the session the Portal just opened.
   *
   * Polling, not Realtime: OD-ADMIN-FLEET-001 keeps `kitluy_devices` closed to
   * browsers, so a subscription would mean exposing the schema to the client.
   * Three seconds is chosen against the human loop — someone walks to the Hub
   * and types eight characters — not against a machine one.
   *
   * Stops the moment the answer is final. A poller that kept running after a
   * successful pairing would hammer the API for the life of the tab.
   */
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
      // A transient failure must not kill the watch — the operator is still
      // standing at the Hub. Keep trying until the code's own deadline passes.
      if (Date.parse(issued.expiresAt) <= Date.now()) return;
      timer = setTimeout(() => void poll(), 3000);
    };

    void poll();
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [client, issued.sessionId, issued.expiresAt]);

  const life = codeLife(issued.expiresAt, now);

  // SUCCESS WINS OVER THE CLOCK. A code that was used at 14:59:58 is paired even
  // though the countdown has since run out, and showing "expired" then would be
  // both wrong and alarming.
  if (status?.paired === true) {
    return (
      <section aria-label="pairing-code" data-paired="true">
        <h2 style={{ color: kitluyTokens.colorPrimary }}>{t.pairedHeading}</h2>
        <p>{t.pairedDetail}</p>
        {status.pairedDeviceReference === null ? null : (
          <p style={{ color: kitluyTokens.colorMuted }}>
            {t.pairedDevice}:{" "}
            <strong style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              {status.pairedDeviceReference}
            </strong>
          </p>
        )}
      </section>
    );
  }

  if (status?.locked === true) {
    return (
      <section aria-label="pairing-code" data-locked="true">
        <h2>{t.codeHeading}</h2>
        <p role="alert" style={{ color: kitluyTokens.colorDanger, fontWeight: 700 }}>
          {t.lockedOut}
        </p>
      </section>
    );
  }

  // Under two minutes the countdown turns urgent. An operator walking to the
  // Hub needs to know the code may die before they arrive, and a uniform grey
  // timer does not say that.
  const urgent = life.kind === "live" && life.secondsRemaining <= 120;

  return (
    <section aria-label="pairing-code">
      <h2>{t.codeHeading}</h2>
      {life.kind === "expired" ? (
        <p role="alert" style={{ color: kitluyTokens.colorDanger, fontWeight: 700 }}>
          {t.expired}
        </p>
      ) : (
        <div
          style={{
            border: `2px solid ${kitluyTokens.colorPrimary}`,
            borderRadius: kitluyTokens.radius,
            padding: "1.25rem 1.5rem",
            textAlign: "center",
            maxWidth: "26rem",
          }}
        >
          {/* `aria-label` carries the ungrouped code so a screen reader does not
              announce the display gap as part of what to type. */}
          <p aria-label={issued.code} style={{ margin: "0 0 .5rem" }}>
            <strong
              style={{
                fontSize: "2.6rem",
                letterSpacing: "0.18em",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                color: kitluyTokens.colorPrimary,
              }}
            >
              {groupCode(issued.code)}
            </strong>
          </p>
          <p
            style={{
              margin: 0,
              color: urgent ? kitluyTokens.colorDanger : kitluyTokens.colorMuted,
            }}
          >
            {t.expiresIn}{" "}
            <time style={{ fontWeight: urgent ? 700 : 500, fontVariantNumeric: "tabular-nums" }}>
              {life.label}
            </time>
          </p>
        </div>
      )}
      <p role="status" style={{ color: kitluyTokens.colorMuted }}>
        {t.waitingForHub}
      </p>
      {status !== null && status.failedAttemptCount > 0 ? (
        <p role="alert" style={{ color: kitluyTokens.colorWarning }}>
          {t.attemptsFailed}: {status.failedAttemptCount}
        </p>
      ) : null}
      <p style={{ color: kitluyTokens.colorMuted }}>
        <em>{t.shownOnce}</em>
      </p>
      <p style={{ color: kitluyTokens.colorMuted }}>
        <em>{t.replaced}</em>
      </p>
    </section>
  );
}

function PairingView({ locale, runtime }: { locale: KitluyLocale; runtime: PortalRuntime }) {
  const t = MESSAGES[locale];
  const client = useMemo(
    () =>
      createPairingClient({
        baseUrl: runtime.managementApiUrl,
        accessToken: async () => {
          const { data } = await runtime.client.auth.getSession();
          return data.session?.access_token ?? null;
        },
      }),
    [runtime],
  );

  const [stores, setStores] = useState<readonly PartnerStore[] | null>(null);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [storeId, setStoreId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const outcome = await client.listStores();
      if (cancelled) return;
      if (outcome.kind !== "ok") {
        setProblem(outcomeMessage(outcome));
        return;
      }
      setStores(outcome.value);
      const first = outcome.value[0];
      if (first !== undefined) {
        setStoreId(first.digitalStoreId);
        setLocationId(first.locations[0]?.storeLocationId ?? "");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const selected = stores?.find((s) => s.digitalStoreId === storeId);

  const generate = useCallback(async () => {
    if (storeId === "" || locationId === "") return;
    setBusy(true);
    setProblem(null);
    setRefusal(null);
    // Clear the previous code BEFORE the call: opening a session revokes the
    // last one for this Store, so leaving it on screen would show a code that
    // has already stopped working.
    setIssued(null);
    try {
      const outcome: PairingOutcome<IssuedCode> = await client.issuePairingCode({
        digitalStoreId: storeId,
        storeLocationId: locationId,
      });
      if (outcome.kind === "ok") {
        setIssued(outcome.value);
      } else if (outcome.kind === "refused") {
        // Governed guidance from the door, shown as-is: it names what to fix.
        setRefusal(outcome.message);
      } else {
        setProblem(outcomeMessage(outcome));
      }
    } finally {
      setBusy(false);
    }
  }, [client, storeId, locationId]);

  if (problem !== null) {
    return (
      <section aria-label="pairing-unavailable">
        <h1>{t.title}</h1>
        <p role="alert">{t[problem]}</p>
        <DataSurface state="unavailable" />
      </section>
    );
  }

  if (stores === null) return <DataSurface state="loading" />;

  if (stores.length === 0) {
    // Not an error: a real, actionable state. `DataSurface` stays "unavailable"
    // because there is genuinely nothing to operate on.
    return (
      <section aria-label="no-stores">
        <h1>{t.title}</h1>
        <p>{t.noStores}</p>
        <DataSurface state="unavailable" />
      </section>
    );
  }

  const pairable = selected !== undefined && canIssueFor(selected);

  return (
    <section aria-label="pairing">
      <h1>{t.title}</h1>
      <p>{t.intro}</p>

      <p>
        <label htmlFor="store">{t.store}</label>
        <select
          id="store"
          value={storeId}
          onChange={(e) => {
            setStoreId(e.target.value);
            const next = stores.find((s) => s.digitalStoreId === e.target.value);
            setLocationId(next?.locations[0]?.storeLocationId ?? "");
            // A code belongs to the Store it was opened for; keeping it on screen
            // after switching would attach it to the wrong shop in the reader's head.
            setIssued(null);
          }}
        >
          {stores.map((s) => (
            <option key={s.digitalStoreId} value={s.digitalStoreId}>
              {s.digitalStoreReference}
            </option>
          ))}
        </select>
      </p>

      {selected === undefined || selected.locations.length === 0 ? (
        <p role="alert">{t.noLocation}</p>
      ) : (
        <p>
          <label htmlFor="location">{t.location}</label>
          <select
            id="location"
            value={locationId}
            onChange={(e) => {
              setLocationId(e.target.value);
              setIssued(null);
            }}
          >
            {selected.locations.map((l) => (
              <option key={l.storeLocationId} value={l.storeLocationId}>
                {l.locationReference}
              </option>
            ))}
          </select>
        </p>
      )}

      {refusal === null ? null : <p role="alert">{refusal}</p>}

      <button type="button" onClick={() => void generate()} disabled={busy || !pairable}>
        {busy ? t.generating : t.generate}
      </button>

      {issued === null ? null : <IssuedCodePanel locale={locale} issued={issued} client={client} />}
    </section>
  );
}

export function App() {
  const [locale, setLocale] = useState<KitluyLocale>("km-KH");
  const [signedIn, setSignedIn] = useState(false);

  // Resolved once, and never thrown from: a misconfigured deployment renders the
  // reason rather than a blank page.
  const resolved = useMemo(() => resolvePortalRuntime(import.meta.env), []);

  useEffect(() => {
    if (resolved.kind !== "ready") return;
    let cancelled = false;
    void (async () => {
      const { data } = await resolved.runtime.client.auth.getSession();
      if (!cancelled) setSignedIn(data.session !== null);
    })();
    return () => {
      cancelled = true;
    };
  }, [resolved]);

  return (
    <LocaleProvider locale={locale}>
      <KitluyErrorBoundary>
        <AppShell productName="Partner PWA Portal">
          <nav aria-label="language">
            <button onClick={() => setLocale("km-KH")} aria-pressed={locale === "km-KH"}>
              ខ្មែរ
            </button>{" "}
            <button onClick={() => setLocale("en-US")} aria-pressed={locale === "en-US"}>
              English
            </button>
          </nav>

          {resolved.kind !== "ready" ? (
            <section aria-label="misconfigured">
              <h1>{MESSAGES[locale].title}</h1>
              <p role="alert">{resolved.detail}</p>
              <DataSurface state="unavailable" />
            </section>
          ) : signedIn ? (
            <>
              <PairingView locale={locale} runtime={resolved.runtime} />
              <p>
                <button
                  type="button"
                  onClick={() => {
                    void resolved.runtime.client.auth.signOut().then(() => setSignedIn(false));
                  }}
                >
                  {MESSAGES[locale].signOut}
                </button>
              </p>
            </>
          ) : (
            <SignInForm
              locale={locale}
              runtime={resolved.runtime}
              onSignedIn={() => setSignedIn(true)}
            />
          )}
        </AppShell>
      </KitluyErrorBoundary>
    </LocaleProvider>
  );
}
