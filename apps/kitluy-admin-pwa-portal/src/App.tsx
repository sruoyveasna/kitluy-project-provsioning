/**
 * Admin PWA Portal — application shell and route guard.
 *
 * Source spec: kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md. Owner decision
 * OD-ADMIN-FLEET-001: device relations are CLOSED to browsers, so every fleet
 * read in this portal goes through the governed Management API — there is no
 * direct device query anywhere in this application, and adding one would be
 * refused by the database.
 *
 * ===========================================================================
 * WHAT THE GUARD IS, AND WHAT IT IS NOT
 * ===========================================================================
 * A session proves authentication. Entry to the control plane is a separate
 * question, answered by `GET /management/v1/me` against canonical database
 * state. This component renders that answer; it never computes it. Hiding a
 * link is not authorization (CLAUDE.md hard rule 7) — a person who edits the
 * hash into `#/devices` still reads nothing, because the API decides again.
 */
import { useCallback, useEffect, useState } from "react";
import type { KitluyLocale } from "@kitluy/localization";
import { AppShell, DataSurface, KitluyErrorBoundary, LocaleProvider } from "@kitluy/web-ui";
import { resolveAccess, type AccessState } from "./access.js";
import { resolvePortalRuntime, type BrowserEnv, type PortalRuntime } from "./config.js";
import {
  createManagementClient,
  type DeviceDetail,
  type FleetPage,
  type ManagementClient,
  type ManagementOutcome,
} from "./management-client.js";
import { MESSAGES, t, type MessageKey } from "./messages.js";
import { DEFAULT_ROUTE, parseRoute, routeHref, type Route } from "./routing.js";
import { classifySignInError, validateCredentials, type SignInState } from "./sign-in.js";
import { AdminNav, DeviceDetailView, DeviceListView, LoginView, NoticePanel } from "./views.js";

export const PRODUCT_NAME = "kitluy-admin-pwa-portal" as const;
export { MESSAGES };

/** Vite injects `import.meta.env`; a non-browser host simply has none. */
function browserEnv(): BrowserEnv {
  return (import.meta as unknown as { env?: BrowserEnv }).env ?? {};
}

function currentHash(): string {
  return typeof window === "undefined" ? "" : window.location.hash;
}

type Loadable<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: T }
  | { readonly kind: "problem"; readonly messageKey: MessageKey; readonly detail?: string };

