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
  | "invalid_input"
  // T1-REAL-OPERATIONS-001 slice 2: the Hub could not price or settle.
  | "price_mismatch" // the Hub's total differs from what the terminal showed
  | "tender_insufficient" // cash in full at intake: the tender does not cover it
  | "configuration_missing"; // no catalog / money contract / FX rate delivered to the Hub

// ---------------------------------------------------------------------------
// T1-REAL-OPERATIONS-001 slice 2 — quote, confirm-intake, recent Bookings.
// Every money value is a decimal minor-unit STRING on this boundary (§1).
// ---------------------------------------------------------------------------

/** One cart line as the Hub prices it: a service and exactly one quantity kind. */
export interface IntakeLineInput {
  readonly serviceId: string;
  readonly pieceCount?: number;
  readonly weighedGrams?: number;
}

export interface IntakeQuoteLine {
  readonly serviceId: string;
  readonly serviceCode: string;
  readonly displayName: string;
  readonly familyCode: string | null;
  readonly pricingMethod: "per_piece" | "per_weight";
  readonly unitCode: "piece" | "kg";
  readonly unitPriceMinor: string;
  readonly quantity: string;
  readonly pieceCount: number | null;
  readonly weighedGrams: number | null;
  readonly billableGrams: number | null;
  readonly lineSubtotalMinor: string;
}

/** The Store Hub's price for the cart — the only price the face may call a Booking price. */
export interface IntakeQuote {
  readonly currencyCode: string;
  readonly currencyExponent: number;
  readonly lines: readonly IntakeQuoteLine[];
  readonly subtotalMinor: string;
  readonly express: boolean;
  readonly expressSurchargeBps: number | null;
  readonly expressSurchargeMinor: string;
  readonly totalMinor: string;
  /** The rate the Hub will accept a USD leg at; null = no USD tender possible. */
  readonly khrPerUsd: number | null;
  readonly locationCode: string | null;
  readonly configurationVersion: string;
}

export interface IntakeTenderLeg {
  readonly currency_code: string;
  readonly currency_exponent: number;
  readonly amount_minor: string;
  readonly local_equivalent_minor: string;
  readonly khr_per_usd: number | null;
}

/** What the Hub committed for one confirm — or answered again for a replay. */
export interface IntakeConfirmation {
  readonly outcome: "confirmed" | "replayed";
  readonly booking: {
    readonly booking_id: string;
    readonly booking_number: string;
    readonly status: string;
    readonly currency_code: string;
    readonly currency_exponent: number;
    readonly subtotal_minor: string;
    readonly express: boolean;
    readonly express_surcharge_minor: string;
    readonly total_minor: string;
    readonly paid_minor: string;
    readonly balance_minor: string;
    readonly line_count: number;
  };
  readonly lines: readonly Record<string, unknown>[];
  readonly payment: {
    readonly payment_id: string;
    readonly payment_number: string;
    readonly amount_minor: string;
    readonly tendered_minor: string;
    readonly change_due_minor: string;
    readonly currency_code: string;
    readonly currency_exponent: number;
    readonly legs: readonly IntakeTenderLeg[];
  } | null;
  readonly receipt: {
    readonly receipt_id: string;
    readonly receipt_number: string;
    readonly content_sha256: string;
    /** The receipt document the Hub issued — rendered and (slice 3) printed from here. */
    readonly payload: Record<string, unknown>;
    readonly print_job_id: string | null;
    readonly print_state: "queued" | "no_printer_binding";
  };
  readonly draft: {
    readonly draft_id: string;
    readonly lifecycle: string;
    readonly version: number;
    readonly converted_booking_id: string;
  };
}

/** A Booking as the Orders view lists it (today, this Location). */
export interface IntakeBookingSummary {
  readonly bookingId: string;
  readonly bookingNumber: string;
  readonly status: string;
  readonly businessDate: string;
  readonly currencyCode: string;
  readonly currencyExponent: number;
  readonly totalMinor: string;
  readonly paidMinor: string;
  readonly balanceMinor: string;
  readonly lineCount: number;
  readonly customerDisplayName: string | null;
  readonly walkIn: boolean;
  readonly receiptNumber: string | null;
  readonly createdAt: string;
}

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
  // T1-REAL-OPERATIONS-001 slice 2
  /** The Hub prices the cart against its delivered catalog and money contract (no write). */
  quote(input: {
    readonly draftId: string;
    readonly lines: readonly IntakeLineInput[];
    readonly express: boolean;
  }): Promise<IntakeResult<IntakeQuote>>;
  /**
   * ONE Hub command: the draft becomes the Booking, priced by the Hub, paid in
   * cash in full (KHR + USD at the delivered rate), with a receipt record. The
   * main process mints the terminal's command key from Hub truth and replays
   * the SAME key after a lost answer, so a retry can never book twice.
   */
  confirmIntake(input: {
    readonly draftId: string;
    readonly expectedVersion: number;
    readonly lines: readonly IntakeLineInput[];
    readonly express: boolean;
    /** The total the face displayed — the Hub refuses if its own differs. */
    readonly displayedTotalMinor: string;
    readonly tender: { readonly localMinor: string; readonly usdCents: string };
  }): Promise<IntakeResult<IntakeConfirmation>>;
  /** Today's Bookings at this Location, newest first. */
  listRecentBookings(): Promise<IntakeResult<readonly IntakeBookingSummary[]>>;
}
