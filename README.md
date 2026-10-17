# ChemClaw — 面向计算化学科研训练的多智能体教学助教

将 Gaussian / ORCA 计算结果转化为可解释、可出题、可批改的教学闭环。支持 OpenClaw 多智能体框架和本地模式双轨运行。

**参赛项目**：郑州大学第一届"四创"大赛 / E3 教育创新应用赛道

## 核心功能

- **计算数据智能分析** — 上传 Gaussian/ORCA 输出文件，AI 自动提取能量、HOMO-LUMO、虚频等指标，生成化学解释和教学建议
- **AI 解读为主线** — 3D 分子结构 + 能量曲线作为可视化佐证，关键发现突出展示，完整解读可折叠
- **实验报告批改** — 四维度 Rubric 评分（数据解析 25%、概念解释 30%、科研设计 25%、报告表达 20%）
- **3D 分子可视化** — Mol* 渲染器，支持结构帧切换、优化轨迹播放、振动模式频谱
- **双模式运行** — OpenClaw（Qwen3_6 多智能体）优先，自动降级到本地规则引擎

## 页面布局

```
┌──────────┬────────────────────────────────┐
│ 输入面板  │           科研工作台            │
│          │                                │
│ 拖拽上传  │  Hero（结论 + 状态 + 操作）      │
│ 粘贴/坐标 │  结论条（未收敛 / 异常终止）      │
│ [分析]    │  Tags（方法/基组/收敛状态）      │
│          │  3D 结构 ←→ 能量曲线            │
│ 学生报告  │  ─────────────────────         │
│ [批改]    │  AI 解读（直接展开）             │
│          │  ▸ 计算详情与文件信息            │
│          │  ▸ 优化轨迹与振动光谱            │
│          │  ▸ 学习目标与训练                │
└──────────┴────────────────────────────────┘
                      ↑ 右下滑出「教学助教」抽屉
```

Tab：**结果**（分析 + AI 解读）| **批改**（评分量表 + 改进建议）| **架构**（仅教师视图）

## 项目架构

```
chemclaw-demo/
├── server.js                      # 入口：静态服务 + API 路由
├── package.json
├── src/
│   ├── openclaw-bridge.js         # OpenClaw 集成（技能调用、大文件智能截断）
│   ├── agents/                    # 四个本地智能体（fallback）
│   │   ├── data-parser.js         # Agent 1: 计算数据解析
│   │   ├── chemical-explainer.js  # Agent 2: 化学概念解释
│   │   ├── teaching-designer.js   # Agent 3: 教学设计 & 出题
│   │   └── grading-feedback.js    # Agent 4: 实验报告批改
│   ├── parsers.js                 # Gaussian / ORCA / 通用格式解析器
│   ├── knowledge.js               # 化学知识库 & Rubric 模板
│   ├── orchestrator.js            # 多智能体编排器
│   ├── llm.js                     # LLM 客户端
│   └── routes.js                  # API 路由
├── data/samples/                  # 样例数据
└── public/
    ├── index.html                 # 两栏工作台 + 助教抽屉
    ├── styles.css                 # 设计令牌与组件样式（无运行时框架）
    ├── js/
    │   ├── main.js                # 入口 & 事件绑定
    │   ├── state.js               # 全局状态
    │   ├── renderers.js           # 渲染引擎（结果页 / 批改页 / Markdown 格式化）
    │   ├── charts.js              # SVG 图表（能量曲线 / 优化轨迹 / 红外光谱）
    │   ├── viewer.js              # Mol* 3D 查看器 + XYZ/PDB 解析 + 2D 兜底
    │   ├── api.js                 # API 客户端（超时与错误处理）
    │   ├── chat.js                # 对话模块
    │   └── theme.js               # 明暗主题（跟随系统偏好）
    └── vendor/
        └── molstar.js             # Mol* 分子渲染（首次需要结构时按需加载）
```

## 数据流

```
用户 → 上传文件 / 粘贴数据
         ↓
     server.js → routes.js
         ↓
  ┌─ OpenClaw 在线？───┐
  │ YES                │ NO
  ↓                    ↓
openclaw-bridge.js   orchestrator.js
  │                    │
  ├ 智能截断（>5KB）    ├ Agent 1 解析
  ├ 写入 workspace     ├ Agent 2 解释
  ↓                    ├ Agent 3 教学
openclaw agent        │
  └→ chemclaw-analyze  ↓
     skill              本地 LLM / 规则引擎
         ↓                    ↓
    结构化 JSON ←────── 合并结果 ──────→ 前端渲染
```

## 快速启动

```bash
# 1. 安装 OpenClaw（推荐）
npm install -g openclaw

# 2. 配置 API key
echo "DEEPSEEK_API_KEY=你的key" > .env

# 3. 安装 OpenClaw skills
# 将 chemclaw-analyze / chemclaw-grade 放入 ~/.openclaw/workspace/skills/

# 4. 启动
npm start

# 5. 打开
open http://localhost:5173
```

