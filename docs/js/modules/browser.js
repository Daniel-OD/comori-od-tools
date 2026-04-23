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
  bookCol.innerHTML = `<div class="bcol-head"><span>Cărți</span></div>`;
  showProgress("col-books", "Se încarcă volumele...");

  try {
    const doc = await fetchDoc(`/author/${author.slug}`);
    bookCol.innerHTML = `<div class="bcol-head"><span>Cărți</span></div>`;

    doc.querySelectorAll("a[href^='/book/']").forEach((a) => {
      const slug = a.getAttribute("href").replace("/book/", "").replace(/\/$/, "");
      const title = a.textContent.trim();

      if (slug && title.length > 2) {
        const d = document.createElement("div");
        d.className = "brow";
        d.innerHTML = `<div class="brow-name">${title}</div>`;
        d.addEventListener("click", () => selectBook({ slug, title }));
        bookCol.appendChild(d);
      }
    });

  } catch (e) {
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

    doc.querySelectorAll("a[href^='/article/']").forEach((a, i) => {
      const slug = a.getAttribute("href").replace("/article/", "").replace(/\/$/, "");
      const title = a.textContent.trim();

      if (slug && title.length > 2) {
        const d = document.createElement("div");
        d.className = "art-row";
        d.innerHTML = `<span>${i + 1}.</span> ${title}`;
        d.addEventListener("click", () => selectArticle({ slug, title }));
        artCol.appendChild(d);
      }
    });

  } catch {
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

    // Step 1: Remove noise elements
    doc.querySelectorAll(
      "nav, header, footer, script, style, img, svg, button, " +
      ".breadcrumb, .breadcrumbs, .sidebar, .widget, .pagination, .nav-links, .post-navigation"
    ).forEach(el => el.remove());

    const title = doc.querySelector("h1")?.textContent?.trim() || article.title;
    const authorName = selAuthor?.name || "";
    const bookTitle = selBook?.title || "";

    // Step 2: Find main content container by priority
    const container =
      doc.querySelector("article .entry-content") ||
      doc.querySelector("article .post-content") ||
      doc.querySelector(".entry-content") ||
      doc.querySelector(".post-content") ||
      doc.querySelector("main article") ||
      doc.querySelector("article") ||
      doc.querySelector("main") ||
      doc.body;

    // Step 3: Extract text from semantic blocks
    const seen = new Set();
    let lines = [];

    const isMetaOrDupe = (t) => {
      if (seen.has(t)) return true;
      if (t === title || t === bookTitle || t === authorName) return true;
      if (/^[»›>]/.test(t) || t.split(/\s*[/›»>]\s*/).length > 2) return true; // breadcrumb-like
      if (/^(home|acasa|inapoi|next|prev|previous|read more|mai mult)$/i.test(t)) return true;
      return false;
    };

    const addLine = (t) => {
      if (!t || isMetaOrDupe(t)) return;
      seen.add(t);
      lines.push(t);
    };

    const blocks = container.querySelectorAll("p, blockquote, h2, h3, li");

    blocks.forEach(el => {
      const t = el.textContent.trim();
      const isSubheading = /^h[23]$/i.test(el.tagName);
      if (t.length >= 25 || isSubheading) addLine(t);
    });

    // Step 5: Fallback to innerText if too little extracted
    if (lines.length < 3) {
      const raw = (container.innerText || container.textContent || "")
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length >= 25);
      lines = [];
      seen.clear();
      raw.forEach(t => addLine(t));
    }

    // Step 6: Defensive check — only metadata/title extracted
    if (lines.length <= 2 && lines.every(l => l === title || l === bookTitle || l === authorName)) {
      console.error("[Reader] No real article body extracted", { slug: article.slug, title });
      throw new Error("No real article body extracted");
    }

    if (!lines.length) throw new Error("No content parsed");

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
