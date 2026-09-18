import { useAppState } from "@face/app/useAppState";
import { fmt } from "@face/lib/formatters";

/** Pinned subtotal — fixed-height slot above Back / Next on the items step. */
export const LaundryBookingSubtotalBar = () => {
  const { cart, cartCount, cartSubtotal } = useAppState();
  const hasCart = cart.length > 0;

  return (
    <div
      className={"sv-od-subtotal-bar" + (hasCart ? "" : " sv-od-subtotal-bar--empty")}
      role="status"
      aria-live="polite"
    >
      <div className="sv-od-subtotal-bar-left">
        <span className="sv-od-subtotal-bar-label">Subtotal</span>
        <span className="sv-od-subtotal-bar-meta">
          {hasCart ? `${cartCount} ${cartCount === 1 ? "item" : "items"}` : "—"}
        </span>
      </div>
      <div className="sv-od-subtotal-bar-amount-wrap hide-scrollbar">
        <span className="sv-od-subtotal-bar-amount">{hasCart ? fmt(cartSubtotal) : "—"}</span>
      </div>
    </div>
  );
};
