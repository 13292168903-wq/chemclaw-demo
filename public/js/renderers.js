// ===== Renderers =====
// 结果页 / 批改页 / 角色与标签页状态。
import { state, $, $$, labels } from "./state.js";
import {
  renderEnergyChart, renderMiniLineChart, renderOptimizationTrajectoryChart,
  renderSpectrum, attachEnergyChartZoom, attachOptimizationChartZoom,
} from "./charts.js";
import {
  initMoleculeViewer, loadMoleculeToViewer, parseXYZAtoms,
  computeBonds, clearMoleculeViewer, resolveMoleculeText,
} from "./viewer.js";

const DEFAULT_ARCHITECTURE = [  { layer: "数据层", items: ["Gaussian / ORCA / VASP 输出", "CSV / XYZ 结构文件", "学生实验报告"] },
  { layer: "工具层", items: ["格式解析器", "能量与频率抽取", "3D 结构渲染", "报告结构识别"] },
  { layer: "智能体层", items: ["数据解析 Agent", "化学解释 Agent", "教学设计 Agent", "批改反馈 Agent"] },
  { layer: "教学层", items: ["学习目标映射", "自动出题", "评分量表批改", "科研路径建议"] },
];

const DEFAULT_ROADMAP = [
  "补充 Gaussian / ORCA / VASP 专用解析器，覆盖更多输出字段",
  "把课程知识点映射到题库标签体系，支持按知识点出题",
  "接入 OpenClaw 插件工具链，可视化多智能体编排过程",
];

// 3D 渲染器是按需加载的：它可能在首屏之后才就绪，就绪时把当前结构补画上去，
// 而不是让用户停在 2D 投影里。
document.addEventListener("viewer:ready", () => {
  syncViewerLabels();
  const index = Number($("#structureSelect")?.value || 0);
  const visible = !$("#resultView")?.classList.contains("hidden");
  if (visible && state.structures?.length && Number.isFinite(index)) {
    selectStructureFrame(index, { updateMoleculeText: false });
  }
});

document.addEventListener("viewer:fallback", () => syncViewerLabels());

// ===== Result page =====
export function renderAnalysisResult(result) {
  $("#emptyState").classList.add("hidden");
  $("#pipeline").classList.add("hidden");
  $("#resultView").classList.remove("hidden");
  resetGradeView();

  renderHero(result);
  renderVerdict(result);
  renderComputationDetails(result.basicInfo || {}, result.fileDetails || {});
  renderStructures(result.structures || []);
  renderKeyStats(result.metrics || {});
  renderEnergyChart(result.chart || {});
  attachEnergyChartZoom(result.chart || {});
  attachEnergyChartClick();
  renderOptimizationProfile(result.optimizationProfile || {}, result.optimizationTrajectory || []);
  renderVibrationalProfile(result.vibrationalProfile || {});
  renderInterpretation(result);
  renderLearningGoals(result.learningGoals || []);
  renderQuiz(result.quiz || []);
  renderSuggestions(result.researchSuggestions || []);
  renderArchitecture(result.architecture || DEFAULT_ARCHITECTURE);
  renderRoadmap(result.nextSteps || DEFAULT_ROADMAP);
  updateRoleUi();
  switchTab("result");
}

function renderHero(result) {
  // hybrid = 部分 Agent 走了 AI、其余降级到本地规则。以前这种情况会被
  // 一律标成"AI 智能体"，现在如实说明混合来源。
  const modeText = result.mode === "openclaw"
    ? `OpenClaw · ${result.openclawModel || "Qwen"}`
    : result.mode === "ai-agent"
      ? `AI 智能体${result.model ? ` · ${result.model}` : ""}`
      : result.mode === "hybrid"
        ? `AI + 本地规则${result.aiAgentCount ? `（${result.aiAgentCount}/${result.agentCount || 3}）` : ""}`
        : "本地演示";
  $("#resultMode").textContent = modeText;
  const stamp = result.analyzedAt || "";
  $("#resultTime").textContent = stamp.startsWith("上次分析")
    ? stamp
    : stamp ? `分析于 ${stamp}` : "刚刚完成";
  $("#projectTitle").textContent = result.projectTitle || "计算化学分析";
  $("#summary").textContent = result.summary || "";
}

