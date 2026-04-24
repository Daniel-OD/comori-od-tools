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

const AUTHORS = [
  { name: "Traian Dorz", slug: "traian-dorz" },
  { name: "Pr. Iosif Trifa", slug: "pr-iosif-trifa" }
];

const delay = (ms) => new Promise(r => setTimeout(r, ms));

function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchHtml(url) {
  const r = await fetch(url);
  return await r.text();
}

function chunkText(text) {
  const parts = text.split(/\n+/).filter(p => p.length > 100);
  return parts.slice(0, 10);
}

async function main() {
  const chunks = [];

  for (const author of AUTHORS) {
    const html = await fetchHtml(`${BASE_URL}/author/${author.slug}`);

    const matches = [...html.matchAll(/href="\/article\/([^"]+)"/g)];

    for (const m of matches.slice(0, 5)) {
      const slug = m[1];
      const art = await fetchHtml(`${BASE_URL}/article/${slug}`);
      const text = stripTags(art);

      const parts = chunkText(text);

      for (const p of parts) {
        chunks.push({ slug, text: p });
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

  console.log("DONE");
}

main();
