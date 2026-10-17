// 多智能体编排器
// 按序执行：数据解析 → 化学解释 → 教学设计 → 批改反馈
// 每个 Agent 的输出作为下一个 Agent 的上下文

import { DataParserAgent } from "./agents/data-parser.js";
import { ChemicalExplainerAgent } from "./agents/chemical-explainer.js";
import { TeachingDesignerAgent } from "./agents/teaching-designer.js";
import { GradingFeedbackAgent } from "./agents/grading-feedback.js";
// 结构几何只有一份实现，浏览器端 /shared/structure.js 用的是同一个文件。
import { toPDB } from "../public/shared/structure.js";

export class Orchestrator {
  constructor(llm = null) {
    this.llm = llm;
    this.agents = [
      new DataParserAgent(llm),
      new ChemicalExplainerAgent(llm),
      new TeachingDesignerAgent(llm),
      new GradingFeedbackAgent(llm),
    ];
  }

  /**
   * 模式由"实际执行路径"决定，而不是"配置里有没有 llm"。
   *
   * 每个 Agent 自己会在 AI 失败时降级到本地规则，原实现只要构造时传了 llm
   * 就无条件上报 ai-agent —— 于是三个 Agent 全部降级、一个 AI 结果都没有的
   * 情况下，界面依然显示"AI 生成"。这里按 via 统计：
   *   all ai → ai-agent；all local → local-demo；混合 → hybrid。
   */
  resolveMode(vias = []) {
    const aiCount = vias.filter((via) => via === "ai").length;
    if (!vias.length || aiCount === 0) return "local-demo";
    return aiCount === vias.length ? "ai-agent" : "hybrid";
  }

  // ===== XYZ to PDB Converter =====
  // 结构几何在 ../public/shared/structure.js，前后端共用同一实现。
  // 数据流：Backend → Frontend Mol* renderer
  xyzToPdb(xyzText, title = "ChemClaw") {
    return toPDB(xyzText, title);
  }

  async runAnalysis({ datasetName = "unknown", datasetText = "", moleculeText = "" }) {
    const context = {
      raw: { datasetName, datasetText, moleculeText },
      startedAt: new Date().toISOString()
    };

    const agentResults = [];

    // Agent 1: 数据解析
    const parseResult = await this.agents[0].analyze(context);
    Object.assign(context, { metrics: parseResult.metrics, parsed: parseResult.parsed });
    agentResults.push({ agent: parseResult.agent, via: parseResult.via, finding: parseResult.findings, warnings: parseResult.warnings });

    // Agent 2: 化学解释
    const explainResult = await this.agents[1].analyze(context);
    Object.assign(context, { explanations: explainResult.explanations });
    agentResults.push({
      agent: explainResult.agent,
      via: explainResult.via,
      finding: explainResult.summary,
      explanations: explainResult.explanations,
    });

    // Agent 3: 教学设计
    const teachResult = await this.agents[2].analyze(context);
    Object.assign(context, { teaching: teachResult });
    agentResults.push({
      agent: teachResult.agent,
      via: teachResult.via,
      finding: teachResult.learningPath?.[0] || "学习路径已生成",
      teaching: teachResult,
    });

    // 组装结果 (不含批改)
    const metrics = parseResult.metrics || {};
    const imagCount = metrics.imaginaryFrequencies?.length || 0;
    const hasReactionPath = (metrics.energies?.length || 0) > 1 || metrics.barrier !== undefined;
    const barrier = hasReactionPath ? (Number.isFinite(metrics.barrier) ? metrics.barrier : metrics.energySpan ?? null) : null;
    const gap = Number.isFinite(metrics.gap) ? metrics.gap : null;
    const adsorption = metrics.adsorption;
    const chart = this.buildChart(metrics, barrier);
    const structures = this.buildStructureFrames(metrics, moleculeText);
    const trajectory = this.buildOptimizationTrajectory(metrics, structures);
    const fileDetails = {
      ...(metrics.fileDetails || {}),
      structureFrameCount: Math.max(metrics.fileDetails?.structureFrameCount || 0, structures.length)
    };

    // Generate PDB data for 3D visualization (OpenClaw provides structured data)
    const moleculeXYZ = moleculeText?.trim() || structures[0]?.xyz || "";
    const pdbData = moleculeXYZ ? this.xyzToPdb(moleculeXYZ, this.inferTitle(metrics, datasetName)) : "";

    const vias = agentResults.map((item) => item.via);
    return {
      mode: this.resolveMode(vias),
      aiAgentCount: vias.filter((via) => via === "ai").length,
      agentCount: vias.length,
      model: this.llm?.model || null,
      datasetName,
      projectTitle: this.inferTitle(metrics, datasetName),
      summary: this.buildSummary(metrics, imagCount, teachResult),
      metrics: {
        calculationType: metrics.calculationType || "通用计算",
          scfEnergy: Number.isFinite(metrics.scfEnergy) ? metrics.scfEnergy : undefined,
        ...(barrier !== null ? { activationBarrier: `${barrier} kcal/mol` } : {}),
        ...(gap !== null ? { homoLumoGap: `${gap} eV` } : {}),
        imaginaryFrequency: imagCount > 0 ? `${metrics.imaginaryFrequencies[0]} cm⁻¹` : "未检出",
        ...(Number.isFinite(adsorption) ? { adsorptionEnergy: `${adsorption} eV` } : {}),
        ...(metrics.thermo?.zpe != null ? { zeroPointEnergy: `${metrics.thermo.zpe.toFixed(6)} Hartree` } : {}),
        ...(metrics.thermo?.enthalpy != null ? { enthalpy: `${metrics.thermo.enthalpy.toFixed(6)} Hartree` } : {}),
        ...(metrics.thermo?.gibbs != null ? { gibbsFreeEnergy: `${metrics.thermo.gibbs.toFixed(6)} Hartree` } : {}),
        confidence: metrics.normalTermination ? "高" : "中"
      },
      chart,
      fileDetails,
      structures,
      basicInfo: this.buildBasicInfo(metrics, datasetName),
      optimizationProfile: this.buildOptimizationProfile(metrics, trajectory.points, trajectory.warnings),
      optimizationTrajectory: trajectory.points,
      vibrationalProfile: this.buildVibrationalProfile(metrics),
      agentFindings: agentResults,
      learningPath: teachResult.learningPath || [],
      learningGoals: teachResult.learningGoals || [],
      quiz: teachResult.quiz || [],
      researchSuggestions: teachResult.researchSuggestions || [],
      literatureBenchmarks: teachResult.literatureBenchmarks || [],
      pdbData,
      openclawDataProvided: false
      // 架构分层与路线图是展示文案，已经在前端常量里（renderers.js 的
      // DEFAULT_ARCHITECTURE / DEFAULT_ROADMAP），不再塞进每次 API 响应。
    };
  }

