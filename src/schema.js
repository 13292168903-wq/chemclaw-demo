// ===== LLM 输出的数据契约 =====
//
// 模型返回的 JSON 是外部输入，不是可信数据：它会把 -423.1 写成 "-423.1"，
// 把数组写成对象，把该有的字段漏掉。下游（orchestrator / renderers）按
// "数值一定能 .toFixed()" 的前提写，于是要么抛 TypeError，要么让 NaN
// 一路流到结论句里。
//
// 这里只做一件事：把任意形状的 JSON 收敛成固定形状，非法值一律变
// undefined / 空数组，让下游可以安心按类型使用。

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** 允许 "‑423.1" / " -423.1 " / 数字；其余（空串、null、布尔、数组）→ undefined。 */
export function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toText(value, max = 2_000) {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text ? text.slice(0, max) : undefined;
}

function toTextArray(value, max = 40, maxChars = 500) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (isPlainObject(item) ? toText(item.text ?? item.suggestion ?? item.label, maxChars) : toText(item, maxChars)))
    .filter(Boolean)
    .slice(0, max);
}

/** 数字数组：丢弃非数值项，但保留 0 与负值（虚频靠负号表达）。 */
function toNumberArray(value, max = 5_000) {
  if (!Array.isArray(value)) return [];
  return value.map(toNumber).filter((item) => item !== undefined).slice(0, max);
}

function toObjectArray(value, max = 500, mapItem) {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlainObject).map(mapItem).filter(Boolean).slice(0, max);
}

/** 能量点：{label, hartree}，hartree 必须是有限数。 */
function normalizeEnergies(value) {
  return toObjectArray(value, 20_000, (item) => {
    const hartree = toNumber(item.hartree ?? item.energy ?? item.value);
    if (hartree === undefined) return null;
    return { label: toText(item.label, 80) || "能量点", hartree };
  });
}

/** 优化步能量点：{step, hartree}。 */
function normalizeOptimizationEnergies(value) {
  let fallbackStep = 0;
  return toObjectArray(value, 50_000, (item) => {
    const hartree = toNumber(item.hartree ?? item.energy ?? item.value);
    if (hartree === undefined) return null;
    fallbackStep += 1;
    return { step: toNumber(item.step) ?? fallbackStep, hartree };
  });
}

function normalizeStructureFrames(value) {
  return toObjectArray(value, 5_000, (item) => {
    const xyz = typeof item.xyz === "string" ? item.xyz.trim() : "";
    if (!xyz) return null;
    const atomCount = toNumber(item.atomCount ?? Number.parseInt(xyz, 10));
    return {
      title: toText(item.title, 120) || "结构",
      atomCount: atomCount === undefined ? null : atomCount,
      xyz,
    };
  });
}

function normalizeVibrationalModes(value) {
  return toObjectArray(value, 5_000, (item) => {
    const frequency = toNumber(item.frequency ?? item.value);
    if (frequency === undefined) return null;
    return {
      index: toNumber(item.index) ?? 0,
      frequency,
      intensity: toNumber(item.intensity ?? item.irIntensity) ?? 0,
    };
  });
}

function normalizeThermo(value) {
  if (!isPlainObject(value)) return {};
  const thermo = {};
  for (const key of ["zpe", "thermalEnergy", "enthalpy", "gibbs"]) {
    const number = toNumber(value[key]);
    if (number !== undefined) thermo[key] = number;
  }
  return thermo;
}

/**
 * 数据解析 Agent 的 metrics 契约。
 * 只保留编排器与前端真正读取的字段，其余字段直接丢弃 — 半对半错的字段
 * 比缺失更危险（前端会照单渲染）。
 */
