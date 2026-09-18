const STEP_LABELS = ["Items", "Customer", "Pricing", "Review"] as const;

/** Full-width step strip — own row above the left section title. */
export const LaundryStepIndicator = ({
  current,
  maxReachable,
  onStepClick,
  disableNavigation,
}: {
  current: number;
  /** Highest step index the cashier has reached — all steps up to here stay jumpable. */
  maxReachable: number;
  onStepClick?: (step: number) => void;
  disableNavigation?: boolean;
}) => (
  <div className="sv-booking-steps" role="list" aria-label="Booking steps">
    {STEP_LABELS.map((label, i) => {
      const active = i === current;
      const visited = i <= maxReachable && !active;
      const clickable = !active && i <= maxReachable && !disableNavigation && Boolean(onStepClick);
      const className =
        "sv-booking-step" +
        (active ? " active" : "") +
        (visited ? " done" : "") +
        (clickable ? " clickable" : "");

      const content = (
        <>
          <span className="num">{visited ? "✓" : i + 1}</span>
          <span>{label}</span>
        </>
      );

      if (clickable) {
        return (
          <button
            key={label}
            type="button"
            role="listitem"
            className={className}
            aria-current={active ? "step" : undefined}
            aria-label={`Go to ${label}`}
            title={`Go to ${label}`}
            onClick={() => onStepClick!(i)}
          >
            {content}
          </button>
        );
      }

      return (
        <div
          key={label}
          role="listitem"
          className={className}
          aria-current={active ? "step" : undefined}
          title={label}
        >
          {content}
        </div>
      );
    })}
  </div>
);

export const BOOKING_STEPS = STEP_LABELS;
