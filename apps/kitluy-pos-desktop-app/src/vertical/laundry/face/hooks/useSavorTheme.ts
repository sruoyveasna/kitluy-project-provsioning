import { useEffect, useState } from "react";

export type SavorTheme = "light" | "dark";

const STORAGE_KEY = "savor_theme";

/** Apply persisted theme before first paint (call from main.tsx). */
export const initSavorTheme = (): SavorTheme => {
  // Server-side render (the test harness) and a blocked storage both mean "light".
  if (typeof document === "undefined") return "light";
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  const theme: SavorTheme = stored === "dark" ? "dark" : "light";
  document.body.setAttribute("data-theme", theme);
  return theme;
};

export const useSavorTheme = () => {
  const [theme, setThemeState] = useState<SavorTheme>(() => {
    if (typeof document !== "undefined" && document.body.hasAttribute("data-theme")) {
      return document.body.getAttribute("data-theme") === "dark" ? "dark" : "light";
    }
    return initSavorTheme();
  });

  const setTheme = (t: SavorTheme) => {
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // A blocked storage only loses the preference across restarts.
    }
    document.body.setAttribute("data-theme", t);
  };

  useEffect(() => {
    document.body.setAttribute("data-theme", theme);
  }, [theme]);

  return { theme, setTheme };
};
