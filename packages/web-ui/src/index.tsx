/**
 * @kitluy/web-ui — shared web design system foundation.
 *
 * STATUS: BUILT (tokens, themed stylesheet, data-state surfaces, error
 * boundary, locale context, app shell) + TESTED via app smoke tests.
 *
 * ===========================================================================
 * THEMING
 * ===========================================================================
 * The visual direction (owner-approved 2026-09-04): a left-sidebar console,
 * refined enterprise-blue accent on cool-slate neutrals, light and dark.
 *
 * Colours are CSS custom properties, defined once by `injectKitluyTheme()`.
 * `kitluyTokens` holds `var(--kl-*)` references, NOT literal hex, so every
 * existing inline style that reads a token becomes theme-aware for free. The
 * theme follows the viewer's system setting; `ThemeToggle` stamps
 * `data-theme` on <html> to override it, persisted per browser.
 *
 * Rules still encoded here:
 * - Every data surface declares one of the required states: loading, empty,
 *   partial, stale, unavailable, fresh (RB v4 §9.7).
 * - A zero value and an unavailable value are never displayed the same way.
 */
import type { CSSProperties, ReactNode } from "react";
import { Component, createContext, useContext } from "react";
import type { KitluyLocale } from "@kitluy/localization";
import { DEFAULT_LOCALE } from "@kitluy/localization";

/**
 * Brand tokens as CSS variables. The keys are stable; the VALUES resolve per
 * theme from the stylesheet `injectKitluyTheme()` installs.
 */
export const kitluyTokens = {
  // Kept keys (existing call sites) — now theme-aware.
  colorPrimary: "var(--kl-accent)",
  colorSurface: "var(--kl-surface)",
  colorText: "var(--kl-text)",
  colorMuted: "var(--kl-text-muted)",
  colorDanger: "var(--kl-critical)",
  colorWarning: "var(--kl-warn)",
  radius: "var(--kl-radius)",
  fontFamily: "var(--kl-font-ui)",
  // New tokens.
  colorSurface2: "var(--kl-surface-2)",
  colorInset: "var(--kl-surface-inset)",
  colorBorder: "var(--kl-border)",
  colorBorderStrong: "var(--kl-border-strong)",
  colorSubtle: "var(--kl-text-subtle)",
  colorAccentHover: "var(--kl-accent-hover)",
  colorAccentInk: "var(--kl-accent-ink)",
  colorAccentSubtle: "var(--kl-accent-subtle)",
  colorGood: "var(--kl-good)",
  colorGoodBg: "var(--kl-good-bg)",
  colorWarnBg: "var(--kl-warn-bg)",
  colorCriticalBg: "var(--kl-critical-bg)",
  fontMono: "var(--kl-font-mono)",
  radiusSm: "var(--kl-radius-sm)",
  radiusLg: "var(--kl-radius-lg)",
  shadowSm: "var(--kl-shadow-sm)",
  shadowMd: "var(--kl-shadow-md)",
} as const;

// ---------------------------------------------------------------------------
// Theme installation
// ---------------------------------------------------------------------------

const THEME_STORAGE_KEY = "kitluy-theme";
const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&family=Noto+Sans+Khmer:wght@400;500;600;700&display=swap";

