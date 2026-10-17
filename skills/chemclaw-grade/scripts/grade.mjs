#!/usr/bin/env node
// chemclaw-grade 技能的执行脚本。
//
// 评分逻辑来自仓库 src/agents/grading-feedback.js（关键词 + 结构启发式），
// 因此这里给的是"结构自检分"，不是教师评分 —— SKILL.md 要求模型在回复中
// 明确这一点。

import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

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
  const options = { input: null, metrics: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--metrics") options.metrics = argv[++i];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (!arg.startsWith("-")) options.input = arg;
  }
  return options;
}

const USAGE = `用法: node grade.mjs <学生报告文件> [--metrics <analyze 输出的 metrics JSON>]

输出: 一段 JSON（stdout），包含 grading（分数/优点/改进/教师提示）与 rubric（四维度）。
失败: {"ok":false,"error":"..."} 并返回退出码 1。`;

function fail(message) {
  process.stdout.write(`${JSON.stringify({ ok: false, skill: "chemclaw-grade", error: message }, null, 2)}\n`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}
if (!args.input) fail("缺少学生报告文件路径");

const root = resolveRoot();
if (!root) fail("找不到 ChemClaw 仓库根目录（可用 CHEMCLAW_ROOT 环境变量指定）");

let studentReport;
try {
  studentReport = await readFile(args.input, "utf8");
} catch (error) {
  fail(`读取报告文件失败: ${error.message}`);
}
if (!studentReport.trim()) fail("报告文件为空");

let metrics = {};
if (args.metrics) {
  try {
    const raw = JSON.parse(await readFile(args.metrics, "utf8"));
    // 允许直接传入 analyze.mjs 的完整输出，取其 metrics 段。
    metrics = raw?.metrics && typeof raw.metrics === "object" ? raw.metrics : raw;
  } catch (error) {
    fail(`读取 metrics 文件失败: ${error.message}`);
  }
}

const { GradingFeedbackAgent } = await import(pathToFileURL(path.join(root, "src/agents/grading-feedback.js")).href);

/**
 * 报告数值与计算结果的一致性核对。
 *
 * 之前 --metrics 只是被读进来、原样塞给启发式规则（而规则根本不看它），
 * 所以命令行加不加参数输出完全一样 —— 交叉核对这条规则在细则里写着，
 * 但模型手上没有任何可比对的东西。这里至少把最容易写错的三类数字对上：
 * gap、能垒、虚频。
 */
function checkConsistency(report, metrics) {
  if (!metrics || !Object.keys(metrics).length) {
    return { checked: false, reason: "未提供 --metrics，本次未做数值一致性核对。" };
  }

  const specs = [
    {
      field: "gap",
      label: "HOMO-LUMO gap",
      regex: /(?:HOMO[\s\-–]*LUMO|gap|能隙|能级差)[^\d\-]{0,24}(-?\d+(?:\.\d+)?)\s*(eV|hartree)?/i,
      computed: Number.isFinite(metrics.gap) ? metrics.gap : null,
      unit: "eV",
      tolerance: (value) => Math.max(0.05, Math.abs(value) * 0.05),
    },
    {
      field: "barrier",
      label: "能垒",
      regex: /(?:能垒|活化能|activation\s*barrier|barrier)[^\d\-]{0,24}(-?\d+(?:\.\d+)?)\s*(kcal\/mol|kJ\/mol)?/i,
      computed: Number.isFinite(metrics.barrier) ? metrics.barrier : null,
      unit: "kcal/mol",
      tolerance: (value) => Math.max(0.5, Math.abs(value) * 0.05),
    },
    {
      field: "imaginaryFrequency",
      label: "虚频",
      regex: /虚频[^\d\-]{0,24}(-?\d+(?:\.\d+)?)\s*(cm-1|cm⁻¹|cm\^-1)?/i,
      computed: Array.isArray(metrics.imaginaryFrequencies) && metrics.imaginaryFrequencies.length
        ? metrics.imaginaryFrequencies
        : null,
      unit: "cm-1",
      tolerance: (value) => Math.max(2, Math.abs(value) * 0.02),
    },
  ];

  const items = [];
  for (const spec of specs) {
    const match = report.match(spec.regex);
    if (!match) continue;

    const reportValue = Number.parseFloat(match[1]);
    if (!Number.isFinite(reportValue)) continue;

    const unitInReport = (match[2] || "").toLowerCase();
    const computed = spec.computed;

    if (computed === null) {
      items.push({
        field: spec.field, label: spec.label, reportValue, computedValue: null,
        unit: spec.unit, status: "uncheckable",
        note: "计算结果中没有该指标（未解析到），无法核对。",
      });
      continue;
    }

    const expectedUnit = spec.unit.toLowerCase().replace("cm-1", "cm");
    const reportedUnit = unitInReport.replace("cm⁻¹", "cm").replace("cm^-1", "cm").replace("cm-1", "cm");
    if (unitInReport && reportedUnit !== expectedUnit) {
      items.push({
        field: spec.field, label: spec.label, reportValue, computedValue: computed,
        unit: spec.unit, status: "unit-mismatch",
        note: `报告使用 ${match[2]}，计算结果是 ${spec.unit}，需先统一单位再比较。`,
      });
      continue;
    }

    const compare = (target) => Math.abs(reportValue - target) <= spec.tolerance(target);
    const matchFound = Array.isArray(computed) ? computed.some(compare) : compare(computed);

    items.push({
      field: spec.field, label: spec.label, reportValue, computedValue: computed,
      unit: spec.unit, status: matchFound ? "match" : "mismatch",
    });
  }

  const mismatches = items.filter((item) => item.status === "mismatch" || item.status === "unit-mismatch");
  return {
    checked: items.length > 0,
    items,
    mismatches,
    note: items.length
      ? "同单位下：报告值四舍五入到计算值相同小数位后相等，或相对偏差 ≤ 5%，视为一致。"
      : "报告中未识别到可核对的指标（gap / 能垒 / 虚频）。",
  };
}

// 传 null 表示强制走启发式：技能不依赖 API key，保证离线可用且结果可复现。
const result = await new GradingFeedbackAgent(null).analyze({
  raw: { studentReport },
  metrics,
});

const grading = result.grading || {};
const rubric = result.rubric || [];
const consistency = checkConsistency(studentReport, metrics);

process.stdout.write(`${JSON.stringify({
  ok: true,
  skill: "chemclaw-grade",
  mode: "local-heuristic",
  reportLength: studentReport.length,
  grading: {
    score: grading.score ?? null,
    strengths: grading.strengths || [],
    improvements: grading.improvements || [],
    teacherNote: grading.teacherNote || "",
  },
  rubric,
  consistency,
  // 界面上的口径：这是结构自检分，不是人工评分。模型回复必须转述这一点。
  disclaimer: "分数由关键词与结构检查得出，用于提示学生缺什么，不代表教师给出的成绩。",
}, null, 2)}\n`);
