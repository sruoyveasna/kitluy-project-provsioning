/**
 * @kitluy/payments — cash session close (expected vs counted).
 *
 * KBR-PAY-002 gives the drawer its movements; at close, the counted drawer is
 * compared with the expected balance. Variance never auto-closes: it requires
 * an explicit reason (and per policy, approval) before the session can end.
 *
 * Vector coverage: PAY-VEC-025 (exact → BALANCED), PAY-VEC-026 (shortfall →
 * VARIANCE_REQUIRES_REASON, auto_close_allowed false, variance −1000).
 */

import { money, type CurrencyCode } from "@kitluy/money";

export type CashCloseState = "BALANCED" | "VARIANCE_REQUIRES_REASON";

export interface CashCloseResult {
  readonly currency: CurrencyCode;
  readonly expectedMinor: bigint;
  readonly countedMinor: bigint;
  /** counted − expected; negative = shortfall, positive = overage. */
  readonly varianceMinor: bigint;
  readonly closeState: CashCloseState;
  readonly autoCloseAllowed: boolean;
}

export function closeCashSession(cmd: {
  currency: CurrencyCode;
  expectedMinor: bigint | number;
  countedMinor: bigint | number;
}): CashCloseResult {
  const expected = money(cmd.currency, cmd.expectedMinor);
  const counted = money(cmd.currency, cmd.countedMinor);
  const varianceMinor = counted.minorUnits - expected.minorUnits;
  const balanced = varianceMinor === 0n;
  return {
    currency: cmd.currency,
    expectedMinor: expected.minorUnits,
    countedMinor: counted.minorUnits,
    varianceMinor,
    closeState: balanced ? "BALANCED" : "VARIANCE_REQUIRES_REASON",
    autoCloseAllowed: balanced,
  };
}
