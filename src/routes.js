// ===== HTTP 路由层 =====
//
// 这一层只做三件事：把 body 交给用例层、把结果序列化、把"当前是什么模式"
// 说清楚。模式判断、provider 分派、降级策略都在 src/analyzer.js 与
// src/runtime.js 里，这里不再出现第二套实现。
//
// （重构前三个 handler 各自复制了一遍 "OpenClaw → 本地 → LLM 兜底"，
//   并且 /api/status 自己拼了一套 provider 判断。）

import { createLLMClient } from "./llm.js";
import { createAnalyzer } from "./analyzer.js";
import { resolveRuntime, describeRuntime } from "./runtime.js";

export function createRoutes() {
  // 注意：createLLMClient 必须在 .env 加载之后调用（server.js 在启动时加载）。
  const llm = createLLMClient();
  const analyzer = createAnalyzer({ llm });

  return {
    /** GET /api/status */
    async handleStatus({ refresh = false } = {}) {
      const runtime = await resolveRuntime({ refresh });
      return describeRuntime(runtime);
    },

    /** POST /api/analyze */
    handleAnalyze(body) {
      return analyzer.analyze(body);
    },

    /** POST /api/grade */
    handleGrade(body) {
      return analyzer.grade(body);
    },

    /** POST /api/chat */
    handleChat(body) {
      return analyzer.chat(body);
    },
  };
}
