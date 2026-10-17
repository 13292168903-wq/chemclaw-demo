// ===== 用例层：分析 / 批改 / 追问 =====
//
// 职责只有一个：每个用例内部按 provider 分派，并且把"降级"讲清楚。
// provider 顺序固定为 OpenClaw → 直连 LLM → 本地规则引擎，任何一环失败
// 都继续往下走，同时在结果里留下 fallbackReason，前端可以显示为什么降级。
//
// 之前这段逻辑散在三个 handler 里各写一遍，并且：
//   - 无 API key 时同一条本地管线会跑两遍（measured: 2MB 日志 67ms ×2）
//   - OpenClaw 失败只 console.error，用户只看到"本地演示模式"
//   - /api/status 与请求路径各用一套缓存，可能互相矛盾

import { Orchestrator } from "./orchestrator.js";
import { resolveRuntime } from "./runtime.js";
import {
  callOpenClawAgent,
  buildAnalyzePrompt,
  buildGradePrompt,
  buildChatPrompt,
} from "./openclaw-bridge.js";

/** OpenClaw 单次调用的上限；前端超时必须比它更长（见 public/js/api.js）。 */
const OPENCLAW_TIMEOUT = 180_000;
const OPENCLAW_CHAT_TIMEOUT = 90_000;

function openclawFields(cloud) {
  return {
    mode: "openclaw",
    openclawModel: cloud.model,
    openclawProvider: cloud.provider,
    openclawSkill: cloud.skillUsed || null,
    openclawDuration: cloud.durationMs,
  };
}

/** 把真正由 OpenClaw 生成解读的那条 finding 标出来（按内容判断，不按下标）。 */
function markOpenClawFindings(findings = []) {
  let marked = false;
  return findings.map((item) => {
    if (!marked && item?.explanations) {
      marked = true;
      return { ...item, agent: "OpenClaw 化学解释 Agent", openclawEnhanced: true };
    }
    return item;
  });
}

function asText(value, max = 5_000_000) {
  if (typeof value !== "string") return value == null ? "" : String(value);
  return value.length > max ? value.slice(0, max) : value;
}

export function normalizeAnalyzeInput(body = {}) {
  return {
    datasetName: asText(body.datasetName, 300) || "unknown",
    datasetText: asText(body.datasetText),
    moleculeText: asText(body.moleculeText),
  };
}

export function normalizeGradeInput(body = {}) {
  return {
    studentReport: asText(body.studentReport),
    analysisContext: body.analysisContext && typeof body.analysisContext === "object" ? body.analysisContext : {},
  };
}

