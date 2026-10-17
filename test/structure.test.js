// 共享结构模块的测试。
//
// 这个模块同时给浏览器（3D 卡片的 PDB、无 WebGL 时的 2D 投影）和 Node
// （服务端生成 pdbData）用。成键判据一改，两侧同时变 —— 这正是把它抽出来
// 的目的，所以这里锁住"苯有 12 根键"这类化学事实。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  parseXYZAtoms, parsePdbAtoms, computeBonds, toPDB, projectAtoms2D,
  summarizeStructure, COVALENT_RADII,
} from "../public/shared/structure.js";

const benzene = readFileSync(new URL("../data/samples/benzene.xyz", import.meta.url), "utf8");

test("XYZ: 跳过原子数/标题两行", () => {
  const atoms = parseXYZAtoms(benzene);
  assert.equal(atoms.length, 12);
  assert.deepEqual(atoms[0], { element: "C", x: 1.396, y: 0, z: 0 });
});

test("XYZ: 无头部时也能解析纯坐标行", () => {
  const atoms = parseXYZAtoms("C 0 0 0\nH 1.09 0 0\n");
  assert.equal(atoms.length, 2);
});

test("XYZ: 非法行被丢弃而不是产生 NaN 原子", () => {
  const atoms = parseXYZAtoms("C 0 0 0\n这是一个标题\nH a b c\nO 1 1 1\n");
  assert.deepEqual(atoms.map((a) => a.element), ["C", "O"]);
  assert.ok(atoms.every((a) => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z)));
});

test("成键: 苯 = 6 根 C–C + 6 根 C–H", () => {
  const atoms = parseXYZAtoms(benzene);
  const bonds = computeBonds(atoms);
  assert.equal(bonds.length, 12);

  const byElement = bonds.map(([i, j]) => `${atoms[i].element}-${atoms[j].element}`);
  assert.equal(byElement.filter((pair) => pair === "C-C").length, 6);
  assert.equal(byElement.filter((pair) => pair === "C-H").length, 6);
});

test("成键: 水分子 2 根键，氢原子间不成键", () => {
  const atoms = parseXYZAtoms(
    "3\nwater\nO 0.000 0.000 0.117\nH 0.000 0.757 -0.468\nH 0.000 -0.757 -0.468",
  );
  assert.deepEqual(computeBonds(atoms), [[0, 1], [0, 2]]);
});

test("成键: 容差可调，用于刻意拉近距离", () => {
  const atoms = [
    { element: "C", x: 0, y: 0, z: 0 },
    { element: "C", x: 2.0, y: 0, z: 0 },
  ];
  assert.equal(computeBonds(atoms).length, 0); // 2.0 Å 对 C–C 太长
  assert.equal(computeBonds(atoms, { tolerance: 2.0 }).length, 1);
});

test("PDB: 12 个 ATOM + CONECT 双向", () => {
  const pdb = toPDB(benzene, "benzene");
  const lines = pdb.split("\n");

  assert.equal(lines.filter((line) => line.startsWith("ATOM")).length, 12);
  assert.ok(lines.includes("END"));

  // 每根键在 CONECT 里出现两次（两端各一次）
  const partners = lines
    .filter((line) => line.startsWith("CONECT"))
    .reduce((sum, line) => sum + (line.length - 11) / 5, 0);
  assert.equal(partners, 24);

  // 元素列必须右对齐到 77-78 列，Mol* 才会认出元素
  const firstAtom = lines.find((line) => line.startsWith("ATOM"));
  assert.equal(firstAtom.slice(76, 78), " C");
});

test("PDB: 解析回来原子数一致", () => {
  const atoms = parsePdbAtoms(toPDB(benzene));
  assert.equal(atoms.length, 12);
  assert.equal(atoms[0].element, "C");
});

test("PDB: 无坐标时返回空串而不是半截文件", () => {
  assert.equal(toPDB("这里没有坐标"), "");
});

test("2D 投影: 坐标落在画布内", () => {
  const { width, height, projected } = projectAtoms2D(parseXYZAtoms(benzene));
  assert.equal(width, 520);
  assert.equal(height, 360);
  assert.equal(projected.length, 12);
  for (const atom of projected) {
    assert.ok(atom.x >= 0 && atom.x <= width, `x=${atom.x}`);
    assert.ok(atom.y >= 0 && atom.y <= height, `y=${atom.y}`);
    assert.ok(atom.r > 0);
  }
});

test("2D 投影: 空原子数组不炸", () => {
  assert.deepEqual(projectAtoms2D([]).projected, []);
});

test("摘要: 原子组成", () => {
  const summary = summarizeStructure(parseXYZAtoms(benzene));
  assert.equal(summary.atomCount, 12);
  assert.equal(summary.bondCount, 12);
  assert.deepEqual(summary.composition, { C: 6, H: 6 });
});

test("元素表覆盖常见重原子（防止常量回退到碳）", () => {
  for (const element of ["H", "C", "N", "O", "F", "S", "P", "Cl", "Br", "I", "Si", "B"]) {
    assert.ok(COVALENT_RADII[element] > 0, `缺少 ${element} 的共价半径`);
  }
});
