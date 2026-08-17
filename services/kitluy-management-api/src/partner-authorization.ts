/**
 * Authorizing a PARTNER actor — Digital Store staff, not an HET Admin.
 *
 * Authority: KLD-2026-08-13-HUB-PAIRING-ROUTE-001; migration group 0193 (the
 * `fleet.hub_pairing_code.issue` permission and its grant to
 * `DIGITAL_STORE_STAFF`).
 *
 * ===========================================================================
 * WHY `authorizeRequest` COULD NOT BE REUSED
 * ===========================================================================
 * That function is admin-only by construction. Its query ends
 *
 *     from kitluy_auth.admin_user_profiles p where p.user_id = $1::uuid
 *
 * and a caller with no row there is refused 403 — "Authenticated, but not an
 * Admin at all". A Partner is exactly that caller: authenticated, legitimately
 * authorized for their own Store, and holding no HET admin profile.
 *
 * `kitluy_auth.has_permission` is deliberately compatible with this: it denies a
 * DISABLED admin profile but, in its own words, "absence of an HET profile does
 * not" deny. So partner authority resolves entirely through
 * `role_assignments` + `assignment_scopes`, which is what the RBAC model always
 * intended — `DIGITAL_STORE_STAFF` and `STORE_LOCATION_STAFF` are seeded role
 * templates, and `assignment_scopes.scope_type` already carries `digital_store`.
 *
 * ===========================================================================
 * WHY THE SCOPE IS CHECKED SEPARATELY, AND THIS IS THE IMPORTANT PART
 * ===========================================================================
 * `has_permission(key, resource_type, resource_id, environment)` LOOKS like it
 * binds a permission to a resource. It does not. Read its body: `p_resource_type`
 * and `p_resource_id` appear once each — in the signature — and `scope_type` /
 * `scope_id` appear nowhere. Only `environment` is gated.
 *
 * So a caller that passed `('fleet.hub_pairing_code.issue', 'digital_store',
 * someOtherStore, 'development')` and trusted the answer would authorize issuing
 * a pairing code for a Store the actor has no assignment to.
 *
 * The existing RLS policies in group 0095 are NOT exposed by this, because they
 * pair the call with a real scope conjunct —
 * `store_location_id = any (kitluy_auth.current_location_ids())` — which does the
 * row binding. That is the pattern this file follows: ask `has_permission` for the
 * PERMISSION, and ask the canonical scope helper for the SCOPE. Two questions,
 * both answered against the caller's own `auth.uid()`.
 *
 * ===========================================================================
 * HOW THE ACTOR IDENTITY IS ESTABLISHED
 * ===========================================================================
 * Identically to `authorizeRequest`, and for the same reason: both halves are
 * transaction-local. `request.jwt.claims` is what `auth.uid()` resolves from, and
 * `set local role authenticated` drops the connecting service identity for the
 * duration — so a governed check cannot be satisfied by the API's own privileges.
 */
import { bearerToken, type DatabaseHandle, type TokenVerifier } from "./authorization.js";

/** The scope a partner action is being attempted against. */
export interface PartnerScope {
  readonly digitalStoreId: string;
}

export type PartnerAuthorizationOutcome =
  | {
      readonly kind: "allow";
      readonly userId: string;
      /** Every Digital Store this actor may act in. Server-resolved. */
      readonly digitalStoreIds: readonly string[];
    }
  | {
      readonly kind: "deny";
      readonly status: number;
      readonly code: string;
      readonly detail: string;
    };

interface ScopeRow {
  permitted: boolean | null;
  digital_store_ids: string[] | null;
  in_scope: boolean | null;
}

/**
 * Resolve a partner's authority for one permission against one Digital Store.
 *
 * Returns `allow` only when BOTH hold: the actor holds the permission, and the
 * named Digital Store is one they are actually assigned to.
 */
export async function authorizePartnerRequest(
  db: DatabaseHandle,
  verifier: TokenVerifier,
  authorizationHeader: string | undefined,
  requiredPermission: string,
  scope: PartnerScope,
  environment: string,
): Promise<PartnerAuthorizationOutcome> {
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

  let rows: ScopeRow[];
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [verified.userId]);
    await db.query(
      "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
      [verified.userId],
    );
    await db.query("set local role authenticated");

    const result = await db.query<ScopeRow>(
      // Both questions in one round trip, both as the ACTOR.
      //
      // `has_permission` is called WITHOUT resource arguments on purpose: passing
      // them would suggest they constrain the answer, and they do not (see the
      // header). The scope is the separate `in_scope` column, resolved from the
      // canonical helper the RLS policies use.
      `select kitluy_auth.has_permission($1::text, null, null, $2::text) as permitted,
              kitluy_auth.current_digital_store_ids()                    as digital_store_ids,
              $3::uuid = any (kitluy_auth.current_digital_store_ids())   as in_scope`,
      [requiredPermission, environment, scope.digitalStoreId],
    );
    rows = result.rows;
  } finally {
    // Always release the assumed role and discard the transaction. This function
    // decides authority and must never leave a mutation behind.
    await db.query("rollback").catch(() => undefined);
  }

  const row = rows[0];
  if (row === undefined) {
    return {
      kind: "deny",
      status: 403,
      code: "KLUY-AUTH-NO-AUTHORITY",
      detail: "the caller holds no authority in this system",
    };
  }

  // A caller who holds the permission but not the Store, and a caller who holds
  // the Store but not the permission, get the SAME answer. Distinguishing them
  // would tell an actor which Stores exist and which permissions they are one
  // grant away from.
  if (row.permitted !== true || row.in_scope !== true) {
    return {
      kind: "deny",
      status: 403,
      code: "KLUY-AUTH-SCOPE-DENIED",
      detail: "not authorized for this Digital Store",
    };
  }

  return {
    kind: "allow",
    userId: verified.userId,
    digitalStoreIds: row.digital_store_ids ?? [],
  };
}
