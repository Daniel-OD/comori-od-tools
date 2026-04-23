// ai-chat.js — Claude cu suport pentru linkuri către comori-od.ro
// Claude generează referințe ca [LINK:autor:traian-dorz:Traian Dorz]
// iar frontend-ul le transformă în <a href="..."> clickabile

const WORKER_URL = "https://comori-od-worker.YOUR_SUBDOMAIN.workers.dev";
const BASE_URL = "https://comori-od.ro";

// ─── System prompt cu instrucțiuni de linkuri ───────────────────────────────
const SYSTEM_PROMPT = `Ești un specialist în literatura creștină românească, în special în operele Oastei Domnului — mișcarea de reînnoire spirituală fondată de Pr. Iosif Trifa în 1923. Cunoști profund toți autorii, cărțile și articolele de pe comori-od.ro. Răspunzi în română, cu eleganță și claritate teologică.

════ INSTRUCȚIUNI LINKURI ════
Când faci referire la un autor, carte sau articol de pe comori-od.ro, inserează un link folosind exact formatul:

  Autor:   [LINK:autor:SLUG:NUME AFIȘAT]
  Carte:   [LINK:carte:SLUG:TITLU AFIȘAT]
  Articol: [LINK:articol:SLUG:TITLU AFIȘAT]

SLUG-uri autori:
traian-dorz | pr-iosif-trifa | arcadie-nistor | popa-petru-saucani
popa-petru-batiz | ioan-marini | ioan-opris | leon-andronic
pr-teodor-heredea | cornel-silaghi | vasile-campean | ioan-voina

Exemple corecte:
"Opera lui [LINK:autor:traian-dorz:Traian Dorz] este marcată de suferință..."
"Cartea [LINK:carte:prietenul-tineretii-mele:Prietenul Tinereții Mele] conține..."
"Articolul [LINK:articol:prieten-tineretii-mele-prietenul-tineretii-mele-traian-dorz:Prieten tinereții mele] ilustrează..."

Dacă nu cunoști slug-ul exact al unui articol, nu genera link de articol — menționează doar autorul și cartea cu linkuri.
Folosește linkuri natural în text, nu ca listă la final.
════════════════════════════`;

// ─── Parsează [LINK:...] → <a href> ────────────────────────────────────────
export function parseLinks(text) {
  return text.replace(/\[LINK:(autor|carte|articol):([^\]:]+):([^\]]+)\]/g, (_, tip, slug, titlu) => {
    const paths = { autor: "author", carte: "book", articol: "article" };
    const url = `${BASE_URL}/${paths[tip]}/${slug}`;
    return `<a href="${url}" target="_blank" rel="noopener" style="color:#5b6af0;text-decoration:none;border-bottom:1px dotted #5b6af0;padding:0 2px;border-radius:2px;white-space:nowrap" title="Deschide pe comori-od.ro — ${tip}: ${titlu}">${titlu}<span style="font-size:10px;opacity:.6;margin-left:2px">↗</span></a>`;
  });
}

// ─── Markdown simplu + linkuri → HTML ───────────────────────────────────────
export function renderMarkdown(text) {
  let h = parseLinks(text);
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  h = h.replace(/^## (.+)$/gm, '<div style="font-weight:600;font-size:14px;margin:10px 0 4px">$1</div>');
  h = h.replace(/^[•\-] (.+)$/gm, '<div style="padding-left:14px;margin:2px 0">· $1</div>');
  h = h.replace(/\n\n+/g, "<br><br>");
  h = h.replace(/\n/g, "<br>");
  return h;
}

// ─── Trimite mesaj → Worker → Claude ────────────────────────────────────────
export async function sendAI(text, chatHistory, currentContent, selAuthor, selBook) {
  let ctx = "";
  if (currentContent) {
    ctx += `\n\nContextul curent:\n- Articol: "${currentContent.title}"\n- Autor: ${currentContent.author || "?"} (slug: ${selAuthor?.slug || "?"})\n- Carte: ${currentContent.book || "?"} (slug: ${selBook?.slug || "?"})\n- Text:\n${currentContent.fullText?.slice(0, 1500) || ""}`;
  } else if (selBook) {
    ctx += `\n\nUtilizatorul navighează cartea: "${selBook.title}" (slug: ${selBook.slug})`;
  } else if (selAuthor) {
    ctx += `\n\nUtilizatorul navighează autorul: ${selAuthor.name} (slug: ${selAuthor.slug})`;
  }

  const messages = [...chatHistory, { role: "user", content: text }];

  const resp = await fetch(`${WORKER_URL}/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      system: SYSTEM_PROMPT + ctx,
      max_tokens: 1200,
    }),
  });

  const data = await resp.json();
  const rawReply = data.content?.[0]?.text || data.error || "Eroare la generare.";

  return {
    rawReply,
    htmlReply: renderMarkdown(rawReply),
    updatedHistory: [...messages, { role: "assistant", content: rawReply }],
  };
}
