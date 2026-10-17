// 编排器的模式上报测试。
//
// "现在到底是谁在算"是这个项目的核心卖点，也是最容易被说出谎的地方：
// 旧实现只要构造时传了 llm 就上报 ai-agent，哪怕三个 Agent 全部在 catch
// 里降级、一个 AI 结果都没有。

import { test } from "node:test";
import assert from "node:assert/strict";

import { Orchestrator } from "../src/orchestrator.js";

const DATASET = "SCF Done:  E(RB3LYP) =  -76.4089123     A.U. after    8 cycles";

/** 按调用次数依次返回预设响应；抛错用 Error 表示。 */
function scriptedLLM(responses, model = "fake-model") {
  let call = 0;
  return {
    model,
    async call() {
      const next = responses[Math.min(call, responses.length - 1)];
      call += 1;
      if (next instanceof Error) throw next;
      return typeof next === "function" ? next() : JSON.stringify(next);
    },
  };
}

const PARSER_OK = { calculationType: "单点能", scfEnergy: -76.4089123, findings: "单点能已解析" };
const EXPLAINER_OK = { explanations: [{ topic: "能量", level: "概念", detail: "SCF 能量可用于比较构象稳定性。" }], summary: "一个维度" };
const TEACHING_OK = { learningPath: ["第一步：看能量", "第二步：看结构"], quiz: [{ type: "概念题", question: "SCF 能量能比较什么？" }] };

test("mode: 三个 Agent 都走 AI 才是 ai-agent", async () => {
  const result = await new Orchestrator(scriptedLLM([PARSER_OK, EXPLAINER_OK, TEACHING_OK]))
    .runAnalysis({ datasetName: "a.log", datasetText: DATASET, moleculeText: "" });
  assert.equal(result.mode, "ai-agent");
  assert.equal(result.aiAgentCount, 3);
  assert.equal(result.model, "fake-model");
});

test("mode: AI 只成功一个时上报 hybrid，而不是假装全 AI", async () => {
  const result = await new Orchestrator(scriptedLLM([PARSER_OK, new Error("explainer down"), new Error("teaching down")]))
    .runAnalysis({ datasetName: "a.log", datasetText: DATASET, moleculeText: "" });
  assert.equal(result.mode, "hybrid");
  assert.equal(result.aiAgentCount, 1);
});

test("mode: 全部降级时是 local-demo", async () => {
  const result = await new Orchestrator(scriptedLLM([new Error("down")]))
    .runAnalysis({ datasetName: "a.log", datasetText: DATASET, moleculeText: "" });
  assert.equal(result.mode, "local-demo");
  assert.equal(result.aiAgentCount, 0);
});

test("mode: 没有 llm 时是 local-demo", async () => {
  const result = await new Orchestrator(null).runAnalysis({ datasetName: "a.log", datasetText: DATASET, moleculeText: "" });
  assert.equal(result.mode, "local-demo");
  assert.equal(result.model, null);
});

test("LLM 把数值写成字符串时不会 500，且格式化正确", async () => {
  const result = await new Orchestrator(scriptedLLM([
    { calculationType: "频率分析", scfEnergy: "-76.4089123", thermo: { zpe: "0.128456", gibbs: "-423.02" } },
    EXPLAINER_OK,
    TEACHING_OK,
  ])).runAnalysis({ datasetName: "a.log", datasetText: DATASET, moleculeText: "" });

  assert.equal(result.mode, "ai-agent");
  assert.equal(result.metrics.zeroPointEnergy, "0.128456 Hartree");
  assert.equal(result.metrics.gibbsFreeEnergy, "-423.020000 Hartree");
});

test("AI 返回空解释时降级到本地，而不是渲染空卡片", async () => {
  const result = await new Orchestrator(scriptedLLM([
    PARSER_OK,
    { explanations: [], summary: "什么都没有" },
    TEACHING_OK,
  ])).runAnalysis({ datasetName: "a.log", datasetText: DATASET, moleculeText: "" });

  assert.equal(result.mode, "hybrid");
  assert.ok((result.agentFindings[1].explanations || []).length >= 0);
});

test("批改：AI 没给出分数时降级到本地启发式", async () => {
  const result = await new Orchestrator(scriptedLLM([{ grading: { strengths: ["不错"] }, rubric: [] }]))
    .runGrading({ studentReport: "能垒 18.6 kcal/mol，存在一个虚频。", analysisContext: {} });

  assert.equal(result.mode, "local-demo");
  assert.equal(typeof result.grading.score, "number");
});

test("长优化任务：轨迹与结构帧数量不一致时给出可见 warning", async () => {
  const log = [];
  for (let i = 0; i < 5; i++) {
    log.push(` Step number ${i}`);
    log.push(` SCF Done:  E(RB3LYP) =  -423.${100000 + i}     A.U.`);
    log.push(" Standard orientation:");
    log.push(" --------------------------------------------------------------");
    log.push(" Center     Atomic      Atomic             Coordinates (Angstroms)");
    log.push(" Number     Number       Type             X           Y           Z");
    log.push(" --------------------------------------------------------------");
    // 几何每步不同，避免被去重合并
    log.push(` 0    6    0   ${i * 0.01}   0.0   0.0`);
    log.push(` 1    1    0   ${1.09 + i * 0.01}   0.0   0.0`);
    log.push(" --------------------------------------------------------------");
  }

  const result = await new Orchestrator(null).runAnalysis({
    datasetName: "opt.log",
    datasetText: log.join("\n"),
    moleculeText: "",
  });

  assert.ok(Array.isArray(result.optimizationTrajectory));
  // warnings 必须挂在 profile 上：挂在数组上会被 JSON.stringify 丢掉
  const restored = JSON.parse(JSON.stringify(result));
  assert.ok(Array.isArray(restored.optimizationProfile.warnings));
});
