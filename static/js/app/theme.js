const THEME_STORAGE_KEY = "graph-of-god-theme";

export function resolveStoredTheme() {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark") {
      return value;
    }
  } catch {
    return null;
  }

  return null;
}

export function resolvePreferredTheme(windowRef) {
  if (windowRef.matchMedia && windowRef.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

export function resolveInitialTheme(windowRef, rootElement) {
  return rootElement.dataset.theme || resolveStoredTheme() || resolvePreferredTheme(windowRef);
}

export function applyTheme(rootElement, theme) {
  rootElement.dataset.theme = theme;
}

export function persistTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

export function getNextTheme(currentTheme) {
  return currentTheme === "dark" ? "light" : "dark";
}

export function getThemeToggleLabel(currentTheme) {
  return currentTheme === "dark" ? "Светлая тема" : "Тёмная тема";
}
