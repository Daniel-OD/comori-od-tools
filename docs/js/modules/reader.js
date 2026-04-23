import { spinner } from "./ui.js";
import { renderBookmarkToggle } from "./bookmarks.js";

export function renderReaderEmpty() {
  const rb = document.getElementById("reader-body");
  if (!rb) return;
  rb.innerHTML = `<div class="empty">Selectează un articol din bibliotecă pentru a-l citi.</div>`;
}

export function renderReaderLoading() {
  const rb = document.getElementById("reader-body");
  if (!rb) return;
  rb.innerHTML = "";
  rb.appendChild(spinner());
}

export function renderReaderArticle(currentContent, onBookmarkChange) {
  const rb = document.getElementById("reader-body");
  if (!rb) return;

  rb.innerHTML = `
    <div class="reader-head">
      <div>
        <div id="article-title"></div>
        <div id="article-meta"></div>
      </div>
      <div id="reader-bookmark"></div>
    </div>
    <div id="article-text"></div>
  `;

  rb.querySelector("#article-title").textContent = currentContent.title;
  rb.querySelector("#article-meta").textContent = `${currentContent.author || ""}${currentContent.book ? ` · ${currentContent.book}` : ""}`;
  rb.querySelector("#article-text").textContent = currentContent.lines.join("\n");

  renderBookmarkToggle(rb.querySelector("#reader-bookmark"), currentContent, onBookmarkChange);
}

export function renderReaderError() {
  const rb = document.getElementById("reader-body");
  if (!rb) return;
  rb.innerHTML = `<div class="empty">Eroare la încărcarea articolului.</div>`;
}
