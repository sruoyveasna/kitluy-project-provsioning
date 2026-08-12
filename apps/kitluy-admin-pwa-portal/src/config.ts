/**
 * Browser runtime configuration.
 *
 * Authority: infrastructure spec v1.0.0 §4.2 (production credentials never in
 * local/dev clients); CLAUDE.md hard rule 4.
 *
 * Only three values reach the bundle, and all three are public by design: the
 * project URL, the publishable key, and the Management API base URL. There is
 * deliberately no code path here that could read a service credential — the
 * client factory refuses one anyway, but the shortest way to guarantee a secret
 * is not in a bundle is to give the bundle no name to read it from.
 *
 * Resolution is a FUNCTION, not module-level state: a portal that throws while
 * its module graph is loading shows a blank page, whereas a portal that throws
 * when asked can render "this deployment is not configured" — which is the
 * difference between an outage and a diagnosable one.
 */
import { createKitluyBrowserClient, type SupabaseClient } from "@kitluy/supabase-client";

export interface PortalConfig {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
  /** Origin of the governed Management API, e.g. http://localhost:8787. */
  readonly managementApiUrl: string;
}

export class PortalConfigError extends Error {
  constructor(
    readonly variable: string,
    message: string,
  ) {
    super(message);
    this.name = "PortalConfigError";
  }
}

/** Vite exposes only `VITE_`-prefixed variables to the bundle. */
export type BrowserEnv = Readonly<Record<string, string | undefined>>;

export function readPortalConfig(env: BrowserEnv): PortalConfig {
  const required = (name: string): string => {
    const value = env[name];
    if (value === undefined || value.trim() === "") {
      throw new PortalConfigError(name, `${name} is not set for this deployment.`);
    }
    return value.trim();
  };
  return {
    supabaseUrl: required("VITE_KITLUY_SUPABASE_URL"),
    publishableKey: required("VITE_KITLUY_SUPABASE_PUBLISHABLE_KEY"),
    managementApiUrl: required("VITE_KITLUY_MANAGEMENT_API_URL").replace(/\/+$/, ""),
  };
}

export interface PortalRuntime {
  readonly client: SupabaseClient;
  readonly managementApiUrl: string;
}

/**
 * Build the portal runtime, or explain why it cannot be built.
 *
 * Never throws: the caller renders the reason. `createKitluyBrowserClient` is
 * the one place allowed to construct a client, so a privileged credential
 * pasted into the publishable slot fails HERE, at startup, rather than becoming
 * an RLS-bypassing credential inside a browser bundle.
 */
export function resolvePortalRuntime(
  env: BrowserEnv,
): { kind: "ready"; runtime: PortalRuntime } | { kind: "misconfigured"; detail: string } {
  try {
    const config = readPortalConfig(env);
    return {
      kind: "ready",
      runtime: {
        client: createKitluyBrowserClient({
          url: config.supabaseUrl,
          publishableKey: config.publishableKey,
        }),
        managementApiUrl: config.managementApiUrl,
      },
    };
  } catch (error) {
    return {
      kind: "misconfigured",
      detail: error instanceof Error ? error.message : "configuration could not be read",
    };
  }
}
