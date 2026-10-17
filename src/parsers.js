// 计算化学输出文件解析器
// 支持 Gaussian、ORCA、VASP 及通用格式

/**
 * 正则匹配结果 → 有限数；没匹配到 / 抓到非数值时返回 undefined。
 * 刻意不返回 NaN：这一层的所有调用方都用 `!== undefined` / `isFinite`
 * 判断"有没有解析到"，NaN 会让两者同时失效。
 */
function matchedNumber(match) {
  if (!match?.[1]) return undefined;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

// ===== 单位 =====
// 轨道能量在不同软件、不同行里的单位不一样：
//   - Gaussian "Alpha occ./virt. eigenvalues" → Hartree
//   - ORCA "E(HOMO) =" / "E(LUMO) ="         → Hartree
//   - 部分整理过的文本直接写 "HOMO = -5.82"  → 惯例上按 eV 理解
// 界面与教学文案统一用 eV 讲 gap，所以把 Hartree 的来源显式换算，
// 而不是把 0.54 Hartree 直接标成 "0.54 eV"（差 27 倍，会把水讲成
// "小 gap、前线轨道作用强"）。
export const HARTREE_TO_EV = 27.211386245988;
/** 偶极矩：1 atomic unit = 2.541746 Debye。 */
export const AU_TO_DEBYE = 2.541746473;

function hartreeToEv(value) {
  return Number.isFinite(value) ? Number((value * HARTREE_TO_EV).toFixed(4)) : undefined;
}

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

  // Archive entry (compact summary at end of Gaussian files)
  // Format: 1|1|UNPC-...|FOpt|RB3LYP|...|Version=...|HF=-267.239|Dipole=...
  const archiveMatch = text.match(/\d\|\d\|UNPC[^\n]*/);
  if (archiveMatch) {
    const archiveLine = archiveMatch[0];
    const hfMatch = archiveLine.match(/HF=(-?[\d.]+)/);
    if (hfMatch) result.archiveHF = parseFloat(hfMatch[1]);
    const dipoleMatch = archiveLine.match(/Dipole=(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/);
    if (dipoleMatch && !result.dipole) {
      // 保持 number 类型：同一个字段在另一条分支里是 parseFloat 的结果，
      // 这里若返回字符串，下游 `typeof` / 算术就会两套行为。
      result.dipole = Number(
        Math.sqrt(
          parseFloat(dipoleMatch[1])**2 + parseFloat(dipoleMatch[2])**2 + parseFloat(dipoleMatch[3])**2
        ).toFixed(4)
      );
    }
    const versionMatch = archiveLine.match(/Version=([^|]+)/);
    if (versionMatch) result.gaussianVersion = versionMatch[1].trim();
  }

  // SCF 能量：保留全部能量点，避免把单个物质误画成反应路径
  const scfMatches = [...text.matchAll(/SCF Done:\s*E\([^)]+\)\s*=\s*(-?\d+(?:\.\d+)?)/gi)];
  result.energies = scfMatches.map((m, index) => ({
    label: inferEnergyLabel(text, m.index, index, scfMatches.length),
    hartree: parseFloat(m[1])
  })).filter(item => Number.isFinite(item.hartree));
  if (result.energies.length) result.scfEnergy = result.energies[result.energies.length - 1].hartree;
  if (result.scfEnergy == null && result.archiveHF != null) result.scfEnergy = result.archiveHF;

  // 最终单点能 (ORCA 兼容)
  const finalMatch = text.match(/FINAL SINGLE POINT ENERGY\s+(-?[\d.]+)/i);
  if (finalMatch) result.finalEnergy = parseFloat(finalMatch[1]);

  // 偶极矩
  const dipoleMatch = text.match(/Dipole moment.*\n.*Tot=\s*(-?[\d.]+)/i)
    || text.match(/Tot=\s*(-?[\d.]+)/i);
  if (dipoleMatch) result.dipole = parseFloat(dipoleMatch[1]);

  // 轨道能量 — 先尝试显式 HOMO/LUMO 标注
  // 注意：匹配失败时必须得到 undefined，不能是 NaN —— parseFloat(undefined)
  // 返回 NaN，而 NaN 不等于 undefined，下面"再尝试 Alpha occ"的兜底和
  // 所有下游的 `!== undefined` 判断都会被它骗过去，最终把 "gap = NaN eV"
  // 端到端送进结论句。
  result.homo = matchedNumber(text.match(/(?:^|\n)\s*HOMO\s*(?:energy)?\s*[:=]\s*(-?\d+(?:\.\d+)?)/im));
  result.lumo = matchedNumber(text.match(/(?:^|\n)\s*LUMO\s*(?:energy)?\s*[:=]\s*(-?\d+(?:\.\d+)?)/im));

  // 再尝试 Gaussian Alpha occ/virt 格式（单位 Hartree，需换成 eV）
  //
  // occ 本征值常按每行 5 个折成多行，HOMO 是**最后一行**的最后一个值。
  // 旧实现用 text.match() 只取第一行，占据轨道超过 5 个的常规日志会算错 HOMO
  // （并且错得很大：会出现 gap 200 eV 这种一眼假的数字）。这里取最后一个
  // occ 块的最后一个值、最后一个 virt 块的第一个值。
  if (result.homo === undefined) {
    const occBlocks = [...text.matchAll(/Alpha\s+occ\. eigenvalues\s+--\s+([^\n]+)/gi)];
    if (occBlocks.length) {
      const values = occBlocks[occBlocks.length - 1][1].trim().split(/\s+/).map(parseFloat).filter(Number.isFinite);
      if (values.length > 0) {
        result.homo = hartreeToEv(values[values.length - 1]);
        result.orbitalUnit = "Hartree→eV";
      }
    }
  }
  if (result.lumo === undefined) {
    const virtBlocks = [...text.matchAll(/Alpha\s+virt\. eigenvalues\s+--\s+([^\n]+)/gi)];
    if (virtBlocks.length) {
      const values = virtBlocks[virtBlocks.length - 1][1].trim().split(/\s+/).map(parseFloat).filter(Number.isFinite);
      if (values.length > 0) {
        result.lumo = hartreeToEv(values[0]);
        result.orbitalUnit = "Hartree→eV";
      }
    }
  }

  if (Number.isFinite(result.homo) && Number.isFinite(result.lumo)) {
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
  // 真实文件里常写成 "Activation barrier (ZPE-corrected): 18.6 kcal/mol"，
  // 旧正则要求 Barrier 后紧跟 : 或 =，于是仓库自带的样例文件里这个字段
  // 一直没被解析出来（界面只是碰巧没显示，没有报错）。
  // 单位也要读：写 78.0 kJ/mol 时若直接当 kcal/mol 讲，误差 4.2 倍。
  const barrierMatch = text.match(/(?:Activation\s*barrier|Barrier)[^:\n]{0,40}?[:=]\s*(-?\d+(?:\.\d+)?)\s*(kcal\s*\/?\s*mol|kJ\s*\/?\s*mol)?/i);
  if (barrierMatch) {
    const raw = parseFloat(barrierMatch[1]);
    const unit = (barrierMatch[2] || "").toLowerCase().replace(/\s/g, "");
    if (unit.includes("kj")) {
      result.barrier = Number((raw / 4.184).toFixed(3));
      result.barrierUnit = "kJ/mol→kcal/mol";
    } else {
      result.barrier = raw;
      if (unit) result.barrierUnit = unit;
    }
  }

  // 吸附能
  const adsMatch = text.match(/Adsorption\s*energy\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
  if (adsMatch) result.adsorption = parseFloat(adsMatch[1]);

  // 收敛状态
  result.converged = /Maximum Force.*YES|Item.*Value.*Threshold.*Converged/i.test(text);
  result.normalTermination = /Normal termination|TERMINATED NORMALLY/i.test(text);
  // Error termination / 被调度器杀掉，比"没找到 Normal termination"强得多，
  // 单独记下来，界面上才有依据说"这次计算是失败的"而不是"可能没结束"。
  // 取全部匹配：一份文件里往往先出现 "Job killed"，后面才是 "Error termination"，
  // 只抓第一个会丢掉真正的失败原因。
  const abortMatches = [...text.matchAll(/(?:Error termination[^\n]*|aborting the run[^\n]*|Job killed[^\n]*)/gi)]
    .map((m) => m[0].trim().slice(0, 200));
  if (abortMatches.length) {
    result.aborted = true;
    result.errors.push(...abortMatches.slice(0, 5));
  }
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
    dipole: null,
    converged: false,
    normalTermination: false,
    aborted: false,
    errors: []
  };

  const energyMatch = text.match(/FINAL SINGLE POINT ENERGY\s+(-?[\d.]+)/i);
  if (energyMatch) result.finalEnergy = parseFloat(energyMatch[1]);
  result.energies = [...text.matchAll(/FINAL SINGLE POINT ENERGY\s+(-?\d+(?:\.\d+)?)/gi)]
    .map((m, index, arr) => ({ label: inferEnergyLabel(text, m.index, index, arr.length), hartree: parseFloat(m[1]) }))
    .filter(item => Number.isFinite(item.hartree));
  result.structureFrames = extractXYZFrames(text);

  // E(HOMO) / E(LUMO) 是 Hartree，界面按 eV 讲，这里换算并标注来源。
  const homoMatch = text.match(/HOMO\s*energy\s*[:=]\s*(-?[\d.]+)/i)
    || text.match(/E\(HOMO\)\s*[:=]\s*(-?[\d.]+)/i);
  if (homoMatch) {
    result.homo = hartreeToEv(Number.parseFloat(homoMatch[1]));
    result.orbitalUnit = "Hartree→eV";
  }

  const lumoMatch = text.match(/LUMO\s*energy\s*[:=]\s*(-?[\d.]+)/i)
    || text.match(/E\(LUMO\)\s*[:=]\s*(-?[\d.]+)/i);
  if (lumoMatch) {
    result.lumo = hartreeToEv(Number.parseFloat(lumoMatch[1]));
    result.orbitalUnit = "Hartree→eV";
  }

  if (result.homo != null && result.lumo != null) {
    result.gap = parseFloat((result.lumo - result.homo).toFixed(4));
  }

  // ORCA 打印的偶极矩单位是 atomic unit，界面按 Debye 展示，需要换算
  // （水 1.85 au ≈ 4.70 D，直接标成 1.85 Debye 是错的）。
  const dipoleMatch = text.match(/Total Dipole Moment\s*[:=]\s*(-?[\d.]+)/i);
  if (dipoleMatch) {
    const au = Number.parseFloat(dipoleMatch[1]);
    if (Number.isFinite(au)) {
      result.dipole = Number((au * AU_TO_DEBYE).toFixed(4));
      result.dipoleUnit = "au→Debye";
    }
  }

  const freqMatches = text.matchAll(/^\s*\d+:\s+(-?[\d.]+)\s+cm\*\*-1/gm);
  for (const m of freqMatches) {
    const val = parseFloat(m[1]);
    // 0.00 cm⁻¹ 是平动/转动自由度，不是振动模式。水只有 3N-6=3 个真实振动，
    // 把 3 个零频算进去会变成"6 个频率模式"，还会在红外谱上多出 0 位置的峰。
    if (!Number.isFinite(val) || Math.abs(val) < 1e-6) continue;
    result.frequencies.push(val);
    if (val < 0) result.imaginaryFrequencies.push(val);
    result.irIntensities.push(0);
    result.vibrationalModes.push({ index: result.vibrationalModes.length + 1, frequency: val, intensity: 0 });
  }

  result.normalTermination = /TERMINATED NORMALLY|ORCA TERMINATED NORMALLY/i.test(text);
  const abortMatch = text.match(/(?:aborting the run[^\n]*|Error termination[^\n]*)/i);
  if (abortMatch) {
    result.aborted = true;
    result.errors.push(abortMatch[0].trim().slice(0, 200));
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
  // 纯坐标文件没有任何计算输出，套一个"通用计算化学输出"会让人以为算过东西。
  if (isPlainCoordinates(text)) return "仅结构（未包含计算结果）";
  for (const { pattern, label } of KNOWN_CALC_TYPES) {
    if (pattern.test(text)) return label;
  }
  return "通用计算化学输出";
}

/**
 * 是否只是一份坐标文件（标准 XYZ 或裸坐标行），不含任何计算结果。
 * 导出给技能脚本复用，避免"网页说是 ORCA、技能说是 XYZ"这种前后不一致。
 */
export function isPlainCoordinates(text = "") {
  if (/\b(SCF Done|FINAL SINGLE POINT ENERGY|Normal termination|TERMINATED NORMALLY|Entering Gaussian|Entering Link|ORCA)\b/i.test(text)) {
    return false;
  }
  // 带 route 行的是输入文件，不是"只有坐标"（它至少交代了想算什么）
  if (/(?:^|\n)\s*#[pPnN]\S*/.test(text)) return false;
  // 标准 XYZ：首行原子数；或者首行就是坐标行
  if (/^\s*\d+\s*(\r?\n)/.test(text)) return true;
  return /^\s*[A-Z][a-z]?\s+-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?/m.test(text);
}

export function parseAny(text) {
  // 纯坐标文件必须单独处理：下面的兜底是 parseORCA()，
  // 一份 .xyz 会被标成 "ORCA" —— 学生会以为"这是 ORCA 算的"，
  // 而文件里一个能量值都没有。
  if (isPlainCoordinates(text)) {
    const parsed = parseGaussian(text);
    parsed.type = "xyz";
    return parsed;
  }
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
