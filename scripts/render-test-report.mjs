// 生成测试执行报告（HTML + PNG 截图）。
// 数据来源：真实跑 node --test 的 TAP 输出 + 真实跑技能脚本的 JSON，
// 表格里的"修复后"一列是当场跑出来的，不是手写结论。
//
// 用法：npm run report
// 依赖：本机装有 Chrome 或 Edge（只用来把 HTML 截成图）。

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_HTML = path.join(ROOT, "docs", "测试报告.html");
const OUT_PNG = path.join(ROOT, "docs", "测试报告.png");

const FILES = [
  ["test/skill-cases.test.js", "技能评估用例"],
  ["test/parsers.test.js", "解析器"],
  ["test/skills.test.js", "技能脚本"],
  ["test/schema.test.js", "LLM 契约"],
  ["test/orchestrator.test.js", "编排与模式"],
  ["test/openclaw-bridge.test.js", "OpenClaw 适配"],
  ["test/env.test.js", ".env 加载"],
  ["test/structure.test.js", "结构几何"],
];

const node = process.execPath;
const run = (args, opts = {}) => execFileSync(node, args, { cwd: ROOT, encoding: "utf8", ...opts });

function parseTap(stdout) {
  const lines = stdout.split(/\r?\n/);
  const tests = [];
  for (const line of lines) {
    const m = line.match(/^(ok|not ok) \d+ - (.*)$/);
    if (!m) continue;
    let name = m[2].trim();
    // TAP 会把 # 转义；去掉末尾的 " # SKIP" 之类
    name = name.replace(/ # (SKIP|TODO).*$/i, "");
    tests.push({ pass: m[1] === "ok", name });
  }
  return tests;
}

const started = Date.now();
const groups = [];
let pass = 0;
let fail = 0;
for (const [file, label] of FILES) {
  const out = run(["--test", "--test-reporter=tap", file]);
  const tests = parseTap(out);
  pass += tests.filter((t) => t.pass).length;
  fail += tests.filter((t) => !t.pass).length;
  groups.push({ file, label, tests });
}
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

const analyze = (fixture, extra = []) => JSON.parse(run(["skills/chemclaw-analyze/scripts/analyze.mjs", fixture, ...extra]));
const grade = (report, metrics) => JSON.parse(run(["skills/chemclaw-grade/scripts/grade.mjs", report, "--metrics", metrics]));
const writeMetrics = (file, data) => writeFileSync(file, JSON.stringify(data), "utf8");

const orca = analyze("test/fixtures/skills/orca-water.out");
const kj = analyze("test/fixtures/skills/barrier-kj.log");
const multi = analyze("test/fixtures/skills/alpha-multiline.log");
const xyz = analyze("test/fixtures/skills/coords-only.xyz");
const two = analyze("test/fixtures/skills/two-imaginary.log");
const sample = analyze("data/samples/diels-alder-ts.log");
const metricsFile = path.join(process.env.TEMP, "chemclaw-report-metrics.json");
writeMetrics(metricsFile, sample);
const mismatch = grade("test/fixtures/skills/report-mismatch.txt", metricsFile);
const basis = grade("test/fixtures/skills/report-basis.txt", metricsFile);

const gapItem = mismatch.consistency.mismatches.find((i) => i.field === "gap");
const basisGap = basis.consistency.items.find((i) => i.field === "gap");

const rows = [
  ["ORCA 水的 HOMO-LUMO gap", "0.5357（标成 eV）", `${orca.metrics.gap} eV`, "用例 4"],
  ["ORCA 水的偶极矩", "1.85（标成 Debye）", `${orca.metrics.dipole} D（1.85 au）`, "用例 4"],
  ["ORCA 水的振动模式数", "6（含 3 个零频）", `${orca.metrics.frequencyCount}`, "用例 4"],
  ["ORCA 正常终止", "false（识别不到）", `${orca.metrics.normalTermination}`, "用例 4"],
  ["能垒 78.0 kJ/mol", "78 kcal/mol", `${kj.metrics.barrier} kcal/mol`, "用例 9"],
  ["多行 Alpha occ 的 HOMO", "-12.24 eV（取错行）", `${multi.metrics.homo} eV`, "用例 9·复检"],
  ["纯坐标 XYZ 的格式", "ORCA", xyz.metrics.format, "用例 5"],
  ["纯坐标的频率数据", "“未检出虚频 → 极小点”", `frequencyCount=${xyz.metrics.frequencyCount}，不判断`, "用例 5"],
  ["双虚频的结论", "“符合一阶鞍点特征”", "“不是一阶鞍点”", "用例 2"],
  ["报告 2.10 vs 计算 3.34", "无核对（--metrics 空转）", `${gapItem.reportValue} vs ${gapItem.computedValue} → ${gapItem.status}`, "用例 8"],
  ["基组名混入取数", "3 → mismatch", `${basisGap.reportValue} → ${basisGap.status}`, "用例 8d"],
];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const now = new Date().toLocaleString("zh-CN", { hour12: false });

const total = pass + fail;
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #16181d;
    font: 15px/1.55 "Segoe UI", "Microsoft YaHei", sans-serif; }
  .page { width: 1240px; padding: 44px 52px 40px; }
  h1 { margin: 0 0 6px; font-size: 27px; letter-spacing: -0.2px; }
  .sub { color: #6b7280; font-size: 13px; }
  .sub b { color: #16181d; font-weight: 600; }
  .rule { height: 1px; background: #e5e7eb; margin: 22px 0; }
  .kpi { display: flex; gap: 12px; }
  .cell { flex: 1; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px 16px; }
  .cell .n { font-size: 32px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .cell .l { color: #6b7280; font-size: 12px; margin-top: 4px; }
  .cell.pass .n { color: #15803d; }
  .cell.fail .n { color: #b42318; }
  h2 { font-size: 15px; margin: 30px 0 12px; letter-spacing: 0.2px; }
  h2 span { color: #9ca3af; font-weight: 400; margin-left: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th { text-align: left; font-weight: 600; color: #4b5563; font-size: 12px;
    background: #f6f7f8; padding: 8px 12px; border-bottom: 1px solid #e5e7eb; }
  td { padding: 8px 12px; border-bottom: 1px solid #f0f1f3; vertical-align: top; }
  td.old { color: #9ca3af; }
  td.new { font-weight: 600; font-variant-numeric: tabular-nums; }
  td.use { color: #6b7280; font-size: 12px; white-space: nowrap; }
  .mono { font-family: "Cascadia Mono", Consolas, monospace; }
  .tests { column-count: 2; column-gap: 34px; }
  .grp { break-inside: avoid; margin-bottom: 14px; }
  .grp h3 { font-size: 12.5px; margin: 0 0 6px; color: #374151; font-weight: 600; }
  .grp h3 em { font-style: normal; color: #9ca3af; font-weight: 400; }
  .t { display: flex; gap: 8px; font-size: 13px; line-height: 1.8; }
  .t .m { width: 11px; flex: none; font-weight: 700; }
  .t.ok .m { color: #15803d; }
  .t.no .m { color: #b42318; }
  .t .n { color: #2f3338; }
  pre { margin: 0; background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 6px;
    padding: 12px 14px; font: 12px/1.6 "Cascadia Mono", Consolas, monospace; color: #24292f;
    white-space: pre-wrap; word-break: break-all; }
  .foot { margin-top: 26px; color: #6b7280; font-size: 12px; }
  .foot code { font-family: "Cascadia Mono", Consolas, monospace; color: #16181d; }
</style></head><body><div class="page">

  <h1>ChemClaw 技能评估 · 测试执行报告</h1>
  <div class="sub">提交 <b>${esc(commit)}</b>　·　${esc(now)}　·　Node ${process.version}　·　Windows</div>

  <div class="rule"></div>

  <div class="kpi">
    <div class="cell pass"><div class="n">${pass}</div><div class="l">通过</div></div>
    <div class="cell ${fail ? "fail" : ""}"><div class="n">${fail}</div><div class="l">失败</div></div>
    <div class="cell"><div class="n">${FILES.length}</div><div class="l">测试文件</div></div>
    <div class="cell"><div class="n">${elapsed}s</div><div class="l">总耗时（含子进程）</div></div>
  </div>

  <h2>修复前后对照 <span>右侧数值由当前代码实时跑出</span></h2>
  <table>
    <thead><tr><th style="width:30%">检查项</th><th style="width:26%">修复前</th><th style="width:30%">修复后（实测）</th><th style="width:14%">对应用例</th></tr></thead>
    <tbody>
      ${rows.map(([a, b, c, d]) => `<tr><td>${esc(a)}</td><td class="old mono">${esc(b)}</td><td class="new mono">${esc(c)}</td><td class="use">${esc(d)}</td></tr>`).join("\n      ")}
    </tbody>
  </table>

  <h2>用例清单 <span>${total} 项 / ${FILES.length} 个文件</span></h2>
  <div class="tests">
    ${groups.map((g) => `<div class="grp">
      <h3>${esc(g.label)} <em>${g.file} · ${g.tests.length}</em></h3>
      ${g.tests.map((t) => `<div class="t ${t.pass ? "ok" : "no"}"><span class="m">${t.pass ? "✓" : "✕"}</span><span class="n">${esc(t.name)}</span></div>`).join("\n      ")}
    </div>`).join("\n    ")}
  </div>

  <h2>一致性核对的实际输出 <span>grade.mjs --metrics report-mismatch.txt</span></h2>
  <pre>${esc(JSON.stringify({
    checked: mismatch.consistency.checked,
    items: mismatch.consistency.items.length,
    mismatches: mismatch.consistency.mismatches.map(({ field, reportValue, computedValue, unit, status }) => ({
      field, reportValue, computedValue, unit, status,
    })),
  }, null, 2))}</pre>

  <div class="foot">
    执行命令：<code>node --test test/*.test.js</code>　·　
    复核命令：<code>node skills/chemclaw-analyze/scripts/analyze.mjs &lt;file&gt;</code>　·　
    失败用例 0 项，本报告由真实测试输出生成，未使用手写结论。
  </div>

</div>
<script>
  // 截图前先量一次真实高度，避免手动猜 window-size 导致底部被切。
  window.addEventListener("load", () => {
    document.title = "H=" + Math.ceil(document.documentElement.scrollHeight);
  });
</script>
</body></html>`;

writeFileSync(OUT_HTML, html, "utf8");
console.log(`HTML: ${OUT_HTML}`);
console.log(`pass=${pass} fail=${fail} elapsed=${elapsed}s`);

// ===== 截图（可选）=====
const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const browser = BROWSERS.find((item) => existsSync(item));

if (browser) {
  const url = `file:///${OUT_HTML.replace(/\\/g, "/")}`;
  mkdirSync(path.dirname(OUT_PNG), { recursive: true });

  // 1) 先 dump 一次 DOM，读页面自报的高度
  const dumped = spawnSync(browser, [
    "--headless=new", "--disable-gpu", "--virtual-time-budget=3000",
    "--dump-dom", "--window-size=1240,1000", url,
  ], { encoding: "utf8" });
  const measured = Number((dumped.stdout || "").match(/H=(\d{3,5})/)?.[1] || 0);
  const height = measured ? measured + 24 : 2600;

  // 2) 按真实高度截图（2x，文字才够清楚）
  const result = spawnSync(browser, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars",
    "--force-device-scale-factor=2",
    `--window-size=1240,${height}`,
    `--screenshot=${OUT_PNG}`,
    url,
  ], { encoding: "utf8" });

  if (existsSync(OUT_PNG)) console.log(`PNG : ${OUT_PNG}（1240×${height} @2x）`);
  else console.warn("截图失败：", result.stderr || result.error?.message || "未知原因");
} else {
  console.warn("未找到 Chrome / Edge，仅生成 HTML。");
}