  async runGrading({ studentReport = "", analysisContext = {} }) {
    const context = {
      raw: { studentReport },
      metrics: analysisContext.metrics || {},
      explanations: analysisContext.explanations || [],
      startedAt: new Date().toISOString()
    };

    const gradeResult = await this.agents[3].analyze(context);
    return {
      mode: this.resolveMode([gradeResult.via]),
      aiAgentCount: gradeResult.via === "ai" ? 1 : 0,
      agentCount: 1,
      model: this.llm?.model || null,
      agentFindings: [{
        agent: gradeResult.agent,
        via: gradeResult.via,
        finding: `报告评分: ${gradeResult.grading?.score ?? "未评分"}`,
        grading: gradeResult
      }],
      grading: gradeResult.grading || {},
      rubric: gradeResult.rubric || []
    };
  }

  inferTitle(metrics, datasetName) {
    if (datasetName && !datasetName.startsWith("sample")) return datasetName;
    if (metrics.imaginaryFrequencies?.length > 0) return "基于过渡态分析的反应机理研究";
    if (metrics.adsorption) return "表面吸附与催化活性计算研究";
    return "计算化学结构性质与反应性研究";
  }

  buildSummary(metrics, imagCount, teachResult) {
    const parts = [];
    if (metrics.calculationType) parts.push(`计算类型: ${metrics.calculationType}`);
    if (metrics.frequencies?.length > 0) parts.push(`包含 ${metrics.frequencies.length} 个频率模式`);
    if (imagCount > 0) parts.push(`检出 ${imagCount} 个虚频信号`);
    if (Number.isFinite(metrics.gap)) parts.push(`HOMO-LUMO gap 已计算`);
    parts.push(`生成 ${teachResult.quiz?.length || 0} 道训练题`);
    return parts.join("；");
  }

  buildChart(metrics, barrierFallback) {
    if (metrics.energies?.length > 1) {
      const min = minOf(metrics.energies.map(item => item.hartree));
      return {
        labels: metrics.energies.map(item => item.label),
        values: metrics.energies.map(item => Number(((item.hartree - min) * 627.509).toFixed(2))),
        unit: "kcal mol⁻¹"
      };
    }
    if (barrierFallback !== null && barrierFallback !== undefined) {
      return { labels: ["反应物", "过渡态"], values: [0, Number(barrierFallback)], unit: "kcal mol⁻¹" };
    }
    return { labels: [], values: [], unit: "kcal mol⁻¹", note: "当前输入只包含单个结构或未识别到反应路径，暂不绘制相对能量曲线。" };
  }

