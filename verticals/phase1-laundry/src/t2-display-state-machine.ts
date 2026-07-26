/**
 * T2 Customer Display Screen state machine.
 *
 * Source authority: POS Desktop spec v4.0.0 §6.2 (state names and flow,
 * SPECIFIED verbatim) and §6.4 (strict privacy reset). T2 is customer-facing
 * and is not a production terminal, KDS, or payment-truth source (§6.1).
 */

export const T2_STATES = [
  "IDLE",
  "SESSION_BOUND",
  "INTAKE_MIRROR",
  "REVIEW",
  "PAYMENT_REQUESTED",
  "KHQR_PENDING",
  "CASH_PROCESSING",
  "PAYMENT_CONFIRMED",
  "PAYMENT_FAILED_OR_EXPIRED",
  "RECEIPT_CHOICE",
  "PICKUP_REFERENCE",
  "THANK_YOU",
  "PRIVACY_RESET",
] as const;
export type T2State = (typeof T2_STATES)[number];

/**
 * Allowed transitions per POS spec §6.2:
 * IDLE → SESSION_BOUND → INTAKE_MIRROR → REVIEW → PAYMENT_REQUESTED →
 * (KHQR_PENDING | CASH_PROCESSING | PAYMENT_CONFIRMED | PAYMENT_FAILED_OR_EXPIRED)
 * → RECEIPT_CHOICE → PICKUP_REFERENCE → THANK_YOU → PRIVACY_RESET → IDLE.
 * PAYMENT_FAILED_OR_EXPIRED may retry back to PAYMENT_REQUESTED, and any state
 * may fall back to PRIVACY_RESET (session end / actor switch clears customer
 * data, §6.4).
 */
const TRANSITIONS: Readonly<Record<T2State, readonly T2State[]>> = {
  IDLE: ["SESSION_BOUND"],
  SESSION_BOUND: ["INTAKE_MIRROR", "PRIVACY_RESET"],
  INTAKE_MIRROR: ["REVIEW", "PRIVACY_RESET"],
  REVIEW: ["PAYMENT_REQUESTED", "INTAKE_MIRROR", "PRIVACY_RESET"],
  PAYMENT_REQUESTED: [
    "KHQR_PENDING",
    "CASH_PROCESSING",
    "PAYMENT_CONFIRMED",
    "PAYMENT_FAILED_OR_EXPIRED",
    "PRIVACY_RESET",
  ],
  KHQR_PENDING: ["PAYMENT_CONFIRMED", "PAYMENT_FAILED_OR_EXPIRED", "PRIVACY_RESET"],
  CASH_PROCESSING: ["PAYMENT_CONFIRMED", "PAYMENT_FAILED_OR_EXPIRED", "PRIVACY_RESET"],
  PAYMENT_CONFIRMED: ["RECEIPT_CHOICE", "PRIVACY_RESET"],
  PAYMENT_FAILED_OR_EXPIRED: ["PAYMENT_REQUESTED", "PRIVACY_RESET"],
  RECEIPT_CHOICE: ["PICKUP_REFERENCE", "PRIVACY_RESET"],
  PICKUP_REFERENCE: ["THANK_YOU", "PRIVACY_RESET"],
  THANK_YOU: ["PRIVACY_RESET"],
  PRIVACY_RESET: ["IDLE"],
};

export class T2TransitionError extends Error {
  constructor(from: T2State, to: T2State) {
    super(`Illegal T2 transition ${from} → ${to} (POS spec v4.0.0 §6.2).`);
    this.name = "T2TransitionError";
  }
}

export function canTransition(from: T2State, to: T2State): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(from: T2State, to: T2State): T2State {
  if (!canTransition(from, to)) throw new T2TransitionError(from, to);
  return to;
}

/**
 * KHQR payment confirmation rule (POS spec §5.10): payment is never confirmed
 * from QR presentation alone — only verified provider reconciliation evidence
 * may drive KHQR_PENDING → PAYMENT_CONFIRMED.
 */
export function confirmKhqrPayment(current: T2State, providerEvidenceVerified: boolean): T2State {
  if (current !== "KHQR_PENDING") throw new T2TransitionError(current, "PAYMENT_CONFIRMED");
  if (!providerEvidenceVerified) {
    throw new Error(
      "KHQR payment cannot be confirmed without verified provider evidence (POS spec §5.10).",
    );
  }
  return "PAYMENT_CONFIRMED";
}
