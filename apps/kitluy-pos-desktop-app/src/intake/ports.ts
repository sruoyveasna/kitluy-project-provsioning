/**
 * T1 intake ports — WS-12-T002-P02 §4/§5.
 *
 * Operation-specific PUBLIC inputs only: scope, actor and terminal
 * identity are derived by the MAIN process from the authenticated runtime
 * (the staff session id travels in a header the adapter adds — never a
 * renderer-supplied field). Every outcome is an explicit application
 * verdict; no raw SQLSTATE and no internal database detail crosses this
 * boundary, and unavailable / stale / conflict / permission-denied are
 * DISTINCT outcomes (§4).
 */

/** Explicit truth labels (owner decision §5) surfaced to the interface. */
export const INTAKE_SYNC_STATES = [
  "local_authoritative",
  "cloud_acknowledged",
  "pending_sync",
  "stale_projection",
  "conflict",
  "unavailable",
] as const;
export type IntakeSyncState = (typeof INTAKE_SYNC_STATES)[number];

export interface IntakeCustomer {
  readonly customerId: string;
  readonly displayName: string;
  readonly phoneMasked: string | null;
  readonly phoneE164: string | null;
  /** Verification is SEPARATE from presence (owner decision §2.7). */
  readonly phoneVerified: boolean;
  readonly preferredLanguage: string;
  readonly origin: string;
  readonly syncState: string;
}

export interface IntakeDraft {
  readonly draftId: string;
  readonly lifecycle: string;
  readonly version: number;
  readonly customerId: string | null;
  readonly walkIn: boolean;
  /** The IMMUTABLE snapshot taken at selection — review screens render
   * THIS, never the live customer master (§6 truth rules). */
  readonly customerSnapshot: Record<string, unknown>;
  readonly preferredLanguage: string;
  readonly intakeSource: string;
  readonly customerNotes: string;
  readonly staffNotes: string;
  readonly cancelReasonCode: string | null;
  readonly syncState: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The closed refusal vocabulary an adapter may surface. */
export type IntakeFailureKind =
  | "unavailable" // transport failure / Hub unreachable — NEVER "no match"
  | "permission_denied"
  | "session_invalid"
  | "conflict" // idempotency or version conflict
  | "stale_version"
  | "not_found"
  | "invalid_input";

export type IntakeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly kind: IntakeFailureKind; readonly detail: string };

/** The complete renderer-reachable operation surface — nothing generic. */
export interface IntakeOperations {
  searchCustomers(phone: string): Promise<IntakeResult<readonly IntakeCustomer[]>>;
  readCustomer(customerId: string): Promise<IntakeResult<IntakeCustomer>>;
  createCustomer(input: {
    readonly displayName: string;
    readonly phone: string | null;
    readonly preferredLanguage: "km-KH" | "en-US";
  }): Promise<IntakeResult<IntakeCustomer>>;
  recordConsentDecision(input: {
    readonly customerId: string;
    readonly purposeKey: string;
    readonly policyRef: string;
    readonly policyVersion: number;
    readonly decision: "granted" | "declined" | "withdrawn" | "acknowledged";
    readonly staffAssisted: boolean;
  }): Promise<IntakeResult<{ readonly decisionId: string; readonly recordedAt: string }>>;
  createDraft(input: {
    readonly customerId: string | null;
    readonly walkIn: boolean;
    readonly preferredLanguage: "km-KH" | "en-US";
    readonly customerNotes: string;
    readonly staffNotes: string;
  }): Promise<IntakeResult<IntakeDraft>>;
  readDraft(draftId: string): Promise<IntakeResult<IntakeDraft>>;
  updateDraft(input: {
    readonly draftId: string;
    readonly expectedVersion: number;
    readonly customerNotes?: string;
    readonly staffNotes?: string;
    readonly preferredLanguage?: "km-KH" | "en-US";
  }): Promise<IntakeResult<IntakeDraft>>;
  cancelDraft(input: {
    readonly draftId: string;
    readonly reasonCode: string;
  }): Promise<IntakeResult<IntakeDraft>>;
}
