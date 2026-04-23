const KEY = "od_dark";

function applyDarkMode(enabled) {
  document.documentElement.classList.toggle("dark", enabled);
  const btn = document.getElementById("dark-toggle");
  if (btn) btn.textContent = enabled ? "☀️" : "🌙";
}

export function initDarkMode() {
  const initial = localStorage.getItem(KEY) === "1";
  applyDarkMode(initial);

  const btn = document.getElementById("dark-toggle");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const enabled = !document.documentElement.classList.contains("dark");
    localStorage.setItem(KEY, enabled ? "1" : "0");
    applyDarkMode(enabled);
  });
}