const THEME_CSS = `
:root {
  --kl-font-ui: "Plus Jakarta Sans", "Noto Sans Khmer", system-ui, -apple-system, "Segoe UI", sans-serif;
  --kl-font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --kl-bg: #eef1f7; --kl-surface: #ffffff; --kl-surface-2: #f7f9fc; --kl-surface-inset: #f1f4f9;
  --kl-border: #e2e7f0; --kl-border-strong: #d3dae6;
  --kl-text: #0e1726; --kl-text-muted: #56657e; --kl-text-subtle: #8a97ac;
  --kl-accent: #2563eb; --kl-accent-hover: #1d4ed8; --kl-accent-ink: #ffffff;
  --kl-accent-subtle: #e9f0ff; --kl-accent-ring: rgba(37,99,235,.35);
  --kl-good: #12885a; --kl-good-bg: #e6f6ee; --kl-warn: #b26a12; --kl-warn-bg: #fbf1df;
  --kl-critical: #cd3b32; --kl-critical-bg: #fbeae8;
  --kl-sidebar-grad: linear-gradient(180deg, #101a2f 0%, #0b1120 100%);
  --kl-sidebar-text: #a9b6cc; --kl-sidebar-muted: #6c7a93; --kl-sidebar-active-bg: rgba(56,116,236,.22);
  --kl-sidebar-border: rgba(255,255,255,.07); --kl-sidebar-hover: rgba(255,255,255,.05);
  --kl-shadow-sm: 0 1px 2px rgba(15,23,42,.06), 0 1px 1px rgba(15,23,42,.04);
  --kl-shadow-md: 0 6px 20px rgba(15,23,42,.08), 0 2px 6px rgba(15,23,42,.05);
  --kl-radius: 10px; --kl-radius-sm: 7px; --kl-radius-lg: 16px;
}
:root:not([data-theme="light"]) { @media (prefers-color-scheme: dark) {
  --kl-bg: #070b13; --kl-surface: #111a2b; --kl-surface-2: #0e1626; --kl-surface-inset: #0c1322;
  --kl-border: #21304a; --kl-border-strong: #2b3d5c;
  --kl-text: #e7edf7; --kl-text-muted: #9db0cb; --kl-text-subtle: #66768f;
  --kl-accent: #5b8cf5; --kl-accent-hover: #7aa2f7; --kl-accent-ink: #07101f;
  --kl-accent-subtle: rgba(91,140,245,.15); --kl-accent-ring: rgba(91,140,245,.4);
  --kl-good: #33c489; --kl-good-bg: rgba(51,196,137,.13); --kl-warn: #e0a355; --kl-warn-bg: rgba(224,163,85,.14);
  --kl-critical: #f0776b; --kl-critical-bg: rgba(240,119,107,.14);
  --kl-sidebar-grad: linear-gradient(180deg, #0a1120 0%, #05090f 100%);
  --kl-sidebar-text: #94a3bd; --kl-sidebar-muted: #5a6884; --kl-sidebar-active-bg: rgba(91,140,245,.18);
  --kl-sidebar-border: rgba(255,255,255,.06); --kl-sidebar-hover: rgba(255,255,255,.04);
  --kl-shadow-sm: 0 1px 2px rgba(0,0,0,.4); --kl-shadow-md: 0 8px 26px rgba(0,0,0,.5);
} }
:root[data-theme="dark"] {
  --kl-bg: #070b13; --kl-surface: #111a2b; --kl-surface-2: #0e1626; --kl-surface-inset: #0c1322;
  --kl-border: #21304a; --kl-border-strong: #2b3d5c;
  --kl-text: #e7edf7; --kl-text-muted: #9db0cb; --kl-text-subtle: #66768f;
  --kl-accent: #5b8cf5; --kl-accent-hover: #7aa2f7; --kl-accent-ink: #07101f;
  --kl-accent-subtle: rgba(91,140,245,.15); --kl-accent-ring: rgba(91,140,245,.4);
  --kl-good: #33c489; --kl-good-bg: rgba(51,196,137,.13); --kl-warn: #e0a355; --kl-warn-bg: rgba(224,163,85,.14);
  --kl-critical: #f0776b; --kl-critical-bg: rgba(240,119,107,.14);
  --kl-sidebar-grad: linear-gradient(180deg, #0a1120 0%, #05090f 100%);
  --kl-sidebar-text: #94a3bd; --kl-sidebar-muted: #5a6884; --kl-sidebar-active-bg: rgba(91,140,245,.18);
  --kl-sidebar-border: rgba(255,255,255,.06); --kl-sidebar-hover: rgba(255,255,255,.04);
  --kl-shadow-sm: 0 1px 2px rgba(0,0,0,.4); --kl-shadow-md: 0 8px 26px rgba(0,0,0,.5);
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--kl-bg); color: var(--kl-text); font-family: var(--kl-font-ui); font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
.kl-mono { font-family: var(--kl-font-mono); font-size: .86em; }
.kl-km { font-family: "Noto Sans Khmer", var(--kl-font-ui); }
.kl-muted { color: var(--kl-text-muted); }
.kl-subtle { color: var(--kl-text-subtle); }

.kl-app { display: grid; grid-template-columns: 244px 1fr; min-height: 100vh; }
.kl-sidebar { background: var(--kl-sidebar-grad); border-right: 1px solid var(--kl-sidebar-border); color: var(--kl-sidebar-text); padding: 18px 14px; display: flex; flex-direction: column; gap: 4px; position: sticky; top: 0; height: 100vh; }
.kl-brand { display: flex; align-items: center; gap: 10px; padding: 6px 8px 14px; }
.kl-brand-mark { width: 30px; height: 30px; border-radius: 8px; flex: none; background: linear-gradient(140deg, var(--kl-accent) 0%, #7aa2f7 100%); display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 15px; box-shadow: 0 2px 8px rgba(37,99,235,.4); }
.kl-brand-name { color: #fff; font-weight: 800; font-size: 16px; letter-spacing: -.02em; line-height: 1.15; }
.kl-brand-sub { color: var(--kl-sidebar-muted); font-size: 11px; font-weight: 500; }
.kl-nav-label { color: var(--kl-sidebar-muted); font-size: 10.5px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; padding: 14px 10px 6px; }
.kl-nav-item { display: flex; align-items: center; gap: 11px; padding: 9px 11px; border-radius: 8px; color: var(--kl-sidebar-text); font-weight: 500; font-size: 13.5px; transition: background .13s, color .13s; cursor: pointer; text-decoration: none; }
.kl-nav-item:hover { background: var(--kl-sidebar-hover); color: #fff; }
.kl-nav-item[aria-current="page"] { background: var(--kl-sidebar-active-bg); color: #fff; font-weight: 600; }
.kl-nav-item .kl-ic { width: 17px; height: 17px; flex: none; opacity: .9; }
.kl-badge-count { margin-left: auto; background: var(--kl-accent); color: #fff; font-size: 11px; font-weight: 700; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; display: grid; place-items: center; }
.kl-sidebar-foot { margin-top: auto; padding-top: 14px; border-top: 1px solid var(--kl-sidebar-border); }
.kl-who { display: flex; align-items: center; gap: 10px; padding: 6px 8px; }
.kl-avatar { width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(140deg, #4f83f1, #9333ea); color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 12px; flex: none; }
.kl-who-name { color: #eef2f9; font-size: 12.5px; font-weight: 600; line-height: 1.2; }
.kl-who-role { color: var(--kl-sidebar-muted); font-size: 11px; }

.kl-main { display: flex; flex-direction: column; min-width: 0; }
.kl-topbar { position: sticky; top: 0; z-index: 5; background: color-mix(in srgb, var(--kl-surface) 86%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--kl-border); display: flex; align-items: center; gap: 14px; padding: 12px 24px; }
.kl-crumb { display: flex; align-items: center; gap: 8px; color: var(--kl-text-subtle); font-size: 12.5px; font-weight: 500; }
.kl-crumb .kl-cur { color: var(--kl-text); font-weight: 700; font-size: 15px; letter-spacing: -.01em; }
.kl-topbar-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.kl-seg { display: inline-flex; background: var(--kl-surface-inset); border: 1px solid var(--kl-border); border-radius: 8px; padding: 3px; }
.kl-seg button { border: 0; background: transparent; color: var(--kl-text-muted); font-family: inherit; font-weight: 600; font-size: 12px; padding: 5px 10px; border-radius: 6px; cursor: pointer; }
.kl-seg button[aria-pressed="true"] { background: var(--kl-surface); color: var(--kl-text); box-shadow: var(--kl-shadow-sm); }
.kl-icon-btn { width: 34px; height: 34px; border-radius: 8px; border: 1px solid var(--kl-border); background: var(--kl-surface); color: var(--kl-text-muted); display: grid; place-items: center; cursor: pointer; transition: color .14s, border-color .14s; }
.kl-icon-btn:hover { color: var(--kl-text); border-color: var(--kl-border-strong); }

.kl-content { padding: 24px 26px 56px; max-width: 1180px; width: 100%; }
.kl-login { display: flex; justify-content: center; align-items: flex-start; padding-top: 6vh; }
.kl-page-head { margin-bottom: 20px; }
.kl-page-head h1 { font-size: 22px; margin: 0; font-weight: 700; letter-spacing: -.01em; }
.kl-page-head p { margin: 5px 0 0; color: var(--kl-text-muted); max-width: 62ch; }
.kl-row { display: flex; gap: 18px; flex-wrap: wrap; }
.kl-stack { display: flex; flex-direction: column; gap: 18px; }
.kl-grid-2 { display: grid; grid-template-columns: 1.4fr 1fr; gap: 18px; align-items: start; }

.kl-card { background: var(--kl-surface); border: 1px solid var(--kl-border); border-radius: var(--kl-radius-lg); box-shadow: var(--kl-shadow-sm); }
.kl-card-head { padding: 15px 18px; border-bottom: 1px solid var(--kl-border); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.kl-card-head h2, .kl-card-head h3 { font-size: 15px; margin: 0; font-weight: 700; }
.kl-card-head .kl-sub { color: var(--kl-text-subtle); font-size: 12.5px; font-weight: 500; }
.kl-card-body { padding: 18px; }
.kl-card-body.kl-tight { padding: 0; }

.kl-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.kl-tile { background: var(--kl-surface); border: 1px solid var(--kl-border); border-radius: var(--kl-radius); padding: 14px 15px; box-shadow: var(--kl-shadow-sm); text-decoration: none; color: inherit; display: block; }
.kl-tile .kl-n { font-size: 27px; font-weight: 800; letter-spacing: -.03em; line-height: 1; }
.kl-tile .kl-l { color: var(--kl-text-muted); font-size: 12px; font-weight: 500; margin-top: 6px; }
.kl-tile.kl-accent { border-color: var(--kl-accent-ring); }
.kl-tile.kl-accent .kl-n { color: var(--kl-accent); }
.kl-tile.kl-warn .kl-n { color: var(--kl-warn); }
.kl-tile.kl-critical .kl-n { color: var(--kl-critical); }

.kl-table-wrap { overflow-x: auto; }
.kl-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.kl-table thead th { text-align: left; padding: 11px 16px; color: var(--kl-text-subtle); font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; border-bottom: 1px solid var(--kl-border); background: var(--kl-surface-2); white-space: nowrap; }
.kl-table tbody td { padding: 13px 16px; border-bottom: 1px solid var(--kl-border); vertical-align: top; }
.kl-table tbody tr:last-child td { border-bottom: 0; }
.kl-table tbody tr:hover { background: var(--kl-surface-2); }
.kl-cell-sub { color: var(--kl-text-subtle); font-size: 12px; margin-top: 2px; }

.kl-pill { display: inline-flex; align-items: center; gap: 7px; font-weight: 600; font-size: 12.5px; white-space: nowrap; }
.kl-pill .kl-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.kl-dot-good { background: var(--kl-good); }
.kl-dot-accent { background: var(--kl-accent); }
.kl-dot-warn { background: var(--kl-warn); }
.kl-dot-critical { background: var(--kl-critical); }
.kl-dot-muted { background: var(--kl-text-subtle); }
.kl-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 20px; }
.kl-badge-good { background: var(--kl-good-bg); color: var(--kl-good); }
.kl-badge-warn { background: var(--kl-warn-bg); color: var(--kl-warn); }
.kl-badge-critical { background: var(--kl-critical-bg); color: var(--kl-critical); }
.kl-badge-neutral { background: var(--kl-surface-inset); color: var(--kl-text-muted); }
.kl-never { color: var(--kl-text-subtle); font-style: italic; }
.kl-crit { color: var(--kl-critical); font-weight: 700; }

.kl-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid transparent; border-radius: 9px; font-family: inherit; font-weight: 600; font-size: 13.5px; padding: 9px 15px; cursor: pointer; transition: background .14s, border-color .14s; white-space: nowrap; }
.kl-btn-primary { background: var(--kl-accent); color: var(--kl-accent-ink); box-shadow: 0 1px 2px var(--kl-accent-ring); }
.kl-btn-primary:hover { background: var(--kl-accent-hover); }
.kl-btn-primary:disabled { background: var(--kl-border-strong); color: var(--kl-text-subtle); box-shadow: none; cursor: not-allowed; }
.kl-btn-ghost { background: var(--kl-surface); border-color: var(--kl-border); color: var(--kl-text); }
.kl-btn-ghost:hover { border-color: var(--kl-border-strong); background: var(--kl-surface-2); }
.kl-btn-sm { padding: 6px 11px; font-size: 12.5px; border-radius: 8px; }

.kl-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.kl-field > label { font-weight: 600; font-size: 12.5px; }
.kl-field .kl-hint { color: var(--kl-text-subtle); font-size: 11.5px; }
.kl-input, .kl-select { width: 100%; border: 1px solid var(--kl-border-strong); border-radius: 9px; background: var(--kl-surface); color: var(--kl-text); font: inherit; font-size: 13.5px; padding: 9px 11px; transition: border-color .14s, box-shadow .14s; }
.kl-input:focus, .kl-select:focus { outline: none; border-color: var(--kl-accent); box-shadow: 0 0 0 3px var(--kl-accent-subtle); }
.kl-checks { display: grid; gap: 2px; border: 1px solid var(--kl-border); border-radius: 10px; padding: 8px; }
.kl-check { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 7px; font-size: 13px; }
.kl-check:hover { background: var(--kl-surface-2); }
.kl-check input { width: 16px; height: 16px; accent-color: var(--kl-accent); }
.kl-check .kl-short { font-family: var(--kl-font-mono); font-weight: 600; color: var(--kl-accent); font-size: 12px; }
.kl-fieldset { border: 1px solid var(--kl-border); border-radius: 10px; padding: 6px 12px 12px; }
.kl-fieldset > legend { font-weight: 600; font-size: 12.5px; padding: 0 6px; }

.kl-notice { display: flex; gap: 11px; padding: 12px 14px; border-radius: 11px; font-size: 13px; align-items: flex-start; }
.kl-notice-critical { background: var(--kl-critical-bg); color: var(--kl-critical); }
.kl-notice-good { background: var(--kl-good-bg); color: var(--kl-good); }
.kl-notice-warn { background: var(--kl-warn-bg); color: var(--kl-warn); }
.kl-surface { border-radius: var(--kl-radius); border: 1px dashed var(--kl-border-strong); background: var(--kl-surface-2); color: var(--kl-text-muted); padding: 14px 16px; font-weight: 600; font-size: 13px; }
.kl-empty { text-align: center; padding: 30px 18px; color: var(--kl-text-subtle); }

.kl-dl { display: grid; grid-template-columns: max-content 1fr; gap: 8px 18px; font-size: 13.5px; margin: 0; }
.kl-dl dt { color: var(--kl-text-muted); font-weight: 500; }
.kl-dl dd { margin: 0; font-weight: 500; }

.kl-tabs { display: flex; gap: 4px; }
.kl-tab { padding: 9px 12px; font-weight: 600; font-size: 13.5px; color: var(--kl-sidebar-text); border-radius: 8px; text-decoration: none; }
.kl-tab:hover { background: var(--kl-sidebar-hover); color: #fff; }
.kl-tab[aria-current="page"] { background: var(--kl-sidebar-active-bg); color: #fff; }

.kl-hub-line { display: flex; align-items: center; gap: 9px; padding: 11px 14px; border-radius: 11px; font-size: 13px; font-weight: 500; margin-bottom: 18px; flex-wrap: wrap; }
.kl-hub-active { background: var(--kl-good-bg); color: var(--kl-good); }
.kl-hub-blocked { background: var(--kl-warn-bg); color: var(--kl-warn); }

.kl-codebox { border: 2px solid var(--kl-accent); border-radius: 14px; background: var(--kl-accent-subtle); padding: 22px; text-align: center; max-width: 26rem; }
.kl-codebox .kl-code { font-family: var(--kl-font-mono); font-size: 2.6rem; font-weight: 600; letter-spacing: .16em; color: var(--kl-accent); line-height: 1; }
.kl-codebox .kl-timer { margin-top: 12px; color: var(--kl-text-muted); font-size: 13px; }
.kl-codebox .kl-timer b { font-variant-numeric: tabular-nums; color: var(--kl-text); }

.kl-ladder { list-style: none; margin: 0; padding: 0; }
.kl-rung { display: grid; grid-template-columns: 22px 1fr; gap: 12px; }
.kl-rung .kl-rail { display: flex; flex-direction: column; align-items: center; }
.kl-rung .kl-node { width: 15px; height: 15px; border-radius: 50%; border: 2px solid var(--kl-border-strong); background: var(--kl-surface); flex: none; margin-top: 2px; }
.kl-rung .kl-line { width: 2px; flex: 1; background: var(--kl-border); margin: 3px 0; min-height: 12px; }
.kl-rung:last-child .kl-line { display: none; }
.kl-rung .kl-rbody { padding-bottom: 12px; }
.kl-rung.kl-done .kl-node { background: var(--kl-good); border-color: var(--kl-good); }
.kl-rung.kl-current .kl-node { border-color: var(--kl-accent); box-shadow: 0 0 0 4px var(--kl-accent-subtle); }
.kl-rung.kl-blocked .kl-node { border-color: var(--kl-critical); background: var(--kl-critical-bg); }
.kl-rung.kl-pending .kl-node { border-style: dashed; }

@media (max-width: 860px) {
  .kl-app { grid-template-columns: 1fr; }
  .kl-sidebar { position: static; height: auto; flex-direction: row; align-items: center; overflow-x: auto; gap: 6px; padding: 10px 12px; }
  .kl-brand { padding: 0 8px 0 0; }
  .kl-brand-sub, .kl-nav-label, .kl-sidebar-foot { display: none; }
  .kl-nav-item { padding: 8px 10px; white-space: nowrap; }
  .kl-grid-2 { grid-template-columns: 1fr; }
  .kl-content { padding: 18px 14px 48px; }
  .kl-topbar { padding: 11px 14px; }
}
`;

