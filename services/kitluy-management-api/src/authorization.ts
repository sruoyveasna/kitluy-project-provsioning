/**
 * Management API authorization boundary.
 *
 * Owner decision OD-ADMIN-FLEET-001 (2026-08-10): `kitluy_devices` stays closed
 * to browsers. This module is the boundary that replaces direct browser access.
 *
 * ===========================================================================
 * TWO IDENTITIES, NEVER CONFLATED
 * ===========================================================================
 *   CALLER identity      the end user's Supabase JWT. Decides WHAT is allowed.
 *   INFRASTRUCTURE identity  the server's database credential. Decides nothing;
 *                            it only makes the read physically possible.
 *
 * The database credential is authority to CONNECT, not authority to ACT. Every
 * authorization answer comes from canonical database state evaluated for the
 * caller — never from a claim, header or request field the browser supplied.
 * A request that says `{"role":"admin","permission":"fleet.read"}` is treated
 * as data, not as authority.
 *
 * ===========================================================================
 * THE CANONICAL EVALUATOR IS THE DATABASE
 * ===========================================================================
 * Authorization is decided by `kitluy_auth.has_permission(...)`, executed as
 * the `authenticated` role with the caller's subject claim — exactly the
 * conditions RLS would see. RBAC rules are NOT reimplemented here, so the API
 * and the database cannot drift into disagreeing about who may do what.
 */

/** Minimal query port — satisfied by `pg.Pool`, `pg.Client`, or a fake. */
export interface DatabaseHandle {
  query<R = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

/** Validates a Supabase access token and returns its subject. */
export interface TokenVerifier {
  verify(accessToken: string): Promise<{ userId: string } | null>;
}

export type AuthorizationOutcome =
  | { readonly kind: "allow"; readonly userId: string; readonly permissions: readonly string[] }
  | {
      readonly kind: "deny";
      readonly status: 401 | 403;
      readonly code: string;
      readonly detail: string;
    };

/**
 * Verify a Supabase access token by asking Supabase.
 *
 * Deliberately NOT local signature verification: that needs the project's JWT
 * secret on every service, and a service holding it can mint tokens as anyone.
 * Asking the auth server also honours revocation and user deletion, which a
 * signature check cannot see.
 */
export function createSupabaseTokenVerifier(config: {
  readonly url: string;
  readonly publishableKey: string;
  readonly fetchImpl?: typeof fetch;
}): TokenVerifier {
  const doFetch = config.fetchImpl ?? fetch;
  return {
    async verify(accessToken) {
      if (accessToken.trim() === "") return null;
      let response: Response;
      try {
        response = await doFetch(`${config.url}/auth/v1/user`, {
          headers: {
            apikey: config.publishableKey,
            Authorization: `Bearer ${accessToken}`,
          },
        });
      } catch {
        // Auth server unreachable: refuse rather than fail open.
        return null;
      }
      if (!response.ok) return null;
      const body = (await response.json()) as { id?: unknown };
      return typeof body.id === "string" && body.id !== "" ? { userId: body.id } : null;
    },
  };
}

/** Extract a bearer token. Returns null for anything malformed. */
export function bearerToken(authorizationHeader: string | undefined): string | null {
  if (authorizationHeader === undefined) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match?.[1]?.trim() ?? null;
}

interface AdminRow {
  profile_status: string | null;
  disabled_at: string | null;
  permitted: boolean | null;
  permissions: string[] | null;
}

/**
 * Resolve the caller's authority for one required permission.
 *
 * Runs inside a transaction as the `authenticated` role with the caller's
 * subject claim, so `has_permission` and every RLS policy see precisely what
 * they would see for that user in a browser session. The transaction is always
 * rolled back — this reads, it never writes.
 *
 * `requiredPermission` may be null to mean "is this a usable Admin at all",
 * which is what the session endpoint asks.
 */
export async function authorizeRequest(
  db: DatabaseHandle,
  verifier: TokenVerifier,
  authorizationHeader: string | undefined,
  requiredPermission: string | null,
): Promise<AuthorizationOutcome> {
  const token = bearerToken(authorizationHeader);
  if (token === null) {
    return {
      kind: "deny",
      status: 401,
      code: "KLUY-AUTH-MISSING-TOKEN",
      detail: "missing bearer token",
    };
  }

  const verified = await verifier.verify(token);
  if (verified === null) {
    return {
      kind: "deny",
      status: 401,
      code: "KLUY-AUTH-INVALID-TOKEN",
      detail: "token is not valid",
    };
  }

  let rows: AdminRow[];
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [verified.userId]);
    await db.query(
      "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
      [verified.userId],
    );
    await db.query("set local role authenticated");

    const result = await db.query<AdminRow>(
      `select p.status                                   as profile_status,
              p.disabled_at::text                        as disabled_at,
              case when $2::text is null then true
                   else kitluy_auth.has_permission($2::text) end as permitted,
              (select array_agg(distinct perm.permission_key order by perm.permission_key)
                 from kitluy_auth.role_assignments ra
                 join kitluy_auth.role_permission_grants g on g.role_template_id = ra.role_template_id
                 join kitluy_auth.permissions perm on perm.id = g.permission_id
                where ra.subject_id = $1::uuid
                  and ra.status = 'ACTIVE'
                  and g.effect = 'ALLOW'
                  and (ra.valid_from is null or ra.valid_from <= now())
                  and (ra.valid_to is null or ra.valid_to > now())) as permissions
         from kitluy_auth.admin_user_profiles p
        where p.user_id = $1::uuid`,
      [verified.userId, requiredPermission],
    );
    rows = result.rows;
  } finally {
    // Always release the assumed role and discard the transaction.
    await db.query("rollback").catch(() => undefined);
  }

  const row = rows[0];
  if (row === undefined) {
    // Authenticated, but not an Admin at all. 403, not 401: the token was fine.
    return {
      kind: "deny",
      status: 403,
      code: "KLUY-ADMIN-NOT-PROVISIONED",
      detail: "authenticated user has no Admin profile",
    };
  }
  if (row.disabled_at !== null) {
    return {
      kind: "deny",
      status: 403,
      code: "KLUY-ADMIN-DISABLED",
      detail: "Admin profile is disabled",
    };
  }
  if (row.profile_status !== "ACTIVE") {
    return {
      kind: "deny",
      status: 403,
      code: "KLUY-ADMIN-INACTIVE",
      detail: `Admin profile status is '${row.profile_status ?? "unknown"}'`,
    };
  }
  if (row.permitted !== true) {
    return {
      kind: "deny",
      status: 403,
      code: "KLUY-PERMISSION-DENIED",
      detail: `missing permission '${requiredPermission ?? ""}'`,
    };
  }

  return { kind: "allow", userId: verified.userId, permissions: row.permissions ?? [] };
}

/**
 * Canonical permission keys this service enforces.
 *
 * `FLEET_PROVISIONING_ISSUE` reuses the key migration 0163 already created.
 * A second provisioning key was deliberately not minted: two keys for one
 * authority drift apart, and revoking one would silently leave the other.
 */
export const PERMISSION = {
  FLEET_READ: "fleet.read",
  FLEET_PROVISIONING_ISSUE: "fleet.device_provisioning_code.issue",
} as const;
