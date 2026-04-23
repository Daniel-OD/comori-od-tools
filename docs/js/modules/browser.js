import { fetchDoc } from "./fetcher.js";
import { showProgress, hideProgress } from "./progress.js";
import { addBooksSearch, addArticlesSearch } from "./search.js";
import { isBookmarked } from "./bookmarks.js";
import { updateCtxBar } from "./ui.js";
import { renderReaderLoading, renderReaderArticle, renderReaderError } from "./reader.js";

let selAuthor = null;
let selBook = null;
let currentContent = null;
let handlers = {
  onStateChange: () => {},
  onBookmarkChange: () => {},
};

function emitState() {
  handlers.onStateChange({ selAuthor, selBook, currentContent });
}

function markSelectedAuthor() {
  document.querySelectorAll("#col-authors .brow").forEach((r) => {
    r.classList.toggle("active", r.dataset.slug === selAuthor?.slug);
  });
  document.querySelectorAll("#bars .bar-seg").forEach((b) => {
    const active = b.dataset.slug === selAuthor?.slug;
    b.style.outline = active ? "2px solid #5b6af0" : "none";
    b.dataset.active = active ? "true" : "false";
  });
}

export function getBrowserState() {
  return { selAuthor, selBook, currentContent };
}

export function initBrowser({ authors, onStateChange, onBookmarkChange }) {
  handlers.onStateChange = onStateChange || handlers.onStateChange;
  handlers.onBookmarkChange = onBookmarkChange || handlers.onBookmarkChange;

  const authCol = document.getElementById("col-authors");
  authCol.innerHTML = `<div class="bcol-head"><span>Autori (${authors.length})</span></div>`;

  authors.forEach((author) => {
    const d = document.createElement("div");
    d.className = "brow";
    d.dataset.slug = author.slug;
    d.innerHTML = `<div><div class="brow-name">${author.name}</div>${author.years ? `<div class="brow-sub">${author.years}</div>` : ""}</div><span class="brow-badge">${author.count.toLocaleString()}</span>`;
    d.addEventListener("click", () => selectAuthor(author));
    authCol.appendChild(d);
  });
}

export async function selectAuthor(author) {
  selAuthor = author;
  selBook = null;
  currentContent = null;
  markSelectedAuthor();

  const bookCol = document.getElementById("col-books");
  bookCol.innerHTML = `<div class="bcol-head"><span>Cărți · ${author.name.split(" ").slice(-1)[0]}</span></div>`;
  showProgress("col-books", "Se încarcă volumele...");

  document.getElementById("col-articles").innerHTML = `<div class="bcol-head"><span>Articole</span></div><div class="empty-msg">Selectează o carte.</div>`;

  try {
    const doc = await fetchDoc(`/author/${author.slug}`);
    bookCol.innerHTML = `<div class="bcol-head"><span>Cărți · ${author.name.split(" ").slice(-1)[0]}</span></div>`;

    const seen = new Set();
    doc.querySelectorAll("a[href^='/book/']").forEach((a) => {
      const slug = a.getAttribute("href").replace("/book/", "").replace(/\/$/, "");
      if (!seen.has(slug) && slug) {
        seen.add(slug);
        const title = a.querySelector("h3")?.textContent?.trim() || a.textContent.trim();
        if (title && title.length > 2) {
          const d = document.createElement("div");
          d.className = "brow";
          d.dataset.slug = slug;
          d.innerHTML = `<div class="brow-name">${title}</div>`;
          d.addEventListener("click", () => selectBook({ slug, title }));
          bookCol.appendChild(d);
        }
      }
    });

    if (bookCol.querySelectorAll(".brow").length === 0) {
      bookCol.innerHTML += `<div class="empty-msg">Nu s-au găsit cărți.</div>`;
    } else {
      addBooksSearch(bookCol);
    }
  } catch {
    bookCol.innerHTML += `<div class="empty-msg">Eroare la încărcare.</div>`;
  } finally {
    hideProgress("col-books");
  }

  updateCtxBar(currentContent, selAuthor);
  emitState();
}

export async function selectBook(book) {
  selBook = book;
  currentContent = null;

  document.querySelectorAll("#col-books .brow").forEach((r) => {
    r.classList.toggle("active", r.dataset.slug === book.slug);
  });

  const artCol = document.getElementById("col-articles");
  artCol.innerHTML = `<div class="bcol-head"><span>${book.title}</span></div>`;
  showProgress("col-articles", "Se încarcă articolele...");

  try {
    const doc = await fetchDoc(`/book/${book.slug}`);
    artCol.innerHTML = `<div class="bcol-head"><span>${book.title}</span></div>`;

    const seen = new Set();
    const grid = document.createElement("div");
    grid.className = "art-grid";
    let n = 0;

    doc.querySelectorAll("a[href^='/article/']").forEach((a) => {
      const slug = a.getAttribute("href").replace("/article/", "").replace(/\/$/, "");
      if (!seen.has(slug) && slug) {
        seen.add(slug);
        n += 1;
        const title = a.querySelector("h3")?.textContent?.trim() || a.textContent.trim();
        if (title && title.length > 2) {
          const d = document.createElement("div");
          d.className = "art-row";
          const star = isBookmarked(slug) ? "★" : "";
          d.innerHTML = `<span class="art-num">${n}.</span><span class="art-title">${title}${star ? ` ${star}` : ""}</span>`;
          d.addEventListener("click", () => selectArticle({ slug, title }));
          grid.appendChild(d);
        }
      }
    });

    artCol.querySelector(".bcol-head").innerHTML = `<span>${book.title}</span><span style="font-weight:400">${n}</span>`;
    if (n === 0) {
      artCol.innerHTML += `<div class="empty-msg">Nu s-au găsit articole.</div>`;
    } else {
      artCol.appendChild(grid);
      addArticlesSearch(artCol);
    }
  } catch {
    artCol.innerHTML += `<div class="empty-msg">Eroare la încărcare.</div>`;
  } finally {
    hideProgress("col-articles");
  }

  updateCtxBar(currentContent, selAuthor);
  emitState();
}

export async function selectArticle(article) {
  currentContent = null;
  renderReaderLoading();

  try {
    const doc = await fetchDoc(`/article/${article.slug}`);
    doc.querySelectorAll("nav,header,footer,script,style,img").forEach((el) => el.remove());

    const title = doc.querySelector("h1")?.textContent?.trim() || article.title;
    const main = doc.querySelector("main") || doc.body;
    const raw = main.innerText || main.textContent || "";

    const bad = ["Comori OD", "Cuprins", "Folosește", "Articol "];
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 1 && !bad.some((b) => l.startsWith(b)) && !l.includes("←") && !l.includes("→") && !(l.startsWith("de ") && l.length < 40) && !l.startsWith("Volum:"))
      .slice(0, 200);

    currentContent = {
      slug: article.slug,
      title,
      lines,
      fullText: lines.join("\n"),
      author: selAuthor?.name || article.author || "",
      book: selBook?.title || article.book || "",
    };

    renderReaderArticle(currentContent, handlers.onBookmarkChange);
  } catch {
    renderReaderError();
  }

  updateCtxBar(currentContent, selAuthor);
  emitState();
}