/** Install the theme stylesheet and font link, once. No-op server-side. */
export function injectKitluyTheme(): void {
  if (typeof document === "undefined") return;
  if (!document.getElementById("kl-font-link")) {
    const link = document.createElement("link");
    link.id = "kl-font-link";
    link.rel = "stylesheet";
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }
  if (!document.getElementById("kl-theme")) {
    const style = document.createElement("style");
    style.id = "kl-theme";
    style.textContent = THEME_CSS;
    document.head.appendChild(style);
  }
}

injectKitluyTheme();

// ---------------------------------------------------------------------------
// Theme + locale controls
// ---------------------------------------------------------------------------

/** Toggle light/dark, stamping `data-theme` on <html> and remembering it. */
export function ThemeToggle(props: { label?: string }): JSX.Element {
  const onClick = (): void => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const explicit = root.getAttribute("data-theme");
    const prefersDark =
      typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = explicit === "dark" || (!explicit && prefersDark);
    const next = dark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* storage may be unavailable; the toggle still works for this view */
    }
  };
  return (
    <button
      type="button"
      className="kl-icon-btn"
      onClick={onClick}
      aria-label={props.label ?? "Toggle theme"}
      title={props.label ?? "Toggle theme"}
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle cx="12" cy="12" r="4.5" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" />
      </svg>
    </button>
  );
}

