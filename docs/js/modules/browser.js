import { fetchDoc } from "./fetcher.js";
import { showProgress, hideProgress } from "./progress.js";
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

function getSlugFromHref(href, segment) {
  if (!href) return "";
  try {
    const url = href.startsWith("http") ? new URL(href) : new URL(href, "https://comori-od.ro");
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf(segment);
    return idx >= 0 ? decodeURIComponent(parts[idx + 1] || "").replace(/\/$/, "") : "";
  } catch {
    const marker = `/${segment}/`;
    const idx = href.indexOf(marker);
    if (idx < 0) return "";
    return href.slice(idx + marker.length).split(/[/?#]/)[0].replace(/\/$/, "");
  }
}

function cleanTitle(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/Pr\.\s*Iosif\s*Trifa\s*/gi, "")
    .replace(/Traian\s*Dorz\s*/gi, "")
    .trim();
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
    d.innerHTML = `<div><div class="brow-name">${author.name}</div></div>`;
    d.addEventListener("click", () => selectAuthor(author));
    authCol.appendChild(d);
  });
}

export async function selectAuthor(author) {
  selAuthor = author;
  selBook = null;
  currentContent = null;

  const bookCol = document.getElementById("col-books");
  const artCol = document.getElementById("col-articles");
  bookCol.innerHTML = `<div class="bcol-head"><span>Cărți</span></div>`;
  artCol.innerHTML = `<div class="bcol-head"><span>Articole</span></div><div class="empty-msg">Selectează o carte.</div>`;
  showProgress("col-books", "Se încarcă volumele...");

  try {
    const doc = await fetchDoc(`/author/${author.slug}`);
    bookCol.innerHTML = `<div class="bcol-head"><span>Cărți</span></div>`;

    const seen = new Set();
    const anchors = [...doc.querySelectorAll("a[href*='/book/'], a[href*='comori-od.ro/book/']")];

    anchors.forEach((a) => {
      const slug = getSlugFromHref(a.getAttribute("href"), "book");
      const title = cleanTitle(a.querySelector("h2,h3,h4")?.textContent || a.textContent);

      if (slug && title.length > 2 && !seen.has(slug)) {
        seen.add(slug);
        const d = document.createElement("div");
        d.className = "brow";
        d.dataset.slug = slug;
        d.innerHTML = `<div class="brow-name">${title}</div>`;
        d.addEventListener("click", () => selectBook({ slug, title }));
        bookCol.appendChild(d);
      }
    });

    if (!seen.size) {
      console.error("[Browser] No books extracted", { author, links: [...doc.querySelectorAll("a")].slice(0, 20).map(a => a.getAttribute("href")) });
      bookCol.innerHTML += `<div class="empty-msg">Nu s-au găsit cărți pentru acest autor.</div>`;
    }
  } catch (e) {
    console.error("[Browser] Author load failed", { author, error: e });
    bookCol.innerHTML += `<div class="empty-msg">Eroare la încărcare.</div>`;
  } finally {
    hideProgress("col-books");
  }

  emitState();
}

export async function selectBook(book) {
  selBook = book;
  currentContent = null;

  const artCol = document.getElementById("col-articles");
  artCol.innerHTML = `<div class="bcol-head"><span>${book.title}</span></div>`;
  showProgress("col-articles", "Se încarcă articolele...");

  try {
    const doc = await fetchDoc(`/book/${book.slug}`);
    artCol.innerHTML = `<div class="bcol-head"><span>${book.title}</span></div>`;

    const seen = new Set();
    const grid = document.createElement("div");
    grid.className = "art-grid";
    const anchors = [...doc.querySelectorAll("a[href*='/article/'], a[href*='comori-od.ro/article/']")];

    anchors.forEach((a) => {
      const slug = getSlugFromHref(a.getAttribute("href"), "article");
      const title = cleanTitle(a.querySelector("h2,h3,h4")?.textContent || a.textContent);

      if (slug && title.length > 2 && !seen.has(slug)) {
        seen.add(slug);
        const d = document.createElement("div");
        d.className = "art-row";
        d.dataset.slug = slug;
        d.innerHTML = `<span class="art-num">${seen.size}.</span><span class="art-title">${title}</span>`;
        d.addEventListener("click", () => selectArticle({ slug, title }));
        grid.appendChild(d);
      }
    });

    artCol.querySelector(".bcol-head").innerHTML = `<span>${book.title}</span><span style="font-weight:400">${seen.size}</span>`;
    if (!seen.size) {
      console.error("[Browser] No articles extracted", { book });
      artCol.innerHTML += `<div class="empty-msg">Nu s-au găsit articole.</div>`;
    } else {
      artCol.appendChild(grid);
    }
  } catch (e) {
    console.error("[Browser] Book load failed", { book, error: e });
    artCol.innerHTML += `<div class="empty-msg">Eroare la încărcare.</div>`;
  } finally {
    hideProgress("col-articles");
  }

  emitState();
}

export async function selectArticle(article) {
  currentContent = null;
  renderReaderLoading();

  try {
    const doc = await fetchDoc(`/article/${article.slug}`);
    doc.querySelectorAll("nav, header, footer, script, style, img, svg, button, .breadcrumb, .breadcrumbs, .sidebar, .widget, .pagination, .nav-links, .post-navigation").forEach(el => el.remove());

    const title = doc.querySelector("h1")?.textContent?.trim() || article.title;
    const authorName = selAuthor?.name || "";
    const bookTitle = selBook?.title || "";
    const container = doc.querySelector("article .entry-content") || doc.querySelector("article .post-content") || doc.querySelector(".entry-content") || doc.querySelector(".post-content") || doc.querySelector("main article") || doc.querySelector("article") || doc.querySelector("main") || doc.body;

    const seen = new Set();
    let lines = [];
    const bad = new Set([title, bookTitle, authorName].filter(Boolean));

    const addLine = (t) => {
      const s = cleanTitle(t);
      if (!s || s.length < 25 || seen.has(s) || bad.has(s)) return;
      if (/^(home|acasa|înapoi|next|prev|read more|mai mult)$/i.test(s)) return;
      seen.add(s);
      lines.push(s);
    };

    container.querySelectorAll("p, blockquote, h2, h3, li").forEach(el => addLine(el.textContent));

    if (lines.length < 3) {
      lines = [];
      seen.clear();
      (container.textContent || "").split(/\r?\n/).forEach(addLine);
    }

    if (!lines.length) {
      console.error("[Reader] No real article body extracted", { slug: article.slug, title });
      throw new Error("No real article body extracted");
    }

    currentContent = {
      slug: article.slug,
      title,
      lines,
      fullText: lines.join("\n"),
      author: authorName,
      book: bookTitle,
    };

    renderReaderArticle(currentContent, handlers.onBookmarkChange);
  } catch (e) {
    console.error("[Reader] error:", e);
    renderReaderError();
  }

  emitState();
}