// The single most important scientific conclusion goes above everything else.
function renderVerdict(result) {
  const banner = $("#verdictBanner");
  const basic = result.basicInfo || {};
  const file = result.fileDetails || {};
  const normal = basic.normalTermination ?? file.normalTermination;
  const converged = file.converged;
  const warnings = (result.agentFindings?.[0]?.warnings || []).filter(Boolean);

  let title = "";
  let detail = "";
  let danger = false;

  if (normal === false) {
    title = "计算未正常结束，结论仅供教学演示";
    detail = "输出文件中没有检测到 Normal termination，几何优化或频率计算可能未完成。建议先核对任务是否异常终止，再使用这些数据。";
    danger = true;
  } else if (converged === false) {
    title = "几何优化尚未收敛";
    detail = "能量与频率基于未完全收敛的结构，数值可能随继续优化而变化。";
  }

  if (!title && warnings.length) {
    title = "数据存在提示";
    detail = warnings[0];
  }

  if (!title) {
    banner.classList.add("hidden");
    banner.innerHTML = "";
    return;
  }

  banner.className = `verdict${danger ? " is-danger" : ""}`;
  banner.innerHTML = `
    <span class="verdict-icon" aria-hidden="true"></span>
    <div>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(detail)}</p>
    </div>`;
}

// ===== Structures =====
function renderStructures(structures = []) {
  state.structures = structures.length ? structures : [];
  const select = $("#structureSelect");
  const play = $("#playFramesButton");
  const badge = $("#openclawDataBadge");

  if (!state.structures.length) {
    const molText = resolveMoleculeText();
    if (molText) state.structures = [{ title: "输入的分子结构", atomCount: null, xyz: molText }];
  }

  if (!state.structures.length) {
    select.innerHTML = "<option>无结构数据</option>";
    select.disabled = true;
    play.disabled = true;
    play.textContent = "无序列";
    clearMoleculeViewer();
    updateViewerInfoBar("");
    return;
  }

  select.innerHTML = state.structures.map((frame, index) =>
    `<option value="${index}">${escapeHtml(frame.title || `帧 ${index + 1}`)}${frame.atomCount ? ` · ${frame.atomCount} 原子` : ""}</option>`
  ).join("");
  select.disabled = state.structures.length <= 1;
  clearMoleculeViewer({ message: "正在加载分子结构", detail: "正在准备三维渲染。" });
  initMoleculeViewer();

  const pdbData = state.analysisResult?.pdbData;
  const moleculeText = state.structures[0]?.xyz || resolveMoleculeText();
  const load = () => {
    if (pdbData) loadMoleculeToViewer(pdbData, "pdb");
    else loadMoleculeToViewer(moleculeText, "xyz");
  };
  // Wait for Mol* creation so we don't flash the 2D fallback on capable browsers.
  Promise.resolve(initMoleculeViewer()).then(load).catch(load);

  play.disabled = state.structures.length <= 1;
  play.textContent = state.structures.length > 1 ? "播放帧序列" : "无序列";
  updateViewerInfoBar(moleculeText);

  if (badge) badge.classList.toggle("hidden", state.analysisResult?.mode !== "openclaw");
}

function syncViewerLabels() {
  const is3d = Boolean(state.viewerInitialized && state.viewer);
  const status = state.viewerStatus || "idle";
  const engine = $("#viewerEngine");
  if (engine) engine.textContent = is3d ? "3D 交互" : status === "loading" ? "3D 加载中" : "2D 投影";

  const hint = $("#viewerHint");
  if (hint) {
    hint.textContent = is3d
      ? "拖拽旋转 · 滚轮缩放"
      : status === "loading"
        ? "已显示 2D 投影，3D 就绪后自动切换"
        : status === "fallback"
          ? "未启用 WebGL，显示 2D 投影"
          : "2D 投影";
  }

  const bar = $("#viewerInfoBar");
  if (bar) bar.title = is3d ? "可拖拽旋转、滚轮缩放" : "当前显示分子结构的二维投影";
}

