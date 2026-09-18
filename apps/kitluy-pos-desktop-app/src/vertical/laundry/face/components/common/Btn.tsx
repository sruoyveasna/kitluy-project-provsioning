import type { CSSProperties, ReactNode } from "react";
import { KIOSK } from "@face/styles/kiosk";
import { CV, font, RADIUS } from "@face/styles/tokens";

/** Matches Shift Open “Open Shift…” / kiosk primary actions (`KIOSK.minTap`). */
const BTN_MIN_H = KIOSK.minTap;

export type BtnVariant = "primary" | "secondary" | "danger" | "ghost" | "success" | "dark";

export type BtnSize = "sm" | "md" | "lg" | "xl";

export interface BtnProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  size?: BtnSize;
  style?: CSSProperties;
  disabled?: boolean;
  icon?: ReactNode;
}

const BASE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  border: "none",
  fontFamily: font,
  fontWeight: 600,
  borderRadius: RADIUS.pill,
  transition: "all 0.15s",
  boxSizing: "border-box",
  touchAction: "manipulation",
  WebkitTapHighlightColor: "transparent",
};

const SIZES: Record<BtnSize, CSSProperties> = {
  sm: { padding: "12px 20px", fontSize: 15, minHeight: BTN_MIN_H },
  md: { padding: "14px 26px", fontSize: 17, minHeight: BTN_MIN_H },
  lg: { padding: "14px 32px", fontSize: 18, minHeight: BTN_MIN_H },
  xl: { padding: "14px 40px", fontSize: 20, minHeight: 64 },
};

const VARIANTS: Record<BtnVariant, CSSProperties> = {
  primary: { background: CV.primary, color: "#fff" },
  secondary: {
    background: "var(--sv-btn-soft)",
    color: CV.text,
    border: `1px solid ${CV.border}`,
  },
  danger: { background: CV.redLight, color: "var(--sv-danger, #DC2626)" },
  ghost: { background: "transparent", color: CV.textSec },
  success: { background: "var(--lsv-green, #10B981)", color: "#fff" },
  dark: { background: "var(--sv-ink, #0F172A)", color: "#fff" },
};

export const Btn = ({
  children,
  onClick,
  variant = "primary",
  size = "md",
  style,
  disabled,
  icon,
}: BtnProps) => {
  const css: CSSProperties = {
    ...BASE,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    ...SIZES[size],
    ...VARIANTS[variant],
    ...style,
  };

  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} style={css}>
      {icon}
      {children}
    </button>
  );
};
