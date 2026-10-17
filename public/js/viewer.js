// ===== Molecular viewer =====
// Mol* is the primary renderer. It is *not* part of the initial payload: the
// 4.6 MB bundle is injected the first time a structure actually needs to be
// drawn (see `ensureMolstarAssets`), so a visitor who never opens the 3D card
// never downloads it. Mol* also injects its own English "WebGL does not seem
// to be available" panel when context creation fails, which is not something a
// student should see — every path here degrades to the 2D projection instead.

import { state, $ } from "./state.js";
import {
  parseXYZAtoms, parsePdbAtoms, computeBonds, toPDB, projectAtoms2D,
} from "/shared/structure.js";

const MOLSTAR_JS = "/vendor/molstar.js";
const MOLSTAR_CSS = "/vendor/molstar.css";

let molstarViewer = null;
let molstarInitPromise = null;
let viewerLoadToken = 0;
let lastFallbackText = "";
let molstarAssetsPromise = null;

// ===== Lazy asset loading =====
function injectStylesheet(href) {
  if (document.querySelector(`link[data-molstar="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.molstar = href;
  document.head.appendChild(link);
}

/**
 * Load Mol* on demand. Resolves true when `window.molstar.Viewer` exists.
 * Failure is not an error: the caller falls back to the 2D projection.
 */
export function ensureMolstarAssets() {
  if (window.molstar?.Viewer) return Promise.resolve(true);
  if (molstarAssetsPromise) return molstarAssetsPromise;

  molstarAssetsPromise = new Promise((resolve) => {
    injectStylesheet(MOLSTAR_CSS);
    const script = document.createElement("script");
    script.src = MOLSTAR_JS;
    script.async = true;
    script.dataset.molstar = MOLSTAR_JS;
    script.onload = () => resolve(Boolean(window.molstar?.Viewer));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  }).then((ok) => {
    // Allow a later retry (network hiccup) without a page reload.
    if (!ok) molstarAssetsPromise = null;
    return ok;
  });

  return molstarAssetsPromise;
}

// ===== Capability check =====
export function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return false;

    // A context can exist on software rasterizers (SwiftShader, llvmpipe) while
    // Mol* still fails to initialise. Treat those as unsupported up front.
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || "");
    const lose = gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
    if (/swiftshader|software|llvmpipe|basic render/i.test(renderer)) return false;
    return true;
  } catch {
    return false;
  }
}

// Mol* can inject its own English error panel after a failed context creation.
// Keep the friendly 2D fallback and remove that panel if it appears.
function installFallbackGuard(container) {
  if (container.__fallbackGuard) return;
  const observer = new MutationObserver(() => {
    if (container.querySelector(".msp-error") || /WebGL does not seem to be available/i.test(container.textContent || "")) {
      observer.disconnect();
      container.innerHTML = "";
      if (lastFallbackText) renderMoleculeFallback(lastFallbackText);
    }
  });
  observer.observe(container, { childList: true, subtree: true });
  container.__fallbackGuard = observer;
  setTimeout(() => {
    try { observer.disconnect(); } catch { /* already gone */ }
    container.__fallbackGuard = null;
  }, 4000);
}

// ===== Initialize =====
export function initMoleculeViewer() {
  if (state.viewerInitialized && molstarViewer) return Promise.resolve(molstarViewer);
  const container = $("#moleculeViewer");
  if (!container) return Promise.resolve(null);

  if (!supportsWebGL()) {
    // Do not fetch 4.6 MB of Mol* for a machine that cannot run it.
    state.viewerInitialized = false;
    molstarViewer = null;
    state.viewerStatus = "fallback";
    return Promise.resolve(null);
  }

  if (molstarInitPromise) return molstarInitPromise;

  state.viewerStatus = "loading";
  molstarInitPromise = (async () => {
    if (!window.molstar?.Viewer) {
      const ready = await ensureMolstarAssets();
      if (!ready) throw new Error("Mol* 资源加载失败");
    }
    return createMolstarViewer(container);
  })().catch((error) => {
    console.warn("Mol* unavailable, using 2D projection:", error?.message || error);
    molstarInitPromise = null;
    molstarViewer = null;
    state.viewer = null;
    state.viewerInitialized = false;
    state.viewerStatus = "fallback";
    installFallbackGuard(container);
    if (container.querySelectorAll("canvas").length || container.querySelector(".msp-error")) {
      container.innerHTML = "";
    }
    document.dispatchEvent(new CustomEvent("viewer:fallback"));
    return null;
  });

  return molstarInitPromise;
}

function createMolstarViewer(container) {
  const dark = document.documentElement.classList.contains("dark");
  return window.molstar.Viewer.create("moleculeViewer", {
    layoutIsExpanded: false,
    layoutShowControls: false,
    layoutShowRemoteState: false,
    layoutShowSequence: false,
    layoutShowLog: false,
    layoutShowLeftPanel: false,
    layoutShowSession: false,
    viewportShowExpand: false,
    viewportShowSettings: false,
    viewportShowSelectionMode: false,
    viewportShowAnimation: false,
    viewportShowTrajectoryControls: false,
    collapseLeftPanel: true,
    collapseRightPanel: true,
    disableDragAndDrop: true,
  }).then((viewer) => {
    // Mol* can resolve while its canvas failed; verify before trusting it.
    const failed = container.querySelector(".msp-error") || /WebGL does not seem to be available/i.test(container.textContent || "");
    if (failed) throw new Error("WebGL unavailable");

    molstarViewer = viewer;
    state.viewer = viewer;
    state.viewerInitialized = true;
    state.viewerStatus = "ready";
    applyViewerTheme(dark);

    // Keep the canvas in sync when the workbench changes width (drawer, tabs).
    if (!container.__resizeObserver && "ResizeObserver" in window) {
      const observer = new ResizeObserver(() => {
        try { viewer.plugin?.layout?.events?.update?.emit("size"); } catch { /* best effort */ }
      });
      observer.observe(container);
      container.__resizeObserver = observer;
    }

    document.dispatchEvent(new CustomEvent("viewer:ready"));
    return viewer;
  });
}

function applyViewerTheme(isDark) {
  try {
    const canvas = $("#moleculeViewer")?.querySelector("canvas");
    if (canvas) canvas.style.background = isDark ? "#0a121f" : "#f7f9fb";
  } catch { /* theme is cosmetic */ }
}

// ===== Load =====
export function loadMoleculeToViewer(text, format = "auto") {
  const loadToken = ++viewerLoadToken;
  if (!text?.trim()) {
    clearMoleculeViewer({
      message: "未找到分子坐标",
      detail: "请在左侧「分子坐标」中粘贴 XYZ，或上传含坐标的输出文件。",
    });
    return;
  }

  if (!state.viewerInitialized || !molstarViewer) {
    renderMoleculeFallback(text);
    return;
  }

  const detectedFormat = format === "auto" ? detectFormat(text) : format;
  const pdbData = detectedFormat === "xyz" ? xyzToPdb(text) : text;

  clearMolstarStructures();
  molstarViewer.loadStructureFromData(pdbData, "pdb", { dataLabel: "Molecular Structure" })
    .then(() => {
      if (loadToken !== viewerLoadToken) return;
      setTimeout(() => applyPremiumRepresentation(), 250);
    })
    .catch(() => {
      if (loadToken !== viewerLoadToken) return;
      renderMoleculeFallback(text);
    });
}

function clearMolstarStructures() {
  const plugin = molstarViewer?.plugin;
  if (!plugin) return;
  try { plugin.clear?.(); } catch { /* best effort */ }
  try { plugin.managers?.structure?.hierarchy?.clear?.(); } catch { /* best effort */ }
  try { plugin.managers?.interactivity?.lociHighlights?.clearHighlights?.(); } catch { /* best effort */ }
  try { plugin.managers?.structure?.selection?.clear?.(); } catch { /* best effort */ }
  try { plugin.managers?.camera?.reset?.(); } catch { /* best effort */ }
}

export function clearMoleculeViewer({
  message = "未找到分子坐标",
  detail = "请在左侧「分子坐标」中粘贴 XYZ，或上传含坐标的输出文件。",
} = {}) {
  viewerLoadToken++;
  clearMolstarStructures();

  const container = $("#moleculeViewer");
  if (!container) return;
  if (!state.viewerInitialized || !molstarViewer) {
    container.innerHTML = `
      <div class="viewer-placeholder">
        <div>
          <strong>${escapeHtml(message)}</strong>
          <p>${escapeHtml(detail)}</p>
        </div>
      </div>`;
  }
}

function applyPremiumRepresentation() {
  const plugin = molstarViewer?.plugin;
  if (!plugin) return;
  try {
    const structures = plugin.managers.structure.hierarchy.current.structs;
    if (structures.length) {
      plugin.managers.structure.component.setOptions(structures[0], { representation: "ball-and-stick" });
    }
  } catch { /* representation is best-effort */ }
}

export function loadFramesToViewer(frames = []) {
  if (!state.viewerInitialized || !molstarViewer || frames.length < 2) return false;
  if (frames[0]?.xyz) {
    loadMoleculeToViewer(frames[0].xyz, "xyz");
    return true;
  }
  return false;
}

// ===== Formats =====
function detectFormat(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("HEADER") || trimmed.startsWith("ATOM") || trimmed.startsWith("HETATM")) return "pdb";
  if (/^\d+\s*\n/.test(trimmed)) return "xyz";
  return "xyz";
}

// 结构几何（解析 / 成键 / PDB / 2D 投影）来自 /shared/structure.js，
// 与后端 src/orchestrator.js 是同一份实现。
export function xyzToPdb(xyzText) {
  return toPDB(xyzText, "ChemClaw structure");
}

// ===== 2D fallback =====
function renderMoleculeFallback(xyzText) {
  lastFallbackText = xyzText || "";
  const container = $("#moleculeViewer");
  if (!container) return;
  let atoms = parseXYZAtoms(xyzText);
  if (!atoms.length && /^(HEADER|ATOM|HETATM)/m.test(xyzText || "")) {
    atoms = parsePdbAtoms(xyzText);
  }
  if (!atoms.length) {
    container.innerHTML = `
      <div class="viewer-placeholder">
        <div>
          <strong>未找到可用坐标</strong>
          <p>请上传 .xyz 文件，或粘贴「元素 x y z」格式的坐标。</p>
        </div>
      </div>`;
    return;
  }

  const { width, height, projected } = projectAtoms2D(atoms);
  // Bond detection must run on the original 3D coordinates; `projected` has
  // its x/y replaced by screen positions.
  const bonds = computeBonds(atoms);
  const dark = document.documentElement.classList.contains("dark");
  const bondColor = dark ? "#475569" : "#a8b4c2";
  const labelColor = dark ? "#0b1220" : "#ffffff";

  container.innerHTML = `
    <svg class="molecule-fallback-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="分子二维投影结构">
      <title>分子二维投影</title>
      ${bonds.map(([a, b]) => {
        const from = projected[a], to = projected[b];
        return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${bondColor}" stroke-width="5" stroke-linecap="round"/>`;
      }).join("")}
      ${projected.map((atom) => {
        const fill = atom.element === "H" ? (dark ? "#94a3b8" : "#cbd5e1") : atom.color;
        return `<g transform="translate(${atom.x},${atom.y})">
          <circle r="${atom.r}" fill="${fill}" stroke="${dark ? "#0a121f" : "#f7f9fb"}" stroke-width="2"/>
          ${atom.r >= 11 ? `<text y="4" text-anchor="middle" fill="${labelColor}" font-size="9" font-weight="700">${atom.element}</text>` : ""}
        </g>`;
      }).join("")}
    </svg>`;
  container.querySelector("svg").style.height = "100%";
}

// ===== Text helpers =====
export function extractMoleculeFromText(text = "") {
  const coordPat = /^\s*([A-Z][a-z]?)\s+(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s+(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s+(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*$/;
  let best = [], cur = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { if (cur.length > best.length) best = cur; cur = []; continue; }
    if (/^\d+$/.test(line) && cur.length === 0) continue;
    if (/^(atom|xyz|coordinates|molecule)/i.test(line)) continue;
    if (coordPat.test(line)) cur.push(line);
    else { if (cur.length > best.length) best = cur; cur = []; }
  }
  if (cur.length > best.length) best = cur;
  return best.length ? `${best.length}\nextracted\n${best.join("\n")}` : "";
}

export function resolveMoleculeText() {
  return $("#moleculeText")?.value.trim()
    || extractMoleculeFromText($("#studentReport")?.value || "")
    || extractMoleculeFromText($("#datasetText")?.value || "")
    || "";
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ===== Sample data =====
export const sampleDataset = `# ChemClaw demo: Diels-Alder reaction TS analysis
Method: B3LYP-D3BJ/def2-SVP, solvent = acetonitrile

Reactant complex
SCF Done: E(RB3LYP) = -423.148932 Hartree
Frequencies -- 43.2 78.1 119.4
Dipole moment = 3.21 Debye

Transition state TS-1
SCF Done: E(RB3LYP) = -423.119281 Hartree
Frequencies -- -431.6 62.4 118.8
HOMO = -5.82
LUMO = -2.48
Activation barrier = 18.6 kcal/mol
Charge on center = 0.37

Product (cyclohexene)
SCF Done: E(RB3LYP) = -423.163504 Hartree
Frequencies -- 35.6 88.2 132.7
Adsorption energy = -0.72 eV`;

export const sampleReport = `本实验使用 B3LYP-D3BJ/def2-SVP 研究 Diels-Alder 反应机理。
计算结果显示 TS-1 存在一个虚频 -431.6 cm⁻¹，符合一阶鞍点特征。
反应能垒为 18.6 kcal/mol，产物能量低于反应物。
HOMO-LUMO gap 为 3.34 eV，提示前线轨道相互作用影响反应活性。
后续需要补充 IRC 计算确认虚频方向，以及不同取代基的对照分析。`;

export const sampleMolecule = `12
benzene (B3LYP-D3BJ/def2-SVP optimized)
C 1.396 0.000 0.000
H 2.479 0.000 0.000
C 0.698 1.209 0.000
H 1.240 2.147 0.000
C -0.698 1.209 0.000
H -1.240 2.147 0.000
C -1.396 0.000 0.000
H -2.479 0.000 0.000
C -0.698 -1.209 0.000
H -1.240 -2.147 0.000
C 0.698 -1.209 0.000
H 1.240 -2.147 0.000`;

export { parseXYZAtoms, computeBonds };

