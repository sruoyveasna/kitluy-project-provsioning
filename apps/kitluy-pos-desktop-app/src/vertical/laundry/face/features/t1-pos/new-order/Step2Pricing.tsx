/**
 * Pricing step — the Store Hub's price, and the cash tender.
 *
 * PROVENANCE: the donor's `Step2Pricing.tsx` (kitluy-laundry-pos-desk-app@
 * 8b2f107): the cash keypad with its KHR and USD lanes and the change line
 * are the design taken over; loyalty coins, pickup slots and the card/QR
 * gateways are GATED (WS-12-T005, BLK-006) and are not here.
 *
 * T1-REAL-OPERATIONS-001 slice 2. The figures on this screen are the STORE
 * HUB's quote over the delivered catalog and money contract (`ports.quote`),
 * fetched for the cart as it stands; the face never computes a Booking price
 * of its own. Express is offered only when the money contract carries a
 * surcharge; a USD lane only when it carries a rate — otherwise those inputs
 * do not exist, and the Hub would refuse them anyway.
 */
import { usdCentsToKhr } from "@kitluy-verticals/phase1-laundry";

import { useThemeColors } from "@face/app/ThemeProvider";
import { useAppState } from "@face/app/useAppState";
import { NumericNumpad } from "@face/components/common/NumericNumpad";
import { useHubQuote } from "@face/hooks/useHubQuote";
import { fmt } from "@face/lib/formatters";

import { BookingMainHead } from "../laundry-savor/BookingMainHead";

/** Whole riel / whole dollars typed on the pad, as integers. */
export function tenderDigitsToInt(digits: string): bigint {
  return digits === "" ? 0n : BigInt(digits.replace(/\D/gu, "") || "0");
}

/**
 * What the cashier holds, in riel, at the Hub's delivered rate — the same
 * conversion the Hub applies (usdCentsToKhr, half-up). Display only.
 */
export function tenderedKhr(
  khrDigits: string,
  usdDigits: string,
  khrPerUsd: number | null,
): {
  readonly khr: bigint;
  readonly usdCents: bigint;
  readonly usdAsKhr: bigint;
  readonly total: bigint;
} {
  const khr = tenderDigitsToInt(khrDigits);
  const usdCents = khrPerUsd === null ? 0n : tenderDigitsToInt(usdDigits) * 100n;
  const usdAsKhr = khrPerUsd === null || usdCents === 0n ? 0n : usdCentsToKhr(usdCents, khrPerUsd);
  return { khr, usdCents, usdAsKhr, total: khr + usdAsKhr };
}

