const KEY = "od_bookmarks";

function readStorage() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStorage(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function saveBookmark(article) {
  const items = readStorage().filter((item) => item.slug !== article.slug);
  items.push({
    slug: article.slug,
    title: article.title,
    author: article.author || "",
    book: article.book || "",
    savedAt: Date.now(),
  });
  writeStorage(items);
}

export function removeBookmark(slug) {
  writeStorage(readStorage().filter((item) => item.slug !== slug));
}

export function getBookmarks() {
  return readStorage().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

export function isBookmarked(slug) {
  return getBookmarks().some((item) => item.slug === slug);
}

export function renderBookmarkToggle(container, article, onChange) {
  if (!container || !article?.slug) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "bookmark-toggle";

  const refresh = () => {
    btn.textContent = isBookmarked(article.slug) ? "★" : "⭐";
    btn.title = isBookmarked(article.slug) ? "Elimină semnul de carte" : "Salvează semn de carte";
  };

  btn.addEventListener("click", () => {
    if (isBookmarked(article.slug)) {
      removeBookmark(article.slug);
    } else {
      saveBookmark(article);
    }
    refresh();
    if (typeof onChange === "function") onChange();
  });

  refresh();
  container.innerHTML = "";
  container.appendChild(btn);
}

export function renderBookmarksPanel(onSelectBookmark) {
  const panel = document.getElementById("bookmarks-panel");
  if (!panel) return;

  const isCollapsed = panel.dataset.collapsed === "true";
  const items = getBookmarks();

  panel.innerHTML = `
    <div class="bookmarks-head">
      <h3>Semne de carte (${items.length})</h3>
      <button class="bookmarks-toggle" type="button">${isCollapsed ? "Arată" : "Ascunde"}</button>
    </div>
    <div class="bookmarks-list" style="display:${isCollapsed ? "none" : "flex"}"></div>
  `;

  const toggle = panel.querySelector(".bookmarks-toggle");
  const list = panel.querySelector(".bookmarks-list");

  toggle.addEventListener("click", () => {
    panel.dataset.collapsed = panel.dataset.collapsed === "true" ? "false" : "true";
    renderBookmarksPanel(onSelectBookmark);
  });

  if (items.length === 0) {
    list.innerHTML = `<div class="empty-msg" style="padding:.5rem 0">Nu ai semne de carte salvate.</div>`;
    return;
  }

  items.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bookmark-item";
    btn.innerHTML = `${item.title} <small>${item.author ? `· ${item.author}` : ""}</small>`;
    btn.addEventListener("click", () => {
      if (typeof onSelectBookmark === "function") onSelectBookmark(item);
    });
    list.appendChild(btn);
  });
}
