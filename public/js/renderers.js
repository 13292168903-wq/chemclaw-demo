// ===== Renderers Module =====
import { state, $, $$, labels } from "./state.js";
import { renderEnergyChart, renderMiniLineChart, renderOptimizationTrajectoryChart, renderSpectrum } from "./charts.js";
import { initMoleculeViewer, loadMoleculeToViewer, loadFramesToViewer, resolveMoleculeText, xyzToPdb, parseXYZAtoms, computeBonds } from "./viewer.js";

// ===== Main Analysis Result Renderer =====
export function renderAnalysisResult(result) {
  $("#emptyState").classList.add("hidden");
  $("#resultView").classList.remove("hidden");
  $("#resultMode").textContent = result.mode === "openclaw"
    ? "🦞 OpenClaw · " + (result.openclawModel || "")
    : result.model ? `${result.mode} · ${result.model}` : result.mode;
  $("#projectTitle").textContent = result.projectTitle || "计算化学分析";
  $("#summary").textContent = result.summary || "";
  $("#scoreValue").textContent = state.gradeResult?.grading?.score ?? "--";

  renderMetrics(result.metrics || {});
  renderEnergyChart(result.chart || {});
  renderFileDetails(result.fileDetails || {});
  renderStructures(result.structures || []);
  renderBasicInfo(result.basicInfo || {});
  renderOptimizationProfile(result.optimizationProfile || {}, result.optimizationTrajectory || []);
  renderVibrationalProfile(result.vibrationalProfile || {});
  renderAgentFindings(result.agentFindings || []);
  renderLearningGoals(result.learningGoals || []);
  renderQuiz(result.quiz || []);
  renderSuggestions(result.researchSuggestions || result.nextSteps || []);
  renderArchitecture(result.architecture || []);
  renderBenchmarks(result.literatureBenchmarks || []);
  renderOpenClawExplanation(result);
  updateRoleUi();

  // Switch to overview tab
  $$(".tab").forEach(b => b.classList.remove("active"));
  document.querySelector('.tab[data-view="overview"]')?.classList.add("active");
  $$(".view-page").forEach(p => p.classList.remove("active"));
  $("#overviewPage")?.classList.add("active");
}

// ===== Grading Result Renderer =====
export function renderGradeResult(result) {
  if (result.grading) {
    $("#scoreValue").textContent = result.grading.score ?? "--";
    renderGrading(result);
    renderRubric(result.rubric || []);
    renderStudentFeedback(result);
    renderOpenClawGradeFeedback(result);
    if (result.agentFindings?.length) {
      const existing = $("#agentFindings").innerHTML;
      const gradeCard = result.agentFindings.map(item => `
        <article class="agent-card" style="border-left: 4px solid #b42318">
          <h3>${item.agent || "批改智能体"}</h3>
          <p>${item.finding || ""}</p>
        </article>
      `).join("");
      $("#agentFindings").innerHTML = existing + gradeCard;
    }
  }
  updateRoleUi();
}

// ===== Metrics =====
function renderMetrics(metrics) {
  $("#metricsGrid").innerHTML = Object.entries(metrics).map(([key, value]) =>
    `<div class="metric"><span>${labels[key] || key}</span><strong>${value}</strong></div>`
  ).join("");
}

