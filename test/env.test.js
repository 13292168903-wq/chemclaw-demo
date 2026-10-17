// .env 加载的测试。
//
// 目的很具体：Windows 上 `npm start` 曾经是 bash-only 的一行命令，
// 现在改成进程内解析，就必须证明它对空格、引号、注释和缺失文件都稳定。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadEnvFile } from "../src/env.js";

function withTempEnv(content, run) {
  const dir = mkdtempSync(path.join(tmpdir(), "chemclaw-env-"));
  const file = path.join(dir, ".env");
  writeFileSync(file, content, "utf8");
  try {
    return run(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("读取键值、跳过注释与空行", () => {
  withTempEnv("# 注释\n\nCHEMCLAW_T_A=1\n  CHEMCLAW_T_B = two \n", (file) => {
    const loaded = loadEnvFile(file);
    assert.deepEqual(loaded.sort(), ["CHEMCLAW_T_A", "CHEMCLAW_T_B"]);
    assert.equal(process.env.CHEMCLAW_T_A, "1");
    assert.equal(process.env.CHEMCLAW_T_B, "two");
    delete process.env.CHEMCLAW_T_A;
    delete process.env.CHEMCLAW_T_B;
  });
});

test("去掉成对引号，保留值里的空格与 #", () => {
  withTempEnv('CHEMCLAW_T_QUOTED="a b #c"\nCHEMCLAW_T_SINGLE=\'x=y\'\n', (file) => {
    loadEnvFile(file);
    assert.equal(process.env.CHEMCLAW_T_QUOTED, "a b #c");
    assert.equal(process.env.CHEMCLAW_T_SINGLE, "x=y");
    delete process.env.CHEMCLAW_T_QUOTED;
    delete process.env.CHEMCLAW_T_SINGLE;
  });
});

test("已存在的环境变量优先（部署平台注入不被文件覆盖）", () => {
  process.env.CHEMCLAW_T_EXISTING = "from-platform";
  withTempEnv("CHEMCLAW_T_EXISTING=from-file\n", (file) => {
    loadEnvFile(file);
    assert.equal(process.env.CHEMCLAW_T_EXISTING, "from-platform");
    delete process.env.CHEMCLAW_T_EXISTING;
  });
});

test("文件不存在时安静返回空数组", () => {
  assert.deepEqual(loadEnvFile(path.join(tmpdir(), "chemclaw-does-not-exist.env")), []);
});

test("非法键名被忽略，不污染 process.env", () => {
  withTempEnv("BAD-KEY=1\n1BAD=2\nGOOD_KEY_1=ok\n", (file) => {
    const loaded = loadEnvFile(file);
    assert.deepEqual(loaded, ["GOOD_KEY_1"]);
    assert.equal(process.env["BAD-KEY"], undefined);
    assert.equal(process.env["1BAD"], undefined);
    delete process.env.GOOD_KEY_1;
  });
});

test("带 UTF-8 BOM 的 .env 也能正常读取（Windows 记事本）", () => {
  // 记事本保存的 .env 首字节是 \uFEFF；不去掉的话第一行键名变成
  // "\uFEFFDEEPSEEK_API_KEY"，校验失败后被静默跳过 —— 现象是
  // "配了 key 却一直走本地演示模式"。
  withTempEnv("\uFEFFCHEMCLAW_T_BOM=sk-test\nCHEMCLAW_T_PLAIN=2\n", (file) => {
    const loaded = loadEnvFile(file);
    assert.deepEqual(loaded.sort(), ["CHEMCLAW_T_BOM", "CHEMCLAW_T_PLAIN"]);
    assert.equal(process.env.CHEMCLAW_T_BOM, "sk-test");
    delete process.env.CHEMCLAW_T_BOM;
    delete process.env.CHEMCLAW_T_PLAIN;
  });
});
