// Agent 3: 教学设计智能体
import { quizTemplates, buildLearningGoals } from "../knowledge.js";
import { extractJSON } from "../utils.js";

export class TeachingDesignerAgent {
  constructor(llm) {
    this.name = "教学设计 Agent";
    this.llm = llm;
  }

  async analyze(context) {
    if (this.llm) {
      try { return await this.analyzeWithAI(context); }
      catch (e) { console.warn(`[${this.name}] AI 调用失败:`, e.message); }
    }
    return this.analyzeLocal(context);
  }

  analyzeLocal(context) {
    const metrics = context.metrics || {};
    const learningGoals = buildLearningGoals(metrics);
    const quiz = this.generateQuiz(metrics);
    const learningPath = [
      "第一步：标注反应物、过渡态和产物结构，说明判据（能量最低 / 一阶鞍点 / 无虚频）。",
      "第二步：用频率和能量共同验证过渡态是否可信，讨论虚频方向是否对应反应坐标。",
      "第三步：结合轨道能级、能垒变化讨论反应选择性和取代基效应。",
      "第四步：将数据分析、化学解释和文献对比串成一段可发表式论证。"
    ];
    const researchSuggestions = this.buildResearchSuggestions(metrics);
    const benchmarks = [
      { topic: "过渡态频率判据", benchmark: "一个虚频 + IRC/动画验证", note: "单一虚频不足以完成机理证明。" },
      { topic: "室温反应可行性", benchmark: "10-25 kcal/mol 课堂讨论区间", note: "需结合温度和阿伦尼乌斯公式。" },
      { topic: "吸附能 Sabatier 原理", benchmark: "过弱不易活化，过强不利脱附", note: "催化分析强调火山图趋势。" }
    ];
    return { agent: this.name, learningGoals, learningPath, quiz, researchSuggestions, literatureBenchmarks: benchmarks };
  }

  generateQuiz(metrics) {
    const quiz = [];
    quiz.push({
      type: "概念题",
      question: "为什么过渡态优化结果通常需要且只需要一个虚频？",
      rubric: "说明一阶鞍点概念：沿反应坐标方向曲率为负，其他方向为正。仅凭虚频不足以证明，需 IRC 验证。"
    });
    const barrier = metrics.barrier ?? metrics.energySpan;
    if (barrier) {
      quiz.push({
        type: "数据题",
        question: `若能垒为 ${barrier} kcal/mol，如何判断该反应在室温下是否可能发生？`,
        rubric: `结合能垒 ${barrier} kcal/mol、阿伦尼乌斯公式 k=A·exp(-Ea/RT)、温度条件和催化影响综合判断。`
      });
    }
    quiz.push({
      type: "科研题",
      question: "如果要证明取代基效应是真实原因而非计算误差，你会设计哪些对照计算？",
      rubric: "应包含不同电子效应取代基、相同计算级别、构象一致性控制、可能的 Hammett 分析。"
    });
    if (metrics.gap) {
      quiz.push({
        type: "讨论题",
        question: `HOMO-LUMO gap = ${metrics.gap} eV，对前线轨道理论和反应活性有什么启示？`,
        rubric: "将 gap 大小与电子跃迁难易、亲核/亲电活性联系，指出轨道对称性和空间匹配也是关键因素。"
      });
    }
    return quiz;
  }

  buildResearchSuggestions(metrics) {
    const suggestions = [];
    if (metrics.imaginaryFrequencies?.length > 0) suggestions.push("补做 IRC 计算，确认虚频方向连接反应物与产物。");
    suggestions.push("设置供电子/吸电子取代基对照组，比较能垒与 HOMO-LUMO gap 的相关性。");
    suggestions.push("用更高基组或 DLPNO-CCSD(T) 单点能校正验证能量排序稳定性。");
    if (metrics.dipole) suggestions.push("加入溶剂模型（PCM/SMD）敏感性分析，比较气相与溶液相能垒差异。");
    suggestions.push("对关键过渡态做振动模式动画和成键分析，用于课堂教学展示。");
    return suggestions;
  }

  async analyzeWithAI(context) {
    const response = await this.llm.call(
      "你是计算化学教学设计专家。基于计算数据生成个性化教学方案，题目要有启发性，返回严格 JSON。",
      `生成教学方案，返回 JSON:
{
  "learningGoals": [{"concept": "概念", "evidence": "数据证据", "outcome": "预期学习结果"}],
  "learningPath": ["步骤1", "步骤2", "步骤3", "步骤4"],
  "quiz": [{"type": "概念题/数据题/科研题/讨论题", "question": "问题", "rubric": "评分标准"}],
  "researchSuggestions": ["科研建议"],
  "literatureBenchmarks": [{"topic": "主题", "benchmark": "基准", "note": "说明"}]
}

指标：${JSON.stringify(context.metrics, null, 2)}
化学解释：${JSON.stringify(context.explanations?.slice(0, 2), null, 2)}`
    );
    const json = extractJSON(response);
    return { agent: this.name, ...json };
  }
}