function updateViewerInfoBar(xyzText) {
  const atoms = parseXYZAtoms(xyzText);
  const bonds = atoms.length > 0 ? computeBonds(atoms) : [];
  if ($("#viewerAtomCount")) $("#viewerAtomCount").textContent = `${atoms.length} 个原子`;
  if ($("#viewerBondCount")) $("#viewerBondCount").textContent = `${bonds.length} 根键`;
  syncViewerLabels();
}

export function selectStructureFrame(index, { updateMoleculeText = true } = {}) {
  const frame = state.structures[Number(index)];
  if (!frame?.xyz) return;
  const select = $("#structureSelect");
  if (select && Number(select.value) !== Number(index)) select.value = String(index);
  if (updateMoleculeText) $("#moleculeText").value = frame.xyz;
  state.framesPlaying = false;
  if ($("#playFramesButton")) {
    $("#playFramesButton").textContent = state.structures.length > 1 ? "播放帧序列" : "无序列";
  }
  initMoleculeViewer();
  const pdbData = state.analysisResult?.pdbData;
  if (pdbData && Number(index) === 0) loadMoleculeToViewer(pdbData, "pdb");
  else loadMoleculeToViewer(frame.xyz, "xyz");
  updateViewerInfoBar(frame.xyz);
}

// ===== Key stats =====
function renderKeyStats(metrics) {
  const priority = ["activationBarrier", "homoLumoGap", "imaginaryFrequency"];
  const units = { activationBarrier: "kcal·mol⁻¹", homoLumoGap: "eV", imaginaryFrequency: "cm⁻¹" };
  const entries = priority
    .map((key) => [key, metrics[key]])
    .filter(([, value]) => value !== undefined && value !== null && value !== "");

  const row = $("#keyStatsRow");
  if (!entries.length) {
    row.classList.add("hidden");
    return;
  }
  row.classList.remove("hidden");
  row.innerHTML = entries.map(([key, value]) => {
    const raw = String(value);
    const cleaned = raw.replace(/\s*(kcal\/mol|kcal·mol⁻¹|eV|cm⁻¹|Hartree)\s*$/i, "");
    const display = cleaned === "未检出" ? "无" : cleaned;
    const unit = units[key] || "";
    const sub = key === "imaginaryFrequency" && cleaned === "未检出" ? "极小点" : unit;
    return `<div class="key-stat" title="${escapeHtml(labels[key] || key)}：${escapeHtml(raw)}">
      <span class="ks-label">${escapeHtml(labels[key] || key)}</span>
      <span class="ks-value">${escapeHtml(display)}</span>
      <span class="ks-unit">${escapeHtml(sub)}</span>
    </div>`;
  }).join("");
}

// ===== Computation details =====
function renderComputationDetails(basic = {}, file = {}) {
  const method = basic.route || file.route || "";
  const task = basic.taskType || "";
  const software = basic.software || "";
  const normal = basic.normalTermination != null ? basic.normalTermination : file.normalTermination;
  const converged = file.converged;
  const chargeSpin = basic.chargeMultiplicity || (file.charge != null ? `${file.charge} / ${file.multiplicity ?? "-"}` : null);

  const tags = [];
  if (method) tags.push(`<span class="compu-tag method">${escapeHtml(method)}</span>`);
  if (task) tags.push(`<span class="compu-tag">${escapeHtml(task)}</span>`);
  if (software) tags.push(`<span class="compu-tag">${escapeHtml(software)}</span>`);
  if (chargeSpin) tags.push(`<span class="compu-tag">电荷/自旋 ${escapeHtml(chargeSpin)}</span>`);
  if (normal != null) tags.push(`<span class="compu-tag ${normal ? "good" : "warn"}">${normal ? "正常结束" : "异常终止"}</span>`);
  if (converged != null) tags.push(`<span class="compu-tag ${converged ? "good" : "warn"}">${converged ? "已收敛" : "未收敛"}</span>`);

  const tagsEl = $("#computationTags");
  if (tags.length) {
    tagsEl.classList.remove("hidden");
    tagsEl.innerHTML = tags.join("");
  } else {
    tagsEl.classList.add("hidden");
  }

  const items = [
    ["文件名", basic.fileName || file.fileName],
    ["格式", file.format],
    ["大小", file.byteSize ? `${(file.byteSize / 1024).toFixed(1)} KB` : null],
    ["行数", file.lineCount],
    ["软件", basic.software],
    ["方法", basic.route || file.route],
    ["任务类型", basic.taskType],
    ["电荷 / 自旋", chargeSpin],
    ["能量点", basic.outputCount || file.energyPointCount],
    ["频率数", file.frequencyCount],
    ["结构帧", file.structureFrameCount],
    ["正常结束", normal != null ? (normal ? "是" : "否") : null],
    ["收敛", converged != null ? (converged ? "是" : "否") : null],
  ].filter(([, value]) => value !== null && value !== undefined && value !== "");

  const section = $("#computationDetailsSection");
  const grid = $("#computationDetailsGrid");
  if (items.length) {
    section?.classList.remove("hidden");
    grid.innerHTML = items.map(([label, value]) =>
      `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`
    ).join("");
  } else {
    section?.classList.add("hidden");
    grid.innerHTML = "";
  }
}

