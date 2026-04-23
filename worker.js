// Cloudflare Worker — comori-od-tools
// 1) CORS proxy pentru comori-od.ro
// 2) Google Gemini API pentru interpretare gratuită

const ALLOWED_ORIGIN = "https://daniel-od.github.io";
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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
      if (!env.GEMINI_API_KEY) {
        return corsJson({
          error: {
            type: "config_error",
            message: "GEMINI_API_KEY not set in Worker env",
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

      let prompt = system + "\n\n";
      for (const m of history) {
        if (m.role === "user") {
          prompt += `User: ${m.content}\n`;
        } else if (m.role === "assistant") {
          prompt += `Assistant: ${m.content}\n`;
        }
      }
      prompt += "Assistant:";

      try {
        const geminiResp = await fetch(GEMINI_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": env.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0.5,
              maxOutputTokens: Math.min(Number(body.max_tokens) || 1200, 1200),
            },
          }),
        });

        const geminiData = await geminiResp.json();

        if (!geminiResp.ok || geminiData.error) {
          const errMsg = geminiData?.error?.message || `Gemini error ${geminiResp.status}`;
          return corsJson({
            error: {
              type: "gemini_error",
              message: errMsg,
            },
          }, 502);
        }

        const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

        if (!text) {
          return corsJson({
            error: {
              type: "empty_response",
              message: "Modelul AI nu a returnat conținut textual.",
            },
          }, 502);
        }

        return corsJson({
          provider: "google-gemini",
          model: GEMINI_MODEL,
          content: [{ text }],
        });
      } catch (e) {
        return corsJson({
          error: {
            type: "gemini_error",
            message: e.message || "Gemini request failed",
          },
        }, 502);
      }
    }

    if (path === "/" || path === "/health") {
      return corsJson({
        status: "ok",
        service: "comori-od-tools worker",
        ai_provider: "google-gemini",
        ai_model: GEMINI_MODEL,
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
