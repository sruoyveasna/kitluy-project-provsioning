import { useEffect, type ReactNode } from "react";
import { font, type ThemeColors } from "@face/styles/tokens";

export interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Caller's active palette. Pass the static `C` token for light-only screens
   * (e.g. PinModal) or the `useThemeColors()` result for theme-aware screens
   * (e.g. ExchangeRateModal) — the shell renders identically to the old inline
   * markup in whichever theme the caller was already using.
   */
  colors: ThemeColors;
  children: ReactNode;
  /** Card width. Default matches the common `min(480px, 92vw)` sizing. */
  width?: number | string;
  /** Card padding. Default 28. */
  padding?: number;
  /** Backdrop color. Default `rgba(15, 23, 42, 0.6)`. */
  backdrop?: string;
  /** Show the circular ✕ close button (top-right). Default true. */
  showClose?: boolean;
  /** Disable the close button (e.g. while a mutation is pending). */
  closeDisabled?: boolean;
  role?: string;
  ariaLabelledby?: string;
  ariaLabel?: string;
}

/**
 * Shared modal chrome: fixed blurred backdrop + centered card + optional close
 * button, with Escape-to-close and backdrop-click-to-close. Extracted from the
 * three copy-pasted inline modals (PinModal, ExchangeRateModal, Step3Review's
 * cancel dialog). Purely presentational — the body is passed as children and
 * each caller keeps its own logic/colors.
 */
export const ModalShell = ({
  isOpen,
  onClose,
  colors,
  children,
  width = "min(480px, 92vw)",
  padding = 28,
  backdrop = "rgba(15, 23, 42, 0.6)",
  showClose = true,
  closeDisabled = false,
  role,
  ariaLabelledby,
  ariaLabel,
}: ModalShellProps) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: backdrop,
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        fontFamily: font,
      }}
    >
      <div
        role={role}
        aria-labelledby={ariaLabelledby}
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          background: colors.card,
          borderRadius: 20,
          padding,
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
          border: `1px solid ${colors.border}`,
          position: "relative",
        }}
      >
        {showClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            disabled={closeDisabled}
            style={{
              position: "absolute",
              top: 14,
              right: 14,
              width: 34,
              height: 34,
              borderRadius: 10,
              border: "none",
              background: colors.gray100,
              color: colors.textSec,
              cursor: closeDisabled ? "not-allowed" : "pointer",
              opacity: closeDisabled ? 0.5 : 1,
              fontSize: 16,
              fontFamily: font,
            }}
          >
            ✕
          </button>
        )}
        {children}
      </div>
    </div>
  );
};
