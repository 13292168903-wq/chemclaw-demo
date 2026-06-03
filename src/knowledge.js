// 计算化学教学知识库
// 为本地 Demo 模式提供领域知识驱动的回答

export const conceptCards = {
  imaginaryFrequency: {
    title: "虚频与过渡态验证",
    concept: "过渡态是势能面上的一阶鞍点，对反应坐标方向有一个负曲率，对应唯一的虚频。",
    evidence: (freq) => freq ? `检出 ${freq} cm⁻¹ 虚频，符合一阶鞍点特征。需进一步确认振动模式对应成键/断键方向。` : "未检出虚频，可能不是过渡态，或需检查初始猜测结构。",
    teaching: "引导学生理解虚频是过渡态的'必要条件'而非'充分条件'。单个虚频不能替代 IRC 验证。"
  },
  homoLumoGap: {
    title: "前线轨道与反应活性",
    concept: "HOMO-LUMO gap 反映电子从占据轨道跃迁到空轨道的难易程度，gap 越小通常反应活性越高。",
    evidence: (gap) => `当前 gap = ${gap} eV，${gap < 3 ? '属于较小 gap，提示前线轨道相互作用可能较强。' : gap < 5 ? '属于中等 gap，可结合取代基效应进一步讨论。' : 'gap 较大，需考察是否有其他反应通道。'}`,
    teaching: "让学生结合 Fukui 函数或轨道系数图，讨论亲核/亲电进攻位点。"
  },
  activationBarrier: {
    title: "能垒与反应可行性",
    concept: "能垒是反应物到过渡态所需的活化能，决定反应速率。10-25 kcal/mol 区间常用于课堂讨论室温反应可行性。",
    evidence: (barrier) => `能垒约 ${barrier} kcal/mol。${barrier < 15 ? '较低，室温下反应容易进行。' : barrier < 25 ? '中等，可能需要加热或催化剂。' : '较高，室温下较难发生。'}`,
    teaching: "不要机械套用阈值。需结合阿伦尼乌斯公式、溶剂效应和催化条件综合判断。"
  },
  adsorptionEnergy: {
    title: "吸附能与催化",
    concept: "吸附能衡量分子与表面的结合强度。过弱不易活化，过强不利脱附——Sabatier 原理。",
    evidence: (ads) => `吸附能 ${ads} eV。${Math.abs(ads) < 0.3 ? '较弱，分子可能不易被活化。' : Math.abs(ads) < 0.8 ? '适中，有利于催化循环。' : '较强，产物可能不易脱附。'}`,
    teaching: "可以让学生比较不同表面的吸附能，讨论火山图曲线的物理意义。"
  }
};

export const quizTemplates = {
  concept: [
    {
      template: "为什么过渡态优化结果通常需要且只需要一个虚频？",
      rubric: "回答应说明势能面一阶鞍点概念：沿反应坐标方向曲率为负（一个虚频），其他方向曲率为正。虚频方向应对应成键/断键振动模式。仅凭虚频不足以完成机理证明，还需 IRC 或振动动画。"
    },
    {
      template: "HOMO-LUMO gap 的含义是什么？如何用它讨论分子反应活性？",
      rubric: "需说明 gap 大小反映基态到激发态的电子跃迁难度，较小 gap 意味着更容易发生电子转移，可能暗示更高的反应活性。同时指出 gap 不是唯一判据，还需考虑轨道对称性和空间匹配。"
    }
  ],
  data: [
    {
      template: (barrier) => `若能垒为 ${barrier} kcal/mol，如何判断该反应在室温下是否可能发生？`,
      getRubric: (barrier) => `需结合能垒大小（${barrier} kcal/mol）、阿伦尼乌斯公式估算、温度、溶剂和催化条件。不能仅凭单一阈值。`
    },
    {
      template: (gap) => `当前 HOMO-LUMO gap 为 ${gap} eV，这对反应活性有什么启示？`,
      getRubric: (gap) => `说明 gap ${gap < 3 ? '较小' : gap < 5 ? '中等' : '较大'}，讨论电子跃迁难易程度及其对反应机理的影响。`
    }
  ],
  research: [
    {
      template: "如果要证明取代基效应是某个反应的真实驱动力，你会设计哪组对照计算？",
      rubric: "优秀方案包括：(1) 设置供电子/吸电子取代基对照 (2) 相同计算级别和方法 (3) 构象一致性控制 (4) 多维度分析（能垒、电荷、轨道能级、键长变化）(5) 可能的 Hammett 线性自由能关系验证。"
    },
    {
      template: "如何评价你的过渡态结构是否可信？请列出至少三个判据。",
      rubric: "判据：(1) 有且仅有一个虚频 (2) 虚频振动模式对应正确的反应坐标 (3) IRC 计算连接反应物和产物 (4) 能量高于反应物和产物 (5) 关键键长介于反应物和产物之间。"
    }
  ]
};

