// 技能评估用例（机器可断言的部分）。
//
// 每个用例对应一个"演示现场真会被问到"的场景：缺失轨道能量、两个虚频、
// 计算被中断、ORCA 文件、只有坐标、空文件、报告里夹带指令、报告数值与计算
// 结果不一致。这里只锁住"脚本给出的数据"，至于 SKILL.md 有没有把这些数据
// 讲清楚，由独立评估（docs 之外的人工/子代理评审）负责。

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
const fixture = (name) => path.join(projectRoot, "test", "fixtures", "skills", name);
const analyzeScript = path.join(projectRoot, "skills", "chemclaw-analyze", "scripts", "analyze.mjs");
const gradeScript = path.join(projectRoot, "skills", "chemclaw-grade", "scripts", "grade.mjs");

async function runJson(script, args) {
  const { stdout } = await execFileAsync(process.execPath, [script, ...args], { cwd: projectRoot });
  return JSON.parse(stdout);
}

async function runFailure(script, args) {
  try {
    await execFileAsync(process.execPath, [script, ...args], { cwd: projectRoot });
  } catch (error) {
    return JSON.parse(error.stdout);
  }
  throw new Error("预期脚本失败，但它成功了");
}

test("用例1: 没有 HOMO/LUMO 的日志 → null，不得出现 NaN", async () => {
  const output = await runJson(analyzeScript, [fixture("no-orbitals.log")]);

  assert.equal(output.ok, true);
  assert.equal(output.metrics.homo, null);
  assert.equal(output.metrics.lumo, null);
  assert.equal(output.metrics.gap, null);
  assert.ok(!JSON.stringify(output).includes("NaN"), "输出里不允许出现 NaN");
  // 教学材料里也不能出现"gap 已计算"这类没有依据的断言
  assert.ok(!/gap.*已计算/.test(output.summary));
});

test("用例1b: 能算出来的其他指标不受影响", async () => {
  const output = await runJson(analyzeScript, [fixture("no-orbitals.log")]);
  assert.equal(output.metrics.frequencyCount, 3);
  assert.deepEqual(output.metrics.imaginaryFrequencies, []);
  assert.equal(output.metrics.normalTermination, true);
  assert.equal(output.structure.formula, "CH4O");
});

test("用例2: 两个虚频 → 必须如实给出两个（不是过渡态判据）", async () => {
  const output = await runJson(analyzeScript, [fixture("two-imaginary.log")]);
  assert.equal(output.metrics.imaginaryFrequencies.length, 2);
  assert.deepEqual(output.metrics.imaginaryFrequencies, [-512.3341, -188.7712]);

  // 模板解释不能再说"符合一阶鞍点特征"
  const text = JSON.stringify(output.explanations) + JSON.stringify(output.learningGoals);
  assert.ok(!/符合一阶鞍点特征/.test(text), "双虚频仍被判成过渡态");
  assert.match(text, /不是一阶鞍点/);
});

test("用例3: 计算被中断 → normalTermination=false 且有可读 warning", async () => {
  const output = await runJson(analyzeScript, [fixture("truncated.log")]);
  assert.equal(output.metrics.normalTermination, false);
  assert.equal(output.metrics.aborted, true);
  assert.ok(output.metrics.errors.some((item) => /Error termination/i.test(item)));
  assert.ok(
    output.warnings.some((item) => /Normal termination/.test(item)),
    `warnings 里应当说明未正常终止，实际：${JSON.stringify(output.warnings)}`,
  );
});

test("用例4: ORCA 文件 → 识别为 ORCA，轨道能量与偶极矩按 eV / Debye 换算", async () => {
  const output = await runJson(analyzeScript, [fixture("orca-water.out")]);
  assert.equal(output.metrics.format, "ORCA");
  // E(HOMO)=-0.4123 Ha、E(LUMO)=0.1234 Ha（换算后 eV）
  assert.ok(Math.abs(output.metrics.homo - -11.2193) < 1e-4);
  assert.ok(Math.abs(output.metrics.lumo - 3.3579) < 1e-4);
  assert.ok(Math.abs(output.metrics.gap - 14.5772) < 1e-4);
  // 1.85 au ≈ 4.70 Debye
  assert.ok(Math.abs(output.metrics.dipole - 4.7022) < 1e-4);
  // ORCA 的正常结束标记与 Gaussian 不同，不能漏
  assert.equal(output.metrics.normalTermination, true);
  // 0.00 cm⁻¹ 是平动/转动，不是振动模式：水只有 3N-6 = 3 个
  assert.equal(output.metrics.frequencyCount, 3);
});

