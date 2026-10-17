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

// 传 null 表示强制走启发式：技能不依赖 API key，保证离线可用且结果可复现。
const result = await new GradingFeedbackAgent(null).analyze({
  raw: { studentReport },
  metrics,
});

const grading = result.grading || {};
const rubric = result.rubric || [];

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
  // 界面上的口径：这是结构自检分，不是人工评分。模型回复必须转述这一点。
  disclaimer: "分数由关键词与结构检查得出，用于提示学生缺什么，不代表教师给出的成绩。",
}, null, 2)}\n`);
