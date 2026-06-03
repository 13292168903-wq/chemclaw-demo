// Agent 1: 数据解析智能体

import { parseAny, detectCalcType, buildFileDetails } from "../parsers.js";
import { extractJSON } from "../utils.js";

export class DataParserAgent {
  constructor(llm) {
    this.name = "数据解析 Agent";
    this.llm = llm;
  }

  async analyze(context) {
    const { datasetText } = context.raw;
    if (!datasetText?.trim()) return this.emptyResult("未提供计算数据");

    if (this.llm) {
      try { return await this.analyzeWithAI(context); }
      catch (e) { console.warn(`[${this.name}] AI 调用失败:`, e.message); }
    }
    return this.analyzeLocal(context);
  }

  analyzeLocal(context) {
    const { datasetText } = context.raw;
    const parsed = parseAny(datasetText);
    const calcType = detectCalcType(datasetText);

    const metrics = {
      calculationType: calcType,
      energies: parsed.energies || [],
      optimizationEnergies: parsed.optimizationEnergies || [],
      structureFrames: parsed.structureFrames || [],
      fileDetails: buildFileDetails(datasetText, parsed),
      scfEnergy: parsed.scfEnergy,
      finalEnergy: parsed.finalEnergy ?? parsed.scfEnergy,
      homo: parsed.homo,
      lumo: parsed.lumo,
      gap: parsed.gap,
      frequencies: parsed.frequencies || [],
      irIntensities: parsed.irIntensities || [],
      vibrationalModes: parsed.vibrationalModes || [],
      imaginaryFrequencies: parsed.imaginaryFrequencies || [],
      dipole: parsed.dipole,
      charge: parsed.charge,
      multiplicity: parsed.multiplicity,
      route: parsed.route,
      barrier: parsed.barrier,
      adsorption: parsed.adsorption,
      thermo: parsed.thermo,
      converged: parsed.converged,
      normalTermination: parsed.normalTermination
    };

    const warnings = [];
    if (!parsed.normalTermination && parsed.type === "gaussian") {
      warnings.push("输出文件未检测到 Normal termination，计算可能未正常结束");
    }
    if (!parsed.converged && parsed.scfEnergy) {
      warnings.push("未检测到收敛标志，几何优化可能未收敛");
    }

    const finding = this.summarizeFindings(metrics, parsed);
    return { agent: this.name, metrics, parsed, findings: finding, warnings };
  }

  summarizeFindings(metrics, parsed) {
    const parts = [];
    if (metrics.calculationType) parts.push(`识别为 ${metrics.calculationType}`);
    if (metrics.scfEnergy) parts.push(`SCF 能量 ${metrics.scfEnergy.toFixed(6)} Hartree`);
    if (metrics.homo !== undefined && metrics.lumo !== undefined) {
      parts.push(`HOMO/LUMO: ${metrics.homo} / ${metrics.lumo} eV (gap: ${metrics.gap} eV)`);
    }
    if (metrics.frequencies.length > 0) parts.push(`频率分析包含 ${metrics.frequencies.length} 个模式`);
    if (metrics.energies?.length > 1) parts.push(`识别到 ${metrics.energies.length} 个能量点`);
    if (metrics.structureFrames?.length > 0) parts.push(`识别到 ${metrics.structureFrames.length} 个结构坐标帧`);
    if (metrics.imaginaryFrequencies.length > 0) {
      parts.push(`检出 ${metrics.imaginaryFrequencies.length} 个虚频: ${metrics.imaginaryFrequencies.join(', ')} cm⁻¹`);
    }
    if (metrics.dipole) parts.push(`偶极矩 ${metrics.dipole} Debye`);
    if (parsed.type === "gaussian" && parsed.normalTermination) parts.push("计算正常终止");
    return parts.join("；");
  }

  emptyResult(reason) {
    return { agent: this.name, metrics: {}, findings: reason, warnings: [reason] };
  }

  async analyzeWithAI(context) {
    const response = await this.llm.call(
      "你是计算化学数据解析专家。从输出文件中提取所有可识别的计算化学指标，返回严格 JSON，不要 Markdown 包裹。",
      `提取计算化学指标，返回 JSON:
{
  "calculationType": "计算方法描述",
  "scfEnergy": 数值或null, "homo": 数值或null, "lumo": 数值或null, "gap": 数值或null,
  "frequencies": [数值], "imaginaryFrequencies": [负值],
  "dipole": 数值或null, "barrier": 数值或null, "adsorption": 数值或null,
  "findings": "一句话关键发现", "warnings": ["警告"]
}

数据：
${context.raw.datasetText?.slice(0, 8000)}`
    );
    const json = extractJSON(response);
    return { agent: this.name, metrics: json, findings: json.findings, warnings: json.warnings };
  }
}