export function App(): JSX.Element {
  const [locale, setLocale] = useState<KitluyLocale>("km-KH");
  const [config] = useState(() => resolvePortalRuntime(browserEnv()));
  const [route, setRoute] = useState<Route>(() =>
    typeof window === "undefined" ? DEFAULT_ROUTE : parseRoute(currentHash()),
  );
  const [access, setAccess] = useState<AccessState>({ kind: "checking" });
  const [signIn, setSignIn] = useState<SignInState>({ kind: "idle" });
  const [fleet, setFleet] = useState<Loadable<FleetPage>>({ kind: "loading" });
  const [detail, setDetail] = useState<Loadable<DeviceDetail>>({ kind: "loading" });

  const runtime: PortalRuntime | null = config.kind === "ready" ? config.runtime : null;

  const api: ManagementClient | null = useState<ManagementClient | null>(() =>
    runtime === null
      ? null
      : createManagementClient({
          baseUrl: runtime.managementApiUrl,
          // Read on every call so a refreshed token is used and a signed-out
          // session cannot leave a stale one behind.
          accessToken: async () => {
            const { data } = await runtime.client.auth.getSession();
            return data.session?.access_token ?? null;
          },
        }),
  )[0];

  // ---- routing ------------------------------------------------------------
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHashChange = (): void => setRoute(parseRoute(currentHash()));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // ---- session restore + guard -------------------------------------------
  const checkAccess = useCallback(async (): Promise<void> => {
    if (api === null) return;
    setAccess({ kind: "checking" });
    setAccess(resolveAccess(await api.getCurrentAdmin()));
  }, [api]);

  useEffect(() => {
    if (runtime === null) return;
    void checkAccess();
    // Re-evaluate whenever the session itself changes: a token refresh, a
    // sign-out in another tab, or a revoked session must all re-ask the API
    // rather than leave a granted screen on display.
    const { data } = runtime.client.auth.onAuthStateChange(() => {
      void checkAccess();
    });
    return () => data.subscription.unsubscribe();
  }, [runtime, checkAccess]);

  // ---- data ---------------------------------------------------------------
  const handleOutcome = useCallback(<T,>(outcome: ManagementOutcome<T>): Loadable<T> => {
    switch (outcome.kind) {
      case "ok":
        return { kind: "ready", value: outcome.value };
      case "unauthenticated":
        setAccess({ kind: "signed_out", messageKey: "sessionExpired" });
        return { kind: "problem", messageKey: "sessionExpired" };
      case "denied":
        return { kind: "problem", messageKey: "accessRefused" };
      case "not_found":
        return { kind: "problem", messageKey: "noDevices" };
      case "unavailable":
        return { kind: "problem", messageKey: "serviceUnavailable", detail: outcome.detail };
    }
  }, []);

  useEffect(() => {
    if (api === null || access.kind !== "granted" || route.kind !== "devices") return;
    let live = true;
    setFleet({ kind: "loading" });
    void api.listDevices().then((outcome) => {
      if (live) setFleet(handleOutcome(outcome));
    });
    return () => {
      live = false;
    };
  }, [api, access.kind, route.kind, handleOutcome]);

  const deviceId = route.kind === "device" ? route.deviceId : null;
  useEffect(() => {
    if (api === null || access.kind !== "granted" || deviceId === null) return;
    let live = true;
    setDetail({ kind: "loading" });
    void api.getDevice(deviceId).then((outcome) => {
      if (live) setDetail(handleOutcome(outcome));
    });
    return () => {
      live = false;
    };
  }, [api, access.kind, deviceId, handleOutcome]);

  // ---- actions ------------------------------------------------------------
  const onSubmit = useCallback(
    (email: string, password: string): void => {
      if (runtime === null) return;
      const invalid = validateCredentials(email, password);
      if (invalid !== null) {
        setSignIn({ kind: "failed", failure: invalid });
        return;
      }
      setSignIn({ kind: "submitting" });
      void runtime.client.auth
        .signInWithPassword({ email: email.trim(), password })
        .then(({ error }) => {
          if (error !== null) {
            setSignIn({ kind: "failed", failure: classifySignInError(error) });
            return;
          }
          setSignIn({ kind: "idle" });
          if (typeof window !== "undefined") {
            window.location.hash = routeHref({ kind: "devices" }).slice(1);
          }
          void checkAccess();
        })
        .catch((error: unknown) => {
          setSignIn({ kind: "failed", failure: classifySignInError(error) });
        });
    },
    [runtime, checkAccess],
  );

  const onSignOut = useCallback((): void => {
    if (runtime === null) return;
    void runtime.client.auth.signOut().finally(() => {
      setAccess({ kind: "signed_out", messageKey: "signedOut" });
      setFleet({ kind: "loading" });
      if (typeof window !== "undefined") window.location.hash = "/login";
    });
  }, [runtime]);

  // ---- render -------------------------------------------------------------
  return (
    <LocaleProvider locale={locale}>
      <KitluyErrorBoundary>
        <AppShell productName="Admin PWA Portal">
          <AdminNav locale={locale} access={access} onSignOut={onSignOut} onLocale={setLocale} />
          {renderBody()}
        </AppShell>
      </KitluyErrorBoundary>
    </LocaleProvider>
  );

  function renderBody(): JSX.Element {
    if (config.kind === "misconfigured") {
      // Fail closed and say why. A control plane that renders an empty frame
      // when it cannot be configured teaches operators to ignore empty frames.
      return <NoticePanel locale={locale} messageKey="notConfigured" detail={config.detail} />;
    }

    if (access.kind === "checking") {
      return <DataSurface state="loading" />;
    }

    if (access.kind === "unavailable") {
      return <NoticePanel locale={locale} messageKey="serviceUnavailable" detail={access.detail} />;
    }

    if (access.kind === "refused") {
      // Signed in, but not permitted. This is NOT a retry: showing a sign-in
      // form here would invite someone to type their password again for a
      // problem no password fixes.
      return <NoticePanel locale={locale} messageKey={access.messageKey} />;
    }

    if (access.kind === "signed_out") {
      return (
        <LoginView
          locale={locale}
          state={signIn}
          notice={signIn.kind === "idle" ? access.messageKey : undefined}
          onSubmit={onSubmit}
        />
      );
    }

    if (route.kind === "login") {
      // Already granted; the login route has nothing to offer.
      return <DeviceListLoader locale={locale} fleet={fleet} />;
    }

    if (route.kind === "device") {
      if (detail.kind === "loading") return <DataSurface state="loading" />;
      if (detail.kind === "problem") {
        return (
          <NoticePanel locale={locale} messageKey={detail.messageKey} detail={detail.detail} />
        );
      }
      return <DeviceDetailView locale={locale} detail={detail.value} />;
    }

    if (route.kind === "unknown") {
      return <NoticePanel locale={locale} messageKey="noDevices" detail={route.path} />;
    }

    return <DeviceListLoader locale={locale} fleet={fleet} />;
  }
}

function DeviceListLoader(props: {
  locale: KitluyLocale;
  fleet: Loadable<FleetPage>;
}): JSX.Element {
  if (props.fleet.kind === "loading") return <DataSurface state="loading" />;
  if (props.fleet.kind === "problem") {
    return (
      <NoticePanel
        locale={props.locale}
        messageKey={props.fleet.messageKey}
        detail={props.fleet.detail}
      />
    );
  }
  return <DeviceListView locale={props.locale} page={props.fleet.value} />;
}

/** Re-exported so a test can assert the vocabulary without importing internals. */
export { t };
