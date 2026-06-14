// ===== Mol* Viewer Module =====
// Replaces 3Dmol.js with Mol* (molstar) for premium molecular visualization.
// Mol* is the next-gen molecular viewer from RCSB PDB.
//
// Architecture:
//   OpenClaw chemclaw-analyze Skill → generates PDB data (with bond info)
//   Web Demo Backend → passes PDB string to frontend
//   Frontend Mol* renderer → high-quality 3D visualization
//
// Data flow: XYZ (basic) or PDB (with bonds, from OpenClaw)

import { state, $ } from "./state.js";

// ===== Mol* Viewer State =====
let molstarViewer = null;
let molstarInitPromise = null;

// ===== Element Colors (CPK-inspired, premium palette) =====
const ELEMENT_COLORS = {
  H: "#f0f2f5", C: "#2b2f36", N: "#275cd8", O: "#b42318",
  F: "#16a34a", P: "#d97706", S: "#eab308", Cl: "#16a34a",
  Br: "#92400e", I: "#581c87", Si: "#6b7280", B: "#fbbf24",
};

// ===== Covalent Radii (Angstrom) for bond inference =====
const COVALENT_RADII = {
  H: 0.31, C: 0.76, N: 0.71, O: 0.66, F: 0.57,
  S: 1.05, P: 1.07, Cl: 1.02, Br: 1.20, I: 1.39,
  Si: 1.11, B: 0.84,
};

// ===== Initialize Mol* Viewer =====
export function initMoleculeViewer() {
  if (state.viewerInitialized && molstarViewer) return;
  const container = $("#moleculeViewer");
  if (!container) return;

  // Check if molstar is loaded
  if (typeof molstar === "undefined" || !molstar.Viewer) {
    container.innerHTML = `
      <div style="display:grid;place-items:center;height:340px;color:#667085;font-size:13px;text-align:center;padding:20px">
        <div>
          <div style="font-size:24px;margin-bottom:8px">🧬</div>
          <div>Mol* 3D 查看器加载中...</div>
          <div style="font-size:11px;margin-top:4px;color:#94a3b8">首次加载需下载约 4MB 渲染引擎</div>
        </div>
      </div>`;
    return;
  }

  // Prevent double initialization
  if (molstarInitPromise) return molstarInitPromise;

  const dark = document.documentElement.classList.contains("dark");

  molstarInitPromise = molstar.Viewer.create("moleculeViewer", {
    layoutIsExpanded: false,
    layoutShowControls: false,
    layoutShowRemoteState: false,
    layoutShowSequence: false,
    layoutShowLog: false,
    layoutShowLeftPanel: false,
    layoutShowSession: false,
    viewportShowExpand: true,
    viewportShowSettings: false,
    viewportShowSelectionMode: false,
    viewportShowAnimation: false,
    viewportShowTrajectoryControls: false,
    collapseLeftPanel: true,
    collapseRightPanel: true,
    disableDragAndDrop: true,
  }).then(viewer => {
    molstarViewer = viewer;
    state.viewer = viewer;
    state.viewerInitialized = true;

    // Apply dark/light theme
    applyViewerTheme(dark);

    return viewer;
  }).catch(e => {
    console.warn("Mol* init failed, falling back to SVG", e);
    molstarInitPromise = null;
    state.viewerInitialized = false;
    return null;
  });

  return molstarInitPromise;
}

// ===== Apply Theme to Viewer =====
function applyViewerTheme(isDark) {
  if (!molstarViewer?.plugin) return;
  try {
    const canvas = $("#moleculeViewer")?.querySelector("canvas");
    if (canvas) {
      canvas.style.background = isDark ? "#0a0f1a" : "#f8fbfc";
    }
  } catch { /* ignore */ }
}

