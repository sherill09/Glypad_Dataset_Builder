import { useState } from "react";

import { getEffectiveTheme, setStoredTheme, type Theme } from "../lib/theme";
import { IconMoon, IconSun } from "./Icons";

/**
 * Topbar light/dark toggle (PHASE2_IMPLEMENTATION_PLAN.md §7.2 point 2).
 * Deliberately not gated behind auth -- it affects the whole app's
 * chrome, including the login/register pages, so it renders in the
 * topbar regardless of whether anyone's signed in.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => getEffectiveTheme());

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setStoredTheme(next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      className="btn btn--ghost btn--small theme-toggle"
      onClick={toggle}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Switch to the other theme"
    >
      {theme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />}
    </button>
  );
}
