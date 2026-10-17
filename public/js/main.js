// ===== Main entry =====
import { state, $, $$ } from "./state.js";
import { analyze, grade, fetchStatus } from "./api.js";
import {
  extractMoleculeFromText, sampleDataset, sampleReport, sampleMolecule,
} from "./viewer.js";
import {
  renderAnalysisResult, renderGradeResult, updateRoleUi, selectStructureFrame,
  stepOptimization, clearOptPlayback, updateOptViewer, switchTab,
} from "./renderers.js";
import { addMessage, askAgent } from "./chat.js";
import { initTheme, toggleTheme } from "./theme.js";
import { closeChartZoom } from "./charts.js";

const SESSION_KEY = "chemclaw-session-v2";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------------- theme ---------------- */
initTheme();
$("#themeToggle").addEventListener("click", () => {
  const theme = toggleTheme();
  // The 2D fallback bakes colors into its SVG, so redraw it on theme change.
  if (!state.viewerInitialized && state.structures.length) {
    const index = Number($("#structureSelect").value) || 0;
    selectStructureFrame(index, { updateMoleculeText: false });
  }
  if (theme === "dark") toast("已切换到深色模式");
});

/* ---------------- status ---------------- */
async function loadStatus() {
  const data = await fetchStatus();
  updateStatusDisplay(data);
}

function updateStatusDisplay(data) {
  const chip = $("#agentStatus");
  const text = chip.querySelector(".status-text");
  let tone = "is-ready";
  let label = "";
  let title = "";

  if (data?.openclaw) {
    label = `OpenClaw · ${data.model || "Qwen"}`;
    title = `OpenClaw 已连接 · 技能：${(data.skills || []).join("、") || "—"}`;
  } else if (data?.agent === "deepseek") {
    label = `DeepSeek · ${data.model || "chat"}`;
    title = "DeepSeek API 模式";
  } else if (data?.agent === "openai") {
    label = `OpenAI · ${data.model || "gpt"}`;
    title = "OpenAI API 模式";
  } else if (data?.agent === "offline") {
    label = "后端离线";
    tone = "is-offline";
    title = "无法连接 /api/status";
  } else {
    label = "演示模式";
    tone = "is-demo";
    // 把降级原因放进 tooltip：演示现场被问到"为什么不是 OpenClaw"时有据可查。
    title = data?.openclawReason
      ? `未启用 OpenClaw：${data.openclawReason}；当前使用本地规则引擎`
      : "未配置 API Key，使用本地规则引擎";
  }

  chip.className = `status-chip ${tone}`;
  chip.title = title;
  text.textContent = label;
}

/* ---------------- toast & alert ---------------- */
let toastTimer = null;
function toast(message) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
  requestAnimationFrame(() => el.classList.add("is-visible"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("is-visible");
    setTimeout(() => el.classList.add("hidden"), 220);
  }, 2200);
}

let retryAction = null;
function showAlert(title, message, retry = null) {
  const el = $("#formAlert");
  el.querySelector("strong").textContent = title;
  el.querySelector("p").textContent = message;
  el.classList.remove("hidden");
  retryAction = retry;
  $("#alertRetry").hidden = !retry;
}

function clearAlert() {
  $("#formAlert").classList.add("hidden");
  retryAction = null;
}

$("#alertRetry").addEventListener("click", () => {
  const action = retryAction;
  clearAlert();
  action?.();
});

/* ---------------- busy state ---------------- */
function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    if (!button.dataset.idle) button.dataset.idle = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${label}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.idle) button.innerHTML = button.dataset.idle;
  }
}

