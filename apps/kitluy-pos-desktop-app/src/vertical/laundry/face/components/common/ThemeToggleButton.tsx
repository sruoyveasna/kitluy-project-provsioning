import { useContext, useSyncExternalStore } from "react";
import { ThemeContext } from "@face/app/ThemeProvider";
import type { SavorTheme } from "@face/hooks/useSavorTheme";

const STORAGE_KEY = "savor_theme";

function readTheme(): SavorTheme {
  if (typeof document === "undefined") return "light";
  return document.body.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function subscribeTheme(onStoreChange: () => void) {
  const obs = new MutationObserver(onStoreChange);
  obs.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

function toggleThemeOnBody() {
  const next: SavorTheme = readTheme() === "dark" ? "light" : "dark";
  document.body.setAttribute("data-theme", next);
  localStorage.setItem(STORAGE_KEY, next);
}

/** Sun / moon icon toggle — persists via localStorage (`savor_theme`). */
export const ThemeToggleButton = ({
  className = "sv-icon-btn",
  size = 20,
}: {
  className?: string;
  size?: number;
}) => {
  const ctx = useContext(ThemeContext);
  const domTheme = useSyncExternalStore(subscribeTheme, readTheme, () => "light" as SavorTheme);
  const theme = ctx?.theme ?? domTheme;
  const onToggle = ctx?.toggleTheme ?? toggleThemeOnBody;

  return (
    <button
      type="button"
      className={className}
      onClick={onToggle}
      title={theme === "light" ? "Switch to dark" : "Switch to light"}
      aria-label={theme === "light" ? "Switch to dark" : "Switch to light"}
    >
      {theme === "light" ? (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      )}
    </button>
  );
};
