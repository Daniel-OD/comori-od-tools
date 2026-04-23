const BASE = "https://comori-od.ro";
const TIMEOUT_MS = 8000;

const proxies = [
  {
    makeUrl: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    parse: async (response) => response.text(),
  },
  {
    makeUrl: (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    parse: async (response) => {
      const data = await response.json();
      return data.contents || "";
    },
  },
  {
    makeUrl: (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    parse: async (response) => response.text(),
  },
];

async function fetchWithTimeout(proxy, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(proxy.makeUrl(url), { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const html = await proxy.parse(response);
    if (!html || typeof html !== "string") {
      throw new Error("Răspuns gol");
    }
    return html;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchDoc(path) {
  const targetUrl = `${BASE}${path}`;
  const errors = [];

  for (const proxy of proxies) {
    try {
      const html = await fetchWithTimeout(proxy, targetUrl);
      return new DOMParser().parseFromString(html, "text/html");
    } catch (error) {
      errors.push(error);
    }
  }

  throw new Error(`Toate proxy-urile au eșuat (${errors.length})`);
}
