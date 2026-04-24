const INDEX_URL = "data/rag-index.json";
let cachedIndex = null;

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  const stop = new Set(["si","sau","de","la","in","din","cu","pe","pentru","este","sunt","care","ce","un","o","ale","al","ai","a","lui","the","and","or","of","to","is","are"]);
  return normalize(text).split(" ").filter((t) => t.length > 2 && !stop.has(t));
}

async function loadIndex() {
  if (cachedIndex) return cachedIndex;
  const resp = await fetch(INDEX_URL, { cache: "no-store" });
  cachedIndex = await resp.json();
  return cachedIndex;
}

function buildQueryVector(tokens, embedding) {
  const { vocab, idf } = embedding;
  const map = new Map(vocab.map((t, i) => [t, i]));
  const tf = new Map();

  tokens.forEach(t => {
    if (map.has(t)) tf.set(t, (tf.get(t) || 0) + 1);
  });

  return [...tf.entries()].map(([t, count]) => {
    const i = map.get(t);
    return [i, Math.log(1 + count) * idf[i]];
  });
}

function cosine(a, b) {
  let dot = 0, normA = 0, normB = 0;
  const map = new Map(a);

  a.forEach(([i, v]) => normA += v * v);
  b.forEach(([i, v]) => {
    normB += v * v;
    if (map.has(i)) dot += v * map.get(i);
  });

  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-9);
}

export async function searchLibrary(query, { currentContent = null, limit = 5 } = {}) {
  const index = await loadIndex();
  const tokens = tokenize(query);

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

  const qVec = buildQueryVector(tokens, index.embedding);

  for (const chunk of index.chunks) {
    if (!chunk.v) continue;
    const score = cosine(qVec, chunk.v);
    if (score > 0.05) {
      results.push({ ...chunk, score, confidence: score > 0.2 ? "ridicată" : "medie" });
    }
  }

  return results.sort((a,b)=>b.score-a.score).slice(0,limit);
}

export function formatRagContext(results) {
  return results.map((r,i)=>[
    `SURSA ${i+1} [${r.confidence}]`,
    `Titlu: ${r.title}`,
    `Autor: ${r.author}`,
    `Carte: ${r.book}`,
    `Fragment: ${String(r.text).slice(0,1000)}`
  ].join("\n")).join("\n\n");
}
