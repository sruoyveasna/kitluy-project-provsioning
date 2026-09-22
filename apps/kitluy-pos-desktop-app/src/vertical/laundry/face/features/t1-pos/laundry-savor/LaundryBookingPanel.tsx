import type { ReactNode } from "react";
import { useAppState } from "@face/app/useAppState";
import { Step2Pricing } from "../new-order/Step2Pricing";
import { Step3Review } from "../new-order/Step3Review";
import { LaundryBookingCartLines } from "./LaundryBookingCartLines";
import { LaundryBookingContextStrip } from "./LaundryBookingContextStrip";
import { LaundryBookingCustomerBlock } from "./LaundryBookingCustomerBlock";
import { LaundryBookingSubtotalBar } from "./LaundryBookingSubtotalBar";
import { LaundryBookingWfKgNumpad } from "./LaundryBookingWfKgNumpad";
export const LaundryBookingPanel = ({
  wizStep,
  onBack,
  onNext,
  backLabel = "Back",
  nextLabel,
  nextDisabled,
  extraActions,
}: {
  wizStep: number;
  onBack?: () => void;
  onNext?: () => void;
  backLabel?: string;
  nextLabel: string;
  nextDisabled?: boolean;
  extraActions?: ReactNode;
}) => {
  const { bookingLineCount, confirmation, wfKgInputActive, selServiceType } = useAppState();

  const showCartLines = wizStep === 0;
  const showWfKgNumpad = showCartLines && wfKgInputActive && selServiceType === "wf";
  const showCustomerPanel = wizStep === 1;
  const showPricingPanel = wizStep === 2;
  const showReviewPanel = wizStep === 3;
  // The draft exists from the Pricing step on; the wizard closes only once
  // the Store Hub confirmed the Booking (slice 2).
  const hideCtaRow = confirmation !== null;

  return (
    <div className="sv-od" data-wiz-step={wizStep}>
      {showCustomerPanel && (
        <div className="sv-od-title">
          Booking details
          <span
            className="km"
            style={{
              fontFamily: "var(--sv-font-km)",
              fontWeight: 500,
              color: "var(--sv-mute)",
              marginLeft: 10,
              fontSize: 19,
            }}
          >
            ព័ត៌មានកក់
          </span>
        </div>
      )}

      {showCustomerPanel && (
        <div className="sv-od-customer-block rail-grow">
          <span className="sv-field-label">Customer</span>
          <LaundryBookingCustomerBlock />
        </div>
      )}

      {showCartLines && (
        <div className={"sv-od-items-body" + (showWfKgNumpad ? " sv-od-items-body--kg-edit" : "")}>
          <LaundryBookingContextStrip />
          <div className="sv-od-orderhd">
            <div className="l">Ordered items</div>
            <div className="r">
              {bookingLineCount} {bookingLineCount === 1 ? "item" : "items"}
            </div>
          </div>
          <div className="sv-od-lines hide-scrollbar">
            <LaundryBookingCartLines />
          </div>
        </div>
      )}

      {showCartLines && (
        <div className="sv-od-items-footer">
          {showWfKgNumpad && (
            <div className="kl-touch-pad-footer sv-wf-kg-numpad-rail" data-wf-kg-numpad-zone>
              <LaundryBookingWfKgNumpad />
            </div>
          )}
          <div className="sv-od-subtotal-slot">
            <LaundryBookingSubtotalBar />
          </div>
        </div>
      )}

      {showPricingPanel && (
        <div className="sv-od-pricing-rail">
          <Step2Pricing layout="panel" />
        </div>
      )}

      {showReviewPanel && (
        <div className="sv-od-review-rail">
          <Step3Review layout="panel" />
        </div>
      )}

      {extraActions}

      {(onBack || onNext) && !hideCtaRow && (
        <div className="sv-cta-row">
          {onBack && (
            <button type="button" className="sv-cta outline" onClick={onBack}>
              {backLabel}
            </button>
          )}
          {onNext && (
            <button type="button" className="sv-cta" onClick={onNext} disabled={nextDisabled}>
              {nextLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
