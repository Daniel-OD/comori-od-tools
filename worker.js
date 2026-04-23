// Cloudflare Worker — comori-od-tools
// 1) CORS proxy pentru comori-od.ro
// 2) Groq API pentru interpretare gratuită

const ALLOWED_ORIGIN = "https://daniel-od.github.io";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

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
      if (!env.GROQ_API_KEY) {
        return corsJson({
          error: {
            type: "config_error",
            message: "GROQ_API_KEY not set in Worker env",
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
            .filter((m) => m && (m.role === "user" || m.role === "assistant" || m.role === "system") && typeof m.content === "string")
            .slice(-12)
        : [];

      const messages = [
        { role: "system", content: system },
        ...history.filter((m) => m.role !== "system"),
      ];

      if (!messages.some((m) => m.role === "user")) {
        messages.push({ role: "user", content: "Salut!" });
      }

      try {
        const groqResp = await fetch(GROQ_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages,
            temperature: 0.5,
            max_tokens: Math.min(Number(body.max_tokens) || 1000, 1200),
          }),
        });

        const groqData = await groqResp.json();

        if (!groqResp.ok || groqData.error) {
          const errMsg = groqData?.error?.message || `Groq error ${groqResp.status}`;
          console.error(`[worker] /ai groq error — status: ${groqResp.status}, message: ${errMsg}`);
          return corsJson({
            error: {
              type: "groq_error",
              message: errMsg,
            },
          }, 502);
        }

        const text = groqData?.choices?.[0]?.message?.content || "";

        if (!text) {
          return corsJson({
            error: {
              type: "empty_response",
              message: "Modelul AI nu a returnat conținut textual.",
            },
          }, 502);
        }

        return corsJson({
          provider: "groq",
          model: GROQ_MODEL,
          content: [{ text }],
        });
      } catch (e) {
        console.error(`[worker] /ai fetch exception — ${e.message}`);
        return corsJson({
          error: {
            type: "groq_error",
            message: e.message || "Groq request failed",
          },
        }, 502);
      }
    }

    if (path === "/" || path === "/health") {
      console.log(`[worker] health check — pathname: ${path}`);
      return corsJson({
        status: "ok",
        service: "comori-od-tools worker",
        ai_provider: "groq",
        ai_model: GROQ_MODEL,
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
