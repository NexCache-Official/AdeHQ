"use client";

import { createContext, useContext, useEffect } from "react";

/**
 * The platform is light-theme only. This provider is intentionally a no-op that
 * forces the light color scheme. `useTheme` is kept (always returning "light")
 * so existing imports don't break after the appearance toggle was removed.
 */

export type Theme = "light";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const LIGHT_VALUE: ThemeContextValue = {
  theme: "light",
  setTheme: () => {},
  toggleTheme: () => {},
};

const ThemeContext = createContext<ThemeContextValue>(LIGHT_VALUE);

/** Runs before hydration to lock the document to the light color scheme. */
export const themeInitScript = `(function(){try{var el=document.documentElement;el.classList.remove('dark');el.style.colorScheme='light';}catch(e){}})();`;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const el = document.documentElement;
    el.classList.remove("dark");
    el.style.colorScheme = "light";
  }, []);

  return <ThemeContext.Provider value={LIGHT_VALUE}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