export const rubricDimensions = [
  {
    dimension: "数据解析",
    weight: 25,
    description: "能否从输出文件中提取关键能量、频率、轨道能级等数值",
    levels: {
      excellent: "完整提取所有关键指标，标注单位，识别计算级别和基组",
      good: "提取主要指标，单位基本正确",
      needsWork: "遗漏关键指标，或数值提取有误"
    }
  },
  {
    dimension: "概念解释",
    weight: 30,
    description: "能否将计算数值与化学概念建立联系",
    levels: {
      excellent: "从数值出发建立机理链条，结合多个证据来源论证结论",
      good: "能解释单个指标的含义，但证据之间关联不够紧密",
      needsWork: "只罗列数值不加解释，或解释与化学原理不符"
    }
  },
  {
    dimension: "科研设计",
    weight: 25,
    description: "能否设计对照计算或敏感性分析验证结论",
    levels: {
      excellent: "设计多组对照（取代基、构象、方法、溶剂），逻辑严密",
      good: "有对照意识，但设计不够系统",
      needsWork: "没有对照设计，或无法解释为什么需要对照"
    }
  },
  {
    dimension: "报告表达",
    weight: 20,
    description: "报告结构、图表规范性和论证逻辑",
    levels: {
      excellent: "结构完整、图表规范、引用恰当、逻辑链清晰",
      good: "结构基本完整，图表需改进，逻辑基本连贯",
      needsWork: "结构混乱，缺少图表或图表不规范"
    }
  }
];

// 根据解析结果生成教学知识点的证据
export function buildLearningGoals(metrics) {
  const goals = [];

  const imagCount = metrics.imaginaryFrequencies?.length || 0;
  goals.push({
    concept: "过渡态验证",
    evidence: imagCount > 0
      ? `检出 ${metrics.imaginaryFrequencies[0]} cm⁻¹ 虚频`
      : "未检出虚频",
    outcome: "学生能够判断优化结构是否满足一阶鞍点特征，并说明 IRC 或振动动画验证的必要性。"
  });

  const barrier = metrics.barrier ?? metrics.energySpan;
  if (barrier) {
    goals.push({
      concept: "能垒与反应动力学",
      evidence: `能垒约 ${barrier} kcal/mol`,
      outcome: "学生能够结合温度、溶剂、催化条件讨论反应可行性，不机械套用阈值。"
    });
  }

  const gap = metrics.gap;
  if (gap) {
    goals.push({
      concept: "前线轨道与反应活性",
      evidence: `HOMO-LUMO gap = ${gap} eV`,
      outcome: "学生能够把轨道能级差、电子效应和反应选择性联系起来。"
    });
  }

  const adsorption = metrics.adsorption;
  if (adsorption) {
    goals.push({
      concept: "表面相互作用",
      evidence: `吸附能 = ${adsorption} eV`,
      outcome: "学生能够区分弱吸附、适中吸附和过强吸附对催化循环的影响，理解 Sabatier 原理。"
    });
  }

  return goals;
}
