/**
 * Pricing step — NOT AVAILABLE on a Pi Terminal yet.
 *
 * PROVENANCE: the donor's `Step2Pricing.tsx` (844 lines: express surcharge,
 * pickup slots, loyalty coins, cash keypad, ABA PayWay) is GATED-PENDING
 * WS-12-T004 / T005 in the disposition register. Pricing truth stays with the
 * WS-05 authorities and `@kitluy/money`; a terminal never computes a Booking
 * price locally (task register §2). This step keeps the wizard's shape and
 * says exactly why it is empty.
 */
import { useThemeColors } from "@face/app/ThemeProvider";
import { useAppState } from "@face/app/useAppState";
import { fmt } from "@face/lib/formatters";

import { BookingMainHead } from "../laundry-savor/BookingMainHead";

export const Step2Pricing = ({ layout }: { layout: "main" | "panel" }) => {
  const C = useThemeColors();
  const { cartSubtotal, cartCount } = useAppState();

  if (layout === "panel") {
    return (
      <div className="sv-review-panel-cards hide-scrollbar" data-pricing="not_available">
        <div className="sv-review-card">
          <div className="sv-review-card-label">Preview subtotal</div>
          <div className="sv-review-card-value sv-review-card-value--lg">{fmt(cartSubtotal)}</div>
          <div className="sv-review-card-sub">
            {cartCount} line{cartCount === 1 ? "" : "s"} · catalog prices, not a Booking price
          </div>
        </div>
        <div className="sv-review-card">
          <div className="sv-review-card-label">Booking price</div>
          <div className="sv-review-card-sub">Priced by the Store Hub when WS-12-T004 lands.</div>
        </div>
      </div>
    );
  }

  return (
    <div data-pricing="not_available">
      <BookingMainHead marginBottom={12}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Pricing</h3>
      </BookingMainHead>
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
          Pricing is not available on this terminal yet
        </h3>
        <p style={{ fontSize: 14, color: C.textSec, margin: 0, lineHeight: 1.55 }}>
          Express surcharge, capacity, due time and the confirmed Booking price are WS-12-T004;
          deposit and payment are WS-12-T005. Until the Store Hub serves them, this booking is saved
          as a <strong>Booking Draft</strong> without a price. Continue to Review to open the draft.
        </p>
      </div>
    </div>
  );
};
