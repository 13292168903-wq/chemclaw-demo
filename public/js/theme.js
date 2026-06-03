// ===== Theme Module =====
import { state, $ } from "./state.js";

export function initTheme() {
  const saved = localStorage.getItem("chemclaw-theme") || "light";
  applyTheme(saved);
}

export function toggleTheme() {
  const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem("chemclaw-theme", next);
  state.theme = next;
}

function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
    document.documentElement.classList.remove("light");
  } else {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
  }
}
