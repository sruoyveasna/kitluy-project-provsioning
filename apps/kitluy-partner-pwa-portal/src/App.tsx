/**
 * Partner PWA Portal — shell, sign-in, Store navigation and routing.
 *
 * Two screens per Store, addressed by the hash (`routing.ts`): the Store Hub
 * pairing tab (`hub-screen.tsx`) and Provisioning → Terminals
 * (`terminals-screen.tsx`). The Stores a Partner holds are loaded once after
 * sign-in and never re-derived in the browser: the Management API decides them
 * from the actor's own assignments.
 *
 * The chrome is the shared `@kitluy/web-ui` AppShell: a left sidebar (the Store
 * switcher and the two tabs), a sticky top bar (language and theme toggles) and
 * the content area. The sidebar nav is per-Store and therefore lives inside
 * `SignedIn`, where the Stores are known.
 *
 * Nothing about a one-time code lives here. Each screen keeps its code in its
 * own state and the code never reaches the hash, storage or a log.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { KitluyLocale } from "@kitluy/localization";
import {
  AppShell,
  DataSurface,
  KitluyErrorBoundary,
  LocaleProvider,
  LocaleToggle,
  ThemeToggle,
  restoreKitluyTheme,
} from "@kitluy/web-ui";

import { resolvePortalRuntime, type PortalRuntime } from "./config.js";
import { HubPairingScreen, outcomeMessage } from "./hub-screen.js";
import { MESSAGES, type MessageKey } from "./messages.js";
import { createPairingClient, type PartnerStore } from "./pairing-client.js";
import { parseRoute, routeHref, storeRoute, type Route } from "./routing.js";
import { classifySignInError, validateCredentials, FAILURE_MESSAGE } from "./sign-in.js";
import { TerminalsScreen } from "./terminals-screen.js";
import { createTerminalsClient } from "./terminals-client.js";
import { NoticePanel, StoreNav } from "./views.js";

export const PRODUCT_NAME = "kitluy-partner-pwa-portal" as const;

const SHELL_PRODUCT = "Partner Portal" as const;

function currentHash(): string {
  return typeof window === "undefined" ? "" : window.location.hash;
}

/** The language and theme toggles, shared by every top bar. */
function Toggles({
  locale,
  onLocale,
}: {
  locale: KitluyLocale;
  onLocale: (locale: KitluyLocale) => void;
}): JSX.Element {
  return (
    <>
      <LocaleToggle locale={locale} onLocale={onLocale} />
      <ThemeToggle />
    </>
  );
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
    <section aria-label="sign-in" className="kl-login">
      <div className="kl-card" style={{ width: "100%", maxWidth: 420 }}>
        <div className="kl-card-body">
          <div className="kl-page-head">
            <h1>{t.portalTitle}</h1>
            <p>{t.signInIntro}</p>
          </div>
          <form aria-label="sign-in" onSubmit={submit}>
            <div className="kl-field">
              <label htmlFor="email">{t.email}</label>
              <input
                className="kl-input"
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="kl-field">
              <label htmlFor="password">{t.password}</label>
              <input
                className="kl-input"
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {failure === null ? null : (
              <div className="kl-notice kl-notice-critical" role="alert">
                <span>{t[failure]}</span>
              </div>
            )}
            <button className="kl-btn kl-btn-primary" type="submit" disabled={busy}>
              {busy ? t.signingIn : t.signIn}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

type StoresState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly stores: readonly PartnerStore[] }
  | { readonly kind: "problem"; readonly messageKey: MessageKey };

