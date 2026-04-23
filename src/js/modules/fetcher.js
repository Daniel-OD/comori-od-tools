// fetcher.js — folosește Cloudflare Worker propriu în loc de proxy-uri publice
// Schimbă WORKER_URL cu URL-ul tău după deploy pe Cloudflare

const WORKER_URL = "https://comori-od-worker.YOUR_SUBDOMAIN.workers.dev";

export async function fetchDoc(path) {
  const targetUrl = "https://comori-od.ro" + path;
  const proxyUrl  = `${WORKER_URL}/proxy?url=${encodeURIComponent(targetUrl)}`;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 10000);

  try {
    const resp = await fetch(proxyUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    if (!html || html.length < 100) throw new Error("Răspuns gol");
    return new DOMParser().parseFromString(html, "text/html");
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}
