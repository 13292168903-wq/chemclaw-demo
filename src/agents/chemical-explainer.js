// Agent 2: 化学解释智能体
import { conceptCards } from "../knowledge.js";
import { extractJSON } from "../utils.js";

export class ChemicalExplainerAgent {
  constructor(llm) {
    this.name = "化学解释 Agent";
    this.llm = llm;
  }

  async analyze(context) {
    const metrics = context.metrics || {};
    if (Object.keys(metrics).length === 0) {
      return { agent: this.name, explanations: [], summary: "无计算指标可供解释" };
    }
    if (this.llm) {
      try { return await this.analyzeWithAI(context); }
      catch (e) { console.warn(`[${this.name}] AI 调用失败:`, e.message); }
    }
    return this.analyzeLocal(context);
  }

  analyzeLocal(context) {
    const metrics = context.metrics || {};
    const explanations = [];

    if (metrics.imaginaryFrequencies?.length > 0) {
      explanations.push({
        topic: conceptCards.imaginaryFrequency.title,
        level: "核心判据",
        detail: conceptCards.imaginaryFrequency.evidence(metrics.imaginaryFrequencies[0]),
        teachingHint: conceptCards.imaginaryFrequency.teaching
      });
    }
    if (metrics.gap !== undefined && metrics.gap !== null) {
      explanations.push({
        topic: conceptCards.homoLumoGap.title,
        level: "电子结构",
        detail: conceptCards.homoLumoGap.evidence(metrics.gap),
        teachingHint: conceptCards.homoLumoGap.teaching
      });
    }
    const barrier = metrics.barrier ?? metrics.energySpan;
    if (barrier) {
      explanations.push({
        topic: conceptCards.activationBarrier.title,
        level: "反应动力学",
        detail: conceptCards.activationBarrier.evidence(barrier),
        teachingHint: conceptCards.activationBarrier.teaching
      });
    }
    if (metrics.adsorption !== undefined && metrics.adsorption !== null) {
      explanations.push({
        topic: conceptCards.adsorptionEnergy.title,
        level: "表面化学",
        detail: conceptCards.adsorptionEnergy.evidence(metrics.adsorption),
        teachingHint: conceptCards.adsorptionEnergy.teaching
      });
    }
    if (metrics.dipole) {
      explanations.push({
        topic: "分子极性",
        level: "分子性质",
        detail: `偶极矩 = ${metrics.dipole} Debye，反映分子内电荷分布不对称性，影响溶解性和分子间相互作用。`,
        teachingHint: "可引导讨论溶剂效应对反应能垒的影响。"
      });
    }

    const summary = explanations.length > 0
      ? `从 ${explanations.length} 个维度完成了化学解释：${explanations.map(e => e.topic).join("、")}`
      : "当前数据不足以生成化学解释";

    return { agent: this.name, explanations, summary };
  }

  async analyzeWithAI(context) {
    const response = await this.llm.call(
      "你是计算化学教育专家。基于计算指标从化学角度给出有深度的解释，注重物理化学概念的教学表达。返回严格 JSON。",
      `基于以下指标生成化学解释，返回 JSON:
{
  "explanations": [{"topic": "主题", "level": "核心判据/电子结构/反应动力学/表面化学/分子性质", "detail": "详细化学解释(2-3句)", "teachingHint": "教学建议"}],
  "summary": "一句话总结"
}

计算指标：${JSON.stringify(context.metrics, null, 2)}
学生报告：${context.raw?.studentReport?.slice(0, 1000) || "无"}`
    );
    const json = extractJSON(response);
    return { agent: this.name, ...json };
  }
}
