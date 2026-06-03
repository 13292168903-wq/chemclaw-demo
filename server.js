import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRoutes } from "./src/routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 5173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const MAX_BODY = 5 * 1024 * 1024; // 5 MB
const readBody = async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("请求体过大");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const serveStatic = async (req, res) => {
  const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const safePath = urlPath === "/" ? "/index.html" : decodeURIComponent(urlPath);
  const target = path.normalize(path.join(publicDir, safePath));
  if (!target.startsWith(publicDir)) { res.writeHead(403); res.end("Forbidden"); return; }
  try {
    const file = await readFile(target);
    const ext = path.extname(target);
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
};

const { handleAnalyze, handleGrade, handleChat } = createRoutes();

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/status") {
      const provider = process.env.DEEPSEEK_API_KEY ? "deepseek" : process.env.OPENAI_API_KEY ? "openai" : "local";
      const model = provider === "deepseek" ? (process.env.DEEPSEEK_MODEL || "deepseek-chat")
        : provider === "openai" ? (process.env.OPENAI_MODEL || "gpt-4o") : null;

      // Check OpenClaw availability (non-blocking, uses cache)
      let openclaw = false;
      try { const { isOpenClawAvailable } = await import("./src/openclaw-bridge.js"); openclaw = await isOpenClawAvailable(); } catch (e) { console.error("OpenClaw status check failed:", e.message); }

      return json(res, 200, {
        ok: true,
        agent: openclaw ? "openclaw" : provider,
        model: openclaw ? "Qwen3_6 (via OpenClaw)" : model,
        openclaw,
        skills: openclaw ? ["chemclaw-analyze", "chemclaw-grade"] : [],
      });
    }

    if (req.method === "POST" && req.url === "/api/analyze") {
      const body = JSON.parse(await readBody(req) || "{}");
      return json(res, 200, await handleAnalyze(body));
    }

    if (req.method === "POST" && req.url === "/api/grade") {
      const body = JSON.parse(await readBody(req) || "{}");
      return json(res, 200, await handleGrade(body));
    }

    if (req.method === "POST" && req.url === "/api/chat") {
      const body = JSON.parse(await readBody(req) || "{}");
      return json(res, 200, await handleChat(body));
    }

    if (req.method === "GET") return serveStatic(req, res);

    res.writeHead(405);
    res.end("Method not allowed");
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

server.listen(PORT, async () => {
  let openclaw = false;
  try { const { isOpenClawAvailable } = await import("./src/openclaw-bridge.js"); openclaw = await isOpenClawAvailable(); } catch (e) { console.error("OpenClaw status check failed:", e.message); }

  const provider = openclaw ? "OpenClaw (Qwen3_6)"
    : process.env.DEEPSEEK_API_KEY ? `DeepSeek (${process.env.DEEPSEEK_MODEL || "deepseek-chat"})`
    : process.env.OPENAI_API_KEY ? `OpenAI (${process.env.OPENAI_MODEL || "gpt-4o"})` : "本地演示模式";
  console.log(`ChemClaw running at http://localhost:${PORT}`);
  console.log(`Agent: ${provider}`);
  if (openclaw) console.log(`Skills: chemclaw-analyze, chemclaw-grade`);
});