// ===== Load Molecule into Viewer =====
export function loadMoleculeToViewer(text, format = "auto") {
  if (!text?.trim()) { renderMoleculeFallback(""); return; }
  if (!state.viewerInitialized || !molstarViewer) { renderMoleculeFallback(text); return; }

  // Auto-detect format
  const detectedFormat = format === "auto" ? detectFormat(text) : format;

  // Convert XYZ to PDB for better bond rendering
  const pdbData = detectedFormat === "xyz" ? xyzToPdb(text) : text;

  // Use loadStructureFromData to load inline (no Blob URL needed)
  molstarViewer.loadStructureFromData(pdbData, "pdb", {
    dataLabel: "Molecular Structure",
  }).then(() => {
    // Apply premium representation after loading
    setTimeout(() => applyPremiumRepresentation(), 300);
  }).catch(e => {
    console.warn("Mol* loadStructureFromData failed, trying loadStructureFromUrl fallback", e);
    // Fallback: try with Blob URL
    try {
      const blob = new Blob([pdbData], { type: "chemical/x-pdb" });
      const url = URL.createObjectURL(blob);
      molstarViewer.loadStructureFromUrl(url, "pdb", false, {
        label: "Molecular Structure",
      }).then(() => {
        URL.revokeObjectURL(url);
        setTimeout(() => applyPremiumRepresentation(), 300);
      }).catch(e2 => {
        console.warn("Mol* Blob URL fallback also failed", e2);
        URL.revokeObjectURL(url);
        renderMoleculeFallback(text);
      });
    } catch {
      renderMoleculeFallback(text);
    }
  });
}

// ===== Apply Premium Representation =====
function applyPremiumRepresentation() {
  if (!molstarViewer?.plugin) return;
  try {
    // Access the plugin's state to set ball-and-stick representation
    const plugin = molstarViewer.plugin;
    const structures = plugin.managers.structure.hierarchy.current.structs;
    if (structures.length > 0) {
      const s = structures[0];
      // Try to set ball-and-stick representation
      plugin.managers.structure.component.setOptions(s, {
        representation: "ball-and-stick",
      });
    }
  } catch { /* representation change is best-effort */ }
}

// ===== Load Multiple Frames =====
export function loadFramesToViewer(frames = []) {
  if (!state.viewerInitialized || !molstarViewer || frames.length < 2) return false;
  // Load the first frame; molstar trajectory loading is complex
  // so we use the simpler single-frame approach with manual switching
  if (frames[0]?.xyz) {
    loadMoleculeToViewer(frames[0].xyz, "xyz");
    return true;
  }
  return false;
}

// ===== Detect Data Format =====
function detectFormat(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("HEADER") || trimmed.startsWith("ATOM") || trimmed.startsWith("HETATM")) {
    return "pdb";
  }
  if (/^\d+\s*\n/.test(trimmed)) {
    return "xyz";
  }
  return "xyz"; // default
}

// ===== XYZ to PDB Converter =====
// Converts XYZ format to PDB with explicit CONECT records.
// This is what makes the 3D visualization high-quality:
// XYZ has no bond info, PDB with CONNECT gives correct bonds.
export function xyzToPdb(xyzText) {
  const atoms = parseXYZAtoms(xyzText);
  if (!atoms.length) return "";

  const bonds = computeBonds(atoms);
  let pdb = "";
  const title = "ChemClaw - Generated by OpenClaw Skill";

  pdb += `HEADER    ${title}\n`;
  pdb += `TITLE     ${title}\n`;

  atoms.forEach((atom, i) => {
    const serial = String(i + 1).padStart(5);
    const name = atom.element.padEnd(4);
    const resName = "MOL";
    const chainId = "A";
    const resSeq = String(1).padStart(4);
    const x = atom.x.toFixed(3).padStart(8);
    const y = atom.y.toFixed(3).padStart(8);
    const z = atom.z.toFixed(3).padStart(8);
    const occupancy = "1.00";
    const tempFactor = "0.00";
    const element = atom.element.padEnd(2);

    pdb += `ATOM  ${serial} ${name} ${resName} ${chainId}${resSeq}    ${x}${y}${z}  ${occupancy}${tempFactor}          ${element}\n`;
  });

  // CONECT records for bonds
  bonds.forEach(([i, j]) => {
    const a1 = String(i + 1).padStart(5);
    const a2 = String(j + 1).padStart(5);
    pdb += `CONECT${a1}${a2}\n`;
  });

  pdb += "END\n";
  return pdb;
}

// ===== Parse XYZ Atoms =====
function parseXYZAtoms(xyzText = "") {
  const lines = xyzText.trim().split(/\r?\n/);
  const start = /^\d+$/.test(lines[0]?.trim()) ? 2 : 0;
  return lines.slice(start).map(line => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4 || !/^[A-Z][a-z]?$/.test(parts[0])) return null;
    const atom = { element: parts[0], x: Number(parts[1]), y: Number(parts[2]), z: Number(parts[3]) };
    return Number.isFinite(atom.x) && Number.isFinite(atom.y) && Number.isFinite(atom.z) ? atom : null;
  }).filter(Boolean);
}

