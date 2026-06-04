import { Orchestrator } from "./orchestrator.js";
import { createLLMClient } from "./llm.js";
import {
  isOpenClawAvailable,
  callOpenClawAgent,
  buildAnalyzePrompt,
  buildGradePrompt,
  buildChatPrompt,
} from "./openclaw-bridge.js";

let _openclawPromise = null; // cached promise to avoid concurrent duplicate calls

function isReady() {
  if (!_openclawPromise) {
    _openclawPromise = isOpenClawAvailable().catch(() => false);
  }
  return _openclawPromise;
}

export function createRoutes() {
  const llm = createLLMClient();
  const orchestrator = new Orchestrator(llm);

  // 分析计算数据 — OpenClaw first, local fallback
  async function handleAnalyze(body) {
    const { datasetName, datasetText, moleculeText } = body;

    // Try OpenClaw first
    if (await isReady()) {
      try {
        const prompt = buildAnalyzePrompt({ datasetName, datasetText, moleculeText });
        const result = await callOpenClawAgent({
          message: prompt,
          sessionId: `chemclaw-analyze-${Date.now()}`,
          timeout: 180_000,
        });

        const localResult = await new Orchestrator(null).runAnalysis({
          datasetName, datasetText, moleculeText,
        });

        return {
          ...localResult,
          mode: "openclaw",
          openclawModel: result.model,
          openclawProvider: result.provider,
          openclawSkill: result.skillUsed || "chemclaw-analyze",
          openclawDuration: result.durationMs,
          openclawExplanations: result.text,
          openclawDataProvided: true,
          agentFindings: localResult.agentFindings.map((f, i) => ({
            ...f,
            agent: i === 1 ? "OpenClaw 化学解释 Agent" : f.agent,
            openclawEnhanced: i === 1,
          })),
        };
      } catch (ocError) {
        console.error("OpenClaw agent failed, falling back to local:", ocError.message);
      }
    }

    // Local mode: try LLM, fall back to rule-based
    const localOnly = await new Orchestrator(null).runAnalysis({ datasetName, datasetText, moleculeText });
    try {
      return await orchestrator.runAnalysis({ datasetName, datasetText, moleculeText });
    } catch (error) {
      localOnly.warning = `AI 分析失败，已切换本地模式: ${error.message}`;
      return localOnly;
    }
  }

  // 批改实验报告 — OpenClaw first, local fallback
  async function handleGrade(body) {
    const { studentReport, analysisContext } = body;

    if (await isReady()) {
      try {
        const prompt = buildGradePrompt({ report: studentReport, rubric: null });
        const result = await callOpenClawAgent({
          message: prompt,
          sessionId: `chemclaw-grade-${Date.now()}`,
          timeout: 180_000,
        });

        const localResult = await new Orchestrator(null).runGrading({ studentReport, analysisContext });

        return {
          ...localResult,
          mode: "openclaw",
          openclawModel: result.model,
          openclawProvider: result.provider,
          openclawSkill: result.skillUsed || "chemclaw-grade",
          openclawDuration: result.durationMs,
          openclawFeedback: result.text,
        };
      } catch (ocError) {
        console.error("OpenClaw grading failed, falling back to local:", ocError.message);
      }
    }

    // Local mode: try LLM, fall back to rule-based
    const localOnly = await new Orchestrator(null).runGrading({ studentReport, analysisContext });
    try {
      return await orchestrator.runGrading({ studentReport, analysisContext });
    } catch (error) {
      localOnly.warning = `AI 批改失败，已切换本地模式: ${error.message}`;
      return localOnly;
    }
  }

  // 助教追问 — OpenClaw first
  async function handleChat({ question, context }) {
    if (await isReady()) {
      try {
        const prompt = buildChatPrompt({
          question,
          context: context ? JSON.stringify(context.metrics || {}) : undefined,
        });
        const result = await callOpenClawAgent({
          message: prompt,
          sessionId: `chemclaw-chat-${Date.now()}`,
          timeout: 60_000,
        });
        return {
          mode: "openclaw",
          model: result.model,
          provider: result.provider,
          skill: result.skillUsed,
          answer: result.text,
        };
      } catch (ocError) {
        console.error("OpenClaw chat failed:", ocError.message);
      }
    }

    // Fallback: local or LLM
    if (!llm) {
      return {
        mode: "local-demo",
        answer: `针对「${question || "如何解释这组数据"}」，建议从数据证据和化学解释两个层面：先引用关键数值，再说明对应的化学概念。当前为本地 Demo 模式。`,
      };
    }
    try {
      const answer = await llm.chat(
        `上下文：${JSON.stringify(context?.metrics || {}, null, 2)}\n\n学生问题：${question}`
      );
      return { mode: "ai-agent", model: llm.model, answer: answer.trim() };
    } catch (e) {
      return { mode: "local-fallback", answer: `AI 调用失败: ${e.message}` };
    }
  }

  return { handleAnalyze, handleGrade, handleChat };
}
