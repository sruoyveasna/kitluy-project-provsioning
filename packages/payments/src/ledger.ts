/**
 * @kitluy/payments — append-only booking payment ledger (pure, in-memory).
 *
 * Canonical authority:
 * - docs/source/qa/kitluy-payment-and-reconciliation-test-vectors-v1.0.0.json
 *   (money_contract: KHR exponent 0 with EXACT_INTEGER_RESULT_UNTIL_OWNER_POLICY_APPROVED,
 *   USD exponent 2 with HALF_EVEN only where a decimal op requires it, no binary
 *   floating point, no silent currency conversion, finalized records append-only
 *   with compensating corrections).
 * - docs/source/business-rules/kitluy-payment-refund-and-void-rules-v1.0.0.md
 *   (KBR-PAY-001/002/004: intent creation, cash completion with change,
 *   deposit/outstanding balance; KBR-PAY-005/006 via refunds.ts;
 *   KBR-PAY-003 via khqr.ts).
 *
 * Design notes:
 * - All monetary truth uses @kitluy/money (bigint integer minor units). No JS
 *   floats ever touch stored amounts; non-integer inputs are rejected.
 * - Records are deep-frozen on append; there is deliberately NO update or
 *   delete API. Corrections are new compensating records (governing principle 4).
 * - Aggregates (paid, refunded, balance, deposit, drawer net) are DERIVED from
 *   the record stream on every read, so the append-only entries are provably
 *   the single source of truth.
 */

import { add, money, subtract, type CurrencyCode, type Money } from "@kitluy/money";
import { PaymentError } from "./errors.js";

/** Minimal double-entry account set used by the in-memory ledger postings. */
export type LedgerAccount =
  "CASH_DRAWER" | "PROVIDER_CLEARING" | "TENDER_ASSET" | "ACCOUNTS_RECEIVABLE";

export interface Posting {
  readonly account: LedgerAccount;
  readonly direction: "DEBIT" | "CREDIT";
  readonly amount: Money;
}

/**
 * Record kinds. PAYMENT and REFUND are financial effects (they carry balanced
 * postings); everything else is a non-financial audit event with no postings.
 */
export type LedgerRecordKind =
  | "PAYMENT"
  | "REFUND"
  | "ATTEMPT_CREATED"
  | "ATTEMPT_STATE_CHANGED"
  | "PROVIDER_EVENT_DUPLICATE"
  | "PROVIDER_EVENT_QUARANTINED"
  | "RECONCILIATION_EXCEPTION"
  | "CLIENT_CONFIRM_OBSERVED"
  | "REFUND_REJECTED"
  | "VOID_FINALIZED_REFUSED";

export interface LedgerRecord {
  /** Monotonic append sequence — proves ordering; never reused. */
  readonly seq: number;
  readonly kind: LedgerRecordKind;
  /** Business amount for financial records (applied amount, refund amount). */
  readonly amount?: Money;
  readonly postings: readonly Posting[];
  /** Free-form immutable metadata (attempt ids, provider txn ids, variance…). */
  readonly meta: Readonly<Record<string, string | number | bigint | boolean>>;
}

export type KhqrAttemptState = "PENDING" | "SUCCEEDED" | "FAILED" | "EXPIRED" | "VOIDED";

/**
 * KHQR attempt (KBR-PAY-001 payment intent). The attempt is a state machine,
 * not a financial record; every transition is mirrored into the append-only
 * record stream as an ATTEMPT_* audit event.
 */
export interface KhqrAttempt {
  readonly attemptId: string;
  /** Requested amount; optional — a status-refresh flow may not know it (PAY-VEC-012). */
  readonly amount?: Money;
  state: KhqrAttemptState;
  /** Non-authoritative client-side outcome (TIMEOUT, success screen…). */
  clientResult?: string;
  providerTransactionId?: string;
}

/** Envelope so callers can distinguish an idempotent replay from a fresh effect. */
export interface CommandEnvelope<T> {
  readonly replayed: boolean;
  readonly result: T;
}

export interface CashTenderResult {
  readonly recordSeq: number;
  readonly appliedMinor: bigint;
  readonly changeDueMinor: bigint;
  readonly paidMinor: bigint;
  readonly balanceMinor: bigint;
}

export interface ProviderCallbackResult {
  readonly accepted: boolean;
  readonly state: "APPLIED" | "RECONCILIATION_EXCEPTION" | "ATTEMPT_CLOSED" | "QUARANTINED";
  readonly recordSeq?: number;
  readonly varianceMinor?: bigint;
}

export interface RefundResult {
  readonly recordSeq: number;
  readonly refundMinor: bigint;
  readonly netPaidMinor: bigint;
}