/* ---------------- pipeline ---------------- */
function startPipeline() {
  const pipeline = $("#pipeline");
  const steps = $$("#pipeline .pipeline-steps li");
  $("#emptyState").classList.add("hidden");
  pipeline.classList.remove("hidden");
  steps.forEach((step) => step.classList.remove("is-active", "is-done"));
  steps[0]?.classList.add("is-active");

  const started = Date.now();
  let current = 0;
  const timer = setInterval(() => {
    if (current >= steps.length - 1) return;
    steps[current].classList.remove("is-active");
    steps[current].classList.add("is-done");
    current += 1;
    steps[current].classList.add("is-active");
  }, 700);

  const finish = () => {
    clearInterval(timer);
    steps.forEach((step) => {
      step.classList.remove("is-active");
      step.classList.add("is-done");
    });
  };

  return {
    async done() {
      finish();
      const minimum = 900 - (Date.now() - started);
      if (minimum > 0) await sleep(minimum);
      pipeline.classList.add("hidden");
    },
    stop() {
      clearInterval(timer);
      pipeline.classList.add("hidden");
      if (!state.analysisResult) $("#emptyState").classList.remove("hidden");
    },
  };
}

/* ---------------- input helpers ---------------- */
function detectFormat(text = "") {
  if (/Gaussian,\s*Inc\.|Normal termination|SCF Done/i.test(text)) return "Gaussian";
  if (/ORCA|SCF done|FINAL SINGLE POINT ENERGY/i.test(text)) return "ORCA";
  if (/^\s*\d+\s*\r?\n/.test(text)) return "XYZ";
  return "通用文本";
}

function setDetectedFormat(label) {
  const chip = $("#detectedFormat");
  if (!label) {
    chip.classList.add("hidden");
    chip.textContent = "";
    return;
  }
  chip.textContent = `检测到 ${label}`;
  chip.classList.remove("hidden");
}

function showFileChip(file) {
  const chip = $("#datasetFileChip");
  chip.querySelector(".file-chip-name").textContent = file.name;
  chip.querySelector(".file-chip-size").textContent = formatBytes(file.size);
  chip.classList.remove("hidden");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function applyDatasetFile(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showAlert("文件太大", "当前限制为 5 MB，请截取关键片段后再上传。");
    return;
  }
  const text = await file.text();
  state.datasetName = file.name;

  if (/\.xyz$/i.test(file.name)) {
    $("#moleculeText").value = text;
    $("#coordDetails").open = true;
    setDetectedFormat("XYZ 坐标");
    toast("已载入坐标文件");
    return;
  }

  $("#datasetText").value = text;
  $("#pasteDetails").open = true;
  $("#moleculeText").value = extractMoleculeFromText(text);
  $("#moleculeFile").value = "";
  state.structures = [];
  state.analysisResult = null;
  clearOptPlayback();
  showFileChip(file);
  setDetectedFormat(detectFormat(text));
  toast(`已载入 ${file.name}`);
}

/* ---------------- sample ---------------- */
function hasUserContent() {
  return ["#datasetText", "#moleculeText", "#studentReport"].some((id) => $(id)?.value.trim());
}

function fillSample({ report = false } = {}) {
  state.datasetName = "sample-chemclaw-output.txt";
  $("#datasetText").value = sampleDataset;
  $("#moleculeText").value = sampleMolecule;
  $("#pasteDetails").open = true;
  if (report) $("#studentReport").value = sampleReport;
  setDetectedFormat("Gaussian");
  $("#datasetFileChip").classList.add("hidden");
}

function loadSample({ report = true } = {}) {
  if (hasUserContent() && !window.confirm("载入示例会覆盖当前输入，继续吗？")) return false;
  fillSample({ report });
  toast("示例数据已载入");
  return true;
}

