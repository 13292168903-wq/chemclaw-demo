// ===== 运行环境探测：唯一事实来源 =====
//
// 之前 "现在是什么模式" 有三个答案来源：
//   - server.js 里 /api/status 自己拼一遍
//   - routes.js 里 _openclawPromise 永久缓存第一次结果
//   - openclaw-bridge.js 里 60s TTL 缓存
// 三者可能同时对不上（开机时 OpenClaw 没起来 → 之后永远认为它不在，
// 但状态接口又说它在）。这里只保留一套探测与缓存，其他模块只读。

import { probeOpenClaw } from "./openclaw-bridge.js";

/** 探测结果缓存时长：CLI 探测要 ~50-200ms，不能每个请求都做。 */
const TTL_MS = 30_000;

let snapshot = null;   // 最近一次成功探测的结果
let resolving = null;  // 正在进行中的探测（并发请求共享）

/** 从环境变量读取 LLM 配置，不构造客户端。 */
function llmConfig() {
  if (process.env.DEEPSEEK_API_KEY) {
    return {
      provider: "deepseek",
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      model: process.env.OPENAI_MODEL || "gpt-4o",
      baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com",
    };
  }
  return null;
}

async function detect() {
  const llm = llmConfig();
  const probe = await probeOpenClaw();

  const provider = probe.available ? "openclaw" : llm ? llm.provider : "local";
  return {
    provider,
    llm,
    openclaw: probe,
    // 给人看的一句话，启动日志和状态接口共用
    label: provider === "openclaw"
      ? `OpenClaw (${probe.version || "Qwen3_6"})`
      : llm
        ? `${llm.provider === "deepseek" ? "DeepSeek" : "OpenAI"} (${llm.model})`
        : "本地演示模式（规则引擎）",
    checkedAt: new Date().toISOString(),
  };
}

/**
 * 解析当前运行环境。
 * @param {{refresh?: boolean}} options refresh=true 强制重新探测
 */
export async function resolveRuntime({ refresh = false } = {}) {
  const age = snapshot ? Date.now() - Date.parse(snapshot.checkedAt) : Infinity;
  if (!refresh && snapshot && age < TTL_MS) return snapshot;
  if (!refresh && resolving) return resolving;

  resolving = detect()
    .then((value) => {
      snapshot = value;
      resolving = null;
      return value;
    })
    .catch((error) => {
      resolving = null;
      throw error;
    });

  return resolving;
}

/** /api/status 的响应体。字段名保持与旧前端兼容。 */
export function describeRuntime(runtime) {
  return {
    ok: true,
    agent: runtime.provider,
    model: runtime.provider === "openclaw" ? `${runtime.openclaw.version || "Qwen3_6"} (via OpenClaw)` : runtime.llm?.model ?? null,
    openclaw: runtime.openclaw.available,
    // 为什么不是 OpenClaw —— 没有它，演示现场只能干看着"本地演示模式"
    openclawReason: runtime.openclaw.available ? null : runtime.openclaw.reason,
    skills: runtime.openclaw.available ? ["chemclaw-analyze", "chemclaw-grade"] : [],
    llm: runtime.llm ? { provider: runtime.llm.provider, model: runtime.llm.model } : null,
    label: runtime.label,
    checkedAt: runtime.checkedAt,
  };
}
