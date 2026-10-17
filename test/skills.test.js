// 两个 OpenClaw 技能的执行脚本测试。
//
// 技能本体（SKILL.md + scripts）在仓库里，就必须能被验证 ——
// 否则"已完成封装"这句话只是文档里的承诺。

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const analyzeScript = path.join(projectRoot, "skills", "chemclaw-analyze", "scripts", "analyze.mjs");
const gradeScript = path.join(projectRoot, "skills", "chemclaw-grade", "scripts", "grade.mjs");
const sampleLog = path.join(projectRoot, "data", "samples", "diels-alder-ts.log");

async function runJson(script, args) {
  const { stdout } = await execFileAsync(process.execPath, [script, ...args], { cwd: projectRoot });
  return JSON.parse(stdout);
}

test("chemclaw-analyze: 样例文件的指标与解析器一致", async () => {
  const output = await runJson(analyzeScript, [sampleLog]);

  assert.equal(output.ok, true);
  assert.equal(output.skill, "chemclaw-analyze");
  assert.ok(Math.abs(output.metrics.scfEnergy - -423.119281416) < 1e-6);
  assert.deepEqual(output.metrics.imaginaryFrequencies, [-431.5678]);
  assert.equal(output.metrics.gap, 3.34);
  assert.equal(output.metrics.barrier, 18.6);
  assert.ok(Array.isArray(output.explanations));
  assert.ok(Array.isArray(output.quiz));
});

test("chemclaw-analyze: 缺文件时返回 ok:false 而不是堆栈", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [analyzeScript, path.join(projectRoot, "data", "不存在.log")], { cwd: projectRoot }),
    (error) => {
      const payload = JSON.parse(error.stdout);
      assert.equal(payload.ok, false);
      assert.match(payload.error, /读取输入文件失败/);
      return true;
    },
  );
});

test("chemclaw-grade: 报告被打分且四个维度齐全", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "chemclaw-grade-"));
  const report = path.join(dir, "report.txt");
  writeFileSync(report, "本实验使用 B3LYP-D3BJ/def2-SVP。TS-1 有一个虚频 -431.6 cm⁻¹。\n能垒 18.6 kcal/mol。\n", "utf8");

  try {
    const output = await runJson(gradeScript, [report]);
    assert.equal(output.ok, true);
    assert.equal(typeof output.grading.score, "number");
    assert.equal(output.rubric.length, 4);
    assert.match(output.disclaimer, /不代表教师给出的成绩/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("chemclaw-grade: 可以吃 analyze 的完整输出作为 metrics", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "chemclaw-grade-"));
  const report = path.join(dir, "report.txt");
  const metrics = path.join(dir, "analysis.json");
  writeFileSync(report, "能垒 18.6 kcal/mol，虚频 -431.6 cm⁻¹。\n", "utf8");

  try {
    const analysis = await runJson(analyzeScript, [sampleLog]);
    writeFileSync(metrics, JSON.stringify(analysis), "utf8");

    const output = await runJson(gradeScript, [report, "--metrics", metrics]);
    assert.equal(output.ok, true);
    assert.equal(typeof output.grading.score, "number");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
