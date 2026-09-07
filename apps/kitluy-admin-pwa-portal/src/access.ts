/**
 * Route guard state, derived from the Management API's answer.
 *
 * THE GUARD IS NOT THE SECURITY BOUNDARY. RLS and the Management API are. This
 * exists so the portal can show "your account is disabled" instead of an empty
 * screen, and so a person who is refused learns something they can act on.
 * A user who defeats this reads nothing, because every request is still
 * authorized server-side against canonical database state
 * (CLAUDE.md hard rule 7: frontend visibility is never authorization).
 */
import type { CurrentAdmin, ManagementOutcome } from "./management-client.js";
import type { MessageKey } from "./messages.js";

export type AccessState =
  | { readonly kind: "checking" }
  | { readonly kind: "granted"; readonly admin: CurrentAdmin }
  /** Must sign in again — no session, or one the auth server no longer honours. */
  | { readonly kind: "signed_out"; readonly messageKey: MessageKey }
  /** Signed in, but refused entry. The reason is shown; it is not a retry. */
  | { readonly kind: "refused"; readonly reason: string; readonly messageKey: MessageKey }
  /** The decision could not be obtained. NOT a denial, and NOT an entry. */
  | { readonly kind: "unavailable"; readonly detail: string };

/**
 * Denial reasons carried by the API in `error.details.reason`.
 *
 * An unmapped reason falls back to the generic refusal rather than to a grant:
 * a guard that treats an unrecognised answer as success is not a guard.
 */
const REFUSAL_MESSAGE: Readonly<Record<string, MessageKey>> = {
  "KLUY-ADMIN-NOT-PROVISIONED": "notAdmin",
  "KLUY-ADMIN-DISABLED": "accountDisabled",
  "KLUY-ADMIN-INACTIVE": "accountInactive",
  "KLUY-PERMISSION-DENIED": "accessRefused",
};

export function resolveAccess(outcome: ManagementOutcome<CurrentAdmin>): AccessState {
  switch (outcome.kind) {
    case "ok":
      return { kind: "granted", admin: outcome.value };
    case "unauthenticated":
      return { kind: "signed_out", messageKey: "sessionExpired" };
    case "denied":
      return {
        kind: "refused",
        reason: outcome.reason,
        messageKey: REFUSAL_MESSAGE[outcome.reason] ?? "accessRefused",
      };
    case "refused":
      // A governed door refused an ACTION. It can never be the answer to `/me`,
      // which asks only whether this is a usable Admin — so treating it as a
      // grant would be wrong, and treating it as a denial would mislabel it.
      return { kind: "unavailable", detail: outcome.message };
    case "not_found":
      // The session endpoint always exists; a 404 means the portal is pointed
      // at something that is not this API. That is a configuration fault, not
      // a permission answer, and must never read as one.
      return { kind: "unavailable", detail: "The management service did not recognise the route." };
    case "unavailable":
      return { kind: "unavailable", detail: outcome.detail };
  }
}

/** Does the granted Admin hold this permission? Presentation only. */
export function holdsPermission(access: AccessState, permission: string): boolean {
  return access.kind === "granted" && access.admin.permissions.includes(permission);
}

export const PERMISSION_FLEET_READ = "fleet.read" as const;
/** Registered CRITICAL by migration 0197. Presentation gate only. */
export const PERMISSION_FLEET_ENROLLMENT_APPROVE = "fleet.device_enrollment.approve" as const;
/** Registered HIGH by migration 0215. Presentation gate only. */
export const PERMISSION_STORE_CREATE = "store.digital_store.create" as const;
/** Seeded reference permission, reused for the Stores list. Presentation gate only. */
export const PERMISSION_PARTNERS_READ = "partners.read" as const;