不配置 API key / 未安装 OpenClaw 时自动使用本地 Demo 模式。

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/status` | GET | 检测后端模式、模型、可用技能 |
| `/api/analyze` | POST | 分析计算数据（Agent 1-3 或 OpenClaw） |
| `/api/grade` | POST | 批改实验报告（Agent 4 或 OpenClaw） |
| `/api/chat` | POST | 教学助教追问 |

## 支持的数据格式

- **Gaussian** `.log` / `.out` — SCF 能量、频率、虚频、HOMO/LUMO、偶极矩、热化学、能垒
- **ORCA** `.out` — 单点能、轨道能量、频率
- **XYZ** `.xyz` — 分子坐标，3D 可视化
- 大文件（>5KB）自动智能截断，保留关键数据行

## 技术栈

- **后端**：Node.js 原生 HTTP，无外部依赖
- **前端**：原生 HTML/CSS/JS（ES Modules），手写设计系统（无运行时 CSS 框架）
- **AI**：OpenClaw 框架（Qwen3_6）→ 降级 DeepSeek API → 降级本地规则
- **3D 渲染**：Mol*（主）+ 2D 投影兜底（无 WebGL 时）
- **图表**：手写 SVG（能量曲线 / 优化轨迹 / 红外光谱）

## 开发报告

### v2.1（2026-10-17）

**可用性与健壮性**
- 无 WebGL 时不再暴露 Mol* 的英文报错，自动降级为可读的 2D 投影，并标注「未启用 WebGL」
- 分析 / 批改失败改为行内错误提示 + 重试，不再只写入默认收起的对话
- 分析过程显示「解析 → 解释 → 出题」进度与骨架屏；请求带 60s 超时
- 批改、架构、学生视图补齐空状态与角色可见性；新分析会清空旧批改
- 最近一次分析与输入自动保存，刷新后可恢复（12 小时内）

**布局与交互**
- 右侧对话改为抽屉，工作台在 1280 / 1600 下获得完整宽度
- 修复 ≤920px 的网格覆盖问题（原先 390px 视口下文档宽 624px）
- 输入区改为「拖拽上传优先」，粘贴与坐标收进二级展开；支持格式识别、文件胶囊与移除
- 一键示例：加载示例后直接分析；「重新分析」「复制解读」回到结果页
- 主题跟随系统偏好，首屏内联应用避免闪白；`color-scheme` 与焦点样式补齐

**视觉与内容**
- 结论前置：未正常结束 / 未收敛以整条警示条置顶
- 去除重复指标：同一组数字不再在 3D 卡片与 AI 解读里出现两次
- 统一字号与字重（正文 15px、元信息 12px），中文字体栈与等宽数字
- 单位与术语统一（kcal·mol⁻¹、cm⁻¹、Rubric → 评分量表、SVG Fallback → 2D 投影等）
- 批改页新增分数环、等级、四维进度条、改进建议空态与文献基准
- 图表重绘：短标签、轴标题、悬停说明、移动端紧凑尺寸；零强度红外给出说明
- 无障碍：表单标签、tab 语义与方向键、`aria-live`、`aria-pressed`、44px 触控目标、对比度修正

**性能**
- 移除未使用的 3Dmol（524KB）与 Tailwind 运行时（398KB）
- Mol* 改为 `defer` 并在能力检测后初始化，首屏不再阻塞

### v2.0（2026-06-04）

**前端布局重构**
- 合并「概览」「智能体」「训练」三个 tab 为统一「结果」页
- AI 解读为主线的信息架构：3D 结构 + 能量曲线作为可视化佐证
- 关键指标从 5 个卡片缩减为 2-3 个核心数字，嵌入 3D 结构下方
- 解读拆为摘要 + 可折叠详情，摘要 ~300 字关键发现
- 计算详情合并 basicInfo + fileDetails 去重，关键标签 pill 展示在 Hero 下方
- Tab 精简：结果 | 批改 | 架构

**OpenClaw 集成优化**
- 大数据预写入 `~/.openclaw/workspace/`，绕过 Agent 写文件超时
- 智能截断：保留关键行（SCF Done/HOMO/LUMO/收敛）+ 头尾，砍掉重复优化步
- 多 payload 遍历，取最长文本 + toolResult 输出
- 过滤 Agent 自言自语（"好的我来...""现在运行..."等前缀）
- Skill JSON 输出格式化为可读 Markdown（表格/列表/代码块/引用）

**视觉优化**
- Markdown 渲染支持：标题层级、表格、代码块、列表、引用、分隔线
- 明暗主题一致的文字颜色和间距
- 摘要和详情统一字重和行高
- 批改页独立得分 Hero

### v1.0（2026-05-30）

- 初始版本：四智能体架构、本地规则引擎、3Dmol.js 渲染
- 三栏布局：输入面板 + 分析面板 + 对话面板
- 支持 Gaussian/ORCA 格式解析
