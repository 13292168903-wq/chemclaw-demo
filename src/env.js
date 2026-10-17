// ===== .env 加载 =====
//
// 之前的 npm start 是 `export $(grep -v '^#' .env | xargs) && node server.js`：
// 只有 bash 能跑，Windows / PowerShell / cmd 全部失败，而 .env 缺失时
// `--env-file=` 又会直接报错。这里用十几行自己解析，跨平台、无依赖、
// 文件不存在就安静跳过 —— 于是 `npm start` 在任何平台都是同一条命令。

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * 读取 <项目根>/.env 并写入 process.env。
 * 已存在的真实环境变量优先（部署平台注入的值不会被文件覆盖）。
 * @returns {string[]} 实际加载的键名，便于启动日志说明来源
 */
export function loadEnvFile(file = path.join(projectRoot, ".env")) {
  if (!existsSync(file)) return [];
  const loaded = [];

  // 去掉 UTF-8 BOM：Windows 记事本保存的 .env 会带 \uFEFF，
  // 不去掉的话第一行键名变成 "\uFEFFDEEPSEEK_API_KEY"，正则校验失败后被
  // 静默跳过 —— 现象是"配了 key 却一直走本地演示模式"，而且没有任何报错。
  const raw = readFileSync(file, "utf8").replace(/^\uFEFF/, "");

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    // 去掉成对的引号，保留值里的 # 与空格
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded.push(key);
    }
  }

  return loaded;
}
