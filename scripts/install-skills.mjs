#!/usr/bin/env node
// 把仓库里的 skills/ 安装到 OpenClaw 技能目录。
//
// 之前 README 只说"把 chemclaw-analyze / chemclaw-grade 放入
// ~/.openclaw/workspace/skills/"，但仓库里没有这两个技能，也没人告诉你要
// 拷贝哪几个文件 —— 换个机器就无法复现。这个脚本负责两件事：
//   1. 复制技能目录（SKILL.md + scripts/）
//   2. 写入 .chemclaw-root，让技能脚本能找到仓库源码（解析器只有一份）

import { cp, mkdir, readdir, writeFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceDir = path.join(projectRoot, "skills");
const targetRoot = process.env.CHEMCLAW_SKILLS_DIR
  || path.join(os.homedir(), ".openclaw", "workspace", "skills");

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

async function exists(target) {
  return stat(target).then(() => true, () => false);
}

async function installSkill(name) {
  const from = path.join(sourceDir, name);
  const to = path.join(targetRoot, name);

  if (await exists(to)) {
    // 覆盖安装会丢掉用户本地改过的内容，默认拒绝。
    if (!force) {
      console.log(`跳过 ${name}：目标已存在（加 --force 覆盖）  ${to}`);
      return "skipped";
    }
    if (!dryRun) await rm(to, { recursive: true, force: true });
  }

  console.log(`${dryRun ? "[dry-run] " : ""}安装 ${name} → ${to}`);
  if (dryRun) return "installed";

  await cp(from, to, { recursive: true });
  // 技能脚本靠这个文件回到仓库取 src/parsers.js 等实现。
  await writeFile(path.join(to, "scripts", ".chemclaw-root"), `${projectRoot}\n`, "utf8");
  return "installed";
}

const entries = await readdir(sourceDir, { withFileTypes: true });
const skills = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("chemclaw-"));

if (!skills.length) {
  console.error(`skills/ 下没有可安装的技能：${sourceDir}`);
  process.exit(1);
}

if (!dryRun) await mkdir(targetRoot, { recursive: true });

let installed = 0;
for (const skill of skills) {
  if (await installSkill(skill.name) === "installed") installed += 1;
}

console.log(`\n完成：${installed}/${skills.length} 个技能已就绪（目标目录 ${targetRoot}）`);
if (installed) {
  console.log("重启 OpenClaw 后，/api/status 的 skills 字段应能看到这些技能。");
}
