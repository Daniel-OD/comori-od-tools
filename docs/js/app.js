import { AUTHORS } from "./data/authors.js";
import { initBrowser, selectAuthor, selectArticle, getBrowserState } from "./modules/browser.js";
import { sendAI } from "./modules/ai-chat.js";
import { renderChat } from "./modules/ui.js";
import { renderBookmarksPanel } from "./modules/bookmarks.js";
import { initDarkMode } from "./modules/dark-mode.js";

let chatHistory = [
  {
    role: "assistant",
    content: "Bună ziua! Sunt gata să analizez și să interpretez textele din Comori OD. Selectează un articol din bibliotecă sau pune-mi o întrebare directă.",
  },
];

let state = getBrowserState();

function renderStats() {
  const total = AUTHORS.reduce((sum, author) => sum + author.count, 0);
  document.getElementById("total-art").textContent = total.toLocaleString("ro");
}

function renderDistributionBars() {
  const total = AUTHORS.reduce((sum, author) => sum + author.count, 0);
  const bars = document.getElementById("bars");
  bars.innerHTML = "";

  AUTHORS.forEach((author) => {
    const h = Math.max(4, Math.round((author.count / 8978) * 34));
    const w = Math.max(6, Math.round((author.count / total) * 600));
    const d = document.createElement("div");
    d.className = "bar-seg";
    d.dataset.slug = author.slug;
    d.style.cssText = `width:${w}px;height:${h}px;background:${author.count > 500 ? "#FAC775" : author.count > 20 ? "#d4cff0" : "#ddd"};`;
    d.title = `${author.name}: ${author.count.toLocaleString()} articole`;
    d.addEventListener("click", () => selectAuthor(author));
    bars.appendChild(d);
  });
}

function setSending(isSending) {
  document.getElementById("send-btn").disabled = isSending;
}

function updateAnalyzeButton() {
  const btn = document.getElementById("btn-analyze");
  btn.style.display = state.currentContent ? "" : "none";
}

async function askAI(text) {
  if (!text?.trim()) return;

  chatHistory = [...chatHistory, { role: "user", content: text.trim() }];
  renderChat(chatHistory);

  const wrap = document.getElementById("chat-wrap");
  const typing = document.createElement("div");
  typing.className = "msg assistant typing";
  typing.textContent = "Se generează răspunsul...";
  wrap.appendChild(typing);
  wrap.scrollTop = wrap.scrollHeight;

  setSending(true);
  const currentContent = state.currentContent;
  const result = await sendAI(text.trim(), chatHistory.slice(0, -1), currentContent);
  chatHistory = result.updatedHistory;
  renderChat(chatHistory);
  setSending(false);
}

function analyzeCurrentText() {
  if (!state.currentContent) return;
  askAI(`Analizează în detaliu acest text din perspectivă teologică, poetică și literară. Identifică temele principale, simbolurile folosite, structura, mesajul central și contextul spiritual:\n\n"${state.currentContent.fullText.slice(0, 2000)}"`);
}

function analyzeAuthor() {
  if (!state.selAuthor) return;
  askAI(`Prezintă o analiză completă a lui ${state.selAuthor.name} ca autor din tradiția Oastei Domnului: biografie, contribuție literară și spirituală, teme recurente, stil și importanță istorică. Date: ${state.selAuthor.years || ""}, ${state.selAuthor.count} articole.`);
}

function bindChat() {
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("send-btn");

  sendBtn.addEventListener("click", () => {
    const text = input.value;
    input.value = "";
    askAI(text);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendBtn.click();
    }
  });
}

function bindQuickButtons() {
  document.querySelectorAll(".quick-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      askAI(btn.dataset.question || btn.textContent || "");
    });
  });
}

function bindAnalyzeActions() {
  document.getElementById("btn-analyze").addEventListener("click", analyzeCurrentText);
  window.addEventListener("ctx:analyze-text", analyzeCurrentText);
  window.addEventListener("ctx:analyze-author", analyzeAuthor);
}

function initBookmarks() {
  renderBookmarksPanel((bookmark) => {
    selectArticle(bookmark);
  });
}

function init() {
  renderStats();
  renderDistributionBars();
  renderChat(chatHistory);
  bindChat();
  bindQuickButtons();
  bindAnalyzeActions();
  initDarkMode();

  initBrowser({
    authors: AUTHORS,
    onStateChange: (nextState) => {
      state = nextState;
      updateAnalyzeButton();
    },
    onBookmarkChange: () => {
      renderBookmarksPanel((bookmark) => selectArticle(bookmark));
    },
  });

  initBookmarks();
}

init();
