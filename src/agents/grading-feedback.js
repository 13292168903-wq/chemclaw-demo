// Agent 4: 批改反馈智能体
import { rubricDimensions } from "../knowledge.js";
import { extractJSON } from "../utils.js";

export class GradingFeedbackAgent {
  constructor(llm) {
    this.name = "批改反馈 Agent";
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
    const { studentReport = "" } = context.raw || {};
    const metrics = context.metrics || {};
    const hasReport = studentReport.trim().length > 0;

    const checks = {
      hasNumbers: /\d+(?:\.\d+)?/.test(studentReport),
      hasUnits: /kcal|eV|Hartree|kJ|cm-1|Debye|nm|Å/i.test(studentReport),
      hasImagFreq: /虚频|imaginary|transition|过渡态/i.test(studentReport),
      hasComparison: /对照|比较|不同|对比|相对/i.test(studentReport),
      hasMechanism: /机理|机制|路径|中间体|反应坐标/i.test(studentReport),
      hasOrbital: /HOMO|LUMO|轨道|前线|能级/i.test(studentReport),
    };

    const reportLength = studentReport.length;
    const dimensionScores = this.evaluateDimensions(checks, reportLength, hasReport);

    const totalScore = hasReport
      ? dimensionScores.reduce((sum, d) => sum + d.score, 0)
      : "未提交";

    const strengths = [];
    if (checks.hasNumbers) strengths.push("引用了数值数据");
    if (checks.hasUnits) strengths.push("标注了能量/频率单位");
    if (checks.hasImagFreq) strengths.push("讨论了虚频或过渡态判据");

    const improvements = [];
    if (!checks.hasNumbers) improvements.push("缺少具体数值引用");
    if (!checks.hasUnits) improvements.push("未标明单位（kcal/mol、eV、cm⁻¹）");
    if (!checks.hasImagFreq) improvements.push("未讨论虚频与过渡态关系");
    if (!checks.hasComparison) improvements.push("缺少对照组设计");
    if (!checks.hasMechanism) improvements.push("缺少机理解释");
    if (reportLength < 100 && hasReport) improvements.push("报告偏短，建议补充方法和结果讨论");

    return {
      agent: this.name,
      grading: {
        score: totalScore,
        strengths: strengths.length > 0 ? strengths : ["可结合计算结果开始批改训练"],
        improvements,
        teacherNote: hasReport
          ? "评分时建议将「数据提取准确性」和「化学解释完整性」分开评价。"
          : "未提交报告，可先生成预习任务和报告模板。"
      },
      rubric: dimensionScores
    };
  }

  evaluateDimensions(checks, reportLength, hasReport) {
    return rubricDimensions.map(dim => {
      let level, comment, ratio;
      switch (dim.dimension) {
        case "数据解析":
          if (checks.hasNumbers && checks.hasUnits) { level = "良好"; ratio = 0.80; comment = "能识别关键数值并标注单位。"; }
          else if (checks.hasNumbers) { level = "中等"; ratio = 0.55; comment = "提取了数值但缺少单位说明。"; }
          else { level = "待加强"; ratio = 0.25; comment = "未引用具体数值。"; }
          break;
        case "概念解释":
          if (checks.hasImagFreq && checks.hasOrbital && checks.hasMechanism) { level = "良好"; ratio = 0.80; comment = "能串联虚频、轨道和机理讨论。"; }
          else if (checks.hasImagFreq || checks.hasOrbital) { level = "中等"; ratio = 0.55; comment = "部分解释了关键概念。"; }
          else { level = "待加强"; ratio = 0.25; comment = "概念解释不足。"; }
          break;
        case "科研设计":
          if (checks.hasComparison) { level = "良好"; ratio = 0.80; comment = "有对照意识。"; }
          else if (reportLength > 200) { level = "中等"; ratio = 0.50; comment = "篇幅充足但缺少对照设计。"; }
          else { level = "待加强"; ratio = 0.20; comment = "需设计对照计算验证假设。"; }
          break;
        case "报告表达":
          if (reportLength > 300 && checks.hasNumbers && checks.hasUnits) { level = "良好"; ratio = 0.85; comment = "结构完整，数值和单位规范。"; }
          else if (reportLength > 150) { level = "中等"; ratio = 0.55; comment = "结构基本完整。"; }
          else { level = "待加强"; ratio = 0.25; comment = "内容偏少。"; }
          break;
        default:
          level = "中等"; ratio = 0.5; comment = "继续完善";
      }
      return { dimension: dim.dimension, weight: dim.weight, level, score: Math.round(ratio * dim.weight), comment };
    });
  }

  async analyzeWithAI(context) {
    const response = await this.llm.call(
      "你是计算化学实验报告批改专家。请基于评分标准给出详细批改意见，返回严格 JSON。",
      `批改学生实验报告，返回 JSON:
{
  "grading": {"score": 0-100, "strengths": ["优势"], "improvements": ["待改进"], "teacherNote": "教师提示"},
  "rubric": [{"dimension": "维度", "weight": 权重, "level": "良好/中等/待加强", "score": 得分, "comment": "评语"}]
}
评分维度：数据解析(25%)、概念解释(30%)、科研设计(25%)、报告表达(20%)

学生报告：${context.raw?.studentReport?.slice(0, 3000) || "未提交"}
计算指标：${JSON.stringify(context.metrics, null, 2)}`
    );
    const json = extractJSON(response);
    return { agent: this.name, ...json };
  }
}