function attachEnergyChartClick() {
  const host = $("#energyChart");
  if (!host) return;
  host.querySelectorAll(".energy-point").forEach((point) => {
    const activate = () => {
      const index = Number(point.dataset.index);
      if (state.structures.length > index) {
        selectStructureFrame(index, { updateMoleculeText: true });
      }
    };
    point.addEventListener("click", (event) => { event.stopPropagation(); activate(); });
    point.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); }
    });
  });
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
    sectionVisible("optVibSection", true);
    stepSelect.disabled = false;
    controls.forEach((id) => { $(id).disabled = false; });
    stepSelect.innerHTML = state.optimizationTrajectory.map((point, index) => {
      const energyText = Number.isFinite(point.relativeEnergyKcal) ? ` · ${point.relativeEnergyKcal.toFixed(2)} kcal·mol⁻¹` : "";
      return `<option value="${index}">${escapeHtml(point.title || `步 ${point.step}`)}${energyText}</option>`;
    }).join("");
    updateOptimizationViewer(0, { syncStructure: false });
    warning.innerHTML = (profile.warnings || []).map((item) => `<p>${escapeHtml(item)}</p>`).join("");
    return;
  }

  const steps = profile.steps || [];
  const values = profile.values || [];
  if (!steps.length || !values.length) {
    stepSelect.innerHTML = "<option>无优化步</option>";
    stepSelect.disabled = true;
    controls.forEach((id) => { $(id).disabled = true; });
    meta.innerHTML = "";
    warning.innerHTML = "";
    $("#optimizationChart").innerHTML = `<div class="chart-empty compact"><strong>没有优化数据</strong><p>${escapeHtml(profile.note || "当前任务可能不是几何优化。")}</p></div>`;
    sectionVisible("optVibSection", false);
    return;
  }

  sectionVisible("optVibSection", true);
  stepSelect.innerHTML = steps.map((step, i) => `<option value="${i}">第 ${step} 步</option>`).join("");
  stepSelect.disabled = steps.length <= 1;
  controls.forEach((id) => { $(id).disabled = steps.length <= 1; });
  meta.innerHTML = `<div><span>能量点</span><strong>${steps.length}</strong></div><div><span>结构帧</span><strong>未关联</strong></div>`;
  warning.innerHTML = "";
  $("#optimizationChart").innerHTML = renderMiniLineChart({
    labels: steps.map((step) => `第 ${step} 步`),
    values,
    title: "总能量随优化步变化",
    unit: profile.unit || "Hartree",
    color: "#275cd8",
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

  const energy = Number.isFinite(point.energyHartree) ? `${point.energyHartree.toFixed(6)} Hartree` : "—";
  const relative = Number.isFinite(point.relativeEnergyKcal) ? `${point.relativeEnergyKcal.toFixed(2)} kcal·mol⁻¹` : "—";
  const structure = point.structureTitle || (point.xyz ? `帧 ${Number(point.frameIndex) + 1}` : "未关联");

  $("#optimizationMeta").innerHTML = `
    <div><span>优化步</span><strong>${point.step}</strong></div>
    <div><span>能量</span><strong>${escapeHtml(energy)}</strong></div>
    <div><span>相对能量</span><strong>${escapeHtml(relative)}</strong></div>
    <div><span>结构</span><strong>${escapeHtml(structure)}</strong></div>`;

  $("#optimizationChart").innerHTML = renderOptimizationTrajectoryChart(trajectory, nextIndex);
  attachOptimizationChartZoom(state.optimizationTrajectory, nextIndex);
  if (syncStructure && point.xyz) {
    if (Number.isInteger(point.frameIndex)) selectStructureFrame(point.frameIndex, { updateMoleculeText: true });
    else {
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
    select.innerHTML = "<option>无振动模式</option>";
    select.disabled = true;
    $("#vibrationChart").innerHTML = `<div class="chart-empty compact"><strong>没有红外光谱</strong><p>${escapeHtml(profile.note || "频率输出中没有 IR 强度数据。")}</p></div>`;
    return;
  }
  sectionVisible("optVibSection", true);
  select.disabled = false;
  select.innerHTML = modes.map((mode) =>
    `<option value="${mode.index}">模式 ${mode.index} · ${Number(mode.frequency).toFixed(1)} cm⁻¹</option>`
  ).join("");
  const hasIntensity = modes.some((mode) => Number(mode.intensity) > 0);
  const play = $("#playVibrationButton");
  play.disabled = !hasIntensity;
  play.textContent = hasIntensity ? "频谱高亮" : "无强度数据";
  renderSpectrum(modes, Number(select.value || modes[0].index));
}

// ===== Interpretation =====
function renderInterpretation(result) {
  const section = $("#interpretationSection");
  const meta = $("#interpretationMeta");
  const summary = $("#interpretationSummary");
  const content = $("#interpretationContent");
  const details = content.closest("details");

  const isOpenClaw = result.mode === "openclaw" && result.openclawExplanations;
  const findings = result.agentFindings?.length;

  if (!isOpenClaw && !findings) {
    section.classList.add("hidden");
    return;
  }
  section.classList.remove("hidden");

  if (isOpenClaw) {
    meta.textContent = `${result.openclawModel || "Qwen"} · ${((result.openclawDuration || 0) / 1000).toFixed(1)}s`;
    const { brief, full } = splitInterpretation(result.openclawExplanations);
    summary.innerHTML = brief;
    details.classList.remove("is-static");
    details.open = false;
    content.innerHTML = full ? formatInterpretationText(full) : "";
    details.classList.toggle("hidden", !full);
  } else {
    meta.textContent = `${findings} 个智能体协同 · ${modeSourceLabel(result)}`;
    summary.innerHTML = "";
    // Local mode returns three short findings; show them inline instead of
    // hiding them behind an extra click.
    details.classList.add("is-static");
    details.open = true;
    details.classList.remove("hidden");
    content.innerHTML = renderAgentFindingsInline(result.agentFindings);
  }
}

function splitInterpretation(text) {
  if (!text) return { brief: "", full: "" };
  const cleaned = text.replace(/```[\s\S]*?```\s*/g, "").trim();
  if (!cleaned) return { brief: "（解读内容为空，请检查后端输出）", full: "" };
  const previewLen = 320;
  let brief = cleaned.slice(0, previewLen).trim();
  if (cleaned.length > previewLen) {
    brief = brief.replace(/\*\*?[^*]*$/, "").trim();
    if (brief.length) brief += "…";
  }
  return { brief: formatInterpretationText(brief), full: cleaned.length > previewLen ? cleaned : "" };
}

function renderAgentFindingsInline(findings) {
  return findings.map((item, index) => {
    const isOC = item.openclawEnhanced;
    const text = typeof item.finding === "string" ? item.finding : "";
    const warnings = item.warnings || [];
    return `
      <div class="interpretation-block${isOC ? " openclaw-enhanced" : ""}">
        <h4>${escapeHtml(item.agent || `智能体 ${index + 1}`)}</h4>
        <p>${escapeHtml(text)}</p>
        ${warnings.length ? `<p class="warning-text">⚠ ${escapeHtml(warnings.join("；"))}</p>` : ""}
      </div>`;
  }).join("");
}

// ===== Training =====
function renderLearningGoals(goals) {
  if (!goals.length) { sectionVisible("trainingSection", false); return; }
  sectionVisible("trainingSection", true);
  $("#learningGoals").innerHTML = goals.map((item) => `
    <div class="goal-card">
      <span>${escapeHtml(item.concept || "")}</span>
      <strong>${escapeHtml(item.evidence || "")}</strong>
      <p>${escapeHtml(item.outcome || "")}</p>
    </div>`).join("");
}

function renderQuiz(quiz) {
  if (!quiz.length) { $("#quizList").innerHTML = ""; return; }
  sectionVisible("trainingSection", true);
  $("#quizList").innerHTML = quiz.map((item, index) => `
    <div class="quiz-card">
      <span class="quiz-type">${escapeHtml(item.type || `第 ${index + 1} 题`)}</span>
      <h3>${escapeHtml(item.question || "")}</h3>
      <p>${escapeHtml(item.rubric || "")}</p>
    </div>`).join("");
}

function renderSuggestions(items) {
  if (!items.length) { $("#researchSuggestions").innerHTML = ""; return; }
  sectionVisible("trainingSection", true);
  $("#researchSuggestions").innerHTML = items.map((item, index) =>
    `<div class="suggestion-card"><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(item)}</p></div>`
  ).join("");
}

// ===== Grading =====
function resetGradeView() {
  // A new analysis invalidates the previous grade.
  $("#gradingEmpty").classList.remove("hidden");
  $("#gradingContentWrap").classList.add("hidden");
  $("#gradeScoreValue").textContent = "—";
  $("#gradeRing")?.style.setProperty("--score", 0);
  const band = $("#gradeBand");
  if (band) { band.className = "grade-band"; band.textContent = "待评分"; }
  $("#rubricTable").innerHTML = "";
  $("#studentFeedback").innerHTML = "";
  $("#openclawGradeSection").classList.add("hidden");
}

export function renderGradeResult(result) {
  if (!result.grading) return;

  $("#gradingEmpty").classList.add("hidden");
  $("#gradingContentWrap").classList.remove("hidden");

  renderScore(result);
  renderGradingContent(result);
  renderRubric(result.rubric || []);
  renderStudentFeedback(result);
  renderOpenClawGradeFeedback(result);

  // Benchmarks live on the analysis result, not the grading payload.
  const benchmarks = result.literatureBenchmarks?.length
    ? result.literatureBenchmarks
    : state.analysisResult?.literatureBenchmarks || [];
  renderBenchmarks(benchmarks);

  renderRoadmap(state.analysisResult?.nextSteps || DEFAULT_ROADMAP);
  updateRoleUi();
  switchTab("grading");
}

function renderScore(result) {
  const g = result.grading || {};
  const ring = $("#gradeRing");
  const score = Number(g.score);
  const hasScore = Number.isFinite(score);
  $("#gradeScoreValue").textContent = hasScore ? String(Math.round(score)) : "—";
  ring.style.setProperty("--score", hasScore ? Math.max(0, Math.min(100, score)) : 0);

  let band = "待评分";
  let tone = "";
  if (hasScore) {
    if (score >= 80) { band = "良好"; tone = "is-good"; }
    else if (score >= 60) { band = "中等"; tone = "is-mid"; }
    else { band = "待加强"; tone = "is-low"; }
  }
  const bandEl = $("#gradeBand");
  bandEl.className = `grade-band ${tone}`.trim();
  bandEl.textContent = band;

  const heuristic = result.mode !== "ai-agent" && result.mode !== "openclaw";

  $("#gradeHeadline").textContent = hasScore
    ? `${band} · ${heuristic ? "结构自检得分" : "综合得分"}`
    : "尚未评分";
  const dims = result.rubric?.length || 0;
  const strengths = (g.strengths || []).length;
  $("#gradeMeta").textContent = hasScore
    ? `${dims} 个评分维度 · ${strengths} 项优势 · ${gradingModeLabel(result)}`
    : "请提供学生报告后重新批改";
}

// 本地模式的"分数"来自关键词与结构检查，不是人工评分 —— 界面上必须说清楚，
// 否则学生会把它当成老师给的成绩。
function gradingModeLabel(result) {
  if (result.mode === "openclaw") return "OpenClaw 批改";
  if (result.mode === "ai-agent") return "AI 批改";
  if (result.mode === "hybrid") return "AI + 本地规则批改";
  return "本地启发式自检（关键词规则，非人工评分）";
}

function modeSourceLabel(result) {
  if (result.mode === "ai-agent") return "AI 生成";
  if (result.mode === "hybrid") return "AI + 本地规则";
  return "本地规则";
}

function renderGradingContent(result) {
  const g = result.grading || {};
  const strengths = (g.strengths || []).filter(Boolean);
  const improvements = (g.improvements || []).filter(Boolean);

  $("#gradingContent").innerHTML = `
    <p><strong>优点</strong>　${strengths.length ? escapeHtml(strengths.join("；")) : "暂未识别到明确优势。"}</p>
    <h4 class="block-title" style="margin-top:14px">改进建议</h4>
    ${improvements.length
      ? `<ul>${improvements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : `<p class="muted-note">这份报告覆盖了主要评分点，暂无明显短板。</p>`}
    <p class="teacher-note"><strong>教师备注</strong>　${escapeHtml(g.teacherNote || "无")}</p>`;
}

function renderRubric(rubric) {
  const table = $("#rubricTable");
  if (!rubric.length) {
    table.innerHTML = "";
    table.dataset.empty = "1";
    table.classList.add("hidden");
    return;
  }
  delete table.dataset.empty;
  table.classList.remove("hidden");
  table.innerHTML = `
    <div class="rubric-row rubric-head"><span>维度</span><span>权重</span><span>等级</span><span>反馈</span></div>
    ${rubric.map((item) => {
      const weight = Number(item.weight) || 0;
      const score = Number.isFinite(Number(item.score))
        ? Number(item.score)
        : ({ 良好: 0.8, 中等: 0.55, 待加强: 0.25 }[item.level] ?? 0.5) * weight;
      const pct = weight ? Math.max(4, Math.min(100, Math.round((score / weight) * 100))) : 0;
      const tone = item.level === "良好" ? "is-good" : item.level === "中等" ? "is-mid" : item.level === "待加强" ? "is-low" : "";
      return `
        <div class="rubric-row">
          <strong>${escapeHtml(item.dimension || "")}</strong>
          <span>${weight}%</span>
          <span class="level-pill ${tone}">${escapeHtml(item.level || "—")}</span>
          <p>${escapeHtml(item.comment || "")}</p>
          <div class="rubric-bar" role="img" aria-label="${escapeHtml(item.dimension || "")}得分 ${pct}%"><i style="width:${pct}%"></i></div>
        </div>`;
    }).join("")}`;
}

function renderStudentFeedback(result) {
  const g = result.grading || {};
  const improvements = (g.improvements || []).slice(0, 3);
  if (!improvements.length) {
    $("#studentFeedback").innerHTML = "";
    return;
  }
  $("#studentFeedback").innerHTML = `
    <div class="student-feedback-card">
      <h3>下一步可以这样改</h3>
      <ol>${improvements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>
    </div>`;
}

function renderBenchmarks(benchmarks = []) {
  const card = $("#benchmarkCard");
  if (!benchmarks.length) {
    card?.classList.add("hidden");
    if (card) card.dataset.empty = "1";
    $("#literatureBenchmarks").innerHTML = "";
    return;
  }
  card?.classList.remove("hidden");
  if (card) delete card.dataset.empty;
  $("#literatureBenchmarks").innerHTML = benchmarks.map((item) => `
    <div class="benchmark-item">
      <strong>${escapeHtml(item.topic || "")}</strong>
      <span>${escapeHtml(item.benchmark || "")}</span>
      <p>${escapeHtml(item.note || "")}</p>
    </div>`).join("");
}

function renderRoadmap(items = []) {
  const list = $("#nextSteps");
  if (!list) return;
  list.innerHTML = (items.length ? items : DEFAULT_ROADMAP)
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
}

// ===== Architecture =====
function renderArchitecture(lanes) {
  const host = $("#architectureLanes");
  if (!host) return;
  host.innerHTML = (lanes?.length ? lanes : DEFAULT_ARCHITECTURE).map((lane) => `
    <div class="arch-lane">
      <h3>${escapeHtml(lane.layer || "")}</h3>
      <div>${(lane.items || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
    </div>`).join("");
}

// ===== OpenClaw grade =====
function renderOpenClawGradeFeedback(result) {
  const section = $("#openclawGradeSection");
  const content = $("#openclawGradeContent");
  const meta = $("#openclawGradeMeta");
  if (!result.openclawFeedback || result.mode !== "openclaw") {
    section.classList.add("hidden");
    return;
  }
  section.classList.remove("hidden");
  meta.textContent = `${result.openclawModel || "Qwen"} · ${((result.openclawDuration || 0) / 1000).toFixed(1)}s`;
  content.innerHTML = formatInterpretationText(result.openclawFeedback);
}

// ===== Markdown-lite =====
export function formatInterpretationText(text) {
  if (!text) return "";
  let html = String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g,
    (_, lang, code) => `<pre class="md-pre"><code class="md-code">${code.trim()}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code class="md-inline">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  html = html.replace(/(\|[^\n]+\|\n\|[-:| ]+\|\n(?:\|[^\n]+\|\n?)+)/g, (match) => {
    const lines = match.trim().split("\n").filter((line) => !/^[-:| ]+$/.test(line.trim()));
    if (lines.length < 2) return match;
    const headerCells = lines[0].split("|").filter((cell) => cell.trim());
    const bodyRows = lines.slice(1).map((row) => {
      const cells = row.split("|").filter((cell) => cell.trim());
      return `<tr>${cells.map((cell) => `<td>${cell.trim()}</td>`).join("")}</tr>`;
    });
    return `<table class="md-table"><thead><tr>${headerCells.map((cell) => `<th>${cell.trim()}</th>`).join("")}</tr></thead><tbody>${bodyRows.join("")}</tbody></table>`;
  });

  html = html.replace(/^### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 class="md-h3">$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h3 class="md-h3">$1</h3>');

  html = html.replace(/((?:^- .+\n?)+)/gm, (match) => {
    const items = match.trim().split("\n").filter((line) => line.startsWith("- "));
    return `<ul class="md-ul">${items.map((line) => `<li>${line.slice(2)}</li>`).join("")}</ul>`;
  });
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, (match) => {
    const items = match.trim().split("\n").filter((line) => /^\d+\./.test(line));
    return `<ol class="md-ol">${items.map((line) => `<li>${line.replace(/^\d+\.\s*/, "")}</li>`).join("")}</ol>`;
  });
  html = html.replace(/^> (.+)$/gm, '<blockquote class="md-quote">$1</blockquote>');
  html = html.replace(/^---$/gm, '<hr class="md-hr">');

  return html.split(/\n{2,}/).map((block) => {
    const trimmed = block.trim();
    if (!trimmed) return "";
    if (/^<(?:h[1-4]|ul|ol|pre|table|blockquote|hr)/.test(trimmed)) return trimmed;
    return `<p class="md-p">${trimmed.replace(/\n/g, "<br>")}</p>`;
  }).filter(Boolean).join("\n");
}

// ===== helpers =====
function sectionVisible(id, visible) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

export function switchTab(name, { focus = false } = {}) {
  const view = name === "result" ? "resultView" : `${name}Page`;
  $$(".tab").forEach((tab) => {
    const active = tab.dataset.view === name;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  });
  $$(".view-page").forEach((page) => page.classList.remove("is-active"));
  const target = document.getElementById(view);
  if (target) target.classList.add("is-active");

  if (name === "result") {
    setTimeout(() => {
      try { state.viewer?.plugin?.layout?.events?.update?.emit("size"); } catch { /* best effort */ }
    }, 120);
  }
}

// ===== Role UI =====
export function updateRoleUi() {
  const isStudent = state.role === "student";
  document.body.dataset.role = state.role;

  $("#roleCaption").textContent = isStudent
    ? "学生视图：个人反馈、训练与改进建议"
    : "教师视图：学习目标、评分标准、教学价值";

  $$(".role-btn").forEach((button) => {
    const active = button.dataset.role === state.role;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  $$(".teacher-only").forEach((el) => {
    el.hidden = isStudent || el.dataset.empty === "1";
  });

  const archTab = $("#tab-architecture");
  if (archTab) archTab.hidden = isStudent;

  if (isStudent && $("#architecturePage")?.classList.contains("is-active")) {
    switchTab("result");
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
