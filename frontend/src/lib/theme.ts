/**
 * Light/dark theme persistence (PHASE2_IMPLEMENTATION_PLAN.md §7.2). The
 * actual palettes live entirely in global.css, keyed off <html>'s
 * data-theme attribute (plus a prefers-color-scheme fallback for a
 * first-time visitor who hasn't chosen yet) -- this module is just the
 * bit of logic that reads/writes the person's stored choice and keeps
 * that attribute in sync with it. No component other than ThemeToggle
 * needs to know this exists.
 */

export type Theme = "light" | "dark";

const STORAGE_KEY = "gdb-theme";

/** The person's stored choice, or null if they've never toggled it --
 * in which case global.css's prefers-color-scheme fallback decides. */
export function getStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    // localStorage can throw (private browsing, blocked storage) --
    // treat that the same as "no stored preference" rather than
    // crashing the app over a theme toggle.
    return null;
  }
}

/** Applies a theme to the document right away, independent of React --
 * called once at startup (main.tsx, before the first paint, to avoid a
 * flash of the wrong theme) and again on every toggle. */
export function applyTheme(theme: Theme | null): void {
  if (theme) {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

/** Persists a choice and applies it immediately. */
export function setStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Best-effort -- the toggle still works for this page load even if
    // the choice can't be persisted for next time.
  }
  applyTheme(theme);
}

/** What the toggle should show as "current right now" -- the stored
 * choice if there is one, otherwise whatever the OS preference
 * resolves to (matching global.css's own fallback). */
export function getEffectiveTheme(): Theme {
  const stored = getStoredTheme();
  if (stored) return stored;
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}
