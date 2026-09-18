import { useAppState } from "@face/app/useAppState";
import { I } from "@face/components/common/icons";
/** Cart recap on the right panel — items step only; fixed height above order lines. */
export const LaundryBookingContextStrip = () => {
  const { bookingLineCount, setSelServiceType } = useAppState();

  if (bookingLineCount === 0) return null;

  return (
    <div className="sv-booking-context-strip">
      <div className="sv-booking-context-summary">
        <I.Package s={18} />
        <span className="sv-booking-context-count">
          {bookingLineCount} {bookingLineCount === 1 ? "item" : "items"} in order
        </span>
      </div>
      <button
        type="button"
        className="sv-booking-context-add"
        onClick={() => setSelServiceType(null)}
      >
        + Add service
      </button>
    </div>
  );
};
