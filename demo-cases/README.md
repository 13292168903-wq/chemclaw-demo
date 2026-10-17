# 演示用例

6 份可以直接喂给 ChemClaw 的输入，覆盖「完整计算输出 / 另一软件 / 只有坐标 / 报告批改 / 故意写错 / 大文件」。
每一份都在本机跑过，下面的"预期结果"是实测值，不是估计。

> ⚠️ 01 和 06 的几何与能量是按真实格式合成的连续数值，用于演示解析与交互，
> **不是真实计算结果**，不要引用到实验报告里。02/03 同理。

## 文件

| 文件 | 规模 | 内容 | 主要看什么 |
|---|---|---|---|
| `01-gaussian-ts-full.log` | 611 行 / 37 KB | Gaussian 过渡态：24 步优化 + 33 个频率（含 1 个虚频）+ 热化学 + 多行 Alpha occ | 主用例：能垒、虚频、gap、热化学、优化轨迹、3D 结构都对 |
| `02-orca-opt-freq.out` | 62 行 / 1.7 KB | ORCA 5.0.4：6 个能量点 + 零频 + E(HOMO)/E(LUMO) + 偶极矩(au) | 单位换算：Hartree→eV、au→Debye、零频不计入模式数 |
| `03-structure-only.xyz` | 13 行 | 只有坐标，没有任何计算结果 | 应显示「仅结构（C6H6），未包含计算结果」，不出训练题 |
| `04-report-good.md` | 21 行 | 学生报告，数字与 01 一致 | 批改 74 分；一致性核对 3 项全 match |
| `05-report-mismatch.md` | 12 行 | 同一份报告，gap 写成 3.10 eV、能垒写成 25.1 kcal/mol | 分数仍有 61，但一致性核对报 **2 处 mismatch**（这正是要演示的坑） |
| `06-long-optimization.log` | 12620 行 / 797 KB | 601 步几何优化 | 前后端耗时、优化轨迹回放、滚动性能 |

## 预期结果（01 的实测值）

```
SCF 能量        -423.119012345 Hartree
HOMO / LUMO     -6.8028 / 0.5442 eV
gap             7.347 eV
虚频            -431.5678 cm⁻¹（频率共 33 个）
能垒            18.6 kcal/mol
ZPE             0.161234 Hartree
Gibbs 自由能    -422.990078 Hartree
结构帧          25 帧 / 12 原子
```

## 怎么跑

### 1. 网页（最直观）

```bash
npm start          # http://localhost:5173
```

把文件拖进左侧输入区（或复制内容粘贴），点「开始分析」。
第一次跑 OpenClaw 分支大约 50 秒，之后会快一些。

### 2. 直接打接口（看 JSON）

> 01 有 37 KB，**不能**直接塞进命令行参数——Windows 的 Git Bash 会报
> `Argument list too long`。先把请求体写成文件，再 `--data-binary @文件`。

```bash
node -e 'const fs=require("fs");fs.writeFileSync(process.env.TEMP+"/body.json",
  JSON.stringify({datasetName:"01-gaussian-ts-full.log",
    datasetText:fs.readFileSync("demo-cases/01-gaussian-ts-full.log","utf8"),moleculeText:""}))'

curl -s http://localhost:5173/api/analyze \
  -H 'content-type: application/json' \
  --data-binary @"$TEMP/body.json" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log(r.mode,r.metrics)})"
```

批改（报告只有 1 KB，可以直接内联）：

```bash
curl -s http://localhost:5173/api/grade \
  -H 'content-type: application/json' \
  --data "$(node -e 'const fs=require("fs");console.log(JSON.stringify({studentReport:fs.readFileSync("demo-cases/05-report-mismatch.md","utf8"),analysisContext:{}}))')"
```

### 3. 技能命令行（不经网页，最快）

```bash
node skills/chemclaw-analyze/scripts/analyze.mjs demo-cases/01-gaussian-ts-full.log
node skills/chemclaw-analyze/scripts/analyze.mjs demo-cases/01-gaussian-ts-full.log > /tmp/ts.json

node skills/chemclaw-grade/scripts/grade.mjs demo-cases/04-report-good.md --metrics /tmp/ts.json
node skills/chemclaw-grade/scripts/grade.mjs demo-cases/05-report-mismatch.md --metrics /tmp/ts.json
```

## 建议的观察顺序

1. **01 → 看结论**：虚频只有 1 个，是否说成"过渡态"而不是"结果不可信"；`converged: true` 时不应再提示未收敛。
2. **02 → 看单位**：gap 必须是 **14.5772 eV**（不是 0.5357），偶极矩 **4.7022 D**（不是 1.85），频率 **3** 个（不是 6）。
3. **03 → 看边界**：`format` 应是 XYZ，不能出现 ORCA；不能生成"为什么过渡态只需要一个虚频"这类无关题目。
4. **04 / 05 → 看批改的诚实度**：05 的分数只比 04 低 13 分，但一致性核对会明确指出「报告 3.10 vs 计算 7.347」「报告 25.1 vs 计算 18.6」。
   如果只看分数，05 会被误认为"基本合格"——这就是为什么批改不能只看关键词。
5. **06 → 看性能**：601 帧解析约 0.5 s；网页端主要耗时在 OpenClaw 叙述（~50 s），不在解析。
