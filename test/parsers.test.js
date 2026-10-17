// 解析器回归测试。
//
// 这些正则撑着整个教学结论（虚频、能垒、gap 都是从文本里"读"出来的），
// 但仓库之前一个测试都没有 —— 改一行正则就可能把虚频解析成 0，而界面照样
// 显示"未检出"。这里用仓库自带的样例文件锁住关键字段。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  parseGaussian, parseORCA, parseAny, detectCalcType, buildFileDetails,
  extractXYZFrames,
} from "../src/parsers.js";

const gaussianLog = readFileSync(new URL("../data/samples/diels-alder-ts.log", import.meta.url), "utf8");
const benzeneXYZ = readFileSync(new URL("../data/samples/benzene.xyz", import.meta.url), "utf8");

test("Gaussian: 关键指标全部提取到", () => {
  const parsed = parseGaussian(gaussianLog);

  assert.equal(parsed.type, "gaussian");
  assert.equal(parsed.charge, 0);
  assert.equal(parsed.multiplicity, 1);

  // SCF 能量取最后一个能量点
  assert.equal(parsed.energies.length, 1);
  assert.ok(Math.abs(parsed.scfEnergy - -423.119281416) < 1e-6);

  // 虚频是过渡态判据，必须保留负号
  assert.deepEqual(parsed.imaginaryFrequencies, [-431.5678]);
  assert.equal(parsed.frequencies.length, 3);

  // 显式 HOMO/LUMO 标注优先于 Alpha occ/virt 列表
  assert.equal(parsed.homo, -5.82);
  assert.equal(parsed.lumo, -2.48);
  assert.equal(parsed.gap, 3.34);

  assert.equal(parsed.barrier, 18.6);
  assert.equal(parsed.normalTermination, true);
});

test("Gaussian: 热化学修正", () => {
  const { thermo } = parseGaussian(gaussianLog);
  // zpe 是 "Zero-point correction"，焓/自由能取的是 "Sum of electronic and
  // thermal ..." 的绝对能量 —— 界面上显示的也是这两个总量。
  assert.equal(thermo.zpe, 0.128456);
  assert.equal(thermo.enthalpy, -422.983769);
  assert.equal(thermo.gibbs, -423.020516);
});

test("Gaussian: 方法 / 基组 / 计算类型", () => {
  const parsed = parseGaussian(gaussianLog);
  assert.equal(parsed.method, "b3lyp-d3bj");
  assert.equal(parsed.basis, "def2-svp");
  assert.match(parsed.route, /^opt=\(ts,calcfc,noeigentest\)/);
  assert.equal(detectCalcType(gaussianLog), "结构优化 + 频率分析");
});

test("Gaussian: 文件摘要", () => {
  const details = buildFileDetails(gaussianLog, parseGaussian(gaussianLog));
  assert.equal(details.format, "gaussian");
  assert.equal(details.lineCount, 51); // 含末尾换行
  assert.equal(details.energyPointCount, 1);
  assert.equal(details.frequencyCount, 3);
  assert.equal(details.normalTermination, true);
});

test("XYZ: 标准文件被视为单帧结构", () => {
  const frames = extractXYZFrames(benzeneXYZ);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].atomCount, 12);
  assert.match(frames[0].xyz, /^12\n/);
});

test("ORCA: 单点能与坐标", () => {
  const orcaLog = [
    "ORCA 5.0.3",
    "FINAL SINGLE POINT ENERGY      -76.412345678",
    "E(HOMO) = -0.4123",
    "E(LUMO) = 0.1234",
    "CARTESIAN COORDINATES (ANGSTROEM)",
    "---------------------------------",
    "O      0.000000    0.000000    0.117000",
    "H      0.000000    0.757000   -0.468000",
    "H      0.000000   -0.757000   -0.468000",
    "",
  ].join("\n");

  const parsed = parseORCA(orcaLog);
  assert.equal(parsed.finalEnergy, -76.412345678);
  // E(HOMO)/E(LUMO) 在 ORCA 里是 Hartree，输出统一换成 eV：
  // -0.4123 Ha ≈ -11.2193 eV，0.1234 Ha ≈ 3.3579 eV
  assert.ok(Math.abs(parsed.homo - -11.2193) < 1e-4);
  assert.ok(Math.abs(parsed.lumo - 3.3579) < 1e-4);
  assert.ok(Math.abs(parsed.gap - 14.5772) < 1e-4);
  assert.equal(parsed.structureFrames.length, 1);
  assert.equal(parsed.structureFrames[0].atomCount, 3);
});

