// Supabase Edge Function "comori": înlocuiește Cloudflare Worker-ul (worker.js)
//   GET  /proxy?url=https://comori-od.ro/...  proxy CORS, doar către comori-od.ro
//   POST /ai                                   chat prin Groq (necesită secretul GROQ_API_KEY)
//   GET  /health
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGINS = ["https://daniel-od.github.io", "http://localhost:8080", "http://127.0.0.1:8080"];
const ALLOWED_HOSTS = new Set(["comori-od.ro", "www.comori-od.ro"]);
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MAX_BYTES = 3_000_000;

function headers(req: Request, contentType: string): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
    "Vary": "Origin",
  };
}
const text = (req: Request, body: string, status = 200, ct = "text/plain; charset=utf-8") =>
  new Response(body, { status, headers: headers(req, ct) });
const json = (req: Request, data: unknown, status = 200) =>
  text(req, JSON.stringify(data), status, "application/json; charset=utf-8");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return text(req, "", 204);
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (path.endsWith("/proxy") && req.method === "GET") {
    let target: URL;
    try {
      target = new URL(url.searchParams.get("url") ?? "");
    } catch {
      return text(req, "Invalid or missing ?url", 400);
    }
    if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
      return text(req, "Domain not allowed", 403);
    }
    try {
      const resp = await fetch(target.toString(), {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; comori-od-tools/1.0)", "Accept": "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(15000),
        redirect: "follow",
      });
      if (new URL(resp.url).hostname && !ALLOWED_HOSTS.has(new URL(resp.url).hostname)) {
        return text(req, "Redirect to a disallowed domain", 403);
      }
      const buf = await resp.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) return text(req, "Response too large", 502);
      return text(req, new TextDecoder().decode(buf), resp.status, "text/html; charset=utf-8");
    } catch (e) {
      return text(req, `Fetch error: ${(e as Error).message}`, 502);
    }
  }

  if (path.endsWith("/ai") && req.method === "POST") {
    const key = Deno.env.get("GROQ_API_KEY");
    if (!key) return json(req, { error: { type: "config_error", message: "GROQ_API_KEY not set" } }, 500);
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json(req, { error: { type: "invalid_request", message: "Invalid JSON" } }, 400);
    }
    const system = typeof body.system === "string"
      ? body.system
      : "Ești un asistent spiritual creștin. Răspunzi în română, clar și profund.";
    const history = Array.isArray(body.messages)
      ? body.messages.filter((m: any) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string").slice(-12)
      : [];
    const messages = [{ role: "system", content: system }, ...history];
    if (!messages.some((m) => m.role === "user")) messages.push({ role: "user", content: "Salut!" });
    try {
      const r = await fetch(GROQ_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({
          model: GROQ_MODEL, messages, temperature: 0.5,
          max_tokens: Math.min(Number(body.max_tokens) || 1000, 1200),
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await r.json();
      if (!r.ok || data.error) {
        return json(req, { error: { type: "groq_error", message: data?.error?.message || `Groq error ${r.status}` } }, 502);
      }
      const out = data?.choices?.[0]?.message?.content || "";
      if (!out) return json(req, { error: { type: "empty_response", message: "Modelul AI nu a returnat text." } }, 502);
      return json(req, { provider: "groq", model: GROQ_MODEL, content: [{ text: out }] });
    } catch (e) {
      return json(req, { error: { type: "groq_error", message: (e as Error).message } }, 502);
    }
  }

  if (path === "" || path.endsWith("/health") || path.endsWith("/comori")) {
    return json(req, { status: "ok", service: "comori edge function", ai_model: GROQ_MODEL });
  }
  return text(req, "Not found", 404);
});
