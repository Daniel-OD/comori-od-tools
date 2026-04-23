// Cloudflare Worker — comori-od-tools
// 1) CORS proxy pentru comori-od.ro
// 2) Workers AI cu Llama 3.1 pentru interpretare gratuită

const ALLOWED_ORIGIN = "https://daniel-od.github.io";
const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return corsResponse("", 204);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/proxy" && request.method === "GET") {
      const target = url.searchParams.get("url");
      if (!target) return corsResponse("Missing ?url param", 400);

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
          cf: { cacheTtl: 300, cacheEverything: true },
        });
        const html = await resp.text();
        return corsResponse(html, resp.status, "text/html; charset=utf-8");
      } catch (e) {
        return corsResponse(`Fetch error: ${e.message}`, 502);
      }
    }

    if (path === "/ai" && request.method === "POST") {
      if (!env.AI) {
        return corsJson({
          error: {
            type: "config_error",
            message: "Workers AI binding missing. Add [ai] binding = \"AI\" in wrangler.toml and redeploy.",
          },
        }, 500);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return corsJson({ error: { type: "invalid_request", message: "Invalid JSON" } }, 400);
      }

      const system = typeof body.system === "string"
        ? body.system
        : "Ești un asistent spiritual creștin. Răspunzi în română, clar și profund.";

      const history = Array.isArray(body.messages)
        ? body.messages
            .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
            .slice(-12)
        : [];

      const messages = [
        { role: "system", content: system },
        ...history,
      ];

      if (!messages.some((m) => m.role === "user")) {
        messages.push({ role: "user", content: "Salut!" });
      }

      try {
        const result = await env.AI.run(AI_MODEL, {
          messages,
          max_tokens: Math.min(Number(body.max_tokens) || 900, 1200),
          temperature: 0.5,
        });

        const text =
          result?.response ||
          result?.result?.response ||
          result?.output_text ||
          (Array.isArray(result?.content)
            ? result.content.map((item) => item?.text || "").join("\n").trim()
            : "");

        if (!text) {
          return corsJson({
            error: {
              type: "empty_response",
              message: "Modelul AI nu a returnat conținut textual.",
            },
          }, 502);
        }

        return corsJson({
          provider: "cloudflare-workers-ai",
          model: AI_MODEL,
          content: [{ text }],
        });
      } catch (e) {
        return corsJson({
          error: {
            type: "workers_ai_error",
            message: e.message || "Workers AI request failed",
          },
        }, 502);
      }
    }

    if (path === "/" || path === "/health") {
      return corsJson({
        status: "ok",
        service: "comori-od-tools worker",
        ai_provider: "cloudflare-workers-ai",
        ai_model: AI_MODEL,
      });
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

function corsJson(data, status = 200) {
  return corsResponse(JSON.stringify(data), status, "application/json; charset=utf-8");
}
