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
import { AppShell, DataSurface, KitluyErrorBoundary, LocaleProvider } from "@kitluy/web-ui";

import { resolvePortalRuntime, type PortalRuntime } from "./config.js";
import { MESSAGES, type MessageKey } from "./messages.js";
import {
  createPairingClient,
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
function IssuedCodePanel({ locale, issued }: { locale: KitluyLocale; issued: IssuedCode }) {
  const t = MESSAGES[locale];
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const life = codeLife(issued.expiresAt, now);

  return (
    <section aria-label="pairing-code">
      <h2>{t.codeHeading}</h2>
      {life.kind === "expired" ? (
        <p role="alert">{t.expired}</p>
      ) : (
        <>
          {/* `aria-label` carries the ungrouped code so a screen reader does not
              announce the display gap as part of what to type. */}
          <p aria-label={issued.code}>
            <strong style={{ fontSize: "2rem", letterSpacing: "0.15em" }}>
              {groupCode(issued.code)}
            </strong>
          </p>
          <p>
            {t.expiresIn} <time>{life.label}</time>
          </p>
        </>
      )}
      <p>
        <em>{t.shownOnce}</em>
      </p>
      <p>
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

      {issued === null ? null : <IssuedCodePanel locale={locale} issued={issued} />}
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
