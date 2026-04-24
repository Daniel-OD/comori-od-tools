#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

let embedder = null;
async function getEmbedder() {
  if (embedder) return embedder;
  const { pipeline } = await import('@xenova/transformers');
  embedder = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  return embedder;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "data");
const OUT_FILE = path.join(OUT_DIR, "rag-index.json");
const BASE_URL = "https://comori-od.ro";

function envLimit(name) {
  const val = parseInt(process.env[name], 10);
  return Number.isFinite(val) && val > 0 ? val : Infinity;
}

const LIMIT_AUTHORS = envLimit('RAG_LIMIT_AUTHORS');
const LIMIT_BOOKS = envLimit('RAG_LIMIT_BOOKS');
const LIMIT_ARTICLES = envLimit('RAG_LIMIT_ARTICLES');

const delay = (ms) => new Promise(r => setTimeout(r, ms));

function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchHtml(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

function chunkText(text) {
  return text.split(/\n+/).filter(p => p.length > 100);
}

function extractSlugs(html, type) {
  return [...new Set([...html.matchAll(new RegExp(`href="\\/${type}\\/([^"/?#]+)"`, 'g'))].map(m => m[1]))];
}

async function main() {
  const chunks = [];

  console.log("Fetching authors list...");
  const homeHtml = await fetchHtml(`${BASE_URL}/`);
  let authorSlugs = extractSlugs(homeHtml, 'author');

  if (authorSlugs.length === 0) {
    const authorsHtml = await fetchHtml(`${BASE_URL}/authors`);
    authorSlugs = extractSlugs(authorsHtml, 'author');
  }

  if (authorSlugs.length === 0) {
    throw new Error("Could not discover any authors from the site.");
  }

  const limitedAuthors = authorSlugs.slice(0, LIMIT_AUTHORS);
  console.log(`Found ${authorSlugs.length} authors, processing ${limitedAuthors.length}.`);

  for (const authorSlug of limitedAuthors) {
    console.log(`  Author: ${authorSlug}`);
    const authorHtml = await fetchHtml(`${BASE_URL}/author/${authorSlug}`);
    await delay(200);

    const bookSlugs = extractSlugs(authorHtml, 'book');
    const articleSlugsFromAuthor = extractSlugs(authorHtml, 'article');

    if (bookSlugs.length > 0) {
      const limitedBooks = bookSlugs.slice(0, LIMIT_BOOKS);
      for (const bookSlug of limitedBooks) {
        console.log(`    Book: ${bookSlug}`);
        const bookHtml = await fetchHtml(`${BASE_URL}/book/${bookSlug}`);
        await delay(200);

        const articleSlugs = extractSlugs(bookHtml, 'article');
        const limitedArticles = articleSlugs.slice(0, LIMIT_ARTICLES);
        for (const slug of limitedArticles) {
          console.log(`      Article: ${slug}`);
          const art = await fetchHtml(`${BASE_URL}/article/${slug}`);
          const text = stripTags(art);
          for (const p of chunkText(text)) {
            chunks.push({ slug, text: p });
          }
          await delay(200);
        }
      }
    } else if (articleSlugsFromAuthor.length > 0) {
      const limitedArticles = articleSlugsFromAuthor.slice(0, LIMIT_ARTICLES);
      for (const slug of limitedArticles) {
        console.log(`    Article: ${slug}`);
        const art = await fetchHtml(`${BASE_URL}/article/${slug}`);
        const text = stripTags(art);
        for (const p of chunkText(text)) {
          chunks.push({ slug, text: p });
        }
        await delay(200);
      }
    }
  }

  if (process.env.RAG_EMBEDDING === 'dense') {
    console.log("Building neural embeddings...");
    const e = await getEmbedder();

    for (const c of chunks) {
      const out = await e(c.text.slice(0, 512));
      c.dv = Array.from(out.data.slice(0, 384));
    }
  }

  await mkdir(OUT_DIR, { recursive: true });

  await writeFile(OUT_FILE, JSON.stringify({
    embedding: { type: process.env.RAG_EMBEDDING === 'dense' ? 'dense' : 'none' },
    chunks
  }, null, 2));

  console.log(`DONE — ${chunks.length} chunks written to ${OUT_FILE}`);
}

main();