  buildStructureFrames(metrics, moleculeText = "") {
    if (metrics.structureFrames?.length) return metrics.structureFrames;
    if (moleculeText?.trim()) {
      const lines = moleculeText.trim().split(/\r?\n/);
      const atomCount = Number(lines[0]);
      if (Number.isFinite(atomCount)) {
        return [{ title: lines[1] || "输入 XYZ 结构", atomCount, xyz: moleculeText.trim() }];
      }
    }
    return [];
  }

  buildBasicInfo(metrics, datasetName) {
    return {
      software: metrics.fileDetails?.format === "gaussian" ? "Gaussian" : metrics.fileDetails?.format === "orca" ? "ORCA" : "未知",
      fileName: datasetName,
      taskType: metrics.calculationType || "未知任务",
      method: metrics.method || null,
      basis: metrics.basis || null,
      route: metrics.route || null,
      chargeMultiplicity: metrics.charge !== null && metrics.charge !== undefined ? `${metrics.charge} / ${metrics.multiplicity ?? "-"}` : null,
      outputCount: metrics.fileDetails?.energyPointCount || 0,
      normalTermination: metrics.normalTermination
    };
  }

  buildOptimizationProfile(metrics, trajectory = [], warnings = []) {
    if (trajectory.length > 1) {
      return {
        steps: trajectory.map(point => point.step),
        values: trajectory.map(point => point.energyHartree),
        relativeValues: trajectory.map(point => point.relativeEnergyKcal),
        unit: "Hartree",
        hasStructures: trajectory.some(point => point.xyz),
        warnings: warnings || []
      };
    }
    const points = metrics.optimizationEnergies || [];
    if (!points.length) return { steps: [], values: [], unit: "Hartree", note: "当前输入未识别到几何优化过程能量。" };
    return {
      steps: points.map(item => item.step),
      values: points.map(item => item.hartree),
      unit: "Hartree",
      ...(warnings.length ? { warnings } : {})
    };
  }

  buildOptimizationTrajectory(metrics, structures = []) {
    const energyPoints = metrics.optimizationEnergies || [];
    const hasOptimizationSignal = energyPoints.length > 1 || structures.length > 1;
    if (!hasOptimizationSignal) return { points: [], warnings: [] };

    const count = Math.max(energyPoints.length, structures.length);
    const finiteEnergies = energyPoints.map(point => point.hartree).filter(Number.isFinite);
    // 用 reduce 而不是 Math.min(...arr)：一次 5000 步的优化会把展开参数
    // 压到 V8 的栈上限附近，超大文件下 RangeError 是真实风险。
    const minEnergy = finiteEnergies.length ? minOf(finiteEnergies) : null;
    const warnings = [];

    if (energyPoints.length > 1 && structures.length > 1 && energyPoints.length !== structures.length) {
      warnings.push(`优化能量点 ${energyPoints.length} 个，结构帧 ${structures.length} 个，已按顺序进行近似配对。`);
    } else if (energyPoints.length > 1 && structures.length === 1) {
      warnings.push(`识别到 ${energyPoints.length} 个优化能量点，但只有 1 个可用结构帧（几何重复已被去重），回放时所有步骤共用同一结构。`);
    }

    const pickStructure = (index) => {
      if (!structures.length) return { frame: null, frameIndex: null };
      if (count === structures.length) return { frame: structures[index], frameIndex: index };
      const mapped = Math.round((index / Math.max(count - 1, 1)) * (structures.length - 1));
      return { frame: structures[mapped], frameIndex: mapped };
    };

    const points = Array.from({ length: count }, (_, index) => {
      const energy = energyPoints[index] || null;
      const { frame, frameIndex } = pickStructure(index);
      const energyHartree = Number.isFinite(energy?.hartree) ? energy.hartree : null;
      return {
        step: energy?.step ?? index + 1,
        energyHartree,
        relativeEnergyKcal: energyHartree !== null && minEnergy !== null
          ? Number(((energyHartree - minEnergy) * 627.509).toFixed(3))
          : null,
        frameIndex,
        title: `优化步 ${energy?.step ?? index + 1}`,
        structureTitle: frame?.title || null,
        atomCount: frame?.atomCount || null,
        xyz: frame?.xyz || null
      };
    });
    // 旧的 `points.warnings = warnings` 会被 JSON.stringify 直接丢掉
    // （数组的自定义属性不参与序列化），所以显式返回。
    return { points, warnings };
  }

  buildVibrationalProfile(metrics) {
    const modes = metrics.vibrationalModes || [];
    if (!modes.length) return { modes: [], note: "当前输入未识别到振动模式或 IR 强度。" };
    return {
      modes: modes.slice(0, 120),
      hasImaginary: modes.some(mode => mode.frequency < 0),
      unit: "cm⁻¹"
    };
  }
}

/** 最小值，不用 Math.min(...arr)：参数展开在超大数组上会栈溢出。 */
function minOf(values = []) {
  return values.reduce((min, value) => (value < min ? value : min), Infinity);
}
