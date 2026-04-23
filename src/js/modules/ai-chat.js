// ai-chat.js — apelează Anthropic prin Cloudflare Worker (nu direct din browser)
// Cheia API stă în Worker, nu în frontend

const WORKER_URL = "https://comori-od-worker.YOUR_SUBDOMAIN.workers.dev";

export async function sendAI(text, chatHistory, currentContent) {
  const ctx = currentContent
    ? `\n\nContextul curent: textul "${currentContent.title}" de ${currentContent.author || "?"} din volumul "${currentContent.book || "?"}".`
    : "";

  const messages = [...chatHistory, { role: "user", content: text }];

  const resp = await fetch(`${WORKER_URL}/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      system: `Ești un specialist în literatura creștină românească, în special în operele Oastei Domnului — mișcarea de reînnoire spirituală fondată de Pr. Iosif Trifa în 1923. Cunoști profund operele lui Traian Dorz, Pr. Iosif Trifa și ceilalți autori din această tradiție. Analizezi texte cu profunzime teologică, poetică și istorică. Răspunzi în română, cu eleganță și claritate.${ctx}`,
      max_tokens: 1000,
    }),
  });

  const data = await resp.json();
  const reply = data.content?.[0]?.text || data.error || "Eroare la generare.";

  return {
    reply,
    updatedHistory: [...messages, { role: "assistant", content: reply }],
  };
}