function SignedIn({
  locale,
  runtime,
  toggles,
  onSignOut,
}: {
  locale: KitluyLocale;
  runtime: PortalRuntime;
  toggles: ReactNode;
  onSignOut: () => void;
}) {
  const t = MESSAGES[locale];
  // Both clients over one transport; each keeps its own contract.
  const pairingClient = useMemo(
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
  const terminalsClient = useMemo(
    () =>
      createTerminalsClient({
        baseUrl: runtime.managementApiUrl,
        accessToken: async () => {
          const { data } = await runtime.client.auth.getSession();
          return data.session?.access_token ?? null;
        },
      }),
    [runtime],
  );

  const [route, setRoute] = useState<Route>(() => parseRoute(currentHash()));
  const [stores, setStores] = useState<StoresState>({ kind: "loading" });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHash = () => setRoute(parseRoute(currentHash()));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const outcome = await pairingClient.listStores();
      if (cancelled) return;
      if (outcome.kind === "ok") setStores({ kind: "ready", stores: outcome.value });
      else setStores({ kind: "problem", messageKey: outcomeMessage(outcome) });
    })();
    return () => {
      cancelled = true;
    };
  }, [pairingClient]);

  // `#/` lands on the first Store's Hub tab once the Stores are known.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (route.kind !== "home" || stores.kind !== "ready") return;
    const first = stores.stores[0];
    if (first !== undefined) {
      window.location.hash = routeHref(storeRoute("hub", first.digitalStoreId)).slice(1);
    }
  }, [route, stores]);

  const navigate = useCallback(
    (storeId: string) => {
      if (typeof window === "undefined") return;
      const tab = route.kind === "terminals" ? "terminals" : "hub";
      window.location.hash = routeHref(storeRoute(tab, storeId)).slice(1);
    },
    [route],
  );

  const account = (
    <div className="kl-who">
      <button
        type="button"
        className="kl-btn kl-btn-ghost kl-btn-sm"
        style={{ width: "100%" }}
        onClick={onSignOut}
      >
        {t.signOut}
      </button>
    </div>
  );

  // All hooks are called above; only the body and the sidebar nav vary below.
  let nav: ReactNode = undefined;
  let crumb: ReactNode = undefined;
  let body: ReactNode;

  if (stores.kind === "loading") {
    body = <DataSurface state="loading" />;
  } else if (stores.kind === "problem") {
    body = (
      <section aria-label="pairing-unavailable">
        <div className="kl-page-head">
          <h1>{t.portalTitle}</h1>
        </div>
        <p role="alert" className="kl-notice kl-notice-critical">
          <span>{t[stores.messageKey]}</span>
        </p>
        <DataSurface state="unavailable" />
      </section>
    );
  } else if (stores.stores.length === 0) {
    body = (
      <section aria-label="no-stores">
        <div className="kl-page-head">
          <h1>{t.portalTitle}</h1>
          <p>{t.noStores}</p>
        </div>
        <DataSurface state="unavailable" />
      </section>
    );
  } else if (route.kind === "home") {
    body = <DataSurface state="loading" />;
  } else if (route.kind === "unknown") {
    body = <NoticePanel locale={locale} messageKey="unknownRoute" detail={route.path} />;
  } else {
    const store = stores.stores.find((s) => s.digitalStoreId === route.storeId);
    if (store === undefined) {
      body = <NoticePanel locale={locale} messageKey="denied" />;
    } else {
      nav = (
        <StoreNav
          locale={locale}
          stores={stores.stores}
          storeId={store.digitalStoreId}
          tab={route.kind}
          onStore={navigate}
        />
      );
      crumb = (
        <>
          <span>{store.digitalStoreReference}</span>
          <span className="kl-cur">{route.kind === "hub" ? t.navHub : t.navTerminals}</span>
        </>
      );
      body =
        route.kind === "hub" ? (
          <HubPairingScreen
            key={store.digitalStoreId}
            locale={locale}
            client={pairingClient}
            store={store}
          />
        ) : (
          <TerminalsScreen
            key={store.digitalStoreId}
            locale={locale}
            client={terminalsClient}
            store={store}
          />
        );
    }
  }

  return (
    <AppShell
      productName={SHELL_PRODUCT}
      brandInitial="P"
      nav={nav}
      account={account}
      topbarRight={toggles}
      crumb={crumb}
    >
      {body}
    </AppShell>
  );
}

export function App() {
  const [locale, setLocale] = useState<KitluyLocale>("km-KH");
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    restoreKitluyTheme();
  }, []);

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

  const toggles = <Toggles locale={locale} onLocale={setLocale} />;

  return (
    <LocaleProvider locale={locale}>
      <KitluyErrorBoundary>
        {resolved.kind !== "ready" ? (
          <AppShell productName={SHELL_PRODUCT} brandInitial="P" topbarRight={toggles}>
            <section aria-label="misconfigured">
              <div className="kl-page-head">
                <h1>{MESSAGES[locale].portalTitle}</h1>
              </div>
              <p role="alert" className="kl-notice kl-notice-critical">
                <span>{resolved.detail}</span>
              </p>
              <DataSurface state="unavailable" />
            </section>
          </AppShell>
        ) : signedIn ? (
          <SignedIn
            locale={locale}
            runtime={resolved.runtime}
            toggles={toggles}
            onSignOut={() => {
              void resolved.runtime.client.auth.signOut().then(() => {
                setSignedIn(false);
                if (typeof window !== "undefined") window.location.hash = "/";
              });
            }}
          />
        ) : (
          <AppShell productName={SHELL_PRODUCT} brandInitial="P" topbarRight={toggles}>
            <SignInForm
              locale={locale}
              runtime={resolved.runtime}
              onSignedIn={() => setSignedIn(true)}
            />
          </AppShell>
        )}
      </KitluyErrorBoundary>
    </LocaleProvider>
  );
}
