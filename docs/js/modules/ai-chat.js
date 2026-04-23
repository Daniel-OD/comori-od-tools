const ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

export async function sendAI(text, chatHistory, currentContent) {
  const nextHistory = [...chatHistory, { role: "user", content: text }];

  const extraContext = currentContent
    ? `\n\nContextul curent: textul "${currentContent.title}" de ${currentContent.author || "?"} din volumul "${currentContent.book || "?"}".`
    : "";

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        system: `Ești un specialist în literatura creștină românească, în special în operele Oastei Domnului. Oferi analize teologice, poetice și istorice, iar răspunsurile tale sunt întotdeauna în limba română.${extraContext}`,
        messages: nextHistory.map((item) => ({ role: item.role, content: item.content })),
      }),
    });

    const data = await response.json();
    const reply = data.content?.[0]?.text || "Eroare la generarea răspunsului.";
    return {
      reply,
      updatedHistory: [...nextHistory, { role: "assistant", content: reply }],
    };
  } catch {
    const reply = "Eroare de conexiune la API.";
    return {
      reply,
      updatedHistory: [...nextHistory, { role: "assistant", content: reply }],
    };
  }
}