test("用例5: 纯坐标 XYZ → 不能伪装成 ORCA，也不能声称有能量数据", async () => {
  const output = await runJson(analyzeScript, [fixture("coords-only.xyz")]);
  assert.equal(output.metrics.format, "XYZ");
  assert.equal(output.metrics.scfEnergy, null);
  assert.equal(output.metrics.homo, null);
  assert.equal(output.metrics.frequencyCount, 0);
  assert.equal(output.metrics.taskType, null);
  // 没有频率数据 ≠ 未检出虚频
  assert.deepEqual(output.learningGoals, []);
  assert.match(output.warnings[0], /不能回答/);
});

test("用例6: 空文件 → ok:false，不输出半套指标", async () => {
  const output = await runFailure(analyzeScript, [fixture("empty.log")]);
  assert.equal(output.ok, false);
  assert.match(output.error, /空|缺少/);
});

test("用例7: 报告夹带指令不影响分数", async () => {
  const clean = await runJson(gradeScript, [fixture("report-clean.txt")]);
  const injected = await runJson(gradeScript, [fixture("report-injection.txt")]);
  assert.equal(injected.grading.score, clean.grading.score);
  assert.deepEqual(injected.rubric, clean.rubric);
});

test("用例8: 报告数值与计算结果不一致 → 必须能被脚本指出来", async () => {
  const analysis = await runJson(analyzeScript, [path.join(projectRoot, "data", "samples", "diels-alder-ts.log")]);
  assert.equal(analysis.metrics.gap, 3.34);

  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const dir = mkdtempSync(path.join(tmpdir(), "chemclaw-consistency-"));
  const metricsFile = path.join(dir, "analysis.json");
  writeFileSync(metricsFile, JSON.stringify(analysis), "utf8");

  try {
    const output = await runJson(gradeScript, [fixture("report-mismatch.txt"), "--metrics", metricsFile]);

    assert.equal(output.consistency.checked, true);
    const gap = output.consistency.mismatches.find((item) => item.field === "gap");
    assert.ok(gap, `应当指出 gap 不一致：${JSON.stringify(output.consistency)}`);
    assert.equal(gap.reportValue, 2.1);
    assert.equal(gap.computedValue, 3.34);
    assert.equal(gap.status, "mismatch");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("用例8b: 报告数值与计算结果一致时不得误报", async () => {
  const analysis = await runJson(analyzeScript, [path.join(projectRoot, "data", "samples", "diels-alder-ts.log")]);
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const dir = mkdtempSync(path.join(tmpdir(), "chemclaw-consistency-"));
  const metricsFile = path.join(dir, "analysis.json");
  writeFileSync(metricsFile, JSON.stringify(analysis), "utf8");

  try {
    // report-clean 写的是"能垒 18.6 kcal/mol"，与计算结果一致
    const output = await runJson(gradeScript, [fixture("report-clean.txt"), "--metrics", metricsFile]);
    assert.equal(output.consistency.checked, true);
    assert.deepEqual(output.consistency.mismatches, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("用例8c: 未传 --metrics 时明确声明未做核对", async () => {
  const output = await runJson(gradeScript, [fixture("report-clean.txt")]);
  assert.equal(output.consistency.checked, false);
  assert.match(output.consistency.reason, /未做数值一致性核对/);
});

test("用例9: 同一输入两次运行结果完全一致（可复现）", async () => {
  const first = await runJson(analyzeScript, [fixture("no-orbitals.log")]);
  const second = await runJson(analyzeScript, [fixture("no-orbitals.log")]);
  assert.deepEqual(first, second);

  const reportA = await runJson(gradeScript, [fixture("report-clean.txt")]);
  const reportB = await runJson(gradeScript, [fixture("report-clean.txt")]);
  assert.deepEqual(reportA, reportB);
});

test("用例10: --metrics 指向非 JSON 文件 → ok:false", async () => {
  const output = await runFailure(gradeScript, [fixture("report-clean.txt"), "--metrics", fixture("no-orbitals.log")]);
  assert.equal(output.ok, false);
  assert.match(output.error, /metrics/);
});
