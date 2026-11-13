// rag.js — context pentru chatul AI din motorul Comori Search (căutare hibridă BM25 + embeddings, în PostgreSQL/pgvector).
// Interfața (searchLibrary / formatRagContext) este neschimbată față de versiunea veche, deci ai-chat.js nu se modifică.
import { SEARCH_API_URL } from "../config.js";

function apiBase() {
  let base = SEARCH_API_URL;
  try { base = localStorage.getItem("comoriSearchApi") || base; } catch { /* storage indisponibil */ }
  return (base || "").replace(/\/+$/, "");
}

async function callApi(base, query, limit) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const words = query.trim().split(/\s+/).length;
    // 3+ cuvinte: căutare după idee; mai puține: căutare hibridă (cuvinte + sens)
    const resp = words >= 3
      ? await fetch(`${base}/api/idea`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: query, limit }),
          signal: ctrl.signal,
        })
      : await fetch(`${base}/api/search?${new URLSearchParams({ q: query, mode: "hybrid", limit })}`, { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function searchLibrary(query, { currentContent = null, limit = 5 } = {}) {
  const results = [];

  if (currentContent?.fullText) {
    results.push({
      title: currentContent.title,
      author: currentContent.author,
      book: currentContent.book,
      text: currentContent.fullText.slice(0, 1500),
      score: 1,
      confidence: "ridicată",
    });
  }

  const base = apiBase();
  if (!base) return results;

  try {
    const data = await callApi(base, query, limit);
    for (const r of data.results || []) {
      results.push({
        title: r.title,
        author: r.author,
        book: r.book,
        text: r.snippet,
        url: r.url,
        score: r.similarity ?? r.relevance,
        confidence: r.confidence || "medie",
        reasons: r.reasons || [],
      });
    }
  } catch (e) {
    // Fără API, chatul continuă doar cu articolul deschis; nu inventăm surse.
    console.warn("Căutarea în bibliotecă nu este disponibilă:", e.message);
  }
  return results.slice(0, limit);
}

export function formatRagContext(results) {
  return results.map((r, i) => [
    `SURSA ${i + 1} [${r.confidence}]`,
    `Titlu: ${r.title}`,
    `Autor: ${r.author}`,
    `Carte: ${r.book}`,
    r.url ? `Link: ${r.url}` : null,
    `Fragment: ${String(r.text).slice(0, 1000)}`,
  ].filter(Boolean).join("\n")).join("\n\n");
}