export function normalizeMetrics(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const metrics = {
    calculationType: toText(source.calculationType, 120),
    energies: normalizeEnergies(source.energies),
    optimizationEnergies: normalizeOptimizationEnergies(source.optimizationEnergies),
    structureFrames: normalizeStructureFrames(source.structureFrames),
    scfEnergy: toNumber(source.scfEnergy),
    finalEnergy: toNumber(source.finalEnergy),
    homo: toNumber(source.homo),
    lumo: toNumber(source.lumo),
    gap: toNumber(source.gap),
    frequencies: toNumberArray(source.frequencies),
    irIntensities: toNumberArray(source.irIntensities),
    vibrationalModes: normalizeVibrationalModes(source.vibrationalModes),
    imaginaryFrequencies: toNumberArray(source.imaginaryFrequencies),
    dipole: toNumber(source.dipole),
    charge: toNumber(source.charge),
    multiplicity: toNumber(source.multiplicity),
    route: toText(source.route, 500),
    method: toText(source.method, 80),
    basis: toText(source.basis, 120),
    barrier: toNumber(source.barrier),
    adsorption: toNumber(source.adsorption),
    thermo: normalizeThermo(source.thermo),
    converged: typeof source.converged === "boolean" ? source.converged : undefined,
    normalTermination: typeof source.normalTermination === "boolean" ? source.normalTermination : undefined,
  };

  // HOMO/LUMO 有一个缺失时 gap 无意义 —— 不许它自己"算出"一个数。
  if (metrics.homo === undefined || metrics.lumo === undefined) metrics.gap = undefined;
  if (metrics.gap === undefined && metrics.homo !== undefined && metrics.lumo !== undefined) {
    metrics.gap = Number((metrics.lumo - metrics.homo).toFixed(4));
  }
  return metrics;
}

export function normalizeExplanations(value) {
  return toObjectArray(value, 12, (item) => {
    const detail = toText(item.detail ?? item.evidence, 1_500);
    if (!detail) return null;
    return {
      topic: toText(item.topic ?? item.concept, 80) || "化学解释",
      level: toText(item.level, 40) || "概念",
      detail,
      teachingHint: toText(item.teachingHint ?? item.teaching, 500) || "",
    };
  });
}

export function normalizeTeaching(raw) {
  const source = isPlainObject(raw) ? raw : {};
  return {
    learningGoals: toObjectArray(source.learningGoals, 12, (item) => {
      const concept = toText(item.concept, 80);
      if (!concept) return null;
      return {
        concept,
        evidence: toText(item.evidence, 300) || "",
        outcome: toText(item.outcome, 300) || "",
      };
    }),
    learningPath: toTextArray(source.learningPath, 12, 300),
    quiz: toObjectArray(source.quiz, 20, (item) => {
      const question = toText(item.question, 500);
      if (!question) return null;
      return {
        type: toText(item.type, 20) || "思考题",
        question,
        rubric: toText(item.rubric, 500) || "",
      };
    }),
    researchSuggestions: toTextArray(source.researchSuggestions, 20, 300),
    literatureBenchmarks: toObjectArray(source.literatureBenchmarks, 12, (item) => {
      const topic = toText(item.topic, 80);
      if (!topic) return null;
      return {
        topic,
        benchmark: toText(item.benchmark, 200) || "",
        note: toText(item.note, 300) || "",
      };
    }),
  };
}

export function normalizeGrading(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const score = toNumber(source.score);
  return {
    score: score === undefined ? null : score,
    strengths: toTextArray(source.strengths, 12, 200),
    improvements: toTextArray(source.improvements, 12, 200),
    teacherNote: toText(source.teacherNote, 800) || "",
  };
}

export function normalizeRubric(value) {
  return toObjectArray(value, 12, (item) => {
    const dimension = toText(item.dimension, 40);
    if (!dimension) return null;
    return {
      dimension,
      weight: toNumber(item.weight) ?? 0,
      level: toText(item.level, 20) || "中等",
      score: toNumber(item.score) ?? 0,
      comment: toText(item.comment, 400) || "",
    };
  });
}