export interface VoidFinalizedDecision {
  /** PAY-VEC-020: destructive void of a finalized payment is NEVER allowed. */
  readonly allowed: false;
  readonly requiredAction: "COMPENSATING_REFUND_OR_ADJUSTMENT";
}

export type PaymentState =
  | "UNPAID"
  | "PAYMENT_PENDING"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERPAID"
  | "RECONCILIATION_EXCEPTION";

/**
 * Deterministic serialization for idempotency-payload fingerprints. Sorts
 * object keys and encodes bigints losslessly (no floats involved anywhere).
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (typeof val === "bigint") return `${val.toString()}n`;
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      );
    }
    return val;
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      deepFreeze(v);
    }
    Object.freeze(value);
  }
  return value;
}

interface IdempotencyEntry {
  readonly fingerprint: string;
  readonly result: unknown;
}

export class BookingPaymentLedger {
  readonly currency: CurrencyCode;
  /**
   * Exact stored booking total. PAY-VEC-005: display rounding (e.g. nearest
   * 100 riel) is NEVER applied to stored truth — this value is the exact
   * integer given at construction and the engine has no rounding code path.
   */
  readonly total: Money;

  private readonly records: LedgerRecord[] = [];
  private readonly idempotency = new Map<string, IdempotencyEntry>();
  /** @internal exposed for khqr.ts / refunds.ts modules of this package. */
  readonly attempts = new Map<string, KhqrAttempt>();
  /** @internal processed provider transactions: dedup authority (KBR-PAY-003). */
  readonly processedProviderTxns = new Map<string, ProviderCallbackResult>();
  private duplicateDeliveries = 0;
  private statusRefreshRequired = false;
  private nextSeq = 1;

  constructor(opts: { currency: CurrencyCode; bookingTotalMinor: bigint | number }) {
    this.currency = opts.currency;
    this.total = money(opts.currency, opts.bookingTotalMinor);
  }

  // ---------------------------------------------------------------- records

  /** Read-only snapshot of the append-only record stream. */
  getRecords(): readonly LedgerRecord[] {
    return [...this.records];
  }

  getRecord(seq: number): LedgerRecord | undefined {
    return this.records.find((r) => r.seq === seq);
  }

  /**
   * @internal Append a record. The ONLY way state enters the ledger; records
   * are deep-frozen so later mutation attempts throw (append-only contract).
   */
  append(
    kind: LedgerRecordKind,
    opts: {
      amount?: Money;
      postings?: readonly Posting[];
      meta?: Record<string, string | number | bigint | boolean>;
    } = {},
  ): LedgerRecord {
    const record: LedgerRecord = deepFreeze({
      seq: this.nextSeq++,
      kind,
      ...(opts.amount !== undefined ? { amount: opts.amount } : {}),
      postings: opts.postings ?? [],
      meta: opts.meta ?? {},
    });
    this.records.push(record);
    return record;
  }

  // ----------------------------------------------------------- idempotency

  /**
   * Idempotency contract (canonical data conventions; PAY-VEC-014/015):
   * replaying the same key with the same payload returns the ORIGINAL result
   * with no new business effect; the same key with a different payload is a
   * hard conflict.
   */
  runIdempotent<T>(
    key: string | undefined,
    payload: unknown,
    execute: () => T,
  ): CommandEnvelope<T> {
    if (key === undefined) {
      return { replayed: false, result: execute() };
    }
    const fingerprint = stableStringify(payload);
    const existing = this.idempotency.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new PaymentError(
          "IDEMPOTENCY_KEY_PAYLOAD_CONFLICT",
          `Idempotency key "${key}" was already used with a different payload (PAY-VEC-015).`,
        );
      }
      return { replayed: true, result: existing.result as T };
    }
    const result = execute();
    this.idempotency.set(key, { fingerprint, result });
    return { replayed: false, result };
  }

  // -------------------------------------------------------------- helpers

  /** @internal Validate and normalize a minor-unit amount in ledger currency. */
  toMoney(minor: bigint | number, currency?: CurrencyCode): Money {
    const cur = currency ?? this.currency;
    if (cur !== this.currency) {
      // PAY-VEC-004: no silent currency conversion — clients must not invent
      // an FX leg; a future approved FX contract may add explicit conversion.
      throw new PaymentError(
        "CURRENCY_MISMATCH_OR_CONVERSION_REQUIRED",
        `Tender currency ${cur} does not match booking currency ${this.currency}; ` +
          `no approved conversion contract exists (PAY-VEC-004).`,
      );
    }
    return money(cur, minor); // rejects non-integer numbers (float money prohibited)
  }

  private zero(): Money {
    return money(this.currency, 0n);
  }

  // ------------------------------------------------------------ aggregates

  /** Sum of applied PAYMENT effects (gross, before refunds). */
  get paidMinor(): bigint {
    return this.records
      .filter((r) => r.kind === "PAYMENT")
      .reduce((s, r) => add(s, r.amount ?? this.zero()), this.zero()).minorUnits;
  }

  /** Sum of REFUND compensating effects. */
  get refundedMinor(): bigint {
    return this.records
      .filter((r) => r.kind === "REFUND")
      .reduce((s, r) => add(s, r.amount ?? this.zero()), this.zero()).minorUnits;
  }

  /** KBR-PAY-005: net paid = completed payments − posted refunds. */
  get netPaidMinor(): bigint {
    return this.paidMinor - this.refundedMinor;
  }

  /** KBR-PAY-004: outstanding = finalized total − payments + refund effects. */
  get balanceMinor(): bigint {
    return subtract(this.total, money(this.currency, this.netPaidMinor)).minorUnits;
  }

  /**
   * Deposit derivation (PAY-VEC-002/013): a payment effect counts as deposit
   * when, after applying it, the booking is still not fully paid — i.e. money
   * held before full settlement. The completing balance payment is not a
   * deposit (KBR-PAY-004: deposit is not conflated with full settlement).
   */
  get depositMinor(): bigint {
    let running = 0n;
    let deposit = 0n;
    for (const r of this.records) {
      if (r.kind !== "PAYMENT") continue;
      const amt = (r.amount ?? this.zero()).minorUnits;
      running += amt;
      if (running < this.total.minorUnits) deposit += amt;
    }
    return deposit;
  }

  /** Number of PAYMENT business effects (dedup/idempotency proof counter). */
  get businessEffectCount(): number {
    return this.records.filter((r) => r.kind === "PAYMENT").length;
  }

  /** Applied tender legs — same population as PAYMENT effects (PAY-VEC-013). */
  get tenderCount(): number {
    return this.businessEffectCount;
  }

  /** PAYMENT + REFUND records (anything that moved money). */
  get financialEffectCount(): number {
    return this.records.filter((r) => r.kind === "PAYMENT" || r.kind === "REFUND").length;
  }

  get duplicateDeliveryCount(): number {
    return this.duplicateDeliveries;
  }

  /** @internal */
  noteDuplicateDelivery(): void {
    this.duplicateDeliveries += 1;
  }

  /**
   * PAY-VEC-012: once a client-side timeout is observed, the client result is
   * non-authoritative and a provider status refresh is required. Sticky —
   * provider truth arriving later resolves the payment, not the client's view.
   */
  get requiresStatusRefresh(): boolean {
    return this.statusRefreshRequired;
  }

  /** @internal */
  markStatusRefreshRequired(): void {
    this.statusRefreshRequired = true;
  }

  /** Net cash drawer movement: drawer debits − drawer credits (PAY-VEC-006). */
  get cashDrawerNetMinor(): bigint {
    let net = 0n;
    for (const r of this.records) {
      for (const p of r.postings) {
        if (p.account !== "CASH_DRAWER") continue;
        net += p.direction === "DEBIT" ? p.amount.minorUnits : -p.amount.minorUnits;
      }
    }
    return net;
  }

  /** PAY-VEC-005: stored truth is the exact integer total — never rounded. */
  get storedTotalMinor(): bigint {
    return this.total.minorUnits;
  }

  private get reconciliationExceptionCount(): number {
    return this.records.filter((r) => r.kind === "RECONCILIATION_EXCEPTION").length;
  }

  /** Variance recorded on the most recent reconciliation exception (PAY-VEC-010). */
  get lastReconciliationVarianceMinor(): bigint | undefined {
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i];
      if (r !== undefined && r.kind === "RECONCILIATION_EXCEPTION") {
        const v = r.meta["varianceMinor"];
        return typeof v === "bigint" ? v : undefined;
      }
    }
    return undefined;
  }

  private get hasOpenPendingAttempt(): boolean {
    for (const a of this.attempts.values()) {
      if (a.state === "PENDING") return true;
    }
    return false;
  }

  /**
   * Derived payment state (KBR-PAY-004 + payment lifecycle §4). Quarantined
   * provider evidence forces RECONCILIATION_EXCEPTION (PAY-VEC-010).
   */
  get paymentState(): PaymentState {
    if (this.reconciliationExceptionCount > 0) return "RECONCILIATION_EXCEPTION";
    const net = this.netPaidMinor;
    const total = this.total.minorUnits;
    if (net === 0n) {
      return this.hasOpenPendingAttempt && total > 0n ? "PAYMENT_PENDING" : "UNPAID";
    }
    if (net < total) return "PARTIALLY_PAID";
    if (net === total) return "PAID";
    return "OVERPAID";
  }

  /**
   * Double-entry invariant: per currency, sum of debits equals sum of credits
   * across all postings (expected `ledger_balanced` in the vectors).
   */
  isBalanced(): boolean {
    const net = new Map<CurrencyCode, bigint>();
    for (const r of this.records) {
      for (const p of r.postings) {
        const cur = p.amount.currency;
        const delta = p.direction === "DEBIT" ? p.amount.minorUnits : -p.amount.minorUnits;
        net.set(cur, (net.get(cur) ?? 0n) + delta);
      }
    }
    for (const v of net.values()) if (v !== 0n) return false;
    return true;
  }

  /**
   * Provider-settlement reconciliation status. The booking ledger never claims
   * settlement completion on its own (KBR-PAY-009); PAY-VEC-007/008 expect
   * `reconciled: false` immediately after payment. Settlement matching lives
   * in settlement.ts.
   */
  get reconciled(): boolean {
    return false;
  }

  // ------------------------------------------------------------------ cash

  /**
   * KBR-PAY-002 — cash completion with change. Postings: DEBIT drawer for the
   * full tendered amount, CREDIT receivable for the applied amount, CREDIT
   * drawer for change returned — so drawer net equals the applied amount
   * (PAY-VEC-006 cash_drawer_net_minor) and the entry stays balanced.
   */
  applyCashTender(cmd: {
    amountMinor?: bigint | number;
    tenderedMinor?: bigint | number;
    appliedMinor?: bigint | number;
    currency?: CurrencyCode;
    idempotencyKey?: string;
  }): CommandEnvelope<CashTenderResult> {
    // Validate BEFORE touching the idempotency store or the record stream so a
    // rejected command has no ledger effect (PAY-VEC-004 no_ledger_effect).
    const tendered = this.toMoney(cmd.tenderedMinor ?? cmd.amountMinor ?? 0n, cmd.currency);
    const applied = this.toMoney(cmd.appliedMinor ?? cmd.amountMinor ?? 0n, cmd.currency);
    if (applied.minorUnits <= 0n) {
      throw new PaymentError("AMOUNT_NOT_POSITIVE", "Applied amount must be positive.");
    }
    if (tendered.minorUnits < applied.minorUnits) {
      throw new PaymentError(
        "INSUFFICIENT_TENDER",
        "Tendered cash must cover the applied amount (KBR-PAY-002).",
      );
    }
    const change = subtract(tendered, applied);

    return this.runIdempotent(
      cmd.idempotencyKey,
      {
        type: "CASH",
        currency: applied.currency,
        tenderedMinor: tendered.minorUnits,
        appliedMinor: applied.minorUnits,
      },
      () => {
        const postings: Posting[] = [
          { account: "CASH_DRAWER", direction: "DEBIT", amount: tendered },
          { account: "ACCOUNTS_RECEIVABLE", direction: "CREDIT", amount: applied },
        ];
        if (change.minorUnits > 0n) {
          postings.push({
            account: "CASH_DRAWER",
            direction: "CREDIT",
            amount: change,
          });
        }
        const record = this.append("PAYMENT", {
          amount: applied,
          postings,
          meta: {
            tender: "CASH",
            tenderedMinor: tendered.minorUnits,
            changeDueMinor: change.minorUnits,
            finalized: true,
          },
        });
        return {
          recordSeq: record.seq,
          appliedMinor: applied.minorUnits,
          changeDueMinor: change.minorUnits,
          paidMinor: this.paidMinor,
          balanceMinor: this.balanceMinor,
        };
      },
    );
  }

  /**
   * Record an already-finalized payment (vector setup shape ORIGINAL_PAYMENT,
   * PAY-VEC-016..018/020). Tender-agnostic asset leg; finalized records are
   * append-only from the moment they exist.
   */
  applyFinalizedPayment(cmd: {
    amountMinor: bigint | number;
    currency?: CurrencyCode;
    idempotencyKey?: string;
  }): CommandEnvelope<{ recordSeq: number }> {
    const amount = this.toMoney(cmd.amountMinor, cmd.currency);
    if (amount.minorUnits <= 0n) {
      throw new PaymentError("AMOUNT_NOT_POSITIVE", "Payment amount must be positive.");
    }
    return this.runIdempotent(
      cmd.idempotencyKey,
      { type: "FINALIZED_PAYMENT", currency: amount.currency, amountMinor: amount.minorUnits },
      () => {
        const record = this.append("PAYMENT", {
          amount,
          postings: [
            { account: "TENDER_ASSET", direction: "DEBIT", amount },
            { account: "ACCOUNTS_RECEIVABLE", direction: "CREDIT", amount },
          ],
          meta: { tender: "FINALIZED", finalized: true },
        });
        return { recordSeq: record.seq };
      },
    );
  }
}
