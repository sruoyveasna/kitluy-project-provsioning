import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useState } from "react";
import { I } from "./icons";
import { touchInteractive } from "@face/styles/kiosk";
import { font } from "@face/styles/tokens";

/**
 * Keystroke emitted by the on-screen keyboard.
 * Special keys are interpreted by the parent (e.g. Tab cycles fields).
 */
export type OnScreenKey =
  | { type: "char"; char: string }
  | { type: "backspace" }
  | { type: "enter" }
  | { type: "tab" }
  | { type: "escape" }
  | { type: "arrowLeft" }
  | { type: "arrowRight" };

interface OnScreenKeyboardProps {
  onKey: (key: OnScreenKey) => void;
  /** Sticky shift / caps — affects letters and punctuation with shift-alternates. */
  shifted: boolean;
  onToggleShift: () => void;
  /** Visually quiet the keyboard (e.g. when no field is focused). Keys still work. */
  dimmed?: boolean;
}

/** Synced with `touch-input-pad.css` (--kl-pad-key-h / --kl-pad-gap). */
const KEY_HEIGHT = 56;
const KEY_GAP = 6;

const ROW_TOP_KEYS = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"] as const;

const ROW_MID_KEYS = ["a", "s", "d", "f", "g", "h", "j", "k", "l"] as const;

const ROW_BOT_KEYS = ["z", "x", "c", "v", "b", "n", "m"] as const;

/** Symbol layer (still no digit row — numpad on the right). */
const SYM_R1 = ["!", "@", "#", "$", "%", "^", "&", "*", "(", ")"] as const;
const SYM_R2 = ["-", "_", "+", "=", "[", "]", "'", '"'] as const;
const SYM_R3 = ["\\", "|", "`", "~", "{", "}", "/", "<"] as const;

/** No outer “shell” — parent provides the same footer strip as the numpad rail. */
const containerStyle = (dimmed?: boolean): CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  gap: KEY_GAP,
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  padding: 0,
  background: "transparent",
  border: "none",
  opacity: dimmed ? 0.7 : 1,
  transition: "opacity 0.15s ease",
  ...touchInteractive,
});

const rowStyle: CSSProperties = {
  display: "flex",
  gap: KEY_GAP,
  alignItems: "stretch",
  width: "100%",
  minWidth: 0,
};

const baseKeyStyle: CSSProperties = {
  minWidth: 0,
  minHeight: KEY_HEIGHT,
  boxSizing: "border-box",
  borderRadius: 12,
  border: `1.5px solid var(--sv-line)`,
  background: "var(--sv-surface)",
  color: "var(--sv-ink)",
  fontSize: 17,
  fontWeight: 700,
  fontFamily: font,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  lineHeight: 1.05,
  padding: "4px 1px",
  ...touchInteractive,
};

function swallowFocus(
  e: ReactPointerEvent<HTMLButtonElement> | ReactMouseEvent<HTMLButtonElement>,
) {
  e.preventDefault();
}

type KeyVariant = "default" | "modifier" | "danger" | "dead" | "wide";

interface KeyButtonProps {
  label: React.ReactNode;
  onPress: () => void;
  flex?: number;
  ariaLabel?: string;
  /** Smaller caption for Esc / Tab / Ctrl. */
  small?: boolean;
  variant?: KeyVariant;
  active?: boolean;
}

function KeyButton({
  label,
  onPress,
  flex,
  ariaLabel,
  small,
  variant = "default",
  active,
}: KeyButtonProps) {
  /** Wide `string` so narrowed token literals (`"var(--sv-surface)"`, …) can widen per variant. */
  let bg: string = "var(--sv-surface)";
  let color: string = "var(--sv-ink)";
  let border: string = "var(--sv-line)";
  let cursor: CSSProperties["cursor"] = "pointer";

  if (variant === "modifier") {
    bg = active ? "var(--sv-primary)" : "var(--sv-btn-soft)";
    color = active ? "var(--sv-surface)" : "var(--sv-ink-2)";
    border = active ? "var(--sv-primary)" : "var(--sv-line)";
  } else if (variant === "danger") {
    bg = "var(--sv-danger-soft)";
    color = "var(--sv-danger)";
    border = "var(--sv-danger-soft)";
  } else if (variant === "dead") {
    bg = "var(--sv-btn-soft)";
    color = "var(--sv-mute)";
    border = "var(--sv-line)";
    cursor = "default";
  } else if (variant === "wide") {
    bg = "var(--sv-primary-tint)";
    color = "var(--sv-primary-deep)";
    border = `var(--sv-primary)40`;
  }

  const opacityStyle = variant === "dead" ? { opacity: 0.75 as const } : {};

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-disabled={variant === "dead" ? true : undefined}
      onPointerDown={variant === "dead" ? undefined : swallowFocus}
      onMouseDown={variant === "dead" ? undefined : swallowFocus}
      onClick={variant === "dead" ? undefined : onPress}
      disabled={variant === "dead"}
      aria-pressed={variant === "modifier" ? active : undefined}
      style={{
        ...baseKeyStyle,
        flex: flex ?? 1,
        background: bg,
        color,
        border: `1.5px solid ${border}`,
        cursor,
        fontSize: small ? 11 : baseKeyStyle.fontSize,
        fontWeight: small ? 600 : 700,
        ...opacityStyle,
      }}
    >
      {label}
    </button>
  );
}

