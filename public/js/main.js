// ===== Main Entry Point =====
import { state, $, $$ } from "./state.js";
import { analyze, grade, fetchStatus } from "./api.js";
import { extractMoleculeFromText, sampleDataset, sampleReport, sampleMolecule } from "./viewer.js";
import { renderAnalysisResult, renderGradeResult, updateRoleUi, selectStructureFrame, stepOptimization, clearOptPlayback, updateOptViewer } from "./renderers.js";
import { addMessage, askAgent } from "./chat.js";
import { initTheme, toggleTheme } from "./theme.js";
import { renderSpectrum, closeChartZoom } from "./charts.js";

// ===== Theme =====
initTheme();
$("#themeToggle").addEventListener("click", toggleTheme);

// ===== Status =====
async function loadStatus() {
  const status = $("#agentStatus");

  // Timeout protection: if status API takes >8s, show fallback
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 8000));
  const data = await Promise.race([fetchStatus(), timeout]);

  if (!data) {
    status.innerHTML = '<span class="text-amber-500">连接中...</span>';
    // Retry once more
    setTimeout(async () => {
      try {
        const retryData = await fetchStatus();
        updateStatusDisplay(status, retryData);
      } catch {
        status.textContent = "后端离线";
      }
    }, 3000);
    return;
  }

  updateStatusDisplay(status, data);
}

function updateStatusDisplay(status, data) {
  if (data.openclaw) {
    status.innerHTML = `<span class="openclaw-badge">🦞 OpenClaw</span> ${data.model}`;
    status.title = `OpenClaw 已连接 · Skills: ${data.skills?.join(", ") || "N/A"}`;
  } else if (data.agent === "deepseek") {
    status.textContent = `DeepSeek · ${data.model}`;
    status.title = "DeepSeek API 模式";
  } else if (data.agent === "openai") {
    status.textContent = `OpenAI · ${data.model}`;
    status.title = "OpenAI API 模式";
  } else if (data.agent === "offline") {
    status.textContent = "后端离线";
  } else {
    status.textContent = "本地演示智能体";
  }
  status.classList.add("ready");
}

// ===== Load Sample =====
function loadSample() {
  state.datasetName = "sample-chemclaw-output.txt";
  $("#datasetText").value = sampleDataset;
  $("#moleculeText").value = sampleMolecule;
  $("#studentReport").value = sampleReport;
}

