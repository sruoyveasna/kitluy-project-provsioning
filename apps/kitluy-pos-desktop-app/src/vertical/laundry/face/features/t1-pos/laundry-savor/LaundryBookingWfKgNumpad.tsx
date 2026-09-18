import { useAppState } from "@face/app/useAppState";
import { NumericNumpad } from "@face/components/common/NumericNumpad";
import { WF_KG_TYPED_MAX_DIGITS, normalizeWfKgDigits, parseWfKgDigits } from "./wfKgConstants";

/** Right-rail numpad while editing Wash & Fold kg on the items step. */
export const LaundryBookingWfKgNumpad = () => {
  const { wfKgDigits, setWfKgDigits, setWfKg } = useAppState();

  return (
    <NumericNumpad
      value={wfKgDigits}
      onChange={(next) => {
        const normalized = normalizeWfKgDigits(next);
        setWfKgDigits(normalized);
        setWfKg(parseWfKgDigits(normalized));
      }}
      statusLabel="Weight"
      statusSuffix="kg"
      maxLength={WF_KG_TYPED_MAX_DIGITS}
    />
  );
};