/** Restore the persisted theme choice. Call once at startup. No-op server-side. */
export function restoreKitluyTheme(): void {
  if (typeof document === "undefined") return;
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "dark" || saved === "light") {
      document.documentElement.setAttribute("data-theme", saved);
    }
  } catch {
    /* no stored preference; follow the system setting */
  }
}

/** A two-option language switch, styled as a segmented control. */
export function LocaleToggle(props: {
  locale: KitluyLocale;
  onLocale: (locale: KitluyLocale) => void;
}): JSX.Element {
  return (
    <div className="kl-seg" role="group" aria-label="Language">
      <button
        aria-pressed={props.locale === "km-KH"}
        onClick={() => props.onLocale("km-KH")}
        className="kl-km"
      >
        ខ្មែរ
      </button>
      <button aria-pressed={props.locale === "en-US"} onClick={() => props.onLocale("en-US")}>
        EN
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout + primitives
// ---------------------------------------------------------------------------

/**
 * The console shell: a deep-slate left sidebar (brand, navigation, account)
 * and a content column with a sticky top bar. All slots are optional, so the
 * shell also frames the sign-in and misconfigured states cleanly.
 *
 * The product name always renders as "KitLuy · {productName}" so the brand is
 * present on every screen.
 */
export function AppShell(props: {
  productName: string;
  brandInitial?: string;
  nav?: ReactNode;
  account?: ReactNode;
  topbarRight?: ReactNode;
  crumb?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="kl-app">
      <aside className="kl-sidebar">
        <div className="kl-brand">
          <div className="kl-brand-mark">{props.brandInitial ?? "K"}</div>
          <div>
            <div className="kl-brand-name">KitLuy</div>
            <div className="kl-brand-sub">{props.productName}</div>
          </div>
        </div>
        {props.nav}
        {props.account ? <div className="kl-sidebar-foot">{props.account}</div> : null}
      </aside>
      <div className="kl-main">
        <header className="kl-topbar">
          <div className="kl-crumb">
            {props.crumb ?? <span className="kl-cur">{props.productName}</span>}
          </div>
          <div className="kl-topbar-right">{props.topbarRight}</div>
        </header>
        <main className="kl-content">{props.children}</main>
      </div>
    </div>
  );
}

/** A titled surface. `actions` sit at the right of the header. */
export function Card(props: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  tight?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="kl-card">
      {props.title === undefined && props.sub === undefined ? null : (
        <div className="kl-card-head">
          {props.title ? <h3>{props.title}</h3> : null}
          {props.sub ? <span className="kl-sub">{props.sub}</span> : null}
          {props.actions ? <span style={{ marginLeft: "auto" }}>{props.actions}</span> : null}
        </div>
      )}
      <div className={props.tight ? "kl-card-body kl-tight" : "kl-card-body"}>{props.children}</div>
    </section>
  );
}

/** A page title and optional description. */
export function PageHeader(props: { title: ReactNode; children?: ReactNode }): JSX.Element {
  return (
    <div className="kl-page-head">
      <h1>{props.title}</h1>
      {props.children ? <p>{props.children}</p> : null}
    </div>
  );
}

export type Tone = "good" | "accent" | "warn" | "critical" | "muted";

/** A status pill: a coloured dot plus a word. Colour is never the only cue. */
export function Pill(props: { tone: Tone; children: ReactNode }): JSX.Element {
  return (
    <span className="kl-pill">
      <span className={`kl-dot kl-dot-${props.tone}`} />
      {props.children}
    </span>
  );
}

export function Badge(props: {
  tone: "good" | "warn" | "critical" | "neutral";
  children: ReactNode;
}): JSX.Element {
  return <span className={`kl-badge kl-badge-${props.tone}`}>{props.children}</span>;
}

const LocaleContext = createContext<KitluyLocale>(DEFAULT_LOCALE);

export function LocaleProvider(props: { locale: KitluyLocale; children: ReactNode }) {
  return <LocaleContext.Provider value={props.locale}>{props.children}</LocaleContext.Provider>;
}

export function useLocale(): KitluyLocale {
  return useContext(LocaleContext);
}

/** Required data-surface states (RB v4 §9.7). */
export type DataSurfaceState = "loading" | "empty" | "partial" | "stale" | "unavailable" | "fresh";

const STATE_LABELS: Record<DataSurfaceState, { "km-KH": string; "en-US": string }> = {
  loading: { "km-KH": "កំពុងផ្ទុក…", "en-US": "Loading…" },
  empty: { "km-KH": "គ្មានទិន្នន័យ", "en-US": "No data" },
  partial: { "km-KH": "ទិន្នន័យមិនពេញលេញ", "en-US": "Partial data" },
  stale: { "km-KH": "ទិន្នន័យចាស់ — មិនមែនបច្ចុប្បន្ន", "en-US": "Stale data — not live" },
  unavailable: { "km-KH": "មិនអាចប្រើបានទេ", "en-US": "Unavailable" },
  fresh: { "km-KH": "បច្ចុប្បន្ន", "en-US": "Live" },
};

export function stateLabel(state: DataSurfaceState, locale: KitluyLocale): string {
  return STATE_LABELS[state][locale];
}

/**
 * Wrapper for any data surface. Fails closed: when the authoritative contract
 * for the data does not exist, callers render state="unavailable" — never
 * fabricated values. The `data-surface-state` hook is load-bearing for tests.
 */
export function DataSurface(props: {
  state: DataSurfaceState;
  children?: ReactNode;
  dataAsOf?: string;
}) {
  const locale = useLocale();
  if (props.state === "fresh") return <>{props.children}</>;
  const style: CSSProperties =
    props.state === "loading" || props.state === "empty"
      ? { color: kitluyTokens.colorMuted, padding: "16px 0", fontWeight: 600, fontSize: 13 }
      : {};
  return (
    <div role="status" data-surface-state={props.state} className="kl-surface" style={style}>
      <strong>{stateLabel(props.state, locale)}</strong>
      {props.dataAsOf ? <span> · {props.dataAsOf}</span> : null}
      {props.state === "partial" || props.state === "stale" ? props.children : null}
    </div>
  );
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/** Application error boundary — renders a safe fallback, never a blank page. */
export class KitluyErrorBoundary extends Component<
  { fallback?: ReactNode; children: ReactNode },
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div role="alert" data-surface-state="unavailable">
            Something went wrong. The error has been recorded.
          </div>
        )
      );
    }
    return this.props.children;
  }
}