test("parseAny: 空输入不抛异常", () => {
  const parsed = parseAny("");
  assert.ok(parsed);
  assert.deepEqual(parsed.frequencies, []);
  assert.equal(detectCalcType(""), "通用计算化学输出");
});

test("parseAny: 无标志位时也不会把 Gaussian 判成 ORCA", () => {
  const parsed = parseAny(gaussianLog);
  assert.equal(parsed.type, "gaussian");
});

test("Gaussian: 没有 HOMO/LUMO 时必须是 undefined，不是 NaN", () => {
  // 回归测试：parseFloat(undefined) === NaN，而 NaN !== undefined，
  // 旧实现的 `=== undefined` 兜底永不触发，最终把 "gap = NaN eV" 送进结论句。
  const log = [
    "#p opt freq b3lyp/6-31g(d)",
    "",
    "Title",
    "",
    "0 1",
    "SCF Done:  E(RB3LYP) =  -40.5143712     A.U. after    8 cycles",
    "Normal termination of Gaussian 16",
  ].join("\n");

  const parsed = parseGaussian(log);
  assert.equal(parsed.homo, undefined);
  assert.equal(parsed.lumo, undefined);
  assert.equal(parsed.gap, undefined);
  assert.ok(!Number.isNaN(parsed.homo));
});

test("Gaussian: Alpha occ/virt 列表能补上显式标注缺失的轨道能量", () => {
  // 真实 log 里这组本征值的单位是 Hartree（-0.5 量级），不是 eV。
  // 解析后统一换成 eV，否则界面上会把 0.5 Ha 讲成 0.5 eV 的"小 gap"。
  const log = [
    "#p sp b3lyp/6-31g(d)",
    " Alpha  occ. eigenvalues --  -19.14  -10.22   -0.35",
    " Alpha virt. eigenvalues --    0.12   2.35",
  ].join("\n");

  const parsed = parseGaussian(log);
  assert.ok(Math.abs(parsed.homo - -9.5240) < 1e-4, `homo=${parsed.homo}`);
  assert.ok(Math.abs(parsed.lumo - 3.2654) < 1e-4, `lumo=${parsed.lumo}`);
  assert.ok(Math.abs(parsed.gap - 12.7894) < 1e-4, `gap=${parsed.gap}`);
  assert.equal(parsed.orbitalUnit, "Hartree→eV");
});

test("纯坐标文件不会被兜底成 ORCA", () => {
  const xyz = "3\nwater\nO 0.0 0.0 0.117\nH 0.0 0.757 -0.468\nH 0.0 -0.757 -0.468\n";
  const parsed = parseAny(xyz);
  assert.equal(parsed.type, "xyz");
  assert.equal(parsed.scfEnergy, null);
  assert.equal(parsed.frequencies.length, 0);
  assert.equal(detectCalcType(xyz), "仅结构（未包含计算结果）");
});

test("ORCA: TERMINATED NORMALLY 被识别为正常结束，零频不计入振动模式", () => {
  const log = [
    "ORCA 5.0.4",
    "FINAL SINGLE POINT ENERGY      -76.412345678",
    "Total Dipole Moment    :        1.85000000 au",
    "VIBRATIONAL FREQUENCIES",
    "   0:       0.00 cm**-1",
    "   1:       0.00 cm**-1",
    "   2:       0.00 cm**-1",
    "   3:    1638.42 cm**-1",
    "****ORCA TERMINATED NORMALLY****",
  ].join("\n");

  const parsed = parseORCA(log);
  assert.equal(parsed.normalTermination, true);
  assert.deepEqual(parsed.frequencies, [1638.42]);
  assert.ok(Math.abs(parsed.dipole - 4.7022) < 1e-4, `dipole=${parsed.dipole}`);
});