export function createAnalyzer({ llm = null } = {}) {
  const rules = new Orchestrator(null);        // 规则引擎：永远可用
  const ai = llm ? new Orchestrator(llm) : null; // 直连 LLM（可选）

  // ---------- 本地 / 直连 LLM ----------

  async function analyzeLocally(input) {
    if (!ai) return { result: await rules.runAnalysis(input) };
    try {
      return { result: await ai.runAnalysis(input) };
    } catch (error) {
      const result = await rules.runAnalysis(input);
      result.fallbackReason = `AI 分析失败，已切换本地规则引擎：${error.message}`;
      return { result };
    }
  }

  async function gradeLocally(input) {
    if (!ai) return { result: await rules.runGrading(input) };
    try {
      return { result: await ai.runGrading(input) };
    } catch (error) {
      const result = await rules.runGrading(input);
      result.fallbackReason = `AI 批改失败，已切换本地规则引擎：${error.message}`;
      return { result };
    }
  }

  // ---------- 用例 ----------

  /**
   * 分析计算数据。
   * OpenClaw 与本地结构化解析并发：云端出叙述，本地出数字与图表，
   * 两者都要，但不必前后串行等 3 分钟。
   */
  async function analyze(body) {
    const input = normalizeAnalyzeInput(body);
    const runtime = await resolveRuntime();

    if (runtime.openclaw.available) {
      try {
        const [cloud, structured] = await Promise.all([
          callOpenClawAgent({
            message: buildAnalyzePrompt(input),
            sessionId: `chemclaw-analyze-${Date.now()}`,
            timeout: OPENCLAW_TIMEOUT,
          }),
          rules.runAnalysis(input),
        ]);

        return {
          ...structured,
          ...openclawFields(cloud),
          openclawExplanations: cloud.text,
          openclawDataProvided: true,
          agentFindings: markOpenClawFindings(structured.agentFindings),
        };
      } catch (error) {
        console.warn("OpenClaw analyze failed:", error.message);
        const { result } = await analyzeLocally(input);
        result.fallbackReason = `OpenClaw 调用失败，已回退：${error.message}`;
        return result;
      }
    }

    const { result } = await analyzeLocally(input);
    return result;
  }

  /** 批改实验报告。 */
  async function grade(body) {
    const input = normalizeGradeInput(body);
    const runtime = await resolveRuntime();

    if (runtime.openclaw.available) {
      try {
        const [cloud, structured] = await Promise.all([
          callOpenClawAgent({
            message: buildGradePrompt({ report: input.studentReport, rubric: null }),
            sessionId: `chemclaw-grade-${Date.now()}`,
            timeout: OPENCLAW_TIMEOUT,
          }),
          rules.runGrading(input),
        ]);

        return {
          ...structured,
          ...openclawFields(cloud),
          openclawFeedback: cloud.text,
        };
      } catch (error) {
        console.warn("OpenClaw grade failed:", error.message);
        const { result } = await gradeLocally(input);
        result.fallbackReason = `OpenClaw 调用失败，已回退：${error.message}`;
        return result;
      }
    }

    const { result } = await gradeLocally(input);
    return result;
  }

  /** 助教追问。 */
  async function chat(body) {
    const question = asText(body?.question, 4_000).trim();
    const context = body?.context && typeof body.context === "object" ? body.context : {};
    const metrics = context.metrics || {};
    const runtime = await resolveRuntime();

    if (runtime.openclaw.available) {
      try {
        const cloud = await callOpenClawAgent({
          message: buildChatPrompt({ question, context: JSON.stringify(metrics) }),
          sessionId: `chemclaw-chat-${Date.now()}`,
          timeout: OPENCLAW_CHAT_TIMEOUT,
        });
        return {
          mode: "openclaw",
          model: cloud.model,
          provider: cloud.provider,
          skill: cloud.skillUsed,
          answer: cloud.text,
        };
      } catch (error) {
        console.warn("OpenClaw chat failed:", error.message);
      }
    }

    if (llm) {
      try {
        const answer = await llm.chat(`上下文：${JSON.stringify(metrics, null, 2)}\n\n学生问题：${question}`);
        return { mode: "ai-agent", model: llm.model, answer: answer.trim() };
      } catch (error) {
        return { mode: "local-fallback", answer: `AI 调用失败: ${error.message}` };
      }
    }

    return {
      mode: "local-demo",
      answer: localChatAnswer(question, metrics),
    };
  }

  return { analyze, grade, chat };
}

/**
 * 无模型时的兜底回答：不假装懂，而是把已解析出的证据点出来，
 * 提示学生接下来该看哪个数字。
 */
function localChatAnswer(question, metrics = {}) {
  const hints = [];
  if (Number.isFinite(Number(metrics.barrier))) hints.push(`能垒 ${metrics.barrier} kcal/mol`);
  if (metrics.gap != null) hints.push(`HOMO-LUMO gap ${metrics.gap} eV`);
  if (metrics.imaginaryFrequencies?.length) hints.push(`虚频 ${metrics.imaginaryFrequencies[0]} cm⁻¹`);

  const evidence = hints.length
    ? `当前数据里可以直接引用的证据：${hints.join("、")}。`
    : "当前还没有可引用的数值证据，建议先完成一次数据分析。";

  return `针对「${question || "这组数据怎么解释"}」，建议分两层回答：先引用具体数值，再说明它对应哪个化学概念。${evidence}（本地演示模式：接入 OpenClaw 或配置 API key 后可获得完整的追问回答。）`;
}
