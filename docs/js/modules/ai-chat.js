import { FACTS, factsAsPromptBlock } from "../data/facts.js";

const WORKER_URL = "https://comori-od-tools.daniel-iosif-gl.workers.dev";

function detectIntent(text) {
  if (/\b(când|în ce an|data|prima zi|cine a fondat)\b/i.test(text)) return "factual";
  return "general";
}

function answerFromFacts(text) {
  const lower = text.toLowerCase();

  if (lower.includes("oastea domnului")) {
    const d = FACTS.movements["oastea-domnului"];

    if (lower.includes("prima zi")) {
      return { text: `Nu există o dată exactă confirmată pentru prima zi istorică. Este sigur că Oastea Domnului a fost fondată în ${d.foundedYear} de ${d.founder}.`, confidence: "ridicată" };
    }

    if (lower.includes("când") || lower.includes("an")) {
      return { text: `Oastea Domnului a fost fondată în anul ${d.foundedYear} de ${d.founder}.`, confidence: "ridicată" };
    }
  }

  return null;
}

function buildRagContext(currentContent) {
  if (!currentContent?.lines) return "";
  return currentContent.lines.slice(0, 8).join("\n");
}

export function renderMarkdown(text){return text.replace(/\n/g,"<br>");}

export async function sendAI(text, chatHistory, currentContent) {
  const intent = detectIntent(text);

  if (intent === "factual") {
    const fact = answerFromFacts(text);
    if (fact) {
      const reply = `📊 Încredere: ${fact.confidence}\n\n${fact.text}`;
      return {
        rawReply: reply,
        htmlReply: renderMarkdown(reply),
        updatedHistory: [...chatHistory, { role: "assistant", content: reply }],
      };
    }

    const fail = "📊 Încredere: scăzută\n\nNu pot confirma această informație din baza factuală.";
    return {
      rawReply: fail,
      htmlReply: renderMarkdown(fail),
      updatedHistory: [...chatHistory, { role: "assistant", content: fail }],
    };
  }

  const rag = buildRagContext(currentContent);
  const facts = factsAsPromptBlock();

  const messages = [...chatHistory, { role: "user", content: text }];

  const resp = await fetch(`${WORKER_URL}/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      system: `Nu inventa informații. Dacă nu știi, spune clar.\n\n${facts}\n\nCONTEXT:\n${rag}`,
    }),
  });

  const data = await resp.json();
  const answer = data?.content?.[0]?.text || "Nu pot răspunde sigur.";

  const reply = `📊 Încredere: medie\n\n${answer}`;

  return {
    rawReply: reply,
    htmlReply: renderMarkdown(reply),
    updatedHistory: [...messages, { role: "assistant", content: reply }],
  };
}
