import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./src/env.js";
import { createRoutes } from "./src/routes.js";
import { resolveRuntime } from "./src/runtime.js";

const gzipAsync = promisify(gzip);

// .env 先加载，routes 里的 LLM 客户端才能读到 key。
// 之前的 npm start 用 bash 的 export $(grep ...)，Windows 上根本起不来。
const loadedEnvKeys = loadEnvFile();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const COMPRESSIBLE = /\.(?:html|css|js|mjs|json|svg|txt|map)$/i;
const MIN_GZIP_BYTES = 1024;
const MAX_BODY = 5 * 1024 * 1024; // 5 MB

// ===== 静态资源缓存 =====
// molstar.js 未压缩 4.65 MB、gzip 后 1.33 MB：没有 gzip 也没有缓存头，
// 每次刷新都要重新下载并重新协商，校园网下首屏就是在等它。
const gzipCache = new Map(); // absolute path -> { key, buffer }
const GZIP_CACHE_MAX = 12;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  res.end(payload);
}

function cacheControlFor(relativePath) {
  if (relativePath.startsWith("vendor/")) return "public, max-age=31536000, immutable";
  if (relativePath.startsWith("shared/")) return "public, max-age=3600";
  // 自己的 HTML/CSS/JS 不缓存，改完刷新就能看到
  return "no-cache";
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw httpError(413, `请求体超过 ${MAX_BODY / 1024 / 1024} MB 上限`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw httpError(400, "请求体不是合法 JSON");
  }
  // typeof [] === "object"：数组能骗过 `typeof` 检查，最后变成一个
  // "什么都没提交"的 200 空分析。接口参数就该是对象，不是就 400。
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw httpError(400, "请求体必须是 JSON 对象");
  }
  return parsed;
}

/** 路径收敛：解析后必须仍落在 public/ 之内。 */
function resolveStaticPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw httpError(400, "路径编码非法");
  }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const target = path.resolve(publicDir, relative);
  const rel = path.relative(publicDir, target);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "") {
    throw httpError(403, "禁止访问该路径");
  }
  return { target, relative: rel.split(path.sep).join("/") };
}

async function serveStatic(req, res, requestId, pathname) {
  const { target, relative } = resolveStaticPath(pathname);

  let info;
  try {
    info = await stat(target);
  } catch {
    return sendJson(res, 404, { error: "未找到该资源", requestId });
  }
  if (!info.isFile()) return sendJson(res, 404, { error: "未找到该资源", requestId });

  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { etag, "cache-control": cacheControlFor(relative) });
    return res.end();
  }

  const ext = path.extname(target).toLowerCase();
  const headers = {
    "content-type": MIME[ext] || "application/octet-stream",
    "cache-control": cacheControlFor(relative),
    etag,
    "last-modified": info.mtime.toUTCString(),
    "x-content-type-options": "nosniff",
    vary: "accept-encoding",
  };

  const wantsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "") && COMPRESSIBLE.test(target);
  let body;
  if (wantsGzip && info.size >= MIN_GZIP_BYTES) {
    const key = `${etag}:${info.size}`;
    const cached = gzipCache.get(target);
    if (cached && cached.key === key) {
      body = cached.buffer;
    } else {
      // 异步 gzip：molstar.js 4.65 MB 压缩要 ~100ms，同步版本会把这段时间
      // 里的所有请求（包括正在轮询的 /api/status）一起卡住。
      body = await gzipAsync(await readFile(target));
      if (gzipCache.size >= GZIP_CACHE_MAX) gzipCache.delete(gzipCache.keys().next().value);
      gzipCache.set(target, { key, buffer: body });
    }
    headers["content-encoding"] = "gzip";
  } else {
    body = await readFile(target);
  }

  headers["content-length"] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === "HEAD" ? undefined : body);
}

const routes = createRoutes();

const server = http.createServer(async (req, res) => {
  const startedAt = process.hrtime.bigint();
  const requestId = randomUUID().slice(0, 8);

  let pathname = "";
  try {
    pathname = new URL(req.url, "http://localhost").pathname;
  } catch {
    return sendJson(res, 400, { error: "非法的请求路径", requestId });
  }

  try {
    if (pathname.startsWith("/api/")) {
      const isGet = req.method === "GET" || req.method === "HEAD";
      const isPost = req.method === "POST";

      if (pathname === "/api/status") {
        if (!isGet) throw httpError(405, "该接口只接受 GET");
        const url = new URL(req.url, "http://localhost");
        return sendJson(res, 200, await routes.handleStatus({ refresh: url.searchParams.has("refresh") }), { "x-request-id": requestId });
      }

      if (pathname === "/api/analyze" || pathname === "/api/grade" || pathname === "/api/chat") {
        if (!isPost) throw httpError(405, "该接口只接受 POST");
        const body = await readJsonBody(req);
        const handler = pathname === "/api/analyze" ? routes.handleAnalyze
          : pathname === "/api/grade" ? routes.handleGrade
            : routes.handleChat;
        const result = await handler(body);
        return sendJson(res, 200, result, { "x-request-id": requestId });
      }

      throw httpError(404, `接口不存在：${pathname}`);
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      throw httpError(405, "静态资源只支持 GET / HEAD");
    }

    return await serveStatic(req, res, requestId, pathname);
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) {
      console.error(`[${requestId}] ${req.method} ${pathname} → ${status}`, error?.stack || error);
    }
    // 500 不把内部堆栈/路径回给客户端，但保留可追踪的 requestId。
    const message = status >= 500 ? "服务器内部错误，请重试" : error.message;
    if (!res.headersSent) sendJson(res, status, { error: message, requestId }, { "x-request-id": requestId });
    else res.end();
  } finally {
    if (pathname.startsWith("/api/")) {
      const ms = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
      if (ms > 50) console.log(`[${requestId}] ${req.method} ${pathname} ${res.statusCode} ${ms}ms`);
    }
  }
});

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用：换一个 PORT，或先关掉正在运行的实例。`);
    process.exit(1);
  }
  console.error("服务器启动失败:", error);
  process.exit(1);
});

// 演示现场常用 Ctrl+C：不处理的话，正在跑的 openclaw 子进程和临时目录
// 会留在后台。close() 停止接收新连接，等存量请求收尾。
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n收到 ${signal}，正在关闭…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  // 监听回调是 async 的，未捕获的 rejection 在 Node 15+ 会直接杀进程；
  // 这里至少把原因打出来，而不是"服务凭空消失"。
  console.error("未处理的 Promise 拒绝:", reason);
});

server.listen(PORT, HOST, async () => {
  const runtime = await resolveRuntime({ refresh: true });
  console.log(`ChemClaw running at http://localhost:${PORT}`);
  console.log(`Agent: ${runtime.label}`);
  if (runtime.openclaw.available) {
    console.log(runtime.skills.length
      ? `Skills: ${runtime.skills.join(", ")}`
      : "Skills: 未检测到 chemclaw 技能（运行 npm run install:skills 安装）");
  } else {
    console.log(`OpenClaw: 未启用（${runtime.openclaw.reason}）`);
  }
  if (loadedEnvKeys.length) console.log(`Env: 已从 .env 读取 ${loadedEnvKeys.join(", ")}`);
  console.log(`Static: ${publicDir}`);
});
