/**
 * @kitluy/supabase-client — the ONE canonical Supabase browser client.
 *
 * Source authority: infrastructure spec v1.0.0 §4.2 (production credentials
 * never in local/dev clients); CLAUDE.md hard rule 4 (never expose secrets)
 * and hard rule 7 (frontend visibility is not authorization).
 *
 * ===========================================================================
 * WHY THIS PACKAGE EXISTS
 * ===========================================================================
 * Every portal that talks to Supabase must go through here. If each app built
 * its own client, each app would independently decide which credential to use,
 * and it only takes one app reading a server key from the wrong environment
 * variable to put an RLS-bypassing credential into a browser bundle. One
 * factory means one place to enforce that, and one place to audit.
 *
 * ===========================================================================
 * THE ONLY CREDENTIAL A BROWSER MAY HOLD
 * ===========================================================================
 * A publishable/anon key. It is designed to be public and carries no
 * authority on its own: the caller's authority comes from the end user's
 * Supabase Auth JWT, and every row it can reach is decided by RLS.
 *
 * `createKitluyBrowserClient` REFUSES anything that looks privileged — a
 * `service_role` JWT, an `sb_secret_` key, or a database password. That
 * refusal is the point of the factory, not a nicety: it converts the most
 * expensive possible configuration mistake into a startup error.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class SupabaseClientConfigError extends Error {
  constructor(
    readonly variable: string,
    message: string,
  ) {
    super(message);
    this.name = "SupabaseClientConfigError";
  }
}

export interface KitluyBrowserClientConfig {
  /** e.g. https://<ref>.supabase.co — public, safe in a bundle. */
  readonly url: string;
  /** Publishable/anon key ONLY. Never a server or database credential. */
  readonly publishableKey: string;
  /**
   * Permit an http LOOPBACK url, for a local Supabase stack.
   *
   * A hosted `*.supabase.co` URL is the only thing accepted otherwise, and
   * that is right for anything shipped. But it also made a local stack
   * unusable, so a developer could not point the portal at the database their
   * own devices enrol into — which is precisely where a device is watched.
   *
   * Callers pass `import.meta.env.DEV`, which Vite replaces with `false` at
   * build time. The exemption therefore cannot exist in a built bundle: it is
   * removed by the bundler, not merely unset at runtime.
   *
   * Loopback only. `http://anything-else` stays refused with the flag on,
   * because the reason this is safe is that the traffic never leaves the
   * machine — not that the developer meant well.
   */
  readonly allowLoopbackHttp?: boolean;
}

/** A local Supabase stack: http, and a host that is unambiguously this machine. */
function isLoopbackHttpUrl(url: string): boolean {
  return /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i.test(url);
}

/**
 * Credential shapes that must never reach a browser.
 *
 * `service_role` is matched on the DECODED JWT payload rather than the raw
 * string, because the role lives in the base64 payload and a substring scan of
 * the token would miss it.
 */
const PRIVILEGED_PREFIXES = ["sb_secret_", "sbp_"] as const;

function looksLikeJwt(value: string): boolean {
  return value.split(".").length === 3 && value.startsWith("eyJ");
}

function decodedJwtRole(value: string): string | null {
  const payload = value.split(".")[1];
  if (payload === undefined) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as { role?: unknown };
    return typeof claims.role === "string" ? claims.role : null;
  } catch {
    return null;
  }
}

/**
 * Reject any credential a browser must not hold.
 *
 * Exported so a bundle-audit test can assert the rule directly rather than
 * re-deriving it.
 */
export function assertBrowserSafeCredential(key: string, variable: string): void {
  if (key.trim() === "") {
    throw new SupabaseClientConfigError(variable, `${variable} is empty`);
  }

  for (const prefix of PRIVILEGED_PREFIXES) {
    if (key.startsWith(prefix)) {
      throw new SupabaseClientConfigError(
        variable,
        `${variable} holds a privileged '${prefix}…' credential; a browser may only use a publishable key`,
      );
    }
  }

  if (looksLikeJwt(key)) {
    const role = decodedJwtRole(key);
    if (role !== null && role !== "anon") {
      throw new SupabaseClientConfigError(
        variable,
        `${variable} holds a '${role}' JWT; a browser may only use a publishable key`,
      );
    }
  }

  // A Supabase database password is neither a JWT nor a publishable key. This
  // catches the paste-the-wrong-value mistake rather than trusting the name.
  if (!looksLikeJwt(key) && !key.startsWith("sb_publishable_")) {
    throw new SupabaseClientConfigError(
      variable,
      `${variable} is not a recognised publishable key or anon JWT; refusing to build a client with an unidentified credential`,
    );
  }
}

/**
 * Build the canonical browser client.
 *
 * The session is persisted and auto-refreshed so a signed-in Admin survives a
 * reload; every request carries the user's JWT and is authorised by RLS.
 */
export function createKitluyBrowserClient(config: KitluyBrowserClientConfig): SupabaseClient {
  const hostedProject = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(config.url);
  const localStack = config.allowLoopbackHttp === true && isLoopbackHttpUrl(config.url);
  if (!hostedProject && !localStack) {
    throw new SupabaseClientConfigError(
      "SUPABASE_URL",
      "SUPABASE_URL must be an https Supabase project URL",
    );
  }
  assertBrowserSafeCredential(config.publishableKey, "SUPABASE_PUBLISHABLE_KEY");

  return createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export type { SupabaseClient };
export * from "./admin-authorization.js";
