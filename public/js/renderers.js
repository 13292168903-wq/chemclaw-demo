// ===== Renderers Module =====
// Structure:
//   renderAnalysisResult  → 结果页（主线：AI 解读 + 可视化佐证）
//   renderGradeResult     → 批改页
//   updateRoleUi          → 教师/学生角色切换
import { state, $, $$, labels } from "./state.js";
import { renderEnergyChart, renderMiniLineChart, renderOptimizationTrajectoryChart, renderSpectrum } from "./charts.js";
import { initMoleculeViewer, loadMoleculeToViewer, loadFramesToViewer, resolveMoleculeText, xyzToPdb, parseXYZAtoms, computeBonds } from "./viewer.js";

// ===== Main: 结果页渲染 =====
export function renderAnalysisResult(result) {
  $("#emptyState").classList.add("hidden");
  $("#resultView").classList.remove("hidden");

  // 1. Hero
  $("#resultMode").textContent = result.mode === "openclaw"
    ? "🦞 OpenClaw · " + (result.openclawModel || "")
    : result.model ? `${result.mode} · ${result.model}` : result.mode;
  $("#projectTitle").textContent = result.projectTitle || "计算化学分析";
  $("#summary").textContent = result.summary || "";

  // 2. Visual evidence (3D + key stats + energy)
  renderStructures(result.structures || []);
  renderKeyStats(result.metrics || {});
  renderEnergyChart(result.chart || {});

  // 4. Collapsible: computation details
  renderComputationDetails(result.basicInfo || {}, result.fileDetails || {});
  renderOptimizationProfile(result.optimizationProfile || {}, result.optimizationTrajectory || []);
  renderVibrationalProfile(result.vibrationalProfile || {});

  // 5. AI interpretation (main content)
  renderInterpretation(result);

  // 6. Collapsible: training
  renderLearningGoals(result.learningGoals || []);
  renderQuiz(result.quiz || []);
  renderSuggestions(result.researchSuggestions || result.nextSteps || []);

  // 7. Architecture (pre-render for architecture tab)
  renderArchitecture(result.architecture || []);

  updateRoleUi();
  switchTab("result");
}

// ===== Main: 批改页渲染 =====
export function renderGradeResult(result) {
  if (!result.grading) return;

  $("#gradeScoreValue").textContent = result.grading.score ?? "--";
  renderGradingContent(result);
  renderRubric(result.rubric || []);
  renderStudentFeedback(result);
  renderOpenClawGradeFeedback(result);
  renderBenchmarks(result.literatureBenchmarks || []);
  renderNextSteps(result.nextSteps || []);
  updateRoleUi();
  switchTab("grading");
}

// ===== Tab switching =====
function switchTab(name) {
  $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  $$(".view-page").forEach(p => p.classList.remove("active"));
  const target = name === "result" ? $("#resultView") : $(`#${name}Page`);
  if (target) target.classList.add("active");
  if (name === "result") setTimeout(() => {
    try { state.viewer?.plugin?.layout?.events?.update?.emit("size"); } catch { /* best effort */ }
  }, 100);
}

// ===== Key Stats (2-3 core numbers below 3D viewer) =====
function renderKeyStats(metrics) {
  const priority = ["activationBarrier", "homoLumoGap", "imaginaryFrequency"];
  const entries = priority
    .map(key => [key, metrics[key]])
    .filter(([, v]) => v !== undefined && v !== null && v !== "");

  if (!entries.length) {
    $("#keyStatsRow").classList.add("hidden");
    return;
  }
  $("#keyStatsRow").classList.remove("hidden");
  $("#keyStatsRow").innerHTML = entries.map(([key, value]) => {
    const label = labels[key] || key;
    const unitMap = { activationBarrier: "kcal/mol", homoLumoGap: "eV", imaginaryFrequency: "cm⁻¹" };
    return `<div class="key-stat"><span class="ks-label">${label}</span><span class="ks-value">${value}</span><span class="ks-unit">${unitMap[key] || ""}</span></div>`;
  }).join("");
}

