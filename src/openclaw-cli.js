// ===== OpenClaw CLI 定位与调用 =====
//
// 为什么需要这一层：Windows 上 npm 全局安装只会生成 `openclaw.cmd`，
// 而 Node 20+ 出于安全考虑禁止 `execFile` 直接执行 .cmd/.bat：
//   execFile("openclaw")      → ENOENT（找不到扩展名匹配的可执行文件）
//   execFile("openclaw.cmd")  → 同步抛 spawn EINVAL
// 结果就是：CLI 明明装了，探活却报"未安装"，整条 OpenClaw 链路永远走不到。
//
// 这里不再碰 shell（避免中文/引号/换行被 cmd 解析），而是把 npm shim 里
// 真正执行的 JS 入口解析出来，用 `node <entry> ...` 调用 —— 参数原样传，
// 没有引号陷阱。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

/** 解析 npm 生成的 .cmd/.bat shim，取出其中的 JS 入口绝对路径。 */
export function parseShimEntry(shimPath) {
  let text;
  try {
    text = readFileSync(shimPath, "utf8");
  } catch {
    return null;
  }
  // 形如： "%_prog%"  "%dp0%\node_modules\openclaw\openclaw.mjs" %*
  const match = text.match(/%dp0%\\([^"%\r\n]+\.(?:mjs|cjs|js))/i);
  if (!match) return null;
  const entry = path.resolve(path.dirname(shimPath), match[1].replace(/\\/g, path.sep));
  return existsSync(entry) ? entry : null;
}

/** 在 PATH 里找可执行文件（Windows 依次尝试 .cmd/.bat/.exe）。 */
function findOnPath(name, extensions) {
  const dirs = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

let resolved;
/** 清空缓存（测试用）。 */
export function resetOpenClawCliCache() {
  resolved = undefined;
}

/**
 * 返回 { command, argsPrefix, display }。
 * 找不到入口时返回 null —— 由调用方给出人话原因。
 */
export function resolveOpenClawCli() {
  if (resolved !== undefined) return resolved;

  // 1) 显式指定：可以是 .exe，也可以是 .js/.mjs
  const explicit = process.env.CHEMCLAW_OPENCLAW_BIN;
  if (explicit) {
    if (/\.(?:mjs|cjs|js)$/i.test(explicit) && existsSync(explicit)) {
      resolved = { command: process.execPath, argsPrefix: [explicit], display: explicit, via: "env-js" };
    } else if (existsSync(explicit)) {
      resolved = { command: explicit, argsPrefix: [], display: explicit, via: "env-bin" };
    } else {
      resolved = null;
    }
    return resolved;
  }

  // 2) 非 Windows：直接调 PATH 里的 openclaw
  if (process.platform !== "win32") {
    const bin = findOnPath("openclaw", [""]);
    resolved = bin ? { command: bin, argsPrefix: [], display: bin, via: "posix" } : null;
    return resolved;
  }

  // 3) Windows：优先 .exe；否则解析 .cmd shim 的 JS 入口
  const exe = findOnPath("openclaw", [".exe"]);
  if (exe) {
    resolved = { command: exe, argsPrefix: [], display: exe, via: "win-exe" };
    return resolved;
  }

  const shim = findOnPath("openclaw", [".cmd", ".bat"]);
  if (shim) {
    const entry = parseShimEntry(shim);
    if (entry) {
      resolved = { command: process.execPath, argsPrefix: [entry], display: `${shim} → ${entry}`, via: "win-shim" };
      return resolved;
    }
    resolved = null;
    return resolved;
  }

  resolved = null;
  return resolved;
}

/**
 * 执行 openclaw 子命令。
 * 不走 shell：参数里的中文、引号、换行都会原样传过去。
 */
export async function execOpenClaw(args, { timeout, maxBuffer = 5 * 1024 * 1024 } = {}) {
  const cli = resolveOpenClawCli();
  if (!cli) {
    const error = new Error("找不到 openclaw 可执行入口");
    error.code = "openclaw-not-found";
    throw error;
  }
  return execFileAsync(cli.command, [...cli.argsPrefix, ...args], {
    timeout,
    maxBuffer,
    windowsHide: true,
    env: { ...process.env },
  });
}
