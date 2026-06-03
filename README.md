# ChemClaw Demo

面向计算化学科研训练的多智能体教学助教。将 Gaussian / ORCA / VASP 等计算结果转化为可解释、可追问、可出题、可批改的教学闭环。

**E3 教育创新应用赛** 参赛项目。

## 项目架构

```
chemclaw-demo/
├── server.js                    # 入口：静态服务 + API 路由
├── package.json
├── src/
│   ├── agents/                  # 四个独立智能体
│   │   ├── data-parser.js       # Agent 1: 计算数据解析
│   │   ├── chemical-explainer.js # Agent 2: 化学概念解释
│   │   ├── teaching-designer.js  # Agent 3: 教学设计 & 出题
│   │   └── grading-feedback.js   # Agent 4: 实验报告批改
│   ├── parsers.js               # Gaussian / ORCA / 通用格式解析器
│   ├── knowledge.js             # 化学知识库 & Rubric 模板
│   ├── orchestrator.js          # 多智能体编排器
│   ├── llm.js                   # LLM 客户端 (DeepSeek / OpenAI 兼容)
│   └── routes.js                # API 路由
├── data/samples/                # 样例数据
│   ├── diels-alder-ts.log       # Gaussian TS 计算输出
│   └── benzene.xyz              # 苯分子坐标
└── public/
    ├── index.html               # 三栏布局页面
    ├── styles.css               # 样式
    └── app.js                   # 前端逻辑 + 3Dmol.js 集成
```

## 多智能体流程

```
计算数据 → [Agent 1 解析] → [Agent 2 解释] → [Agent 3 教学] → 分析结果
                              ↓
实验报告 → [Agent 4 批改] → 评分 & Rubric 反馈
```

分析和批改**独立运行**：可以先分析数据看结果，再填报告单独批改，互不依赖。

## 快速启动

```bash
# 1. 配置 API key（申请地址: platform.deepseek.com）
echo "DEEPSEEK_API_KEY=你的key" > .env
echo "DEEPSEEK_MODEL=deepseek-chat" >> .env

# 2. 启动
npm start

# 3. 打开
open http://localhost:5173
```

不配置 API key 时使用本地 Demo 模式（规则解析 + 知识库）。

## API 接口

| 接口 | 说明 |
|------|------|
| `GET /api/status` | 检测后端模式 |
| `POST /api/analyze` | 分析计算数据（Agent 1-3） |
| `POST /api/grade` | 批改实验报告（Agent 4） |
| `POST /api/chat` | 助教追问 |

## 支持的数据格式

- **Gaussian** `.log` / `.out`：SCF 能量、频率、虚频、HOMO/LUMO、偶极矩、热化学、能垒、吸附能
- **ORCA** `.out`：单点能、轨道能量、频率
- **通用格式**：自动检测，正则提取关键指标
- **XYZ** 坐标：3Dmol.js 渲染可旋转结构

## 技术栈

- 后端：Node.js 原生 http 模块
- 前端：原生 HTML/CSS/JS + 3Dmol.js
- AI：DeepSeek Chat API（OpenAI 兼容）
- 无需任何 npm 依赖