// ===== File Details =====
function renderFileDetails(details = {}) {
  const items = [
    ["文件格式", details.format],
    ["计算路径", details.route],
    ["电荷/自旋", details.charge !== null && details.charge !== undefined ? `${details.charge} / ${details.multiplicity ?? "-"}` : null],
    ["行数", details.lineCount],
    ["文件大小", details.byteSize ? `${(details.byteSize / 1024).toFixed(1)} KB` : null],
    ["能量点数", details.energyPointCount],
    ["频率数", details.frequencyCount],
    ["结构帧数", details.structureFrameCount],
    ["正常结束", details.normalTermination === null || details.normalTermination === undefined ? null : details.normalTermination ? "是" : "否"],
    ["已收敛", details.converged === null || details.converged === undefined ? null : details.converged ? "是" : "未确认"]
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");

  $("#fileDetailsGrid").innerHTML = items.length ? items.map(([label, value]) => `
    <div class="detail-item"><span>${label}</span><strong>${value}</strong></div>
  `).join("") : '<p class="text-ink-muted dark:text-slate-500 text-sm">未检测到额外文件信息。</p>';
}

// ===== Structures =====
function renderStructures(structures = []) {
  state.structures = structures.length ? structures : [{ title: "输入/样例", atomCount: null, xyz: resolveMoleculeText() }];
  const select = $("#structureSelect");
  select.innerHTML = state.structures.map((frame, index) =>
    `<option value="${index}">${frame.title || `帧 ${index + 1}`}${frame.atomCount ? ` · ${frame.atomCount} 原子` : ""}</option>`
  ).join("");
  select.disabled = state.structures.length <= 1;
  initMoleculeViewer();

  // Use PDB data from backend (OpenClaw) if available, otherwise fall back to XYZ
  const pdbData = state.analysisResult?.pdbData;
  const moleculeText = state.structures[0]?.xyz || resolveMoleculeText();
  setTimeout(() => {
    if (pdbData) {
      loadMoleculeToViewer(pdbData, "pdb");
    } else {
      loadMoleculeToViewer(moleculeText, "xyz");
    }
  }, 200);

  $("#playFramesButton").disabled = state.structures.length <= 1;
  $("#playFramesButton").textContent = state.structures.length > 1 ? "播放帧序列" : "无序列";

  // Update viewer info bar with atom/bond counts
  updateViewerInfoBar(moleculeText);
}

// ===== Update Viewer Info Bar =====
function updateViewerInfoBar(xyzText) {
  const atoms = parseXYZAtoms(xyzText);
  const bonds = atoms.length > 0 ? computeBonds(atoms) : [];
  const atomCountEl = $("#viewerAtomCount");
  const bondCountEl = $("#viewerBondCount");
  const badgeEl = $("#openclawDataBadge");
  const engineEl = $("#viewerEngine");

  if (atomCountEl) atomCountEl.textContent = `${atoms.length} atoms`;
  if (bondCountEl) bondCountEl.textContent = `${bonds.length} bonds`;

  // Show OpenClaw badge if analysis came from OpenClaw
  if (badgeEl && state.analysisResult?.mode === "openclaw") {
    badgeEl.classList.remove("hidden");
    badgeEl.textContent = `🦞 OpenClaw 提供结构数据 · ${state.analysisResult.openclawSkill || "chemclaw-analyze"}`;
  } else if (badgeEl && state.analysisResult?.openclawDataProvided) {
    badgeEl.classList.remove("hidden");
    badgeEl.textContent = `🦞 OpenClaw 提供结构数据`;
  } else if (badgeEl) {
    badgeEl.classList.add("hidden");
  }

  // Update engine tag
  if (engineEl) {
    engineEl.textContent = state.viewerInitialized ? "Mol* Renderer" : "SVG Fallback";
  }
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

  // Prefer PDB data from backend if available
  const pdbData = state.analysisResult?.pdbData;
  if (pdbData) {
    loadMoleculeToViewer(pdbData, "pdb");
  } else {
    loadMoleculeToViewer(frame.xyz, "xyz");
  }
  updateViewerInfoBar(frame.xyz);
}

// ===== Basic Info =====
function renderBasicInfo(info = {}) {
  const items = [
    ["计算软件", info.software],
    ["文件", info.fileName],
    ["任务类型", info.taskType],
    ["方法", info.route],
    ["电荷/自旋", info.chargeMultiplicity],
    ["能量点数", info.outputCount],
    ["正常结束", info.normalTermination === undefined ? null : info.normalTermination ? "是" : "否"]
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");

  $("#basicInfoGrid").innerHTML = items.length ? items.map(([label, value]) => `
    <div class="detail-item"><span>${label}</span><strong>${value}</strong></div>
  `).join("") : '<p class="text-ink-muted dark:text-slate-500 text-sm">未检测到任务信息。</p>';
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
    return;
  }

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
    <div><span>结构</span><strong>${structure}</strong></div>
  `;

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
  const btn = $("#optPlayButton");
  if (btn) btn.textContent = "播放";
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
  select.disabled = false;
  select.innerHTML = modes.map(m => `<option value="${m.index}">模式 ${m.index} · ${Number(m.frequency).toFixed(1)} cm&sup1;</option>`).join("");
  renderSpectrum(modes, Number(select.value || modes[0].index));
}

// ===== Agent Findings =====
function renderAgentFindings(findings) {
  const colors = ["#0f766e", "#2563eb", "#956400"];
  $("#agentFindings").innerHTML = findings.map((item, i) => {
    const isOC = item.openclawEnhanced;
    return `
    <article class="agent-card${isOC ? " openclaw-enhanced" : ""}" style="border-left: 4px solid ${isOC ? "var(--openclaw)" : colors[i % 3]}">
      <h3>${item.agent || `智能体 ${i + 1}`}${isOC ? ' <span class="openclaw-badge">🦞 OpenClaw</span>' : ""}</h3>
      <p>${item.finding || item}</p>
      ${item.warnings?.length ? `<p class="warning-text">⚠ ${item.warnings.join("; ")}</p>` : ""}
    </article>`;
  }).join("");
}

// ===== Learning Goals =====
function renderLearningGoals(goals) {
  $("#learningGoals").innerHTML = goals.map(item => `
    <article class="goal-card">
      <span>${item.concept || ""}</span>
      <strong>${item.evidence || ""}</strong>
      <p>${item.outcome || item}</p>
    </article>
  `).join("");
}

// ===== Quiz =====
function renderQuiz(quiz) {
  $("#quizList").innerHTML = quiz.map((item, i) => `
    <article class="quiz-card">
      <span class="quiz-type">${item.type || `Q${i + 1}`}</span>
      <h3>${item.question || item}</h3>
      <p>${item.rubric || ""}</p>
    </article>
  `).join("");
}

// ===== Grading =====
function renderGrading(result) {
  const g = result.grading || {};
  $("#gradingContent").innerHTML = `
    <p><strong>优点：</strong>${(g.strengths || []).join("；") || "无"}</p>
    <ul>${(g.improvements || []).map(s => `<li>${s}</li>`).join("")}</ul>
    <p><strong>教师备注：</strong>${g.teacherNote || "无"}</p>`;
  $("#nextSteps").innerHTML = (result.nextSteps || []).map(s => `<li>${s}</li>`).join("");
}

function renderRubric(rubric) {
  if (!rubric.length) return;
  $("#rubricTable").innerHTML = `
    <div class="rubric-row rubric-head"><span>维度</span><span>权重</span><span>等级</span><span>反馈</span></div>
    ${rubric.map(r => `
      <div class="rubric-row">
        <strong>${r.dimension}</strong><span>${r.weight}%</span>
        <span class="level-pill">${r.level}</span><p>${r.comment}</p>
      </div>
    `).join("")}`;
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

// ===== Suggestions =====
function renderSuggestions(items) {
  $("#researchSuggestions").innerHTML = items.map((item, i) =>
    `<article class="suggestion-card"><span>${String(i + 1).padStart(2, "0")}</span><p>${item}</p></article>`
  ).join("");
}

// ===== Benchmarks =====
function renderBenchmarks(benchmarks) {
  $("#literatureBenchmarks").innerHTML = benchmarks.map(b =>
    `<div class="benchmark-item"><strong>${b.topic}</strong><span>${b.benchmark}</span><p>${b.note}</p></div>`
  ).join("");
}

// ===== Architecture =====
function renderArchitecture(architecture) {
  $("#architectureLanes").innerHTML = architecture.map(lane => `
    <article class="arch-lane">
      <h3>${lane.layer}</h3>
      <div>${(lane.items || []).map(s => `<span>${s}</span>`).join("")}</div>
    </article>
  `).join("");
}

// ===== Role UI =====
export function updateRoleUi() {
  const isStudent = state.role === "student";
  document.body.dataset.role = state.role;
  $("#roleCaption").textContent = isStudent
    ? "学生视角：个人反馈、训练、改进建议"
    : "教师视角：学习目标、评分标准、教学价值";
  $("#scoreLabel").textContent = isStudent ? "进度" : "报告得分";
  $$(".role-btn").forEach(b => b.classList.toggle("active", b.dataset.role === state.role));
  $$(".teacher-only").forEach(el => el.hidden = isStudent);
}

// ===== OpenClaw AI Explanation =====
function renderOpenClawExplanation(result) {
  const section = $("#openclawSection");
  const content = $("#openclawContent");
  const meta = $("#openclawMeta");

  if (!result.openclawExplanations || result.mode !== "openclaw") {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  meta.textContent = `${result.openclawModel || "Qwen3_6"} · ${result.openclawSkill || "chemclaw-analyze"} · ${(result.openclawDuration / 1000).toFixed(1)}s`;

  // Simple markdown-like rendering
  const html = formatOpenClawText(result.openclawExplanations);
  content.innerHTML = html;
}

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

  const html = formatOpenClawText(result.openclawFeedback);
  content.innerHTML = html;
}

function formatOpenClawText(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/#{1,3}\s+(.+)/g, '<strong class="openclaw-heading">$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code class="openclaw-code">$1</code>')
    .replace(/- (.+)/g, '<div class="openclaw-list-item">• $1</div>')
    .replace(/\d+\.\s+(.+)/g, '<div class="openclaw-list-item openclaw-ordered">$1</div>')
    .replace(/\n{2,}/g, "<br><br>")
    .replace(/\n/g, "<br>");
}
