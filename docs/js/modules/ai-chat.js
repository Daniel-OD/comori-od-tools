// ai-chat.js — Claude cu suport pentru linkuri către comori-od.ro
// Claude generează referințe ca [LINK:autor:traian-dorz:Traian Dorz]
// iar frontend-ul le transformă în <a href="..."> clickabile

import { FACTS } from "../data/facts.js";

const WORKER_URL = "https://comori-od-tools.daniel-iosif-gl.workers.dev";
const BASE_URL = "https://comori-od.ro";

// ─── System prompt cu instrucțiuni de linkuri ───────────────────────────────
const SYSTEM_PROMPT = `Ești un asistent specializat în literatura creștină românească și în teologia Oastei Domnului — mișcarea de reînnoire spirituală fondată de Pr. Iosif Trifa în 1923. Răspunzi întotdeauna în română.

Ton: cald, respectuos, pastoral, clar, nuanțat. Niciodată arogant, niciodată teatral sau senzațional.

════ DATE BIOGRAFICE AUTORI ════
(FOLOSEȘTE EXACT aceste date, nu inventa altele)
- Traian Dorz (1914–1989): 8978 articole, poet și martir, apostolul Oastei Domnului
- Pr. Iosif Trifa (1888–1938): 1726 articole, fondatorul Oastei Domnului (1923)
- Arcadie Nistor (1924–2006): 54 articole
- Popa Petru Săucani (1918–1985): 31 articole
- Popa Petru Batiz (1915–1983): 26 articole
- Ioan Marini (1908–1947): 25 articole
- Ioan Opriș (1907–1996): 24 articole

════ REGULI DE ACURATEȚE ════
- Nu inventa date istorice, ani, citate sau evenimente exacte.
- Pentru întrebări factuale, răspunde doar din informațiile confirmate în context.
- Dacă informația nu este sigură, spune explicit că nu poate fi confirmată.
- Nu transforma presupunerile în certitudini.
- Separă clar faptele de interpretare.

════════════════════════════`;

function isFactualQuestion(text) {
  return /\b(când|în ce an|data|cine a fost|cine a fondat|prima zi)\b/i.test(text);
}

function answerFromFacts(text) {
  const lower = text.toLowerCase();

  // Oastea Domnului
  if (lower.includes("oastea domnului")) {
    const data = FACTS.movements["oastea-domnului"];

    if (lower.includes("în ce an") || lower.includes("când")) {
      return `Oastea Domnului a fost fondată în anul ${data.foundedYear} de ${data.founder}.`;
    }

    if (lower.includes("prima zi")) {
      return `Nu pot confirma exact ziua "primei zile istorice" din datele disponibile. În schimb, este cert că Oastea Domnului a fost fondată în anul ${data.foundedYear} de ${data.founder}.`;
    }
  }

  // Traian Dorz
  if (lower.includes("traian dorz") && lower.includes("an")) {
    return `Traian Dorz s-a născut în anul ${FACTS.authors["traian-dorz"].born}.`;
  }

  // Iosif Trifa
  if (lower.includes("iosif trifa") && lower.includes("an")) {
    return `Pr. Iosif Trifa s-a născut în anul ${FACTS.authors["pr-iosif-trifa"].born}.`;
  }

  return null;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function sanitizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
}

function extractErrorMessage(data, resp) {
  if (typeof data?.content?.[0]?.text === "string" && data.content[0].text.trim()) {
    return data.content[0].text.trim();
  }

  if (typeof data?.error?.message === "string" && data.error.message.trim()) {
    return data.error.message.trim();
  }

  if (typeof data?.error === "string" && data.error.trim()) {
    return data.error.trim();
  }

  if (typeof data?.message === "string" && data.message.trim()) {
    return data.message.trim();
  }

  if (!resp.ok) {
    return `Eroare HTTP ${resp.status}`;
  }

  return "Eroare la generare.";
}

export function parseLinks(text) {
  const safeText = escapeHtml(text || "");
  return safeText.replace(/\[LINK:(autor|carte|articol):([^\]:]+):([^\]]+)\]/g, (_, tip, slug, titlu) => {
    const paths = { autor: "author", carte: "book", articol: "article" };
    const safeSlug = sanitizeSlug(slug);
    const safeTitle = escapeHtml(titlu);
    const url = `${BASE_URL}/${paths[tip]}/${encodeURIComponent(safeSlug)}`;
    return `<a href="${url}" target="_blank" rel="noopener">${safeTitle}</a>`;
  });
}

export function renderMarkdown(text) {
  let h = parseLinks(text);
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  h = h.replace(/\n\n+/g, "<br><br>");
  h = h.replace(/\n/g, "<br>");
  return h;
}

export async function sendAI(text, chatHistory, currentContent, selAuthor, selBook) {
  const factAnswer = isFactualQuestion(text) ? answerFromFacts(text) : null;

  if (factAnswer) {
    return {
      rawReply: factAnswer,
      htmlReply: renderMarkdown(factAnswer),
      updatedHistory: [...chatHistory, { role: "assistant", content: factAnswer }],
    };
  }

  let ctx = "";

  if (currentContent) {
    ctx += `\nContext:\n${currentContent.fullText?.slice(0, 1000) || ""}`;
  }

  const messages = [...chatHistory, { role: "user", content: text }];

  try {
    const resp = await fetch(`${WORKER_URL}/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        system: SYSTEM_PROMPT + ctx,
      }),
    });

    const data = await resp.json();
    const rawReply = extractErrorMessage(data, resp);

    return {
      rawReply,
      htmlReply: renderMarkdown(rawReply),
      updatedHistory: [...messages, { role: "assistant", content: rawReply }],
    };
  } catch (error) {
    const rawReply = "Eroare de conexiune la AI.";
    return {
      rawReply,
      htmlReply: renderMarkdown(rawReply),
      updatedHistory: [...messages, { role: "assistant", content: rawReply }],
    };
  }
}