// ===== Analyze Handler =====
async function handleAnalyze() {
  const btn = $("#analyzeButton");
  btn.disabled = true;
  btn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> 分析中...';

  try {
    const moleculeText = $("#moleculeText").value.trim() || extractMoleculeFromText($("#studentReport").value);
    const result = await analyze({
      datasetName: state.datasetName,
      datasetText: $("#datasetText").value,
      moleculeText
    });
    state.analysisResult = result;
    state.gradeResult = null;
    renderAnalysisResult(result);
    addMessage("assistant", result.mode === "openclaw"
      ? `🦞 OpenClaw 分析完成 · ${result.openclawSkill} · ${result.openclawModel} · ${(result.openclawDuration / 1000).toFixed(1)}s`
      : `分析完成 · ${result.agentFindings?.length || 3} 个智能体执行 · ${result.mode}`);
  } catch (error) {
    addMessage("assistant", `分析失败：${error.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"/></svg> 分析数据';
  }
}

// ===== Grade Handler =====
async function handleGrade() {
  const report = $("#studentReport").value.trim();
  if (!report) { addMessage("assistant", "请先输入学生报告再进行批改。"); return; }

  const btn = $("#gradeButton");
  btn.disabled = true;
  btn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> 批改中...';

  try {
    const analysisContext = state.analysisResult ? {
      metrics: state.analysisResult.metrics,
      explanations: state.analysisResult.agentFindings?.find(f => f.explanations)?.explanations || []
    } : {};

    const result = await grade({ studentReport: report, analysisContext });
    state.gradeResult = result;
    renderGradeResult(result);
    addMessage("assistant", result.mode === "openclaw"
      ? `🦞 OpenClaw 批改完成 · ${result.openclawSkill} · 得分：${result.grading?.score ?? "N/A"}`
      : `批改完成 · 得分：${result.grading?.score ?? "N/A"}`);
  } catch (error) {
    addMessage("assistant", `批改失败：${error.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z"/></svg> 批改报告';
  }
}

// ===== Event Bindings =====
$("#analyzeButton").addEventListener("click", handleAnalyze);
$("#gradeButton").addEventListener("click", handleGrade);
$("#loadSampleButton").addEventListener("click", loadSample);
$("#chatForm").addEventListener("submit", askAgent);

// File upload: computation output
$("#datasetFile").addEventListener("change", async () => {
  const file = $("#datasetFile").files?.[0];
  if (!file) return;
  state.datasetName = file.name;
  const text = await file.text();
  if (file.name.toLowerCase().endsWith(".xyz")) {
    $("#moleculeText").value = text;
    return;
  }
  $("#datasetText").value = text;
  if (!$("#moleculeText").value.trim()) {
    const extracted = extractMoleculeFromText(text);
    if (extracted) $("#moleculeText").value = extracted;
  }
});

// File upload: molecule
$("#moleculeFile").addEventListener("change", async () => {
  const file = $("#moleculeFile").files?.[0];
  if (!file) return;
  $("#moleculeText").value = await file.text();
});

// Structure frame select
$("#structureSelect").addEventListener("change", () => {
  selectStructureFrame(Number($("#structureSelect").value));
});

// Play frames — Mol* doesn't have the same animate API as 3Dmol,
// so we manually cycle through frames with a timer
let frameTimer = null;
$("#playFramesButton").addEventListener("click", () => {
  if (state.structures.length <= 1) return;
  if (!state.framesPlaying) {
    state.framesPlaying = true;
    $("#playFramesButton").textContent = "停止";
    let frameIdx = Number($("#structureSelect").value) || 0;
    frameTimer = setInterval(() => {
      frameIdx = (frameIdx + 1) % state.structures.length;
      selectStructureFrame(frameIdx, { updateMoleculeText: true });
    }, 650);
  } else {
    clearInterval(frameTimer);
    frameTimer = null;
    state.framesPlaying = false;
    $("#playFramesButton").textContent = "播放帧序列";
  }
});

// Vibration select
$("#vibrationSelect").addEventListener("change", () => {
  const modes = state.analysisResult?.vibrationalProfile?.modes || [];
  renderSpectrum(modes, Number($("#vibrationSelect").value));
});

// Optimization controls
$("#optimizationStepSelect").addEventListener("change", () => {
  updateOptViewer(Number($("#optimizationStepSelect").value));
});
$("#optPrevButton").addEventListener("click", () => stepOptimization(-1));
$("#optNextButton").addEventListener("click", () => stepOptimization(1));
$("#optPlayButton").addEventListener("click", () => {
  if (state.optimizationTrajectory.length <= 1) return;
  if (state.optimizationPlaying) { clearOptPlayback(); return; }
  state.optimizationPlaying = true;
  $("#optPlayButton").textContent = "停止";
  state.optimizationTimer = setInterval(() => stepOptimization(1), 650);
});

// Click on optimization chart points
$("#optimizationChart").addEventListener("click", (event) => {
  const point = event.target.closest?.(".optimization-point");
  if (!point) return;
  updateOptViewer(Number(point.dataset.index));
});

// Play vibration — Mol* doesn't support vibration animation via simple API,
// so we show a message about the spectral highlight feature
$("#playVibrationButton").addEventListener("click", () => {
  if (state.vibrationPlaying) {
    state.vibrationPlaying = false;
    $("#playVibrationButton").textContent = "播放振动";
    return;
  }
  // Mol* doesn't have a vibration animation API like 3Dmol
  // Spectral highlight in the IR chart still works
  addMessage("assistant", "Mol* 渲染器支持振动模式的频谱高亮显示。选择不同振动模式可更新红外光谱图。");
  state.vibrationPlaying = true;
  $("#playVibrationButton").textContent = "光谱模式";
});


// Quick prompts
$$(".quick-prompts button").forEach(btn => btn.addEventListener("click", () => {
  $("#chatInput").value = btn.dataset.prompt;
  $("#chatInput").focus();
}));

// Chat toggle
$("#chatToggle").addEventListener("click", () => {
  const panel = $("#chatPanel");
  const collapsed = panel.classList.toggle("collapsed");
  $("#chatToggle").textContent = collapsed ? "对话" : "关闭";
});

// Role switch
$$(".role-btn").forEach(btn => btn.addEventListener("click", () => {
  state.role = btn.dataset.role;
  updateRoleUi();
}));

// Tab switching (result | grading | architecture)
$$(".tab").forEach(btn => btn.addEventListener("click", () => {
  const view = btn.dataset.view;
  $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  $$(".view-page").forEach(p => p.classList.remove("active"));
  const target = view === "result" ? $("#resultView") : $(`#${view}Page`);
  if (target) target.classList.add("active");
  if (view === "result" && state.viewer?.plugin) setTimeout(() => {
    try { state.viewer.plugin.layout.events.update.emit("size"); } catch { /* best effort */ }
  }, 100);
}));

// Chart modal close: click backdrop or close button or ESC
$("#chartModalClose").addEventListener("click", closeChartZoom);
$("#chartModal").querySelector(".chart-modal-backdrop")?.addEventListener("click", closeChartZoom);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeChartZoom(); });

// ===== Initialize =====
updateRoleUi();
// Don't auto-load sample — user clicks "加载样例" to fill the form
loadStatus();
