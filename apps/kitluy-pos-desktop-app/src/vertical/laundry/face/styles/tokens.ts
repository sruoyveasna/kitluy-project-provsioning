export const APP_VERSION = "1.8.0";

/** Latin/brand face — matches Café Savor `--sv-font` stack. */
export const font =
  '"Inter Tight", "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
/** Khmer face — keep a dedicated fallback so Khmer glyphs never break on the font swap. */
export const fontKm = '"Noto Sans Khmer", ' + font;

export const C = {
  // Brand family — re-pointed from sky-blue to the café "Savor" green during
  // the design migration (Phase 1). Neutrals + semantic status colors below
  // are intentionally unchanged.
  primary: "#35977D",
  primaryDark: "#2F8470",
  primaryDeep: "#1F5E50",
  primaryLight: "#B7DBC9",
  primarySoft: "#ECF6F1",
  bg: "#F6F6F6",
  card: "#FFFFFF",
  border: "#EEEEEE",
  text: "#1B1B1B",
  textSec: "#4D4D4D",
  textTer: "#7F7F7F",
  gray50: "#F6F6F6",
  gray100: "#F3F3F3",
  gray200: "#E2E8F0",
  gray300: "#CBD5E1",
  gray400: "#94A3B8",
  gray500: "#64748B",
  slate700: "#334155",
  slate800: "#1E293B",
  slate900: "#0F172A",
  green: "#10B981",
  greenLight: "#D1FAE5",
  greenDark: "#059669",
  red: "#EF4444",
  redLight: "#FEE2E2",
  redDark: "#DC2626",
  amber: "#F59E0B",
  amberLight: "#FEF3C7",
  amberDark: "#D97706",
  purple: "#8B5CF6",
  purpleLight: "#EDE9FE",
  gold: "#F5A623",
  teal: "#14B8A6",
  tealLight: "#CCFBF1",
} as const;

export type ThemeColors = { readonly [K in keyof typeof C]: string };
export type ColorKey = keyof typeof C;

/** Dark palette — mirrors Café Savor `body[data-theme="dark"]` tokens. */
export const C_DARK: ThemeColors = {
  ...C,
  primarySoft: "rgba(53,151,125,0.16)",
  primaryLight: "rgba(53,151,125,0.32)",
  bg: "#0D0D0D",
  card: "#1B1B1B",
  border: "#2A2A2A",
  text: "#FFFFFF",
  textSec: "#E3E3E3",
  textTer: "#A5A5A5",
  gray50: "#0D0D0D",
  gray100: "#2A2A2A",
  gray200: "#2A2A2A",
  gray300: "#3A3A3A",
  gray400: "#64748B",
  gray500: "#94A3B8",
  slate700: "#CBD5E1",
  slate800: "#E2E8F0",
  slate900: "#F8FAFC",
  redLight: "rgba(203,58,49,0.18)",
  greenLight: "rgba(16,185,129,0.18)",
  amberLight: "rgba(245,158,11,0.18)",
  purpleLight: "rgba(139,92,246,0.18)",
  tealLight: "rgba(20,184,166,0.18)",
};

/**
 * CSS-variable references — auto-track `body[data-theme]` without re-render.
 * Use inside `.lsv-shell` (T1) or anywhere `--kl-*` / `--sv-*` are defined.
 */
export const CV = {
  primary: "var(--sv-primary)",
  primaryDark: "var(--sv-primary-dark)",
  primaryDeep: "var(--sv-primary-deep)",
  primaryLight: "var(--sv-primary-soft)",
  primarySoft: "var(--sv-primary-tint)",
  bg: "var(--sv-fill)",
  card: "var(--sv-surface)",
  border: "var(--sv-line)",
  text: "var(--sv-ink)",
  textSec: "var(--sv-ink-2)",
  textTer: "var(--sv-mute)",
  gray50: "var(--sv-fill)",
  gray100: "var(--sv-btn-soft)",
  gray200: "var(--sv-line-2)",
  gray300: "var(--sv-soft)",
  red: "var(--sv-danger)",
  redLight: "var(--sv-danger-soft)",
  shadowMd: "var(--sv-sh-md)",
  shadowSm: "var(--sv-sh-sm)",
  shadowLg: "var(--sv-sh-lg)",
} as const;

/**
 * Café "Savor" shape tokens — additive, introduced in the design migration.
 * Existing screens keep using `KIOSK.radius` (16); these give later phases the
 * café's pill buttons + soft elevations without re-deriving the values.
 */
export const RADIUS = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const SHADOW = {
  sm: "0 1px 2px rgba(0, 0, 0, 0.04)",
  md: "0 4px 12px rgba(0, 0, 0, 0.06)",
  lg: "0 16px 40px rgba(0, 0, 0, 0.10)",
} as const;
