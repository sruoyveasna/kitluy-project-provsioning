/**
 * The booking wizard composer: Items → Customer → Pricing → Review inside the
 * two-column laundry workspace.
 *
 * PROVENANCE: donor `NewOrder.tsx` (kitluy-laundry-pos-desk-app@8b2f107).
 * The card/QR gateway polling and the hard-coded USD parity are gone; the
 * payment-readiness gate is back in slice 2 as the Store Hub's quote: Review
 * opens only once the Hub has priced the cart and the cash covers it
 * (T1-REAL-OPERATIONS-001).
 */
import { useEffect } from "react";

import { useAppState } from "@face/app/useAppState";
import { useT1WizardScrollReporter } from "@face/hooks/useT1WizardScrollReporter";
import { useWfKgInputDismiss } from "@face/hooks/useWfKgInputDismiss";

import { BookingStepsRow } from "../laundry-savor/BookingMainHead";
import { LaundryBookingPanel } from "../laundry-savor/LaundryBookingPanel";
import { LaundryBookingWorkspace } from "../laundry-savor/LaundryBookingWorkspace";
import { Step0Customer } from "./Step0Customer";
import { Step1Items } from "./Step1Items";
import { Step2Pricing, tenderedKhr } from "./Step2Pricing";
import { Step3Review } from "./Step3Review";

export const NewOrder = () => {
  const {
    wizStep,
    setWizStep,
    resetOrder,
    selServiceType,
    setSelServiceType,
    setSelFamilyCode,
    setT1WizardScrollRatio,
    quote,
    tenderKhrDigits,
    tenderUsdDigits,
    confirmation,
  } = useAppState();

  const onWizardScroll = useT1WizardScrollReporter();
  useWfKgInputDismiss();

  useEffect(() => {
    setT1WizardScrollRatio(0);
  }, [wizStep, setT1WizardScrollRatio]);

  const panelBack =
    wizStep === 0
      ? () => {
          if (selServiceType) {
            setSelServiceType(null);
            setSelFamilyCode(null);
            return;
          }
          resetOrder();
        }
      : wizStep === 1
        ? () => setWizStep(0)
        : wizStep === 3
          ? () => setWizStep(2)
          : () => setWizStep(1);

  const panelNext =
    wizStep === 0 ? () => setWizStep(1) : wizStep === 1 ? () => setWizStep(2) : () => setWizStep(3);

  const panelNextLabel =
    wizStep === 0 ? "Next: Customer" : wizStep === 1 ? "Next: Pricing" : "Next: Review";

  // A chosen Hub customer, a typed new-customer name, or a walk-in all pass
  // into Pricing (WS-12-T002 opens a draft for a walk-in). Review opens only
  // once the Store Hub priced the cart and the cash covers its total — the
  // Hub would refuse the confirm otherwise (TENDER_INSUFFICIENT).
  const covered =
    quote !== null &&
    tenderedKhr(tenderKhrDigits, tenderUsdDigits, quote.khrPerUsd).total >=
      BigInt(quote.totalMinor);
  const panelNextDisabled = wizStep === 2 ? !covered : false;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
      data-wizard-step={wizStep}
    >
      <LaundryBookingWorkspace
        bookingStep={wizStep}
        main={
          wizStep === 1 ? (
            <Step0Customer layout="main" />
          ) : (
            <div className="sv-menu-card sv-menu-card--booking-steps">
              <BookingStepsRow />
              <div className="sv-booking-main-scroll hide-scrollbar" onScroll={onWizardScroll}>
                {wizStep === 0 ? (
                  <Step1Items />
                ) : wizStep === 2 ? (
                  <Step2Pricing layout="main" />
                ) : (
                  <Step3Review layout="main" />
                )}
              </div>
            </div>
          )
        }
        panel={
          <LaundryBookingPanel
            wizStep={wizStep}
            onBack={panelBack}
            onNext={wizStep < 3 && confirmation === null ? panelNext : undefined}
            backLabel={wizStep === 0 && !selServiceType ? "Clear" : "Back"}
            nextLabel={panelNextLabel}
            nextDisabled={panelNextDisabled}
          />
        }
      />
    </div>
  );
};