function OsWinGlyph({ s = 14, fill = "var(--sv-ink-2)" }: { s?: number; fill?: string }) {
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        fill={fill}
        d="M0 2.5h6.85v5.03H0V2.5zm8.05 0H15v5.03H8.05V2.5zM0 8.97h6.85V14H0V8.97zm8.05 0H15V14H8.05V8.97z"
      />
    </svg>
  );
}

function MicGlyph({ s = 18, stroke = "var(--sv-ink-2)" }: { s?: number; stroke?: string }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2}>
      <path d="M12 14a3 3 0 003-3V7a3 3 0 10-6 0v4a3 3 0 003 3z" />
      <path d="M19 11a7 7 0 01-14 0M12 17v4" strokeLinecap="round" />
    </svg>
  );
}

export function OnScreenKeyboard({ onKey, shifted, onToggleShift, dimmed }: OnScreenKeyboardProps) {
  const [symbolsMode, setSymbolsMode] = useState(false);

  const emitLetter = (c: string) => onKey({ type: "char", char: shifted ? c.toUpperCase() : c });

  const punct = (plain: string, whenShifted: string) =>
    onKey({ type: "char", char: shifted ? whenShifted : plain });

  if (symbolsMode) {
    return (
      <div style={containerStyle(dimmed)} aria-label="On-screen symbols" role="group">
        <div style={rowStyle}>
          {SYM_R1.map((c) => (
            <KeyButton key={c} label={c} onPress={() => onKey({ type: "char", char: c })} />
          ))}
          <KeyButton
            label={<I.Backspace s={20} c={"var(--sv-danger)"} />}
            ariaLabel="Backspace"
            variant="danger"
            flex={1.25}
            onPress={() => onKey({ type: "backspace" })}
          />
        </div>

        <div style={rowStyle}>
          <KeyButton
            label="Tab"
            small
            flex={0.95}
            ariaLabel="Tab"
            variant="modifier"
            onPress={() => onKey({ type: "tab" })}
          />
          {SYM_R2.map((c) => (
            <KeyButton key={c} label={c} onPress={() => onKey({ type: "char", char: c })} />
          ))}
          <KeyButton
            label="↵"
            ariaLabel="Enter"
            variant="wide"
            flex={1.2}
            onPress={() => onKey({ type: "enter" })}
          />
        </div>

        <div style={rowStyle}>
          <KeyButton
            label="⇧"
            ariaLabel="Caps lock"
            variant="modifier"
            active={shifted}
            flex={1.05}
            onPress={onToggleShift}
          />
          {SYM_R3.map((c) => (
            <KeyButton key={c} label={c} onPress={() => onKey({ type: "char", char: c })} />
          ))}
          <KeyButton
            label="⇧"
            ariaLabel="Caps lock"
            variant="modifier"
            active={shifted}
            flex={1.05}
            onPress={onToggleShift}
          />
        </div>

        <div style={rowStyle}>
          <KeyButton
            label="ABC"
            small
            flex={0.95}
            ariaLabel="Letters"
            variant="modifier"
            onPress={() => setSymbolsMode(false)}
          />
          <KeyButton
            label="Ctrl"
            small
            variant="dead"
            flex={0.75}
            ariaLabel="Not used on this terminal"
            onPress={() => undefined}
          />
          <KeyButton
            label={<OsWinGlyph />}
            variant="dead"
            flex={0.75}
            ariaLabel="Not used on this terminal"
            onPress={() => undefined}
          />
          <KeyButton
            label="Alt"
            small
            variant="dead"
            flex={0.72}
            ariaLabel="Not used on this terminal"
            onPress={() => undefined}
          />
          <KeyButton
            label={<span style={{ fontSize: 11, letterSpacing: 0.5 }}>space</span>}
            ariaLabel="Space"
            flex={3.8}
            onPress={() => onKey({ type: "char", char: " " })}
          />
          <KeyButton
            label={<MicGlyph />}
            variant="dead"
            flex={0.75}
            ariaLabel="Voice not available"
            onPress={() => undefined}
          />
          <KeyButton
            label="<"
            ariaLabel="Caret left"
            onPress={() => onKey({ type: "arrowLeft" })}
          />
          <KeyButton
            label=">"
            ariaLabel="Caret right"
            onPress={() => onKey({ type: "arrowRight" })}
          />
          <KeyButton
            label="ENG"
            small
            variant="dead"
            flex={0.82}
            ariaLabel="English"
            onPress={() => undefined}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle(dimmed)} aria-label="On-screen keyboard" role="group">
      {/* Row 1 — Esc · q–p · ⌫ */}
      <div style={rowStyle}>
        <KeyButton
          label="Esc"
          small
          flex={0.68}
          ariaLabel="Escape"
          variant="modifier"
          onPress={() => onKey({ type: "escape" })}
        />
        {ROW_TOP_KEYS.map((c) => (
          <KeyButton key={c} label={shifted ? c.toUpperCase() : c} onPress={() => emitLetter(c)} />
        ))}
        <KeyButton
          label={<I.Backspace s={20} c={"var(--sv-danger)"} />}
          ariaLabel="Backspace"
          variant="danger"
          flex={1.1}
          onPress={() => onKey({ type: "backspace" })}
        />
      </div>

      {/* Row 2 — Tab · a–l · ;: · Enter */}
      <div style={rowStyle}>
        <KeyButton
          label="Tab"
          small
          flex={0.9}
          ariaLabel="Tab"
          variant="modifier"
          onPress={() => onKey({ type: "tab" })}
        />
        {ROW_MID_KEYS.map((c) => (
          <KeyButton key={c} label={shifted ? c.toUpperCase() : c} onPress={() => emitLetter(c)} />
        ))}
        <KeyButton
          label={shifted ? ":" : ";"}
          ariaLabel={shifted ? "Colon" : "Semicolon"}
          onPress={() => punct(";", ":")}
        />
        <KeyButton
          label="↵"
          ariaLabel="Enter"
          variant="wide"
          flex={1.1}
          onPress={() => onKey({ type: "enter" })}
        />
      </div>

      {/* Row 3 — Shift · z–m · , . ? · Shift */}
      <div style={rowStyle}>
        <KeyButton
          label="⇧"
          ariaLabel={shifted ? "Caps lock on" : "Caps lock off"}
          variant="modifier"
          active={shifted}
          flex={1.05}
          onPress={onToggleShift}
        />
        {ROW_BOT_KEYS.map((c) => (
          <KeyButton key={c} label={shifted ? c.toUpperCase() : c} onPress={() => emitLetter(c)} />
        ))}
        <KeyButton
          label={shifted ? ";" : ","}
          ariaLabel={shifted ? "Semicolon" : "Comma"}
          onPress={() => punct(",", ";")}
        />
        <KeyButton
          label={shifted ? ":" : "."}
          ariaLabel={shifted ? "Colon" : "Period"}
          onPress={() => punct(".", ":")}
        />
        <KeyButton
          label={shifted ? "!" : "?"}
          ariaLabel={shifted ? "Exclamation mark" : "Question mark"}
          onPress={() => punct("?", "!")}
        />
        <KeyButton
          label="⇧"
          ariaLabel={shifted ? "Caps lock on" : "Caps lock off"}
          variant="modifier"
          active={shifted}
          flex={1.05}
          onPress={onToggleShift}
        />
      </div>

      {/* Row 4 — &123 … Modifiers … space … mic · arrows · ENG */}
      <div style={rowStyle}>
        <KeyButton
          label="&123"
          small
          flex={0.95}
          ariaLabel="Symbols"
          variant="modifier"
          onPress={() => setSymbolsMode(true)}
        />
        <KeyButton
          label="Ctrl"
          small
          variant="dead"
          flex={0.75}
          ariaLabel="Not used on this terminal"
          onPress={() => undefined}
        />
        <KeyButton
          label={<OsWinGlyph />}
          variant="dead"
          flex={0.75}
          ariaLabel="Not used on this terminal"
          onPress={() => undefined}
        />
        <KeyButton
          label="Alt"
          small
          variant="dead"
          flex={0.72}
          ariaLabel="Not used on this terminal"
          onPress={() => undefined}
        />
        <KeyButton
          label={<span style={{ fontSize: 11, letterSpacing: 0.5 }}>space</span>}
          ariaLabel="Space"
          flex={3.8}
          onPress={() => onKey({ type: "char", char: " " })}
        />
        <KeyButton
          label={<MicGlyph />}
          variant="dead"
          flex={0.75}
          ariaLabel="Voice not available"
          onPress={() => undefined}
        />
        <KeyButton label="<" ariaLabel="Caret left" onPress={() => onKey({ type: "arrowLeft" })} />
        <KeyButton
          label=">"
          ariaLabel="Caret right"
          onPress={() => onKey({ type: "arrowRight" })}
        />
        <KeyButton
          label="ENG"
          small
          variant="dead"
          flex={0.82}
          ariaLabel="English"
          onPress={() => undefined}
        />
      </div>
    </div>
  );
}