/* ---------------- analyze ---------------- */
async function handleAnalyze() {
  const datasetText = $("#datasetText").value.trim();
  if (!datasetText) {
    showAlert("还没有计算数据", "先上传 Gaussian / ORCA 输出文件，或展开「粘贴计算数据」填写内容。");
    $("#pasteDetails").open = true;
    $("#datasetText").focus();
    return;
  }

  clearAlert();
  clearInterval(frameTimer);
  frameTimer = null;
  state.framesPlaying = false;
  state.vibrationPlaying = false;
  clearOptPlayback();

  const button = $("#analyzeButton");
  setBusy(button, true, "分析中…");
  const pipeline = startPipeline();

  try {
    const moleculeText = $("#moleculeText").value.trim() || extractMoleculeFromText($("#studentReport").value);
    const result = await analyze({
      datasetName: state.datasetName,
      datasetText,
      moleculeText,
    });
    result.analyzedAt = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    state.analysisResult = result;
    state.gradeResult = null;
    await pipeline.done();
    renderAnalysisResult(result);
    saveSession(result);
    addMessage("assistant", `分析完成：${result.projectTitle || "计算结果"}。可以继续追问指标含义，或切到「批改」评价学生报告。`);
    toast("分析完成");
    if (window.matchMedia("(max-width: 980px)").matches) {
      $("#analysisPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (error) {
    pipeline.stop();
    showAlert("分析失败", error.message, handleAnalyze);
    addMessage("assistant", `分析失败：${error.message}`);
  } finally {
    setBusy(button, false);
  }
}

/* ---------------- grade ---------------- */
async function handleGrade() {
  const report = $("#studentReport").value.trim();
  if (!report) {
    showAlert("还没有学生报告", "在左侧「学生实验报告」中粘贴报告内容后再批改。");
    $("#studentReport").focus();
    return;
  }

  clearAlert();
  const button = $("#gradeButton");
  setBusy(button, true, "批改中…");

  try {
    const analysisContext = state.analysisResult
      ? {
          metrics: state.analysisResult.metrics,
          explanations: state.analysisResult.agentFindings?.find((item) => item.explanations)?.explanations || [],
        }
      : {};
    const result = await grade({ studentReport: report, analysisContext });
    state.gradeResult = result;
    renderGradeResult(result);
    addMessage("assistant", `批改完成：综合得分 ${result.grading?.score ?? "—"}。`);
    toast("批改完成");
    if (window.matchMedia("(max-width: 980px)").matches) {
      $("#analysisPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (error) {
    showAlert("批改失败", error.message, handleGrade);
    addMessage("assistant", `批改失败：${error.message}`);
  } finally {
    setBusy(button, false);
  }
}

/* ---------------- copy & rerun ---------------- */
function buildMarkdown(result) {
  if (!result) return "";
  const lines = [`# ${result.projectTitle || "计算化学分析"}`, ""];
  if (result.summary) lines.push(result.summary, "");

  const metrics = [
    ["能垒", result.metrics?.activationBarrier],
    ["HOMO-LUMO gap", result.metrics?.homoLumoGap],
    ["虚频", result.metrics?.imaginaryFrequency],
    ["SCF 能量", result.metrics?.scfEnergy ? `${Number(result.metrics.scfEnergy).toFixed(6)} Hartree` : null],
  ].filter(([, value]) => value);

  if (metrics.length) {
    lines.push("## 关键指标", "");
    metrics.forEach(([label, value]) => lines.push(`- ${label}：${value}`));
    lines.push("");
  }

  if (result.agentFindings?.length) {
    lines.push("## AI 解读", "");
    result.agentFindings.forEach((item) => {
      lines.push(`### ${item.agent || "智能体"}`, "", item.finding || "", "");
      if (item.warnings?.length) lines.push(`> ⚠ ${item.warnings.join("；")}`, "");
    });
  }
  return lines.join("\n").trim();
}

async function copyResult() {
  if (!state.analysisResult) return;
  try {
    await navigator.clipboard.writeText(buildMarkdown(state.analysisResult));
    toast("解读已复制到剪贴板");
  } catch {
    showAlert("复制失败", "浏览器未授予剪贴板权限，请手动选择文本复制。");
  }
}

/* ---------------- session ---------------- */
function saveSession(result) {
  try {
    const inputs = {
      datasetText: $("#datasetText").value,
      moleculeText: $("#moleculeText").value,
      studentReport: $("#studentReport").value,
      datasetName: state.datasetName,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify({ at: Date.now(), result, inputs }));
  } catch { /* quota or private mode */ }
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const { at, result, inputs } = JSON.parse(raw);
    if (!result?.metrics || Date.now() - at > 12 * 60 * 60 * 1000) return;

    if (inputs) {
      if (inputs.datasetText) {
        $("#datasetText").value = inputs.datasetText;
        $("#pasteDetails").open = true;
      }
      if (inputs.moleculeText) $("#moleculeText").value = inputs.moleculeText;
      if (inputs.studentReport) $("#studentReport").value = inputs.studentReport;
      if (inputs.datasetName) state.datasetName = inputs.datasetName;
      setDetectedFormat(inputs.datasetText ? detectFormat(inputs.datasetText) : "");
    }

    result.analyzedAt = `上次分析 ${new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
    state.analysisResult = result;
    renderAnalysisResult(result);
  } catch { /* corrupt payload */ }
}

/* ---------------- tabs ---------------- */
$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.view));
  tab.addEventListener("keydown", (event) => {
    const tabs = $$(".tab").filter((item) => !item.hidden);
    const index = tabs.indexOf(tab);
    let next = null;
    if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
    else if (event.key === "ArrowLeft") next = tabs[(index - 1 + tabs.length) % tabs.length];
    else if (event.key === "Home") next = tabs[0];
    else if (event.key === "End") next = tabs[tabs.length - 1];
    if (!next) return;
    event.preventDefault();
    switchTab(next.dataset.view, { focus: true });
  });
});

/* ---------------- role ---------------- */
$$(".role-btn").forEach((button) => {
  button.addEventListener("click", () => {
    state.role = button.dataset.role;
    updateRoleUi();
    toast(state.role === "student" ? "已切换到学生视图" : "已切换到教师视图");
  });
});

/* ---------------- chat drawer ---------------- */
const chatPanel = $("#chatPanel");
const chatBackdrop = $("#chatBackdrop");
const chatToggle = $("#chatToggle");
let chatLastFocus = null;

function syncChatA11y() {
  const open = chatPanel.classList.contains("is-open");
  chatPanel.setAttribute("aria-hidden", String(!open));
  chatPanel.inert = !open;
  chatToggle.setAttribute("aria-expanded", String(open));
  chatBackdrop.classList.toggle("hidden", !open);
  document.body.style.overflow = open ? "hidden" : "";
}

function openChat() {
  chatLastFocus = document.activeElement;
  chatPanel.classList.add("is-open");
  syncChatA11y();
  setTimeout(() => $("#chatInput").focus(), 120);
}

function closeChat() {
  chatPanel.classList.remove("is-open");
  syncChatA11y();
  chatLastFocus?.focus?.();
}

chatToggle.addEventListener("click", () => {
  if (chatPanel.classList.contains("is-open")) closeChat();
  else openChat();
});
$("#chatClose").addEventListener("click", closeChat);
chatBackdrop.addEventListener("click", closeChat);
syncChatA11y();

/* ---------------- files ---------------- */
$("#datasetFile").addEventListener("change", () => {
  const file = $("#datasetFile").files?.[0];
  if (file) applyDatasetFile(file);
});

$("#moleculeFile").addEventListener("change", async () => {
  const file = $("#moleculeFile").files?.[0];
  if (!file) return;
  $("#moleculeText").value = await file.text();
  setDetectedFormat("XYZ 坐标");
  toast(`已载入坐标 ${file.name}`);
});

const dropZone = $("#dropZone");
["dragenter", "dragover"].forEach((type) => {
  dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragover");
  });
});
["dragleave", "drop"].forEach((type) => {
  dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragover");
  });
});
dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) applyDatasetFile(file);
});

$("#datasetFileClear").addEventListener("click", () => {
  $("#datasetFile").value = "";
  $("#datasetFileChip").classList.add("hidden");
  setDetectedFormat("");
});

$("#datasetText").addEventListener("input", () => {
  const value = $("#datasetText").value.trim();
  setDetectedFormat(value ? detectFormat(value) : "");
  if (value) $("#datasetFileChip").classList.add("hidden");
});

/* ---------------- actions ---------------- */
$("#analyzeButton").addEventListener("click", handleAnalyze);
$("#gradeButton").addEventListener("click", handleGrade);
$("#copyResultButton").addEventListener("click", copyResult);
$("#rerunButton").addEventListener("click", handleAnalyze);
$("#loadSampleButton").addEventListener("click", () => {
  if (loadSample()) handleAnalyze();
});
$("#emptySampleButton").addEventListener("click", () => {
  if (loadSample()) handleAnalyze();
});
$("#emptyUploadButton").addEventListener("click", () => $("#datasetFile").click());
$("#gradingSampleButton").addEventListener("click", () => {
  if (loadSample({ report: true })) {
    $("#studentReport").scrollIntoView({ block: "center" });
    handleGrade();
  }
});

$("#structureSelect").addEventListener("change", () => {
  selectStructureFrame(Number($("#structureSelect").value));
});

let frameTimer = null;
$("#playFramesButton").addEventListener("click", () => {
  if (state.structures.length <= 1) return;
  if (!state.framesPlaying) {
    state.framesPlaying = true;
    $("#playFramesButton").textContent = "停止";
    let frameIndex = Number($("#structureSelect").value) || 0;
    frameTimer = setInterval(() => {
      frameIndex = (frameIndex + 1) % state.structures.length;
      selectStructureFrame(frameIndex, { updateMoleculeText: true });
    }, 700);
  } else {
    clearInterval(frameTimer);
    frameTimer = null;
    state.framesPlaying = false;
    $("#playFramesButton").textContent = "播放帧序列";
  }
});

$("#vibrationSelect").addEventListener("change", () => {
  const modes = state.analysisResult?.vibrationalProfile?.modes || [];
  import("./charts.js").then((module) => module.renderSpectrum(modes, Number($("#vibrationSelect").value)));
});

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
  state.optimizationTimer = setInterval(() => stepOptimization(1), 700);
});

$("#optimizationChart").addEventListener("click", (event) => {
  const point = event.target.closest?.(".optimization-point");
  if (!point) return;
  updateOptViewer(Number(point.dataset.index));
});

$("#playVibrationButton").addEventListener("click", () => {
  if (state.vibrationPlaying) {
    state.vibrationPlaying = false;
    $("#playVibrationButton").textContent = "频谱高亮";
    return;
  }
  state.vibrationPlaying = true;
  $("#playVibrationButton").textContent = "已高亮";
  toast("红外图中已高亮所选模式");
});

/* ---------------- chat form ---------------- */
$("#chatForm").addEventListener("submit", askAgent);
$$(".quick-prompts button").forEach((button) => {
  button.addEventListener("click", () => {
    $("#chatInput").value = button.dataset.prompt;
    $("#chatInput").focus();
  });
});

/* ---------------- chart modal ---------------- */
$("#chartModalClose").addEventListener("click", closeChartZoom);
$("#chartModal").querySelector(".chart-modal-backdrop")?.addEventListener("click", closeChartZoom);
$("#chartModal").addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const focusables = $$("#chartModal button, #chartModal [href], #chartModal [tabindex]:not([tabindex='-1'])");
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

/* ---------------- keyboard ---------------- */
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    if (document.activeElement === $("#studentReport")) handleGrade();
    else handleAnalyze();
  }
  if (event.key === "Escape") {
    const modal = $("#chartModal");
    if (!modal.classList.contains("hidden")) { closeChartZoom(); return; }
    if (chatPanel.classList.contains("is-open")) closeChat();
  }
});

/* ---------------- init ---------------- */
updateRoleUi();
if (!$("#chatLog").children.length) {
  addMessage("assistant", "我可以解释能垒、虚频、HOMO-LUMO 能隙等概念，也能根据当前数据出题和批改报告。先加载示例数据试试。");
}
restoreSession();
loadStatus();
