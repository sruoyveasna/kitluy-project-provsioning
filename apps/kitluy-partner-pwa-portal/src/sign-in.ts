/**
 * Sign-in state and failure classification.
 *
 * Kept out of the component so the interesting part — which failure a person is
 * told about — is testable without a browser, a server or a real credential.
 *
 * AUTHENTICATION IS NOT AUTHORIZATION. Everything here ends at "this person
 * proved who they are". Whether they may enter the control plane is decided
 * afterwards, by the Management API, against canonical database state.
 */
import type { MessageKey } from "./messages.js";

export type SignInFailure =
  "missing_email" | "missing_password" | "invalid_credentials" | "network_error" | "unexpected";

export type SignInState =
  | { readonly kind: "idle" }
  | { readonly kind: "submitting" }
  | { readonly kind: "failed"; readonly failure: SignInFailure };

export const FAILURE_MESSAGE: Readonly<Record<SignInFailure, MessageKey>> = {
  missing_email: "missingEmail",
  missing_password: "missingPassword",
  invalid_credentials: "invalidCredentials",
  network_error: "networkError",
  unexpected: "unexpectedError",
};

/** Local field checks, so an empty form does not become a network round trip. */
export function validateCredentials(email: string, password: string): SignInFailure | null {
  if (email.trim() === "") return "missing_email";
  if (password === "") return "missing_password";
  return null;
}

interface AuthErrorShape {
  readonly code?: unknown;
  readonly status?: unknown;
  readonly name?: unknown;
  readonly message?: unknown;
}

/**
 * Classify an auth error.
 *
 * Matched on SHAPE rather than `instanceof`: the auth library's error classes
 * are implementation detail, and a version bump that renames one must not
 * silently turn "wrong password" into "something unexpected went wrong" —
 * which is the message that makes a person call support instead of retyping.
 *
 * A wrong password and an unknown email deliberately produce the SAME message.
 * Distinguishing them would turn the sign-in form into an account-existence
 * oracle for a privileged control plane.
 */
export function classifySignInError(error: unknown): SignInFailure {
  if (error === null || typeof error !== "object") return "unexpected";
  const shape = error as AuthErrorShape;
  const code = typeof shape.code === "string" ? shape.code : "";
  const name = typeof shape.name === "string" ? shape.name : "";
  const message = typeof shape.message === "string" ? shape.message : "";
  const status = typeof shape.status === "number" ? shape.status : null;

  if (code === "invalid_credentials") return "invalid_credentials";
  if (/retryable|network/i.test(name) || /failed to fetch|network|load failed/i.test(message)) {
    return "network_error";
  }
  if (/invalid login credentials/i.test(message)) return "invalid_credentials";
  if (status === 400 || status === 401) return "invalid_credentials";
  if (status === 0 || (status !== null && status >= 500)) return "network_error";
  return "unexpected";
}
