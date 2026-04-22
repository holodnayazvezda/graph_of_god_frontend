import {
  THEME_CHANGE_EVENT,
  applyTheme,
  getNextTheme,
  getThemeToggleLabel,
  persistTheme,
  resolveInitialTheme,
} from "./app/theme.js";

window.addEventListener("DOMContentLoaded", () => {
  const documentRef = window.document;
  const rootElement = documentRef.documentElement;
  const themeToggleButton = documentRef.getElementById("theme-toggle-button");

  if (!themeToggleButton) {
    return;
  }

  let currentTheme = resolveInitialTheme(window, rootElement);
  applyCurrentTheme(currentTheme, { persist: false });

  themeToggleButton.addEventListener("click", () => {
    currentTheme = getNextTheme(currentTheme);
    applyCurrentTheme(currentTheme);
  });

  function applyCurrentTheme(theme, options = {}) {
    const { persist = true } = options;
    applyTheme(rootElement, theme);
    if (persist) {
      persistTheme(theme);
    }

    themeToggleButton.textContent = getThemeToggleLabel(theme);
    themeToggleButton.setAttribute("aria-pressed", String(theme === "dark"));
    themeToggleButton.setAttribute("title", themeToggleButton.textContent);
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme } }));
  }
});