export const Step2Pricing = ({ layout }: { layout: "main" | "panel" }) => {
  const C = useThemeColors();
  const {
    quote,
    quoteFailure,
    express,
    setExpress,
    tenderKhrDigits,
    setTenderKhrDigits,
    tenderUsdDigits,
    setTenderUsdDigits,
    cartLines,
  } = useAppState();
  const { busy } = useHubQuote(layout === "main");

  const total = quote === null ? null : BigInt(quote.totalMinor);
  const tender = tenderedKhr(tenderKhrDigits, tenderUsdDigits, quote?.khrPerUsd ?? null);
  const change = total === null ? null : tender.total - total;
  const covered = total !== null && tender.total >= total;

  // ------------------------------------------------------------------ panel
  if (layout === "panel") {
    return (
      <div
        className="sv-review-panel-cards hide-scrollbar"
        data-pricing={quote === null ? "pending" : "quoted"}
      >
        <div className="sv-review-card">
          <div className="sv-review-card-label">Total to pay</div>
          <div className="sv-review-card-value sv-review-card-value--lg">
            {total === null ? "—" : fmt(total.toString())}
          </div>
          <div className="sv-review-card-sub">
            {quote === null
              ? busy
                ? "Asking the Store Hub…"
                : (quoteFailure ?? "not priced yet")
              : `Store Hub price · ${String(quote.lines.length)} line${quote.lines.length === 1 ? "" : "s"}`}
          </div>
        </div>
        <div className="sv-review-card" data-tender-lane="khr">
          <NumericNumpad
            value={tenderKhrDigits}
            onChange={setTenderKhrDigits}
            statusLabel="Cash ៛"
            maxLength={9}
          />
        </div>
        {quote?.khrPerUsd !== null && quote?.khrPerUsd !== undefined ? (
          <div className="sv-review-card" data-tender-lane="usd">
            <NumericNumpad
              value={tenderUsdDigits}
              onChange={setTenderUsdDigits}
              statusLabel="Cash $"
              maxLength={5}
            />
            <div className="sv-review-card-sub">
              1 $ = {fmt(quote.khrPerUsd)} (Store rate) · {fmt(tender.usdAsKhr.toString())}
            </div>
          </div>
        ) : (
          <div className="sv-review-card-sub" data-tender-lane="usd-unavailable">
            USD cash needs a Store rate; none is delivered.
          </div>
        )}
        <div className="sv-review-card" data-tender-summary>
          <div className="sv-review-card-label">Tendered</div>
          <div className="sv-review-card-value">{fmt(tender.total.toString())}</div>
          <div className="sv-review-card-label" style={{ marginTop: 6 }}>
            Change
          </div>
          <div
            className="sv-review-card-value"
            style={{ color: change !== null && change < 0n ? C.redDark : undefined }}
          >
            {change === null
              ? "—"
              : change < 0n
                ? `short ${fmt((-change).toString())}`
                : fmt(change.toString())}
          </div>
          <div className="sv-review-card-sub">
            {covered ? "Cash in full — continue to Review" : "Cash in full at intake"}
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------- main
  return (
    <div data-pricing={quote === null ? "pending" : "quoted"}>
      <BookingMainHead marginBottom={12}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Pricing</h3>
        <span className="sv-review-badge">priced by the Store Hub</span>
      </BookingMainHead>
      {quote === null ? (
        <div
          role="status"
          style={{
            borderRadius: 16,
            border: `1.5px dashed ${C.border}`,
            background: C.card,
            padding: "26px 24px",
            maxWidth: 640,
          }}
        >
          <h3 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 8px" }}>
            {busy
              ? "Asking the Store Hub for the price…"
              : "The Store Hub has not priced this booking"}
          </h3>
          <p style={{ fontSize: 14, color: C.textSec, margin: 0, lineHeight: 1.55 }}>
            {quoteFailure ??
              (cartLines.length === 0
                ? "Add at least one service on the Items step."
                : "The price is requested from the Store Hub for the lines in the cart.")}
          </p>
        </div>
      ) : (
        <div className="sv-review-lines-card" data-quote-lines>
          {quote.lines.map((line) => (
            <div key={`${line.serviceId}-${line.quantity}`} className="sv-review-line">
              <span className="sv-review-line-name">
                {line.displayName}
                {line.pricingMethod === "per_weight" && line.weighedGrams !== null
                  ? ` · ${(line.weighedGrams / 1000).toString()} kg weighed`
                  : ""}
              </span>
              <span className="sv-review-line-qty">
                {line.pricingMethod === "per_weight"
                  ? `${Number(line.quantity).toString()} kg × ${fmt(line.unitPriceMinor)}`
                  : `×${Number(line.quantity).toString()} · ${fmt(line.unitPriceMinor)}`}
              </span>
              <span className="sv-review-line-price">{fmt(line.lineSubtotalMinor)}</span>
            </div>
          ))}
          <div className="sv-review-line" data-quote-subtotal>
            <span className="sv-review-line-name">Subtotal</span>
            <span className="sv-review-line-qty" />
            <span className="sv-review-line-price">{fmt(quote.subtotalMinor)}</span>
          </div>
          {quote.expressSurchargeBps !== null ? (
            <div className="sv-review-line" data-quote-express>
              <span className="sv-review-line-name">
                <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={express}
                    onChange={(e) => setExpress(e.target.checked)}
                    aria-label="Express service"
                  />
                  Express (+{(quote.expressSurchargeBps / 100).toString()}%)
                </label>
              </span>
              <span className="sv-review-line-qty" />
              <span className="sv-review-line-price">{fmt(quote.expressSurchargeMinor)}</span>
            </div>
          ) : null}
          <div className="sv-review-line" data-quote-total style={{ fontWeight: 700 }}>
            <span className="sv-review-line-name">Total</span>
            <span className="sv-review-line-qty">{quote.currencyCode}</span>
            <span className="sv-review-line-price">{fmt(quote.totalMinor)}</span>
          </div>
          <div className="sv-review-card-sub" style={{ padding: "8px 12px" }}>
            Configuration v{quote.configurationVersion}
            {quote.locationCode ? ` · ${quote.locationCode}` : ""} · the Hub prices every line from
            its delivered catalog; a changed cart is priced again.
          </div>
        </div>
      )}
    </div>
  );
};
