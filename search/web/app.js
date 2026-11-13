const $ = (id) => document.getElementById(id);
let lastTerms = [], currentArticle = null;

const esc = (s) => (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[șşŝ]/gi, "s").replace(/[țţ]/gi, "t").toLowerCase();

// regex tolerant la diacritice pentru evidențierea cuvintelor căutate
function termRegex(terms) {
  const cls = { a: "[aăâ]", i: "[iî]", s: "[sșş]", t: "[tțţ]" };
  const pats = terms.filter((t) => t.length > 2).map((t) =>
    [...fold(t)].map((c) => (cls[c] || c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join(""));
  return pats.length ? new RegExp("(" + pats.join("|") + ")", "giu") : null;
}
function highlight(text, terms) {
  const re = termRegex(terms);
  const safe = esc(text);
  return re ? safe.replace(re, "<mark>$1</mark>") : safe;
}

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
}

async function loadFacets() {
  try {
    const f = await api("/api/facets");
    const fill = (id, items, v, l) => items.forEach((x) => $(id).add(new Option(l(x), v(x))));
    fill("author", f.authors, (x) => x.slug, (x) => x.name);
    fill("book", f.books, (x) => x.slug, (x) => x.title);
    fill("volume", f.volumes, (x) => x.slug, (x) => x.title);
    fill("category", f.categories, (x) => x, (x) => x);
  } catch (e) { $("status").textContent = "Baza de date nu răspunde: " + e.message; }
}

function render(data, related = false) {
  lastTerms = data.query_terms || [];
  const res = data.results || [];
  $("status").textContent = res.length
    ? `${data.total} rezultate` + (data.top_similarity ? ` · cea mai bună similaritate ${data.top_similarity}` : "")
    : data.message || "Niciun rezultat suficient de apropiat.";
  $("results").innerHTML = res.map((r, i) => {
    const meta = [r.author, r.book, r.volume].filter(Boolean).map(esc).join(" · ");
    const sim = r.similarity != null ? `<span class="badge">similaritate ${(r.similarity * 100).toFixed(0)}%</span>` : "";
    const conf = r.confidence ? `<span class="badge">încredere ${esc(r.confidence)}</span>` : "";
    const bm = r.bm25 != null ? `<span class="badge">BM25 ${r.bm25}</span>` : "";
    const th = (r.themes || []).map((t) => `<span class="badge">${esc(t)}</span>`).join("");
    const src = related && r.source_passage ? `<div class="meta">Din articolul sursă: „${esc(r.source_passage.slice(0, 220))}…”</div>` : "";
    return `<article class="card">
      <h3><a data-i="${i}">${esc(r.title)}</a></h3>
      <div class="meta">${meta}</div>
      <div class="snip">${highlight(r.snippet.length > 700 ? r.snippet.slice(0, 700) + "…" : r.snippet, related ? [] : lastTerms)}</div>${src}
      <div class="badges"><span class="badge">relevanță ${(r.relevance * 100).toFixed(0)}%</span>${sim}${conf}${bm}${th}</div>
      <ul class="why">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <div class="actions">
        <button class="sec" data-open="${i}">Articol integral</button>
        <button class="sec" data-rel="${r.article_id}">Găsește articole înrudite</button>
        <a href="${esc(r.url)}" target="_blank" rel="noopener">Sursa originală ↗</a>
      </div></article>`;
  }).join("");
  $("disc").textContent = data.disclaimer || "";
  $("results").onclick = (e) => {
    const t = e.target;
    const idx = t.dataset.open ?? t.dataset.i;
    if (idx != null) openArticle(res[+idx]);
    if (t.dataset.rel) showRelated(+t.dataset.rel);
  };
}

async function openArticle(hit) {
  const a = await api("/api/article/" + hit.article_id);
  currentArticle = a.id;
  $("dlg-title").textContent = a.title;
  $("dlg-meta").textContent = [a.author, a.book, a.volume, a.position ? `articolul ${a.position} din ${a.total_in_book}` : "", a.bible_refs.length ? "Versete: " + a.bible_refs.join("; ") : ""].filter(Boolean).join(" · ");
  const t = a.text, s = hit.passage_start, e = hit.passage_end;
  const part = (x, hl) => (hl ? highlight(x, lastTerms) : esc(x));
  const mid = e > s ? `<mark class="passage" id="hitpass">${part(t.slice(s, e), true)}</mark>` : "";
  $("dlg-text").innerHTML = (e > s ? part(t.slice(0, s), true) + mid + part(t.slice(e), true) : part(t, true));
  $("dlg-src").href = a.url;
  $("dlg").showModal();
  document.getElementById("hitpass")?.scrollIntoView({ block: "center" });
}

async function showRelated(id) {
  $("dlg").close();
  $("status").textContent = "Caut articole înrudite…";
  try { render(await api("/api/related/" + id), true); window.scrollTo({ top: 0, behavior: "smooth" }); }
  catch (e) { $("status").textContent = "Eroare: " + e.message; }
}

$("dlg-close").onclick = () => $("dlg").close();
$("dlg-related").onclick = () => currentArticle && showRelated(currentArticle);

$("f").onsubmit = async (ev) => {
  ev.preventDefault();
  $("status").textContent = "Caut…";
  const p = { author: $("author").value, book: $("book").value, volume: $("volume").value, category: $("category").value };
  try {
    const mode = $("mode").value, q = $("q").value;
    const data = mode === "idea"
      ? await api("/api/idea", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: q, ...p }) })
      : await api("/api/search?" + new URLSearchParams({ q, mode, ...p }));
    render(data);
  } catch (e) { $("status").textContent = "Eroare: " + e.message; }
};
loadFacets();
