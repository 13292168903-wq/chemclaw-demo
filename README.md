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
┌──────────┬──────────────────────────────┬──────┐
│ 输入面板  │         科研工作台             │ 对话  │
│          │                              │      │
│ 文件上传  │  Hero（标题 + 摘要）           │ 提问  │
│ 数据粘贴  │  Tags（方法/基组/收敛状态）     │      │
│ 分子坐标  │  3D 结构 ←→ 能量曲线（并排）    │      │
│          │  ─────────────────────       │      │
│ [分析]    │  🦞 AI 解读                   │      │
│          │  ├ 关键发现（摘要高亮）          │      │
│ [批改]    │  └ 完整解读（可折叠展开）        │      │
│          │  ─────────────────────       │      │
│          │  ▸ 计算详情与文件信息            │      │
│          │  ▸ 优化轨迹与振动光谱            │      │
│          │  ▸ 学习目标与训练               │      │
└──────────┴──────────────────────────────┴──────┘
```

Tab：**结果**（分析 + AI 解读）| **批改**（Rubric 评分）| **架构**（路线图）

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
    ├── index.html                 # 三栏布局页面
    ├── styles.css                 # 样式
    ├── js/
    │   ├── main.js                # 入口 & 事件绑定
    │   ├── state.js               # 全局状态
    │   ├── renderers.js           # 渲染引擎（结果页 / 批改页 / Markdown 格式化）
    │   ├── charts.js              # SVG 图表（能量曲线 / 优化轨迹 / 红外光谱）
    │   ├── viewer.js              # Mol* 3D 查看器 + XYZ/PDB 解析
    │   ├── api.js                 # API 客户端
    │   ├── chat.js                # 对话模块
    │   └── theme.js               # 明暗主题
    └── vendor/                    # 第三方库
        ├── molstar.js             # Mol* 分子渲染
        └── 3Dmol-min.js           # 3Dmol.js（备用）
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
- **前端**：原生 HTML/CSS/JS（ES Modules），Tailwind CSS CDN
- **AI**：OpenClaw 框架（Qwen3_6）→ 降级 DeepSeek API → 降级本地规则
- **3D 渲染**：Mol*（主）+ SVG fallback
- **图表**：手写 SVG（能量曲线 / 优化轨迹 / 红外光谱）

## 开发报告

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
