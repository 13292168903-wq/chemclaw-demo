#!/usr/bin/env node
// chemclaw-analyze 技能的执行脚本。
//
// 设计原则：不在 SKILL.md 里"教模型怎么算"，而是让模型调用这个脚本拿
// 确定性结果，再基于结果写解释。解析器只有一份（仓库 src/parsers.js），
// 所以 Web Demo 与 OpenClaw 链路对同一个文件给出的数字必然一致。

import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * 找到 ChemClaw 仓库根目录。
 * 技能被装到 ~/.openclaw/workspace/skills/ 之后，脚本与源码不再同级，
 * 所以按 环境变量 → 安装时写入的 .chemclaw-root → 向上找 package.json 的顺序找。
 */
function resolveRoot() {
  if (process.env.CHEMCLAW_ROOT) return process.env.CHEMCLAW_ROOT;

  const marker = path.join(scriptDir, ".chemclaw-root");
  if (existsSync(marker)) {
    const root = readFileSync(marker, "utf8").trim();
    if (root && existsSync(path.join(root, "package.json"))) return root;
  }

  const looksLikeRepo = (dir) => {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
      return pkg?.name === "chemclaw-demo";
    } catch {
      return false;
    }
  };

  for (const start of [scriptDir, process.cwd()]) {
    let dir = start;
    for (let i = 0; i < 10; i++) {
      if (looksLikeRepo(dir)) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

function parseArgs(argv) {
  const options = { input: null, xyz: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--xyz") options.xyz = argv[++i];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (!arg.startsWith("-")) options.input = arg;
  }
  return options;
}

const USAGE = `用法: node analyze.mjs <计算输出文件> [--xyz <坐标文件>]

输出: 一段 JSON（stdout），包含 metrics / findings / warnings / explanations / teaching。
失败: {"ok":false,"error":"..."} 并返回退出码 1。`;

/** 按 Hill 规则拼最简式（C、H 优先，其余按字母序）；无坐标时返回 null。 */
function hillFormula(xyzText) {
  const atoms = parseXYZAtoms(xyzText || "");
  if (!atoms.length) return null;
  const { composition } = summarizeStructure(atoms);
  const order = [
    ...(composition.C ? ["C"] : []),
    ...(composition.H ? ["H"] : []),
    ...Object.keys(composition).filter((el) => el !== "C" && el !== "H").sort(),
  ];
  return order.map((el) => `${el}${composition[el] > 1 ? composition[el] : ""}`).join("");
}

/**
 * 纯坐标文件（标准 XYZ 或裸坐标行）。
 * 判定逻辑放在 src/parsers.js 里（isPlainCoordinates），网页端用的是同一份，
 * 避免"技能说 XYZ、接口说 ORCA"。
 */
const isCoordinatesOnly = () => isPlainCoordinates(text);

function fail(message) {
  process.stdout.write(`${JSON.stringify({ ok: false, skill: "chemclaw-analyze", error: message }, null, 2)}\n`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}
if (!args.input) fail("缺少输入文件路径");

const root = resolveRoot();
if (!root) fail("找不到 ChemClaw 仓库根目录（可用 CHEMCLAW_ROOT 环境变量指定）");

let text;
try {
  text = await readFile(args.input, "utf8");
} catch (error) {
  fail(`读取输入文件失败: ${error.message}`);
}
if (!text.trim()) fail("输入文件为空");

const { parseAny, buildFileDetails, isPlainCoordinates } = await import(pathToFileURL(path.join(root, "src/parsers.js")).href);
const { Orchestrator } = await import(pathToFileURL(path.join(root, "src/orchestrator.js")).href);
const { parseXYZAtoms, summarizeStructure } = await import(pathToFileURL(path.join(root, "public/shared/structure.js")).href);

const parsed = parseAny(text);
let moleculeText = "";
if (args.xyz) {
  try {
    moleculeText = await readFile(args.xyz, "utf8");
  } catch (error) {
    fail(`读取坐标文件失败: ${error.message}`);
  }
} else {
  // 计算输出里最后一帧就是最终结构，直接用，不额外要求用户给 XYZ。
  moleculeText = parsed.structureFrames.at(-1)?.xyz || "";
}

const result = await new Orchestrator(null).runAnalysis({
  datasetName: path.basename(args.input),
  datasetText: text,
  moleculeText,
});

const coordinatesOnly = isCoordinatesOnly();
const format = coordinatesOnly
  ? "XYZ"
  : parsed.type === "gaussian" ? "Gaussian" : parsed.type === "orca" ? "ORCA" : "unknown";

// 只有坐标时，编排器仍会给出"通用计算化学输出"这类措辞 —— 对结构文件是错的，
// 这里统一改成事实陈述，免得模型照抄一个并不存在的计算类型。
const findings = coordinatesOnly
  ? [
      {
        agent: "数据解析 Agent",
        finding: `仅提供坐标，未包含计算输出：${result.structures[0]?.atomCount ?? 0} 个原子，无可提取的能量、频率或轨道指标。`,
        warnings: ["文件里没有 SCF 能量 / 频率 / 轨道能量，不能回答任何与计算结果有关的问题。"],
      },
      ...result.agentFindings.slice(1),
    ]
  : result.agentFindings.map((item) => ({
      agent: item.agent,
      finding: item.finding,
      warnings: item.warnings || [],
    }));

const summary = coordinatesOnly
  ? `仅结构（${hillFormula(moleculeText) || `${result.structures[0]?.atomCount ?? 0} 个原子`}），未包含计算结果`
  : result.summary;

const output = {
  ok: true,
  skill: "chemclaw-analyze",
  datasetName: path.basename(args.input),
  mode: result.mode,

  // 数字原样给，不预先格式化：模型引用时应当用这些值，而不是自己重算。
  metrics: {
    format,
    taskType: coordinatesOnly ? null : result.basicInfo?.taskType || null,
    method: parsed.method || null,
    basis: parsed.basis || null,
    route: parsed.route || null,
    charge: parsed.charge ?? null,
    multiplicity: parsed.multiplicity ?? null,
    scfEnergy: Number.isFinite(parsed.scfEnergy) ? parsed.scfEnergy : null,
    finalEnergy: Number.isFinite(parsed.finalEnergy) ? parsed.finalEnergy : null,
    homo: Number.isFinite(parsed.homo) ? parsed.homo : null,
    lumo: Number.isFinite(parsed.lumo) ? parsed.lumo : null,
    gap: Number.isFinite(parsed.gap) ? parsed.gap : null,
    barrier: Number.isFinite(parsed.barrier) ? parsed.barrier : null,
    adsorption: Number.isFinite(parsed.adsorption) ? parsed.adsorption : null,
    dipole: Number.isFinite(parsed.dipole) ? parsed.dipole : null,
    imaginaryFrequencies: parsed.imaginaryFrequencies || [],
    frequencyCount: (parsed.frequencies || []).length,
    thermo: parsed.thermo || {},
    normalTermination: Boolean(parsed.normalTermination),
    converged: Boolean(parsed.converged),
    /** 明确的中止信号（Error termination / Job killed / aborting the run）。 */
    aborted: Boolean(parsed.aborted),
    errors: parsed.errors || [],
  },

  // 单位写死在这里，避免模型按字段名猜：轨道能量统一换算成 eV，
  // 偶极矩统一换算成 Debye，能量保持源文件的 Hartree。
  units: {
    energy: "Hartree",
    orbital: "eV",
    dipole: "Debye",
    frequency: "cm-1",
    barrier: "kcal/mol",
  },
  // unitsSource 说明"这个单位是换算来的，还是照文件原样抄的"。
  // as-written 表示脚本没校验过源单位：显式 `HOMO = -0.24` 这种行没法判断
  // 是 eV 还是 Hartree，只能原样给出，由回复时注明"单位未校验"。
  unitsSource: {
    orbital: parsed.orbitalUnit || "as-written",
    dipole: parsed.dipoleUnit || "as-written",
    barrier: parsed.barrierUnit || "as-written",
  },

  fileDetails: {
    ...buildFileDetails(text, parsed),
    ...(coordinatesOnly ? { format: "xyz", energyPointCount: 0, frequencyCount: 0 } : {}),
  },
  structure: {
    frameCount: result.structures.length,
    atomCount: result.structures[0]?.atomCount ?? null,
    /** Hill 式最简式，例如 "C6H6"；模型描述结构时可以直接引用。 */
    formula: hillFormula(moleculeText),
  },

  findings,
  warnings: (findings[0]?.warnings || []).filter(Boolean),
  explanations: result.agentFindings.find((item) => item.explanations)?.explanations || [],
  // 只有坐标时，教学材料（学习路径/训练题）是通用模板，与数据无关，
  // 直接不输出，免得模型转述"标注反应物、过渡态和产物"这种无根据的指导。
  ...(coordinatesOnly
    ? {
        learningGoals: [],
        learningPath: [],
        quiz: [],
        researchSuggestions: [],
        literatureBenchmarks: [],
        teachingNote: "该文件不含计算结果，已跳过教学材料生成。",
      }
    : {
        learningGoals: result.learningGoals,
        learningPath: result.learningPath,
        quiz: result.quiz,
        researchSuggestions: result.researchSuggestions,
        literatureBenchmarks: result.literatureBenchmarks,
      }),
  summary,
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
