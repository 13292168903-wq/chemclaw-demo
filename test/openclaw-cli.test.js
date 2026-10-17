// OpenClaw CLI 定位的测试。
//
// 背景：Windows 上 npm 只生成 openclaw.cmd，而 Node 20+ 禁止 execFile 执行
// .cmd（同步抛 spawn EINVAL）。所以 status 里那句"未安装 openclaw CLI"
// 其实是误判。这一层负责把 shim 背后的 JS 入口找出来，用 node 直接跑。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseShimEntry, resolveOpenClawCli, resetOpenClawCliCache } from "../src/openclaw-cli.js";

function makeShim({ entry = "node_modules/openclaw/openclaw.mjs", createEntry = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "chemclaw-shim-"));
  const shim = path.join(dir, "openclaw.cmd");
  writeFileSync(shim, [
    "@ECHO off",
    "SETLOCAL",
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ") ELSE (",
    "  SET \"_prog=node\"",
    ")",
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${entry}" %*`,
  ].join("\r\n"), "utf8");

  if (createEntry) {
    const target = path.join(dir, entry);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "// fake cli\n", "utf8");
  }
  return { dir, shim, entryPath: path.join(dir, entry) };
}

test("shim 解析: 从 npm 生成的 .cmd 里取出 JS 入口", (t) => {
  const { dir, shim, entryPath } = makeShim();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.equal(parseShimEntry(shim), entryPath);
});

test("shim 解析: 入口文件不存在时返回 null（不返回不存在的路径）", (t) => {
  const { dir, shim } = makeShim({ createEntry: false });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.equal(parseShimEntry(shim), null);
});

test("shim 解析: 普通批处理文件返回 null", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "chemclaw-shim-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "plain.cmd");
  writeFileSync(file, "@echo off\r\nnode app.js\r\n", "utf8");

  assert.equal(parseShimEntry(file), null);
});

test("入口覆盖: CHEMCLAW_OPENCLAW_BIN 指向 .mjs 时用 node 执行", (t) => {
  const { dir, entryPath } = makeShim();
  t.after(() => {
    delete process.env.CHEMCLAW_OPENCLAW_BIN;
    resetOpenClawCliCache();
    rmSync(dir, { recursive: true, force: true });
  });

  process.env.CHEMCLAW_OPENCLAW_BIN = entryPath;
  resetOpenClawCliCache();

  const cli = resolveOpenClawCli();
  assert.equal(cli.via, "env-js");
  assert.equal(cli.command, process.execPath);
  assert.deepEqual(cli.argsPrefix, [entryPath]);
});

test("入口覆盖: 路径不存在时返回 null，而不是继续猜", (t) => {
  t.after(() => {
    delete process.env.CHEMCLAW_OPENCLAW_BIN;
    resetOpenClawCliCache();
  });

  process.env.CHEMCLAW_OPENCLAW_BIN = path.join(tmpdir(), "definitely-not-here", "openclaw.mjs");
  resetOpenClawCliCache();

  assert.equal(resolveOpenClawCli(), null);
});
