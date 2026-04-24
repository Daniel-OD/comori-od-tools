import { FACTS, factsAsPromptBlock } from "../data/facts.js";

const WORKER_URL = "https://comori-od-tools.daniel-iosif-gl.workers.dev";
const BASE_URL = "https://comori-od.ro";

const SYSTEM_PROMPT = `Ești un asistent teologic riguros.

REGULI:
- Nu inventa niciodată date istorice.
- Dacă nu știi exact, spune clar că nu e sigur.
- Nu transforma presupunerile în certitudini.
- Separă clar: fapte / interpretare.

Răspunsurile trebuie să fie clare, sincere și precise.`;

function detectIntent(text) {
  if (/\b(când|în ce an|data|cine a fost|prima zi)\b/i.test(text)) return "factual";
  if (/\b(ce înseamnă|interpretare|teme|mesaj)\b/i.test(text)) return "interpretare";
  return "general";
}

function answerFromFacts(text) {
  const lower = text.toLowerCase();

  if (lower.includes("oastea domnului")) {
    const data = FACTS.movements["oastea-domnului"];

    if (lower.includes("prima zi")) {
      return `Nu există o dată exactă confirmată pentru "prima zi istorică" a Oastei Domnului. Este însă cert că mișcarea a fost fondată în anul ${data.foundedYear} de ${data.founder}.`;
    }

    if (lower.includes("an") || lower.includes("când")) {
      return `Oastea Domnului a fost fondată în anul ${data.foundedYear} de ${data.founder}.`;
    }
  }

  return null;
}

function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}

export function renderMarkdown(text){return escapeHtml(text).replace(/\n/g,"<br>");}

export async function sendAI(text, chatHistory, currentContent) {
  const intent = detectIntent(text);

  if (intent === "factual") {
    const fact = answerFromFacts(text);
    if (fact) {
      return {
        rawReply: fact,
        htmlReply: renderMarkdown(fact),
        updatedHistory: [...chatHistory, { role: "assistant", content: fact }],
      };
    }
  }

  let ctx = factsAsPromptBlock();

  if (currentContent) {
    ctx += `\n\nTEXT CONTEXT:\n${currentContent.fullText?.slice(0,1000) || ""}`;
  }

  const messages = [...chatHistory, { role: "user", content: text }];

  const resp = await fetch(`${WORKER_URL}/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      system: SYSTEM_PROMPT + "\n\n" + ctx,
    }),
  });

  const data = await resp.json();
  const reply = data?.content?.[0]?.text || "Nu pot răspunde sigur.";

  return {
    rawReply: reply,
    htmlReply: renderMarkdown(reply),
    updatedHistory: [...messages, { role: "assistant", content: reply }],
  };
}
