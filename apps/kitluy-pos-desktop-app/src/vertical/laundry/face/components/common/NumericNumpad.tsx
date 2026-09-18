import { I } from "@face/components/common/icons";
import "@face/styles/touch-input-pad.css";

type NumpadKey = number | "back" | "clear";

const NUMPAD_KEYS: NumpadKey[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, "clear", 0, "back"];

export function NumericNumpad({
  value,
  onChange,
  statusLabel,
  statusSuffix,
  maxLength = 2,
}: {
  value: string;
  onChange: (next: string) => void;
  statusLabel?: string;
  statusSuffix?: string;
  maxLength?: number;
}) {
  const display = value.length === 0 ? "—" : statusSuffix ? `${value} ${statusSuffix}` : value;

  const handleKey = (k: NumpadKey) => {
    if (k === "clear") {
      onChange("");
      return;
    }
    if (k === "back") {
      onChange(value.slice(0, -1));
      return;
    }
    if (value.length >= maxLength) return;
    onChange(value + String(k));
  };

  return (
    <div className="kl-touch-pad-zone kl-touch-pad-zone--numpad">
      <div className={`kl-pad-status right${value.length === 0 ? " muted" : ""}`}>
        {statusLabel ? `${statusLabel} · ` : ""}
        {display}
      </div>
      <div className="kl-numpad-grid">
        {NUMPAD_KEYS.map((k, i) => {
          const isClear = k === "clear";
          const isBack = k === "back";
          const disabled =
            (isBack && value.length === 0) || (typeof k === "number" && value.length >= maxLength);
          return (
            <button
              key={i}
              type="button"
              className={
                "kl-numpad-key" +
                (isClear ? " kl-numpad-key--plus" : "") +
                (isBack ? " kl-numpad-key--back" : "")
              }
              onClick={() => handleKey(k)}
              disabled={disabled}
              aria-label={isBack ? "Delete last digit" : isClear ? "Clear" : undefined}
            >
              {isClear ? "C" : isBack ? <I.Backspace s={24} c="var(--sv-danger,#cb3a31)" /> : k}
            </button>
          );
        })}
      </div>
    </div>
  );
}
