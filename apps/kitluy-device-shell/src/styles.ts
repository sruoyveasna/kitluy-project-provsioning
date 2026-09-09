/**
 * The kiosk stylesheet, injected once at startup.
 *
 * Kiosk rules an ordinary web page does not want: the cursor is hidden (there is
 * no mouse on a 7-inch panel), nothing is selectable, and touch targets are large
 * (≥ 64 px) because a finger is not a pointer. The layout works in both the panel's
 * native portrait (720×1280) and a landscape HDMI monitor, so it is column-based
 * and never assumes a width. No external fonts are fetched — the image ships Noto
 * Sans Khmer and the stack falls back to it.
 */
export const SHELL_CSS = `
:root {
  --bg: #0b1120; --panel: #111a2b; --ink: #eef2f9; --muted: #93a4c0;
  --accent: #5b8cf5; --accent-ink: #07101f; --warn: #e0a355; --critical: #f0776b;
  --box: #0c1322; --line: #24324a;
  --font: "Noto Sans Khmer", "Plus Jakarta Sans", system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--ink); font-family: var(--font); cursor: none; user-select: none; -webkit-user-select: none; }
button { font-family: inherit; cursor: none; }

.kt-shell { display: flex; flex-direction: column; height: 100%; }
.kt-top { display: flex; align-items: center; justify-content: space-between; padding: 18px 24px; }
.kt-brand { font-weight: 800; font-size: 20px; letter-spacing: -.02em; }
.kt-lang { min-height: 44px; padding: 8px 16px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--ink); font-weight: 600; font-size: 15px; }
.kt-body { flex: 1; min-height: 0; display: flex; overflow: auto; }
.kt-foot { display: flex; align-items: baseline; gap: 10px; padding: 14px 24px; border-top: 1px solid var(--line); color: var(--muted); }
.kt-foot-k { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; }
.kt-foot-v { font-size: 16px; color: var(--ink); }
.kt-mono { font-family: var(--mono); }

.kt-center { margin: auto; text-align: center; padding: 24px; max-width: 640px; }
.kt-brand-big { font-size: 46px; font-weight: 800; letter-spacing: -.03em; }
.kt-title { font-size: 30px; font-weight: 700; margin: 0 0 14px; text-wrap: balance; }
.kt-lead { font-size: 19px; line-height: 1.5; color: var(--ink); margin: 0 auto; max-width: 46ch; }
.kt-muted { color: var(--muted); font-size: 17px; }
.kt-warn { margin-top: 18px; color: var(--warn); font-size: 17px; font-weight: 600; }
.kt-halted .kt-title { color: var(--critical); }

.kt-approved { margin: auto; padding: 24px; width: 100%; max-width: 760px; text-align: center; }
.kt-code { margin: 22px 0; }
.kt-code-label { text-transform: uppercase; letter-spacing: .08em; font-size: 13px; color: var(--muted); margin-bottom: 10px; }
.kt-boxes { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.kt-box { width: 56px; height: 72px; display: grid; place-items: center; border: 2px solid var(--line); border-radius: 12px; background: var(--box); font-family: var(--mono); font-size: 34px; font-weight: 600; }
.kt-box-filled { border-color: var(--accent); color: var(--accent); }
.kt-keypad { display: grid; grid-template-columns: repeat(8, 1fr); gap: 10px; margin: 22px 0; }
.kt-key { min-height: 64px; border-radius: 12px; border: 1px solid var(--line); background: var(--panel); color: var(--ink); font-family: var(--mono); font-size: 22px; font-weight: 600; }
.kt-key:active { background: var(--accent); color: var(--accent-ink); }
.kt-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
.kt-btn { min-height: 64px; min-width: 130px; padding: 0 22px; border-radius: 12px; border: 1px solid var(--line); background: var(--panel); color: var(--ink); font-size: 18px; font-weight: 700; }
.kt-btn-primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.kt-btn:disabled { opacity: .4; }

@media (max-width: 760px) {
  .kt-keypad { grid-template-columns: repeat(4, 1fr); }
  .kt-box { width: 44px; height: 60px; font-size: 26px; }
}

/* --- Settings ------------------------------------------------------------ */
/* Touch targets are 44px minimum throughout: this is operated with a finger on
   a wall-mounted screen, often by someone in a hurry. */
.kt-top-actions { display: flex; gap: .5rem; align-items: center; }
.kt-settings { display: flex; flex-direction: column; gap: 1rem; width: 100%; max-width: 46rem; }
.kt-tabs { display: flex; gap: .25rem; flex-wrap: wrap; }
.kt-tab {
  flex: 1 1 auto; min-height: 44px; padding: .6rem 1rem; cursor: pointer;
  border: 1px solid rgba(255,255,255,.18); border-radius: .5rem;
  background: transparent; color: inherit; font: inherit;
}
.kt-tab[data-active="yes"] { background: rgba(255,255,255,.14); font-weight: 700; }
.kt-panel { display: flex; flex-direction: column; gap: .75rem; text-align: left; }
.kt-nets { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .25rem; }
.kt-net-btn {
  width: 100%; min-height: 44px; display: flex; gap: .75rem; align-items: center;
  padding: .5rem .75rem; cursor: pointer; text-align: left;
  border: 1px solid rgba(255,255,255,.14); border-radius: .5rem;
  background: transparent; color: inherit; font: inherit;
}
.kt-net-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kt-field { display: flex; flex-direction: column; gap: .25rem; }
.kt-field input[type="text"], .kt-field input[type="password"] {
  min-height: 44px; padding: .5rem .75rem; font: inherit;
  border: 1px solid rgba(255,255,255,.24); border-radius: .5rem;
  background: rgba(0,0,0,.25); color: inherit;
}
.kt-field input[type="range"] { min-height: 44px; }
.kt-join { display: flex; flex-direction: column; gap: .75rem; }
.kt-facts { display: flex; flex-direction: column; gap: .5rem; margin: 0; }
.kt-fact { display: flex; justify-content: space-between; gap: 1rem; }
`;

export function injectShellStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("kt-style") !== null) return;
  const style = document.createElement("style");
  style.id = "kt-style";
  style.textContent = SHELL_CSS;
  document.head.appendChild(style);
}
