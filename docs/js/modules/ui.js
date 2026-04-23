import { renderMarkdown } from "./ai-chat.js";

export function spinner() {
  const s = document.createElement("div");
  s.className = "spin";
  return s;
}

export function renderChat(chatHistory) {
  const wrap = document.getElementById("chat-wrap");
  if (!wrap) return;

  wrap.innerHTML = "";
  chatHistory.forEach((message) => {
    const d = document.createElement("div");
    d.className = `msg ${message.role}`;

    if (message.role === "assistant") {
      d.innerHTML = renderMarkdown(message.content);
    } else {
      d.textContent = message.content;
    }

    wrap.appendChild(d);
  });
  wrap.scrollTop = wrap.scrollHeight;
}

export function updateCtxBar(currentContent, selAuthor) {
  const ctx = document.getElementById("ai-ctx");
  if (!ctx) return;

  if (!currentContent && !selAuthor) {
    ctx.style.display = "none";
    return;
  }

  ctx.style.display = "flex";
  let html = "";

  if (currentContent) {
    html += `<span>Text curent: <strong>${currentContent.title}</strong></span>`;
    html += `<button class="ctx-btn" type="button" data-action="analyze-text">Analizează text ↗</button>`;
  } else if (selAuthor) {
    html += `<span>Autor selectat: <strong>${selAuthor.name}</strong></span>`;
  }

  if (selAuthor) {
    html += `<button class="ctx-btn" type="button" data-action="analyze-author">Profil autor ↗</button>`;
  }

  ctx.innerHTML = html;

  ctx.querySelector("[data-action='analyze-text']")?.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("ctx:analyze-text"));
  });

  ctx.querySelector("[data-action='analyze-author']")?.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("ctx:analyze-author"));
  });
}
