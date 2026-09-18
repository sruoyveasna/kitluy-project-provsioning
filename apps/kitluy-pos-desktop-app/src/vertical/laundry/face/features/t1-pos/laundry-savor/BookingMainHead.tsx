import type { ReactNode } from "react";
import { useAppState } from "@face/app/useAppState";
import { BOOKING_STEPS, LaundryStepIndicator } from "./LaundryStepIndicator";

/** Full-width booking steps — dedicated row at top of the left column. */
export const BookingStepsRow = () => {
  const { wizStep, wizStepMax, bookingDraft, setWizStep } = useAppState();
  if (wizStep < 0 || wizStep > 3) return null;
  const committed = bookingDraft !== null;
  const stepCurrent = committed ? BOOKING_STEPS.length : wizStep;
  const maxReachable = committed ? BOOKING_STEPS.length - 1 : wizStepMax;

  const handleStepClick = (step: number) => {
    if (committed || step === wizStep || step > wizStepMax) return;
    setWizStep(step);
  };

  return (
    <div className="sv-booking-steps-row">
      <LaundryStepIndicator
        current={stepCurrent}
        maxReachable={maxReachable}
        onStepClick={handleStepClick}
        disableNavigation={committed}
      />
    </div>
  );
};

/** Section title block below the step row (Customer, Dry Clean, etc.). */
export const BookingMainHead = ({
  children,
  marginBottom,
}: {
  children: ReactNode;
  marginBottom?: number;
}) => (
  <div
    className="sv-booking-section-head"
    style={marginBottom != null ? { marginBottom } : undefined}
  >
    {children}
  </div>
);