// ===== Structures (3D viewer) =====
function renderStructures(structures = []) {
  state.structures = structures.length ? structures : [{ title: "输入/样例", atomCount: null, xyz: resolveMoleculeText() }];
  const select = $("#structureSelect");
  select.innerHTML = state.structures.map((frame, index) =>
    `<option value="${index}">${frame.title || `帧 ${index + 1}`}${frame.atomCount ? ` · ${frame.atomCount} 原子` : ""}</option>`
  ).join("");
  select.disabled = state.structures.length <= 1;
  initMoleculeViewer();

  const pdbData = state.analysisResult?.pdbData;
  const moleculeText = state.structures[0]?.xyz || resolveMoleculeText();
  setTimeout(() => {
    if (pdbData) loadMoleculeToViewer(pdbData, "pdb");
    else loadMoleculeToViewer(moleculeText, "xyz");
  }, 200);

  $("#playFramesButton").disabled = state.structures.length <= 1;
  $("#playFramesButton").textContent = state.structures.length > 1 ? "播放帧序列" : "无序列";
  updateViewerInfoBar(moleculeText);
}

function updateViewerInfoBar(xyzText) {
  const atoms = parseXYZAtoms(xyzText);
  const bonds = atoms.length > 0 ? computeBonds(atoms) : [];
  if ($("#viewerAtomCount")) $("#viewerAtomCount").textContent = `${atoms.length} atoms`;
  if ($("#viewerBondCount")) $("#viewerBondCount").textContent = `${bonds.length} bonds`;

  const badgeEl = $("#openclawDataBadge");
  if (badgeEl && state.analysisResult?.mode === "openclaw") {
    badgeEl.classList.remove("hidden");
    badgeEl.textContent = `🦞 OpenClaw · ${state.analysisResult.openclawSkill || "chemclaw-analyze"}`;
  } else if (badgeEl) {
    badgeEl.classList.add("hidden");
  }
  if ($("#viewerEngine")) $("#viewerEngine").textContent = state.viewerInitialized ? "Mol* Renderer" : "SVG Fallback";
}

export function selectStructureFrame(index, { updateMoleculeText = true } = {}) {
  const frame = state.structures[Number(index)];
  if (!frame?.xyz) return;
  const select = $("#structureSelect");
  if (select && Number(select.value) !== Number(index)) select.value = String(index);
  if (updateMoleculeText) $("#moleculeText").value = frame.xyz;
  state.framesPlaying = false;
  $("#playFramesButton").textContent = state.structures.length > 1 ? "播放帧序列" : "无序列";
  initMoleculeViewer();
  const pdbData = state.analysisResult?.pdbData;
  if (pdbData) loadMoleculeToViewer(pdbData, "pdb");
  else loadMoleculeToViewer(frame.xyz, "xyz");
  updateViewerInfoBar(frame.xyz);
}

