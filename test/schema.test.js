// LLM 输出契约的测试。
//
// 这里锁住的是"模型返回什么形状都不会把下游搞崩"：字符串数值、缺字段、
// 数组写成对象、NaN 字符串。缺了这层，一个 "-423.1" 就能让
// metrics.thermo.zpe.toFixed() 抛 TypeError。

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  toNumber, normalizeMetrics, normalizeExplanations, normalizeTeaching,
  normalizeGrading, normalizeRubric,
} from "../src/schema.js";

test("toNumber: 字符串数值被接受，垃圾值返回 undefined", () => {
  assert.equal(toNumber("-423.1"), -423.1);
  assert.equal(toNumber(" -0.72 "), -0.72);
  assert.equal(toNumber(0), 0);
  assert.equal(toNumber(""), undefined);
  assert.equal(toNumber("NaN"), undefined);
  assert.equal(toNumber("未知"), undefined);
  assert.equal(toNumber(null), undefined);
  assert.equal(toNumber(true), undefined);
  assert.equal(toNumber([1]), undefined);
  assert.equal(toNumber(NaN), undefined);
});

test("normalizeMetrics: 字符串数值被转成 number", () => {
  const metrics = normalizeMetrics({ scfEnergy: "-76.4089123", homo: "-5.82", lumo: "-2.48", dipole: "3.21" });
  assert.equal(metrics.scfEnergy, -76.4089123);
  assert.equal(metrics.homo, -5.82);
  assert.equal(metrics.gap, 3.34);
  assert.equal(metrics.dipole, 3.21);
});

test("normalizeMetrics: 只有 HOMO 没有 LUMO 时不给 gap", () => {
  const metrics = normalizeMetrics({ homo: -5.82 });
  assert.equal(metrics.gap, undefined);
});

test("normalizeMetrics: 非法/缺失字段不产生 NaN", () => {
  const metrics = normalizeMetrics({ frequencies: "not-an-array", imaginaryFrequencies: null, thermo: { zpe: "abc" } });
  assert.deepEqual(metrics.frequencies, []);
  assert.deepEqual(metrics.imaginaryFrequencies, []);
  assert.deepEqual(metrics.thermo, {});
  assert.equal(metrics.scfEnergy, undefined);
});

test("normalizeMetrics: 数组里的非数值项被丢弃，负虚频保留", () => {
  const metrics = normalizeMetrics({ frequencies: [43.2, "abc", -431.6, null], imaginaryFrequencies: [-431.6] });
  assert.deepEqual(metrics.frequencies, [43.2, -431.6]);
  assert.deepEqual(metrics.imaginaryFrequencies, [-431.6]);
});

test("normalizeMetrics: 不是对象时给出空契约而不是抛异常", () => {
  for (const input of [null, undefined, "text", 42, []]) {
    const metrics = normalizeMetrics(input);
    assert.deepEqual(metrics.frequencies, []);
    assert.equal(metrics.scfEnergy, undefined);
  }
});

test("normalizeExplanations: 空解释被丢掉，字段缺省有兜底", () => {
  const list = normalizeExplanations([
    { topic: "能垒", detail: "18.6 kcal/mol 属于室温可讨论区间。" },
    { topic: "空的", detail: "" },
    "不是对象",
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].level, "概念");
  assert.equal(list[0].teachingHint, "");
});

test("normalizeTeaching: quiz 与 learningPath 形状被固定", () => {
  const teaching = normalizeTeaching({
    learningPath: "第一步：看虚频",
    quiz: [{ question: "为什么只有一个虚频？", type: "概念题" }, { question: "" }],
  });
  assert.deepEqual(teaching.learningPath, []); // 字符串不是数组 → 空，不做危险猜测
  assert.equal(teaching.quiz.length, 1);
  assert.equal(teaching.quiz[0].rubric, "");
});

test("normalizeGrading: 分数缺失返回 null，便于调用方降级", () => {
  assert.equal(normalizeGrading({ score: "88" }).score, 88);
  assert.equal(normalizeGrading({ score: "优秀" }).score, null);
  assert.equal(normalizeGrading({}).score, null);
});

test("normalizeRubric: 缺维度的条目被丢弃", () => {
  const rubric = normalizeRubric([{ dimension: "数据解析", weight: "25", score: "20" }, { comment: "没有维度名" }]);
  assert.equal(rubric.length, 1);
  assert.equal(rubric[0].weight, 25);
  assert.equal(rubric[0].score, 20);
});
