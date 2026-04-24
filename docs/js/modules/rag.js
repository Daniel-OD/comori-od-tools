const INDEX_URL = "data/rag-index.json";

let cachedIndex = null;

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ăâîșț\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  const stop = new Set([
    "si", "sau", "de", "la", "in", "din", "cu", "pe", "pentru", "este", "sunt", "care", "ce", "un", "o", "ale", "al", "ai", "a", "lui",
    "the", "and", "or", "of", "to", "is", "are",
  ]);
  return normalize(text)
    .split(" ")
    .filter((t) => t.length > 2 && !stop.has(t));
}

async function loadIndex() {
  if (cachedIndex) return cachedIndex;
  try {
    const resp = await fetch(INDEX_URL, { cache: "no-store" });
    if (!resp.ok) throw new Error(`RAG index HTTP ${resp.status}`);
    cachedIndex = await resp.json();
    if (!Array.isArray(cachedIndex?.chunks)) throw new Error("Invalid RAG index shape");
    return cachedIndex;
  } catch (error) {
    console.warn("[RAG] Index not available; falling back to current article only", error);
    cachedIndex = { version: 1, chunks: [] };
    return cachedIndex;
  }
}

function scoreChunk(chunk, queryTokens) {
  const haystack = normalize(`${chunk.title || ""} ${chunk.author || ""} ${chunk.book || ""} ${chunk.text || ""}`);
  let score = 0;

  for (const token of queryTokens) {
    if (haystack.includes(token)) score += 1;
    if (normalize(chunk.title).includes(token)) score += 1.5;
    if (normalize(chunk.author).includes(token)) score += 1;
    if (normalize(chunk.book).includes(token)) score += 0.8;
  }

  return score;
}

export async function searchLibrary(query, { currentContent = null, limit = 5 } = {}) {
  const queryTokens = tokenize(query);
  const results = [];

  if (currentContent?.fullText) {
    results.push({
      source: "current-article",
      confidence: "ridicată",
      title: currentContent.title,
      author: currentContent.author,
      book: currentContent.book,
      slug: currentContent.slug,
      text: currentContent.fullText.slice(0, 1600),
      score: 999,
    });
  }

  const index = await loadIndex();

  for (const chunk of index.chunks || []) {
    const score = scoreChunk(chunk, queryTokens);
    if (score > 0) {
      results.push({ ...chunk, score, source: "library-index", confidence: score >= 4 ? "ridicată" : "medie" });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function formatRagContext(results) {
  if (!results?.length) return "Nu există fragmente relevante în indexul local.";

  return results.map((r, i) => [
    `SURSA ${i + 1} [${r.confidence || "medie"}]`,
    `Titlu: ${r.title || "necunoscut"}`,
    `Autor: ${r.author || "necunoscut"}`,
    `Carte: ${r.book || "necunoscută"}`,
    `Slug: ${r.slug || ""}`,
    `Fragment: ${String(r.text || "").slice(0, 1200)}`,
  ].join("\n")).join("\n\n");
}
