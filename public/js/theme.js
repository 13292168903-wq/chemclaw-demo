// ===== Theme =====
const KEY = "chemclaw-theme";

export function initTheme() {
  const saved = localStorage.getItem(KEY);
  const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (systemDark ? "dark" : "light"), { persist: false });
}

export function toggleTheme() {
  const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
  applyTheme(next, { persist: true });
  return next;
}

export function applyTheme(theme, { persist = true } = {}) {
  const dark = theme === "dark";
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
  root.style.colorScheme = dark ? "dark" : "light";

  if (persist) {
    try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
  }

  const toggle = document.getElementById("themeToggle");
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(dark));
    toggle.setAttribute("aria-label", dark ? "切换到浅色模式" : "切换到深色模式");
    toggle.title = dark ? "切换到浅色模式" : "切换到深色模式";
  }
}
