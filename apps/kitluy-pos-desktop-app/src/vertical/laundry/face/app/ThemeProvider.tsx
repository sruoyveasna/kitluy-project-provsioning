import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSavorTheme, type SavorTheme } from "@face/hooks/useSavorTheme";
import { C, C_DARK, type ThemeColors } from "@face/styles/tokens";

type ThemeContextValue = {
  theme: SavorTheme;
  setTheme: (t: SavorTheme) => void;
  toggleTheme: () => void;
  colors: ThemeColors;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const { theme, setTheme } = useSavorTheme();

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => setTheme(theme === "light" ? "dark" : "light"),
      colors: theme === "dark" ? C_DARK : C,
    }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
};

/** Theme-aware palette for inline styles (re-renders on toggle). */
export const useThemeColors = (): ThemeColors => {
  const ctx = useContext(ThemeContext);
  if (ctx) return ctx.colors;
  if (typeof document !== "undefined" && document.body.getAttribute("data-theme") === "dark") {
    return C_DARK;
  }
  return C;
};