// ===== Compute Bonds from Interatomic Distances =====
function computeBonds(atoms) {
  const bonds = [];
  const tolerance = 1.28; // Bond detection tolerance factor

  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const a = atoms[i], b = atoms[j];
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const r1 = COVALENT_RADII[a.element] || 0.76;
      const r2 = COVALENT_RADII[b.element] || 0.76;
      const maxDist = (r1 + r2) * tolerance;
      if (dist > 0.25 && dist < maxDist) {
        bonds.push([i, j]);
      }
    }
  }
  return bonds;
}

// ===== SVG Fallback Renderer (for when Mol* fails to load) =====
function renderMoleculeFallback(xyzText) {
  const atoms = parseXYZAtoms(xyzText);
  if (!atoms.length) {
    $("#moleculeViewer").innerHTML = `
      <div style="display:grid;place-items:center;height:340px;color:#667085;text-align:center;padding:20px">
        <div>
          <div style="font-size:28px;margin-bottom:8px">🧬</div>
          <strong>未找到坐标数据</strong>
          <p style="font-size:12px;margin-top:4px">请上传 .xyz 或 .pdb 文件，或粘贴坐标数据。</p>
        </div>
      </div>`;
    return;
  }

  const { width, height, projected } = projectAtoms2D(atoms);
  const bonds = computeBonds(projected);
  const dark = document.documentElement.classList.contains("dark");
  const bg = dark ? "#0a0f1a" : "#f8fbfc";
  const bondColor = dark ? "#334155" : "#98a6b3";

  $("#moleculeViewer").innerHTML = `
    <svg class="molecule-fallback-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Molecular structure">
      <rect width="${width}" height="${height}" rx="8" fill="${bg}"></rect>
      ${bonds.map(([a, b]) => `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${bondColor}" stroke-width="4" stroke-linecap="round"></line>`).join("")}
      ${projected.map(atom => `
        <g transform="translate(${atom.x},${atom.y})">
          <circle r="${atom.r}" fill="${atom.color}" stroke="${bg}" stroke-width="3"></circle>
          <text y="4" text-anchor="middle" fill="#fff" font-size="10" font-weight="900">${atom.element}</text>
        </g>
      `).join("")}
    </svg>`;
}

// ===== 2D Projection for SVG Fallback =====
function projectAtoms2D(atoms) {
  const width = 500, height = 340;
  const cx = atoms.reduce((s, a) => s + a.x, 0) / atoms.length;
  const cy = atoms.reduce((s, a) => s + a.y, 0) / atoms.length;
  const cz = atoms.reduce((s, a) => s + a.z, 0) / atoms.length;
  const cosY = Math.cos(0.75), sinY = Math.sin(0.75);
  const cosX = Math.cos(-0.55), sinX = Math.sin(-0.55);

  const raw = atoms.map(atom => {
    const x0 = atom.x - cx, y0 = atom.y - cy, z0 = atom.z - cz;
    const x1 = x0 * cosY + z0 * sinY;
    const z1 = -x0 * sinY + z0 * cosY;
    const y1 = y0 * cosX - z1 * sinX;
    return { ...atom, px: x1, py: y1 };
  });

  const span = Math.max(
    Math.max(...raw.map(a => a.px)) - Math.min(...raw.map(a => a.px)),
    Math.max(...raw.map(a => a.py)) - Math.min(...raw.map(a => a.py)),
    1
  );
  const scale = Math.min(width, height) * 0.58 / span;
  const radii = { H: 9, C: 14, N: 13, O: 13, F: 12, S: 15, P: 15, Cl: 15 };

  return {
    width, height,
    projected: raw.map(atom => ({
      ...atom,
      x: Number((width / 2 + atom.px * scale).toFixed(1)),
      y: Number((height / 2 - atom.py * scale).toFixed(1)),
      color: ELEMENT_COLORS[atom.element] || "#7c8794",
      r: radii[atom.element] || 12,
    }))
  };
}

// ===== Extract Molecule Coordinates from Text =====
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

// ===== Resolve Molecule Text =====
export function resolveMoleculeText() {
  return $("#moleculeText").value.trim()
    || extractMoleculeFromText($("#studentReport").value)
    || extractMoleculeFromText($("#datasetText").value)
    || "";
}

// ===== Sample Data =====
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

// ===== Expose helpers for external use =====
export { parseXYZAtoms, computeBonds };
