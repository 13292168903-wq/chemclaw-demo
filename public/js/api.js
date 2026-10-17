// ===== API client =====
// 超时必须比服务端更长。服务端在 OpenClaw 模式下允许 180s（见 src/analyzer.js），
// 以前这里是 60s —— 真接了模型就变成"前端先超时、后端还在跑"，用户看到假失败。
const DEFAULT_TIMEOUT = 200_000;
const ANALYSIS_TIMEOUT = 200_000;
const CHAT_TIMEOUT = 150_000;

async function request(url, { method = "GET", body, timeout = DEFAULT_TIMEOUT } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const payload = await response.json();
        if (payload?.error) detail = payload.error;
      } catch { /* non-JSON error body */ }
      throw new Error(detail);
    }
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("请求超时，请检查后端服务或网络连接");
    if (error instanceof TypeError) throw new Error("无法连接后端，请确认服务已启动");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchStatus() {
  try {
    return await request("/api/status", { timeout: 8000 });
  } catch {
    return { agent: "offline", model: null };
  }
}

export function analyze({ datasetName, datasetText, moleculeText }) {
  return request("/api/analyze", {
    method: "POST",
    body: { datasetName, datasetText, moleculeText },
    timeout: ANALYSIS_TIMEOUT,
  });
}

export function grade({ studentReport, analysisContext }) {
  return request("/api/grade", {
    method: "POST",
    body: { studentReport, analysisContext },
    timeout: ANALYSIS_TIMEOUT,
  });
}

export function chat({ question, context }) {
  return request("/api/chat", { method: "POST", body: { question, context }, timeout: CHAT_TIMEOUT });
}
