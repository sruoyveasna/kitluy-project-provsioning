/**
 * @kitluy/payments — provider settlement matching (KBR-PAY-009).
 *
 * Separates customer payment truth from provider settlement and fee truth:
 * ledger payments are matched to provider settlement lines by provider
 * transaction id; fees are recorded as separate balanced postings, never
 * netted into the customer payment amount.
 *
 * Vector coverage: PAY-VEC-021 (exact match), 022 (fee recorded separately,
 * ledger balanced), 023 (unknown provider item flagged, no auto-close),
 * 024 (payment missing settlement after SLA → flagged, alert, no auto-close).
 */

import { money, type CurrencyCode, type Money } from "@kitluy/money";
import { PaymentError } from "./errors.js";

export type ReconciliationState =
  | "MATCHED"
  | "MATCHED_WITH_FEE"
  | "SETTLEMENT_AMOUNT_MISMATCH"
  | "UNMATCHED_PROVIDER_ITEM"
  | "MISSING_SETTLEMENT";

export interface SettlementMatchResult {
  readonly reconciliationState: ReconciliationState;
  readonly providerTransactionId: string;
  readonly varianceMinor: bigint;
  readonly grossMinor: bigint;
  readonly feeMinor: bigint;
  readonly netMinor: bigint;
  readonly autoCloseAllowed: boolean;
}

export interface MissingSettlementFinding {
  readonly reconciliationState: "MISSING_SETTLEMENT";
  readonly providerTransactionId: string;
  readonly ageHours: number;
  readonly alertRequired: true;
  readonly autoCloseAllowed: false;
}

interface RegisteredPayment {
  readonly providerTransactionId: string;
  readonly amount: Money;
  readonly ageHours: number;
  settled: boolean;
}

interface FeePosting {
  readonly account: "SETTLEMENT_BANK" | "PROVIDER_FEE_EXPENSE" | "PROVIDER_CLEARING";
  readonly direction: "DEBIT" | "CREDIT";
  readonly amount: Money;
}

/**
 * Settlement SLA. [REQUIRED: owner-approved settlement SLA — not specified in
 * the canonical vectors; PAY-VEC-024 uses age 72h and expects it flagged.
 * 24h is a conservative default until the governed decision lands.]
 */
export const DEFAULT_SETTLEMENT_SLA_HOURS = 24;

export class SettlementReconciler {
  private readonly payments = new Map<string, RegisteredPayment>();
  private readonly postings: FeePosting[] = [];
  private readonly slaHours: number;

  constructor(
    readonly currency: CurrencyCode,
    opts: { slaHours?: number } = {},
  ) {
    this.slaHours = opts.slaHours ?? DEFAULT_SETTLEMENT_SLA_HOURS;
  }

  /** Register an authoritative ledger payment awaiting provider settlement. */
  registerLedgerPayment(cmd: {
    providerTransactionId: string;
    amountMinor: bigint | number;
    ageHours?: number;
  }): void {
    this.payments.set(cmd.providerTransactionId, {
      providerTransactionId: cmd.providerTransactionId,
      amount: money(this.currency, cmd.amountMinor),
      ageHours: cmd.ageHours ?? 0,
      settled: false,
    });
  }

  /**
   * Match one provider settlement line against the ledger.
   * - Internal consistency gross = fee + net is enforced first.
   * - Unknown provider transaction → UNMATCHED_PROVIDER_ITEM, never
   *   auto-closed (PAY-VEC-023): provider data cannot invent ledger truth.
   * - Fee > 0 with matching gross → MATCHED_WITH_FEE and separate balanced
   *   fee postings (PAY-VEC-022): bank receives net, fee is an expense,
   *   clearing releases gross.
   */
  applySettlementLine(cmd: {
    providerTransactionId: string;
    grossMinor: bigint | number;
    feeMinor: bigint | number;
    netMinor: bigint | number;
  }): SettlementMatchResult {
    const gross = money(this.currency, cmd.grossMinor);
    const fee = money(this.currency, cmd.feeMinor);
    const net = money(this.currency, cmd.netMinor);
    if (gross.minorUnits !== fee.minorUnits + net.minorUnits) {
      throw new PaymentError(
        "SETTLEMENT_LINE_INCONSISTENT",
        `Settlement line for ${cmd.providerTransactionId}: gross ${gross.minorUnits} != fee ${fee.minorUnits} + net ${net.minorUnits}.`,
      );
    }
    const base = {
      providerTransactionId: cmd.providerTransactionId,
      grossMinor: gross.minorUnits,
      feeMinor: fee.minorUnits,
      netMinor: net.minorUnits,
    };
    const payment = this.payments.get(cmd.providerTransactionId);
    if (!payment) {
      return {
        ...base,
        reconciliationState: "UNMATCHED_PROVIDER_ITEM",
        varianceMinor: gross.minorUnits,
        autoCloseAllowed: false,
      };
    }
    const varianceMinor = gross.minorUnits - payment.amount.minorUnits;
    if (varianceMinor !== 0n) {
      return {
        ...base,
        reconciliationState: "SETTLEMENT_AMOUNT_MISMATCH",
        varianceMinor,
        autoCloseAllowed: false,
      };
    }
    payment.settled = true;
    this.postings.push(
      { account: "SETTLEMENT_BANK", direction: "DEBIT", amount: net },
      ...(fee.minorUnits > 0n
        ? [{ account: "PROVIDER_FEE_EXPENSE", direction: "DEBIT", amount: fee } as const]
        : []),
      { account: "PROVIDER_CLEARING", direction: "CREDIT", amount: gross },
    );
    return {
      ...base,
      reconciliationState: fee.minorUnits > 0n ? "MATCHED_WITH_FEE" : "MATCHED",
      varianceMinor: 0n,
      autoCloseAllowed: true,
    };
  }

  /**
   * PAY-VEC-024: a ledger payment with no settlement after the SLA is an
   * explicit exception — alert required, reconciliation run cannot auto-close.
   */
  reviewMissingSettlements(): MissingSettlementFinding[] {
    const findings: MissingSettlementFinding[] = [];
    for (const p of this.payments.values()) {
      if (!p.settled && p.ageHours > this.slaHours) {
        findings.push({
          reconciliationState: "MISSING_SETTLEMENT",
          providerTransactionId: p.providerTransactionId,
          ageHours: p.ageHours,
          alertRequired: true,
          autoCloseAllowed: false,
        });
      }
    }
    return findings;
  }

  /** Double-entry check over fee/settlement postings (PAY-VEC-022). */
  isBalanced(): boolean {
    let netSum = 0n;
    for (const p of this.postings) {
      netSum += p.direction === "DEBIT" ? p.amount.minorUnits : -p.amount.minorUnits;
    }
    return netSum === 0n;
  }
}
