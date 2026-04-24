#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "data");
const OUT_FILE = path.join(OUT_DIR, "rag-index.json");
const BASE_URL = "https://comori-od.ro";

const AUTHORS = [
  { name: "Traian Dorz", slug: "traian-dorz" },
  { name: "Pr. Iosif Trifa", slug: "pr-iosif-trifa" },
  { name: "Arcadie Nistor", slug: "arcadie-nistor" },
  { name: "Popa Petru (Săucani)", slug: "popa-petru-saucani" },
  { name: "Popa Petru (Batiz)", slug: "popa-petru-batiz" },
  { name: "Ioan Marini", slug: "ioan-marini" },
  { name: "Ioan Opriș", slug: "ioan-opris" },
  { name: "Leon Andronic", slug: "leon-andronic" },
  { name: "Ioan Voina", slug: "ioan-voina" },
  { name: "Vasile Câmpean", slug: "vasile-campean" },
  { name: "Pr. Teodor Heredea", slug: "pr-teodor-heredea" },
  { name: "Costică Feder", slug: "costica-feder" },
  { name: "Costică Iacobuță", slug: "costica-iacobuta" },
  { name: "Cornel Silaghi", slug: "cornel-silaghi" },
  { name: "Valer Irinca", slug: "valer-irinca" },
  { name: "Cornel Rusu", slug: "cornel-rusu" },
  { name: "Vasile Acsinuță", slug: "vasile-acsinuta" },
  { name: "Viorel Bar (Săucani)", slug: "viorel-bar-saucani" },
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function decodeHtml(text) {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripTags(html) {
  return decodeHtml(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/h[1-6]>|<\/li>|<\/blockquote>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractLinks(html, segment) {
  const links = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = re.exec(html))) {
    const href = match[1];
    const slug = getSlugFromHref(href, segment);
    if (!slug || seen.has(slug)) continue;

    const title = cleanText(stripTags(match[2]));
    if (!title || title.length < 2) continue;

    seen.add(slug);
    links.push({ slug, title });
  }

  return links;
}

function getSlugFromHref(href, segment) {
  if (!href) return "";
  try {
    const url = href.startsWith("http") ? new URL(href) : new URL(href, BASE_URL);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf(segment);
    return idx >= 0 ? decodeURIComponent(parts[idx + 1] || "") : "";
  } catch {
    const marker = `/${segment}/`;
    const idx = href.indexOf(marker);
    return idx >= 0 ? href.slice(idx + marker.length).split(/[/?#]/)[0] : "";
  }
}

function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/⏱\s*<?\s*\d+\s*min/gi, "")
    .trim();
}

function extractTitle(html, fallback) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return cleanText(stripTags(h1?.[1] || fallback));
}

function extractArticleText(html) {
  const candidates = [
    /<article[\s\S]*?>([\s\S]*?)<\/article>/i,
    /<main[\s\S]*?>([\s\S]*?)<\/main>/i,
    /<body[\s\S]*?>([\s\S]*?)<\/body>/i,
  ];

  for (const re of candidates) {
    const match = html.match(re);
    if (match) {
      const text = stripTags(match[1]);
      if (text.length > 80) return text;
    }
  }

  return stripTags(html);
}

function chunkText(text, maxChars = 1200, overlap = 180) {
  const paragraphs = text.split(/\n+/).map(cleanText).filter((p) => p.length > 40);
  const chunks = [];
  let current = "";

  for (const p of paragraphs) {
    if ((current + "\n" + p).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = current.slice(Math.max(0, current.length - overlap));
    }
    current += (current ? "\n" : "") + p;
  }

  if (current.trim().length > 60) chunks.push(current.trim());
  return chunks;
}

async function fetchHtml(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; comori-od-rag-builder/1.0)",
          "Accept": "text/html,application/xhtml+xml",
        },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.text();
    } catch (error) {
      if (i === tries - 1) throw error;
      await delay(600 * (i + 1));
    }
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  const chunks = [];
  const errors = [];
  let articleCount = 0;
  let bookCount = 0;

  const limitAuthors = Number(process.env.RAG_LIMIT_AUTHORS || 0);
  const limitBooks = Number(process.env.RAG_LIMIT_BOOKS || 0);
  const limitArticles = Number(process.env.RAG_LIMIT_ARTICLES || 0);
  const sleepMs = Number(process.env.RAG_SLEEP_MS || 150);

  const authors = limitAuthors ? AUTHORS.slice(0, limitAuthors) : AUTHORS;

  for (const author of authors) {
    console.log(`\n[author] ${author.name}`);
    let authorHtml;
    try {
      authorHtml = await fetchHtml(`${BASE_URL}/author/${author.slug}`);
    } catch (error) {
      errors.push({ type: "author", slug: author.slug, message: error.message });
      continue;
    }

    let books = extractLinks(authorHtml, "book");
    if (limitBooks) books = books.slice(0, limitBooks);
    console.log(`  books: ${books.length}`);

    for (const book of books) {
      bookCount++;
      let bookHtml;
      try {
        await delay(sleepMs);
        bookHtml = await fetchHtml(`${BASE_URL}/book/${book.slug}`);
      } catch (error) {
        errors.push({ type: "book", slug: book.slug, message: error.message });
        continue;
      }

      let articles = extractLinks(bookHtml, "article");
      if (limitArticles) articles = articles.slice(0, limitArticles);
      console.log(`  [book] ${book.title} — ${articles.length} articles`);

      for (const article of articles) {
        try {
          await delay(sleepMs);
          const html = await fetchHtml(`${BASE_URL}/article/${article.slug}`);
          const title = extractTitle(html, article.title);
          const text = extractArticleText(html);
          const articleChunks = chunkText(text);
          articleCount++;

          articleChunks.forEach((chunk, idx) => {
            chunks.push({
              id: `${article.slug}#${idx + 1}`,
              slug: article.slug,
              title,
              author: author.name,
              authorSlug: author.slug,
              book: book.title,
              bookSlug: book.slug,
              url: `${BASE_URL}/article/${article.slug}`,
              chunk: idx + 1,
              text: chunk,
            });
          });
        } catch (error) {
          errors.push({ type: "article", slug: article.slug, message: error.message });
        }
      }
    }
  }

  await mkdir(OUT_DIR, { recursive: true });
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: BASE_URL,
    stats: {
      authors: authors.length,
      books: bookCount,
      articles: articleCount,
      chunks: chunks.length,
      errors: errors.length,
      startedAt,
    },
    chunks,
    errors: errors.slice(0, 200),
  };

  await writeFile(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\nDone: ${OUT_FILE}`);
  console.log(payload.stats);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
