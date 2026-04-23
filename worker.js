// Cloudflare Worker — comori-od-tools
// Rezolvă: 1) CORS proxy pentru comori-od.ro  2) Anthropic API call server-side
//
// Deploy: https://dash.cloudflare.com → Workers → Create → Paste → Deploy
// Setează secret: wrangler secret put ANTHROPIC_KEY  (sau din dashboard → Settings → Variables)

const ALLOWED_ORIGIN = "*"; // Schimbă cu "https://daniel-od.github.io" în producție

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return corsResponse("", 204);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ── 1. Proxy comori-od.ro ──────────────────────────────────────────────
    // GET /proxy?url=https://comori-od.ro/author/traian-dorz
    if (path === "/proxy" && request.method === "GET") {
      const target = url.searchParams.get("url");
      if (!target) return corsResponse("Missing ?url param", 400);

      // Permitem doar comori-od.ro
      let targetUrl;
      try {
        targetUrl = new URL(target);
        if (!targetUrl.hostname.endsWith("comori-od.ro")) {
          return corsResponse("Domain not allowed", 403);
        }
      } catch {
        return corsResponse("Invalid URL", 400);
      }

      try {
        const resp = await fetch(targetUrl.toString(), {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; comori-od-tools/1.0)",
            "Accept": "text/html,application/xhtml+xml",
          },
          cf: { cacheTtl: 300, cacheEverything: true }, // cache 5 min
        });
        const html = await resp.text();
        return corsResponse(html, resp.status, "text/html; charset=utf-8");
      } catch (e) {
        return corsResponse("Fetch error: " + e.message, 502);
      }
    }

    // ── 2. Anthropic API proxy ─────────────────────────────────────────────
    // POST /ai   body: { messages: [...], system: "..." }
    if (path === "/ai" && request.method === "POST") {
      const ANTHROPIC_KEY = env.ANTHROPIC_KEY;
      if (!ANTHROPIC_KEY) return corsResponse("ANTHROPIC_KEY not set in Worker env", 500);

      let body;
      try { body = await request.json(); } catch { return corsResponse("Invalid JSON", 400); }

      try {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: body.max_tokens || 1000,
            system: body.system || "",
            messages: body.messages || [],
          }),
        });
        const data = await resp.json();
        return corsResponse(JSON.stringify(data), resp.status, "application/json");
      } catch (e) {
        return corsResponse(JSON.stringify({ error: e.message }), 502, "application/json");
      }
    }

    // ── 3. Health check ───────────────────────────────────────────────────
    if (path === "/" || path === "/health") {
      return corsResponse(JSON.stringify({ status: "ok", service: "comori-od-tools worker" }), 200, "application/json");
    }

    return corsResponse("Not found", 404);
  },
};

function corsResponse(body, status = 200, contentType = "text/plain; charset=utf-8") {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