// ===== Computation Details (合并 basicInfo + fileDetails，去重) =====
function renderComputationDetails(basic = {}, file = {}) {
  const method = basic.route || file.route || "";
  const task = basic.taskType || "";
  const software = basic.software || "";
  const normal = basic.normalTermination != null ? basic.normalTermination : file.normalTermination;
  const conv = file.converged;
  const chargeSpin = basic.chargeMultiplicity || (file.charge != null ? `${file.charge} / ${file.multiplicity ?? "-"}` : null);

  // Tags row: 方法 | 任务 | 软件 | 电荷/自旋 | 正常结束 | 收敛
  const tags = [];
  if (method) tags.push(`<span class="compu-tag method">${method}</span>`);
  if (task) tags.push(`<span class="compu-tag">${task}</span>`);
  if (software) tags.push(`<span class="compu-tag">${software}</span>`);
  if (chargeSpin) tags.push(`<span class="compu-tag">${chargeSpin}</span>`);
  if (normal != null) tags.push(`<span class="compu-tag ${normal ? 'good' : 'warn'}">${normal ? '正常结束' : '异常终止'}</span>`);
  if (conv != null) tags.push(`<span class="compu-tag ${conv ? 'good' : 'warn'}">${conv ? '已收敛' : '未收敛'}</span>`);

  const tagsEl = $("#computationTags");
  if (tags.length) {
    tagsEl.classList.remove("hidden");
    tagsEl.innerHTML = tags.join("");
  } else {
    tagsEl.classList.add("hidden");
  }

  // Collapsible details: 完整字段
  const items = [
    ["文件名", basic.fileName || file.fileName],
    ["格式", file.format],
    ["大小", file.byteSize ? `${(file.byteSize / 1024).toFixed(1)} KB` : null],
    ["行数", file.lineCount],
    ["软件", basic.software],
    ["方法", basic.route || file.route],
    ["任务类型", basic.taskType],
    ["电荷/自旋", chargeSpin],
    ["能量点", basic.outputCount || file.energyPointCount],
    ["频率数", file.frequencyCount],
    ["结构帧", file.structureFrameCount],
    ["正常结束", normal != null ? (normal ? "是" : "否") : null],
    ["收敛", conv != null ? (conv ? "是" : "否") : null],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");

  const section = document.getElementById("computationDetailsSection");
  const grid = $("#computationDetailsGrid");
  if (items.length) {
    if (section) section.classList.remove("hidden");
    grid.innerHTML = items.map(([label, value]) =>
      `<div class="detail-item"><span>${label}</span><strong>${value}</strong></div>`
    ).join("");
  } else {
    if (section) section.classList.add("hidden");
    grid.innerHTML = '<p class="text-ink-muted dark:text-slate-500 text-sm">未检测到计算信息。</p>';
  }
}

// ===== Optimization =====
function renderOptimizationProfile(profile = {}, trajectory = []) {
  clearOptimizationPlayback();
  state.optimizationTrajectory = trajectory || [];
  state.selectedOptimizationIndex = 0;
  const stepSelect = $("#optimizationStepSelect");
  const controls = ["#optPrevButton", "#optNextButton", "#optPlayButton"];
  const meta = $("#optimizationMeta");
  const warning = $("#optimizationWarning");

  if (state.optimizationTrajectory.length > 1) {
    stepSelect.disabled = false;
    controls.forEach(id => $(id).disabled = false);
    stepSelect.innerHTML = state.optimizationTrajectory.map((point, index) => {
      const energyText = Number.isFinite(point.relativeEnergyKcal) ? ` · ${point.relativeEnergyKcal.toFixed(2)} kcal/mol` : "";
      return `<option value="${index}">${point.title || `步 ${point.step}`}${energyText}</option>`;
    }).join("");
    updateOptimizationViewer(0, { syncStructure: false });
    const warnings = profile.warnings || [];
    warning.innerHTML = warnings.length ? warnings.map(item => `<p>${item}</p>`).join("") : "";
    return;
  }

  const steps = profile.steps || [];
  const values = profile.values || [];
  if (!steps.length || !values.length) {
    stepSelect.innerHTML = '<option>无优化步</option>';
    stepSelect.disabled = true;
    controls.forEach(id => $(id).disabled = true);
    meta.innerHTML = "";
    warning.innerHTML = "";
    $("#optimizationChart").innerHTML = `<div class="chart-empty compact"><strong>无优化数据</strong><p>${profile.note || "这可能不是几何优化任务。"}</p></div>`;
    hideCollapsible("optVibSection");
    return;
  }

  showCollapsible("optVibSection");
  stepSelect.innerHTML = steps.map((step, i) => `<option value="${i}">步 ${step}</option>`).join("");
  stepSelect.disabled = steps.length <= 1;
  controls.forEach(id => $(id).disabled = steps.length <= 1);
  meta.innerHTML = `${steps.length} 个能量点；未关联结构帧。`;
  warning.innerHTML = "";
  $("#optimizationChart").innerHTML = renderMiniLineChart({
    labels: steps.map(String), values,
    title: "总能量", unit: profile.unit || "Hartree", color: "#275cd8"
  });
}

function updateOptimizationViewer(index, { syncStructure = true } = {}) {
  const trajectory = state.optimizationTrajectory || [];
  if (!trajectory.length) return;
  const nextIndex = Math.max(0, Math.min(index, trajectory.length - 1));
  state.selectedOptimizationIndex = nextIndex;
  const point = trajectory[nextIndex];
  const select = $("#optimizationStepSelect");
  if (select) select.value = String(nextIndex);

  const energy = Number.isFinite(point.energyHartree) ? `${point.energyHartree.toFixed(8)} Hartree` : "N/A";
  const relative = Number.isFinite(point.relativeEnergyKcal) ? `${point.relativeEnergyKcal.toFixed(3)} kcal/mol` : "N/A";
  const structure = point.structureTitle || (point.xyz ? `帧 ${Number(point.frameIndex) + 1}` : "未关联");

  $("#optimizationMeta").innerHTML = `
    <div><span>步数</span><strong>${point.step}</strong></div>
    <div><span>能量</span><strong>${energy}</strong></div>
    <div><span>相对能量</span><strong>${relative}</strong></div>
    <div><span>结构</span><strong>${structure}</strong></div>`;

  $("#optimizationChart").innerHTML = renderOptimizationTrajectoryChart(trajectory, nextIndex);
  if (syncStructure && point.xyz) {
    if (Number.isInteger(point.frameIndex)) {
      selectStructureFrame(point.frameIndex, { updateMoleculeText: true });
    } else {
      $("#moleculeText").value = point.xyz;
      initMoleculeViewer();
      loadMoleculeToViewer(point.xyz);
    }
  }
}

function clearOptimizationPlayback() {
  if (state.optimizationTimer) { clearInterval(state.optimizationTimer); state.optimizationTimer = null; }
  state.optimizationPlaying = false;
  if ($("#optPlayButton")) $("#optPlayButton").textContent = "播放";
}

export function stepOptimization(delta) {
  const length = state.optimizationTrajectory.length;
  if (!length) return;
  const next = (state.selectedOptimizationIndex + delta + length) % length;
  updateOptimizationViewer(next);
  if (state.optimizationPlaying && next === length - 1 && delta > 0) clearOptimizationPlayback();
}

export function clearOptPlayback() { clearOptimizationPlayback(); }
export function updateOptViewer(index) { updateOptimizationViewer(index); }

// ===== Vibrational =====
function renderVibrationalProfile(profile = {}) {
  const modes = profile.modes || [];
  const select = $("#vibrationSelect");
  if (!modes.length) {
    select.innerHTML = '<option>无振动模式</option>';
    select.disabled = true;
    $("#vibrationChart").innerHTML = `<div class="chart-empty compact"><strong>无红外光谱</strong><p>${profile.note || "频率输出中没有 IR 强度数据。"}</p></div>`;
    return;
  }
  showCollapsible("optVibSection");
  select.disabled = false;
  select.innerHTML = modes.map(m => `<option value="${m.index}">模式 ${m.index} · ${Number(m.frequency).toFixed(1)} cm&sup1;</option>`).join("");
  renderSpectrum(modes, Number(select.value || modes[0].index));
}

// ===== AI Interpretation (summary + collapsible detail) =====
function renderInterpretation(result) {
  const section = $("#interpretationSection");
  const meta = $("#interpretationMeta");
  const summary = $("#interpretationSummary");
  const content = $("#interpretationContent");

  const hasOpenClaw = result.mode === "openclaw" && result.openclawExplanations;
  const hasAgentFindings = result.agentFindings?.length;

  if (!hasOpenClaw && !hasAgentFindings) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");

  if (hasOpenClaw) {
    meta.textContent = `${result.openclawModel || ""} · ${result.openclawSkill || ""} · ${(result.openclawDuration / 1000).toFixed(1)}s`;
    const { brief, full } = splitInterpretation(result.openclawExplanations);
    summary.innerHTML = brief;
    if (full) {
      content.innerHTML = formatInterpretationText(full);
      content.closest("details").classList.remove("hidden");
    } else {
      content.closest("details").classList.add("hidden");
    }
  } else {
    meta.textContent = `${result.agentFindings.length} 个智能体 · ${result.mode || "local"}`;
    const first = result.agentFindings[0];
    summary.innerHTML = `<strong>${first.agent || "智能体 1"}:</strong> ${(first.finding || "").slice(0, 200)}...`;
    content.innerHTML = renderAgentFindingsInline(result.agentFindings);
    content.closest("details").classList.remove("hidden");
  }
}

// Split interpretation text: short preview → summary, full text → detail
function splitInterpretation(text) {
  if (!text) return { brief: "", full: "" };

  let cleaned = text
    .replace(/```[\s\S]*?```\s*/g, "") // strip code blocks
    .trim();

  if (!cleaned) return { brief: "（解读内容为空，请检查后端输出）", full: "" };

  // Show first ~300 chars as summary preview; always keep full text for detail
  const previewLen = 300;
  let brief = cleaned.slice(0, previewLen).trim();
  // Don't cut mid-word or mid-tag
  if (cleaned.length > previewLen) {
    brief = brief.replace(/\*\*?[^*]*$/, "").trim(); // remove partial markdown bold
    if (brief.length > 0) brief += "…";
  }

  const full = cleaned.length > previewLen ? cleaned : "";
  return { brief: formatInterpretationText(brief), full };
}

function renderAgentFindingsInline(findings) {
  return findings.map((item, i) => {
    const isOC = item.openclawEnhanced;
    return `
    <div class="interpretation-block${isOC ? " openclaw-enhanced" : ""}">
      <h4>${item.agent || `智能体 ${i + 1}`}${isOC ? ' <span class="openclaw-badge">🦞</span>' : ""}</h4>
      <p>${item.finding || item}</p>
      ${item.warnings?.length ? `<p class="warning-text">⚠ ${item.warnings.join("; ")}</p>` : ""}
    </div>`;
  }).join("");
}

// ===== Learning Goals =====
function renderLearningGoals(goals) {
  if (!goals.length) { hideCollapsible("trainingSection"); return; }
  showCollapsible("trainingSection");
  $("#learningGoals").innerHTML = goals.map(item => `
    <div class="goal-card">
      <span>${item.concept || ""}</span>
      <strong>${item.evidence || ""}</strong>
      <p>${item.outcome || item}</p>
    </div>`).join("");
}

// ===== Quiz =====
function renderQuiz(quiz) {
  if (!quiz.length) return;
  showCollapsible("trainingSection");
  $("#quizList").innerHTML = quiz.map((item, i) => `
    <div class="quiz-card">
      <span class="quiz-type">${item.type || `Q${i + 1}`}</span>
      <h3>${item.question || item}</h3>
      <p>${item.rubric || ""}</p>
    </div>`).join("");
}

// ===== Suggestions =====
function renderSuggestions(items) {
  if (!items.length) return;
  showCollapsible("trainingSection");
  $("#researchSuggestions").innerHTML = items.map((item, i) =>
    `<div class="suggestion-card"><span>${String(i + 1).padStart(2, "0")}</span><p>${item}</p></div>`
  ).join("");
}

// ===== Grading Content =====
function renderGradingContent(result) {
  const g = result.grading || {};
  $("#gradingContent").innerHTML = `
    <p><strong>优点：</strong>${(g.strengths || []).join("；") || "无"}</p>
    <ul>${(g.improvements || []).map(s => `<li>${s}</li>`).join("")}</ul>
    <p><strong>教师备注：</strong>${g.teacherNote || "无"}</p>`;
}

function renderRubric(rubric) {
  if (!rubric.length) return;
  $("#rubricTable").innerHTML = `
    <div class="rubric-row rubric-head"><span>维度</span><span>权重</span><span>等级</span><span>反馈</span></div>
    ${rubric.map(r => `
      <div class="rubric-row">
        <strong>${r.dimension}</strong><span>${r.weight}%</span>
        <span class="level-pill">${r.level}</span><p>${r.comment}</p>
      </div>`).join("")}`;
}

function renderStudentFeedback(result) {
  const g = result.grading || {};
  const improvements = g.improvements || ["补充数据引用和单位", "加强机理与数据的关联", "设计对照实验"];
  $("#studentFeedback").innerHTML = `
    <div class="student-feedback-card">
      <span class="text-[10px] font-bold tracking-wide text-brand-500 dark:text-brand-400 uppercase">学生反馈</span>
      <h3>前 3 项改进建议</h3>
      <ol>${improvements.slice(0, 3).map(s => `<li>${s}</li>`).join("")}</ol>
      <p>${g.teacherNote || ""}</p>
    </div>`;
}

function renderBenchmarks(benchmarks) {
  $("#literatureBenchmarks").innerHTML = benchmarks.map(b =>
    `<div class="benchmark-item"><strong>${b.topic}</strong><span>${b.benchmark}</span><p>${b.note || ""}</p></div>`
  ).join("");
}

function renderNextSteps(items) {
  $("#nextSteps").innerHTML = items.map(s => `<li>${s}</li>`).join("");
}

// ===== Architecture =====
function renderArchitecture(architecture) {
  $("#architectureLanes").innerHTML = architecture.map(lane => `
    <div class="arch-lane">
      <h3>${lane.layer}</h3>
      <div>${(lane.items || []).map(s => `<span>${s}</span>`).join("")}</div>
    </div>`).join("");
}

// ===== OpenClaw Grade Feedback =====
function renderOpenClawGradeFeedback(result) {
  const section = $("#openclawGradeSection");
  const content = $("#openclawGradeContent");
  const meta = $("#openclawGradeMeta");
  if (!result.openclawFeedback || result.mode !== "openclaw") {
    section.classList.add("hidden");
    return;
  }
  section.classList.remove("hidden");
  meta.textContent = `${result.openclawModel || "Qwen3_6"} · ${result.openclawSkill || "chemclaw-grade"} · ${(result.openclawDuration / 1000).toFixed(1)}s`;
  content.innerHTML = formatInterpretationText(result.openclawFeedback);
}

// ===== Text Formatting (markdown → readable HTML) =====
function formatInterpretationText(text) {
  if (!text) return "";

  // Escape HTML
  let html = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Code blocks (before other transformations)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g,
    (_, lang, code) => `<pre class="md-pre"><code class="md-code">${code.trim()}</code></pre>`);

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="md-inline">$1</code>');

  // Bold / italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Table: detect |---| pattern
  html = html.replace(/(\|[^\n]+\|\n\|[-:| ]+\|\n(?:\|[^\n]+\|\n?)+)/g, (match) => {
    const lines = match.trim().split("\n").filter(l => !/^[-:| ]+$/.test(l.trim()));
    if (lines.length < 2) return match;
    const headerCells = lines[0].split("|").filter(c => c.trim());
    const bodyRows = lines.slice(1).map(row => {
      const cells = row.split("|").filter(c => c.trim());
      return `<tr>${cells.map(c => `<td>${c.trim()}</td>`).join("")}</tr>`;
    });
    return `<table class="md-table"><thead><tr>${headerCells.map(c => `<th>${c.trim()}</th>`).join("")}</tr></thead><tbody>${bodyRows.join("")}</tbody></table>`;
  });

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 class="md-h3">$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h3 class="md-h3">$1</h3>');

  // Unordered lists — group consecutive - items
  html = html.replace(/((?:^- .+\n?)+)/gm, (match) => {
    const items = match.trim().split("\n").filter(l => l.startsWith("- "));
    return `<ul class="md-ul">${items.map(l => `<li>${l.slice(2)}</li>`).join("")}</ul>`;
  });

  // Ordered lists — group consecutive 1. items
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, (match) => {
    const items = match.trim().split("\n").filter(l => /^\d+\./.test(l));
    return `<ol class="md-ol">${items.map(l => `<li>${l.replace(/^\d+\.\s*/, "")}</li>`).join("")}</ol>`;
  });

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote class="md-quote">$1</blockquote>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr class="md-hr">');

  // Paragraphs: wrap remaining text lines in <p>
  // Split by double newline, filter out already-wrapped blocks
  const blocks = html.split(/\n{2,}/);
  html = blocks.map(block => {
    const trimmed = block.trim();
    if (!trimmed) return "";
    // Already an HTML block element?
    if (/^<(?:h[1-4]|ul|ol|pre|table|blockquote|hr)/.test(trimmed)) return trimmed;
    // Single <br>-separated lines → wrap in <p>
    return `<p class="md-p">${trimmed.replace(/\n/g, "<br>")}</p>`;
  }).filter(Boolean).join("\n");

  return html;
}

// ===== Collapsible helpers =====
function hideCollapsible(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("hidden");
}

function showCollapsible(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("hidden");
}

// ===== Role UI =====
export function updateRoleUi() {
  const isStudent = state.role === "student";
  document.body.dataset.role = state.role;
  $("#roleCaption").textContent = isStudent
    ? "学生视角：个人反馈、训练、改进建议"
    : "教师视角：学习目标、评分标准、教学价值";
  $$(".role-btn").forEach(b => b.classList.toggle("active", b.dataset.role === state.role));
  $$(".teacher-only").forEach(el => el.hidden = isStudent);
}
