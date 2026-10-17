// ===== Global State =====
export const state = {
  analysisResult: null,
  gradeResult: null,
  datasetName: "sample-chemclaw-output.txt",
  role: "teacher",
  viewer: null,
  viewerInitialized: false,
  // idle | loading | ready | fallback — 3D 渲染器是按需加载的，信息条要能说清当前状态
  viewerStatus: "idle",
  structures: [],
  optimizationTrajectory: [],
  selectedOptimizationIndex: 0,
  optimizationPlaying: false,
  optimizationTimer: null,
  framesPlaying: false,
  vibrationPlaying: false,
  theme: localStorage.getItem("chemclaw-theme") || "light"
};

// ===== DOM Helpers =====
export const $ = (s) => document.querySelector(s);
export const $$ = (s) => [...document.querySelectorAll(s)];

// ===== Label Map =====
export const labels = {
  calculationType: "计算类型",
  activationBarrier: "能垒",
  homoLumoGap: "HOMO-LUMO",
  imaginaryFrequency: "虚频",
  adsorptionEnergy: "吸附能",
  zeroPointEnergy: "零点能(ZPE)",
  enthalpy: "焓(H)",
  gibbsFreeEnergy: "自由能(G)",
  confidence: "置信度"
};
