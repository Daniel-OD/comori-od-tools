const WORKER_URL = "https://comori-od-tools.daniel-iosif-gl.workers.dev";
const SOURCE_BASE_URL = "https://comori-od.ro";

export async function fetchDoc(path) {
  const targetUrl = `${SOURCE_BASE_URL}${path}`;
  const proxyUrl = `${WORKER_URL}/proxy?url=${encodeURIComponent(targetUrl)}`;

  const controller = new AbortController();
  const timeoutMs = 10000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(proxyUrl, { signal: controller.signal });
    const html = await resp.text();
    clearTimeout(timeout);

    if (!resp.ok) {
      console.error("[fetchDoc] HTTP error", { path, targetUrl, proxyUrl, status: resp.status, body: html.slice(0, 200) });
      throw new Error(`HTTP ${resp.status}`);
    }

    if (!html || html.length < 100) {
      console.error("[fetchDoc] Empty HTML", { path, htmlLength: html.length });
      throw new Error("Răspuns gol");
    }

    return new DOMParser().parseFromString(html, "text/html");
  } catch (e) {
    clearTimeout(timeout);

    if (e.name === "AbortError") {
      console.error("[fetchDoc] Timeout", { path, proxyUrl });
      throw new Error("Timeout la încărcare");
    }

    console.error("[fetchDoc] Error", { path, proxyUrl, error: e });
    throw e;
  }
}
