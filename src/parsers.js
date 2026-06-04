// 计算化学输出文件解析器
// 支持 Gaussian、ORCA、VASP 及通用格式

export function parseGaussian(text) {
  const result = {
    type: "gaussian",
    route: null,
    charge: null,
    multiplicity: null,
    energies: [],
    optimizationEnergies: [],
    structureFrames: [],
    scfEnergy: null,
    finalEnergy: null,
    dipole: null,
    orbitals: [],
    frequencies: [],
    irIntensities: [],
    vibrationalModes: [],
    imaginaryFrequencies: [],
    thermo: {},
    converged: false,
    normalTermination: false,
    errors: []
  };

  // 计算方法 / 基组
  const routeMatch = text.match(/^\s*#p?\s+(.+)$/m);
  if (routeMatch) result.route = routeMatch[1].trim();

  // 提取方法和基组 (e.g., "B3LYP/6-31+G(d,p)" or "UHF/6-31G(d)")
  if (result.route) {
    const methodMatch = result.route.match(/(?:^|\s)([A-Za-z0-9-]+\/[^\s]+)/);
    if (methodMatch) {
      const parts = methodMatch[1].split("/");
      result.method = parts[0] || null;
      result.basis = parts.slice(1).join("/") || null;
    }
  }

  // 电荷与自旋多重度
  const chargeMatch = text.match(/Charge\s*=\s*(-?\d+)\s+Multiplicity\s*=\s*(\d+)/i);
  if (chargeMatch) {
    result.charge = parseInt(chargeMatch[1]);
    result.multiplicity = parseInt(chargeMatch[2]);
  }

  // SCF 能量：保留全部能量点，避免把单个物质误画成反应路径
  const scfMatches = [...text.matchAll(/SCF Done:\s*E\([^)]+\)\s*=\s*(-?\d+(?:\.\d+)?)/gi)];
  result.energies = scfMatches.map((m, index) => ({
    label: inferEnergyLabel(text, m.index, index, scfMatches.length),
    hartree: parseFloat(m[1])
  })).filter(item => Number.isFinite(item.hartree));
  if (result.energies.length) result.scfEnergy = result.energies[result.energies.length - 1].hartree;

  // 最终单点能 (ORCA 兼容)
  const finalMatch = text.match(/FINAL SINGLE POINT ENERGY\s+(-?[\d.]+)/i);
  if (finalMatch) result.finalEnergy = parseFloat(finalMatch[1]);

  // 偶极矩
  const dipoleMatch = text.match(/Dipole moment.*\n.*Tot=\s*(-?[\d.]+)/i)
    || text.match(/Tot=\s*(-?[\d.]+)/i);
  if (dipoleMatch) result.dipole = parseFloat(dipoleMatch[1]);

  // 轨道能量 — 先尝试显式 HOMO/LUMO 标注
  result.homo = parseFloat(text.match(/(?:^|\n)\s*HOMO\s*(?:energy)?\s*[:=]\s*(-?\d+(?:\.\d+)?)/im)?.[1]);
  result.lumo = parseFloat(text.match(/(?:^|\n)\s*LUMO\s*(?:energy)?\s*[:=]\s*(-?\d+(?:\.\d+)?)/im)?.[1]);

  // 再尝试 Gaussian Alpha occ/virt 格式
  if (result.homo === undefined) {
    const alphaOccMatch = text.match(/Alpha\s+occ\. eigenvalues\s+--\s+(.+)/i);
    if (alphaOccMatch) {
      const values = alphaOccMatch[1].trim().split(/\s+/).map(parseFloat).filter(n => !isNaN(n));
      if (values.length > 0) result.homo = values[values.length - 1];
    }
  }
  if (result.lumo === undefined) {
    const alphaVirtMatch = text.match(/Alpha\s+virt\. eigenvalues\s+--\s+(.+)/i);
    if (alphaVirtMatch) {
      const values = alphaVirtMatch[1].trim().split(/\s+/).map(parseFloat).filter(n => !isNaN(n));
      if (values.length > 0) result.lumo = values[0];
    }
  }

  if (result.homo !== undefined && result.lumo !== undefined) {
    result.gap = parseFloat((result.lumo - result.homo).toFixed(4));
  }

  // 频率分析
  const freqSection = text.match(/Harmonic frequencies[\s\S]*?Thermochemistry/i)
    || text.match(/Frequencies --[\s\S]*?(?=------|$)/i);
  if (freqSection) {
    const modeBlocks = [...freqSection[0].matchAll(/Frequencies\s+--\s+([^\n]+)(?:\n[\s\S]*?IR Inten\s+--\s+([^\n]+))?/g)];
    for (const block of modeBlocks) {
      const freqs = block[1].trim().split(/\s+/).map(Number).filter(Number.isFinite);
      const intensities = (block[2] || "").trim().split(/\s+/).map(Number).filter(Number.isFinite);
      freqs.forEach((val, index) => {
        result.frequencies.push(val);
        if (val < 0) result.imaginaryFrequencies.push(val);
        const intensity = intensities[index] ?? 0;
        result.irIntensities.push(intensity);
        result.vibrationalModes.push({
          index: result.vibrationalModes.length + 1,
          frequency: val,
          intensity
        });
      });
    }
  }

  // 热化学数据
  const thermoBlock = text.match(/- Thermochemistry -([\s\S]*)/i);
  if (thermoBlock) {
    const block = thermoBlock[1];
    const zpeMatch = block.match(/Zero-point correction=\s*(-?[\d.]+)/i)
      || block.match(/Sum of electronic and zero-point Energies=\s*(-?[\d.]+)/i);
    if (zpeMatch) result.thermo.zpe = parseFloat(zpeMatch[1]);

    const thermalMatch = block.match(/Sum of electronic and thermal Energies=\s*(-?[\d.]+)/i);
    if (thermalMatch) result.thermo.thermalEnergy = parseFloat(thermalMatch[1]);

    const enthalpyMatch = block.match(/Sum of electronic and thermal Enthalpies=\s*(-?[\d.]+)/i);
    if (enthalpyMatch) result.thermo.enthalpy = parseFloat(enthalpyMatch[1]);

    const gibbsMatch = block.match(/Sum of electronic and thermal Free Energies=\s*(-?[\d.]+)/i);
    if (gibbsMatch) result.thermo.gibbs = parseFloat(gibbsMatch[1]);
  }

  // 能垒
  const barrierMatch = text.match(/(?:Activation\s*barrier|Barrier)\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
  if (barrierMatch) result.barrier = parseFloat(barrierMatch[1]);

  // 吸附能
  const adsMatch = text.match(/Adsorption\s*energy\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
  if (adsMatch) result.adsorption = parseFloat(adsMatch[1]);

  // 收敛状态
  result.converged = /Maximum Force.*YES|Item.*Value.*Threshold.*Converged/i.test(text);
  result.normalTermination = /Normal termination/i.test(text);
  result.structureFrames = extractXYZFrames(text);
  result.optimizationEnergies = extractOptimizationEnergies(text, result.energies);

  return result;
}

export function parseORCA(text) {
  const result = {
    type: "orca",
    energies: [],
    optimizationEnergies: [],
    structureFrames: [],
    finalEnergy: null,
    homo: undefined,
    lumo: undefined,
    gap: undefined,
    frequencies: [],
    imaginaryFrequencies: [],
    irIntensities: [],
    vibrationalModes: [],
    dipole: null
  };

  const energyMatch = text.match(/FINAL SINGLE POINT ENERGY\s+(-?[\d.]+)/i);
  if (energyMatch) result.finalEnergy = parseFloat(energyMatch[1]);
  result.energies = [...text.matchAll(/FINAL SINGLE POINT ENERGY\s+(-?\d+(?:\.\d+)?)/gi)]
    .map((m, index, arr) => ({ label: inferEnergyLabel(text, m.index, index, arr.length), hartree: parseFloat(m[1]) }))
    .filter(item => Number.isFinite(item.hartree));
  result.structureFrames = extractXYZFrames(text);

  const homoMatch = text.match(/HOMO\s*energy\s*[:=]\s*(-?[\d.]+)/i)
    || text.match(/E\(HOMO\)\s*[:=]\s*(-?[\d.]+)/i);
  if (homoMatch) result.homo = parseFloat(homoMatch[1]);

  const lumoMatch = text.match(/LUMO\s*energy\s*[:=]\s*(-?[\d.]+)/i)
    || text.match(/E\(LUMO\)\s*[:=]\s*(-?[\d.]+)/i);
  if (lumoMatch) result.lumo = parseFloat(lumoMatch[1]);

  if (result.homo != null && result.lumo != null) {
    result.gap = parseFloat((result.lumo - result.homo).toFixed(4));
  }

  const dipoleMatch = text.match(/Total Dipole Moment\s*[:=]\s*(-?[\d.]+)/i);
  if (dipoleMatch) result.dipole = parseFloat(dipoleMatch[1]);

  const freqMatches = text.matchAll(/^\s*\d+:\s+(-?[\d.]+)\s+cm\*\*-1/gm);
  for (const m of freqMatches) {
    const val = parseFloat(m[1]);
    if (!isNaN(val)) {
      result.frequencies.push(val);
      if (val < 0) result.imaginaryFrequencies.push(val);
      result.irIntensities.push(0);
      result.vibrationalModes.push({ index: result.vibrationalModes.length + 1, frequency: val, intensity: 0 });
    }
  }
  result.optimizationEnergies = extractOptimizationEnergies(text, result.energies);

  return result;
}

const KNOWN_CALC_TYPES = [
  { pattern: /#p?\s+.*\bopt\b.*\bfreq\b/i, label: "结构优化 + 频率分析" },
  { pattern: /#p?\s+.*\bmodredundant\b/i, label: "构象扫描 (modredundant)" },
  { pattern: /#p?\s+.*\bscan\b/i, label: "势能面扫描" },
  { pattern: /#p?\s+.*\bopt\b/i, label: "结构优化" },
  { pattern: /#p?\s+.*\bfreq\b/i, label: "频率分析" },
  { pattern: /#p?\s+.*\birc\b/i, label: "IRC 反应路径" },
  { pattern: /#p?\s+.*\bts\b/i, label: "过渡态搜索" },
  { pattern: /#p?\s+.*\bsp\b/i, label: "单点能计算" }
];

export function detectCalcType(text) {
  for (const { pattern, label } of KNOWN_CALC_TYPES) {
    if (pattern.test(text)) return label;
  }
  return "通用计算化学输出";
}

export function parseAny(text) {
  // 自动检测格式
  if (/\bGaussian\s*\d/i.test(text) || /Entering Link/i.test(text) || /SCF Done/i.test(text)) {
    return parseGaussian(text);
  }
  if (/ORCA[\s-]*\d/i.test(text) || /FINAL SINGLE POINT ENERGY/i.test(text)) {
    return parseORCA(text);
  }
  // 通用回退：尝试 Gaussian 解析
  const gaussian = parseGaussian(text);
  if (gaussian.scfEnergy || gaussian.frequencies.length > 0) return gaussian;
  return parseORCA(text);
}

export function extractXYZFrames(text = "") {
  const lines = text.split(/\r?\n/);
  const tableFrames = extractGaussianOrientationFrames(text);
  const orcaFrames = extractOrcaCartesianFrames(text);
  const frames = [...tableFrames, ...orcaFrames];
  const coordLine = /^\s*([A-Z][a-z]?)\s+(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s+(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s+(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*$/;
  let current = [];
  let title = "结构";

  const flush = () => {
    if (current.length >= 2) {
      frames.push({
        title,
        atomCount: current.length,
        xyz: `${current.length}\n${title}\n${current.join("\n")}`
      });
    }
    current = [];
  };

  lines.forEach((raw, index) => {
    const line = raw.trim();
    const labelMatch = line.match(/^(?:Standard orientation|Input orientation|CARTESIAN COORDINATES|Coordinates|Geometry|Molecule)/i);
    if (labelMatch) {
      flush();
      title = line.replace(/[:\-]+$/, "") || `结构 ${frames.length + 1}`;
      return;
    }
    if (coordLine.test(line)) {
      current.push(line);
      return;
    }
    if (!line || /^[-\s]+$/.test(line)) return;
    if (current.length) flush();
    if (/^(Reactant|Transition|Product|TS|Intermediate|反应物|过渡态|产物)/i.test(line)) {
      title = line.slice(0, 80);
    } else if (index === 1 && /^\d+$/.test(lines[0]?.trim())) {
      title = line || title;
    }
  });
  flush();

  // 兼容标准 XYZ 文件
  const first = lines[0]?.trim();
  if (/^\d+$/.test(first)) {
    const atomCount = Number(first);
    const atoms = lines.slice(2, 2 + atomCount).map(line => line.trim()).filter(line => coordLine.test(line));
    if (atoms.length === atomCount) {
      return [{
        title: lines[1]?.trim() || "XYZ 结构",
        atomCount,
        xyz: `${atomCount}\n${lines[1]?.trim() || "XYZ 结构"}\n${atoms.join("\n")}`
      }];
    }
  }

  return dedupeFrames(frames);
}

const atomicSymbols = {
  1: "H", 2: "He", 3: "Li", 4: "Be", 5: "B", 6: "C", 7: "N", 8: "O", 9: "F", 10: "Ne",
  11: "Na", 12: "Mg", 13: "Al", 14: "Si", 15: "P", 16: "S", 17: "Cl", 18: "Ar", 19: "K", 20: "Ca",
  21: "Sc", 22: "Ti", 23: "V", 24: "Cr", 25: "Mn", 26: "Fe", 27: "Co", 28: "Ni", 29: "Cu", 30: "Zn",
  31: "Ga", 32: "Ge", 33: "As", 34: "Se", 35: "Br", 36: "Kr", 44: "Ru", 45: "Rh", 46: "Pd", 47: "Ag",
  48: "Cd", 53: "I", 74: "W", 75: "Re", 76: "Os", 77: "Ir", 78: "Pt", 79: "Au", 80: "Hg"
};

function extractGaussianOrientationFrames(text = "") {
  const frames = [];
  const blockRegex = /(Standard orientation|Input orientation):\s*\n\s*-{5,}\s*\n\s*Center\s+Atomic\s+Atomic\s+Coordinates[\s\S]*?\n\s*-{5,}\s*\n([\s\S]*?)\n\s*-{5,}/gi;
  let match;
  while ((match = blockRegex.exec(text)) !== null) {
    const title = `${match[1]} ${frames.length + 1}`;
    const atoms = match[2].split(/\r?\n/).map(line => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) return null;
      const atomicNumber = Number(parts[1]);
      const symbol = atomicSymbols[atomicNumber];
      const x = Number(parts[3]);
      const y = Number(parts[4]);
      const z = Number(parts[5]);
      if (!symbol || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
      return `${symbol} ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}`;
    }).filter(Boolean);
    if (atoms.length >= 2) {
      frames.push({
        title,
        atomCount: atoms.length,
        xyz: `${atoms.length}\n${title}\n${atoms.join("\n")}`
      });
    }
  }
  return frames;
}

function extractOrcaCartesianFrames(text = "") {
  const frames = [];
  const blockRegex = /CARTESIAN COORDINATES \(ANGSTROEM\)\s*-+\s*([\s\S]*?)(?=\n\s*\n|CARTESIAN COORDINATES|$)/gi;
  let match;
  while ((match = blockRegex.exec(text)) !== null) {
    const atoms = match[1].split(/\r?\n/).map(line => line.trim()).filter(line =>
      /^[A-Z][a-z]?\s+-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\s+-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\s+-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/.test(line)
    );
    if (atoms.length >= 2) {
      const title = `ORCA Cartesian ${frames.length + 1}`;
      frames.push({ title, atomCount: atoms.length, xyz: `${atoms.length}\n${title}\n${atoms.join("\n")}` });
    }
  }
  return frames;
}

function dedupeFrames(frames = []) {
  const seen = new Set();
  return frames.filter(frame => {
    const key = frame.xyz.split(/\r?\n/).slice(2).join("\n");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildFileDetails(text = "", parsed = {}) {
  const lineCount = text ? text.split(/\r?\n/).length : 0;
  const byteSize = new TextEncoder().encode(text || "").length;
  return {
    lineCount,
    byteSize,
    format: parsed.type || "unknown",
    route: parsed.route || null,
    charge: parsed.charge ?? null,
    multiplicity: parsed.multiplicity ?? null,
    normalTermination: parsed.normalTermination ?? null,
    converged: parsed.converged ?? null,
    energyPointCount: parsed.energies?.length || 0,
    frequencyCount: parsed.frequencies?.length || 0,
    structureFrameCount: parsed.structureFrames?.length || 0
  };
}

export function extractOptimizationEnergies(text = "", energies = []) {
  const explicit = [...text.matchAll(/(?:Optimization Step|Step)\s+(\d+)[\s\S]{0,160}?(?:Energy|E)\s*[=:]\s*(-?\d+(?:\.\d+)?)/gi)]
    .map(m => ({ step: Number(m[1]), hartree: Number(m[2]) }))
    .filter(item => Number.isFinite(item.step) && Number.isFinite(item.hartree));
  if (explicit.length > 1) return explicit;
  const cycleMatches = [...text.matchAll(/(?:Step number|Optimization cycle)\s+(\d+)[\s\S]{0,240}?(?:SCF Done:\s*E\([^)]+\)\s*=|Energy\s*[=:])\s*(-?\d+(?:\.\d+)?)/gi)]
    .map(m => ({ step: Number(m[1]), hartree: Number(m[2]) }))
    .filter(item => Number.isFinite(item.step) && Number.isFinite(item.hartree));
  if (cycleMatches.length > 1) return cycleMatches;
  const stationaryMatches = [...text.matchAll(/(?:Stationary point found|Optimization completed)[\s\S]{0,240}?(?:SCF Done:\s*E\([^)]+\)\s*=|Energy\s*[=:])\s*(-?\d+(?:\.\d+)?)/gi)]
    .map((m, index) => ({ step: index + 1, hartree: Number(m[1]) }))
    .filter(item => Number.isFinite(item.hartree));
  if (stationaryMatches.length > 1) return stationaryMatches;
  if (energies.length > 1) {
    return energies.map((item, index) => ({ step: index + 1, hartree: item.hartree }));
  }
  return [];
}

function inferEnergyLabel(text, index, order, total) {
  const start = Math.max(0, index - 220);
  const context = text.slice(start, index);
  const lines = context.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const lastLabel = [...lines].reverse().find(line =>
    /^(Reactant|Transition|Product|TS|Intermediate|反应物|过渡态|产物|结构|State)/i.test(line)
  );
  if (lastLabel) return lastLabel.slice(0, 40);
  if (total === 1) return "结构能量";
  if (order === 0) return "起点";
  if (order === total - 1) return "终点";
  return `能量点 ${order + 1}`;
}
