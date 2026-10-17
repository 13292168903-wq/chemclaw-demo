// ===== Chart rendering (hand-written SVG) =====
// Colors come from CSS custom properties so charts follow the theme without
// re-rendering. Every chart carries an accessible <title> and native tooltips.
import { $ } from "./state.js";

const UNIT_KCAL = "kcal·mol⁻¹";
let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;
const isCompact = () => window.matchMedia("(max-width: 560px)").matches;

// ---------- label helpers ----------
function shortLabel(label = "", max = 12) {
  let text = String(label).trim();
  text = text
    .replace(/^reactant complex$/i, "反应物")
    .replace(/^reactant$/i, "反应物")
    .replace(/^transition state\s*/i, "过渡态 ")
    .replace(/^product$/i, "产物")
    .replace(/^product\s*\((.+)\)$/i, "产物")
    .replace(/^intermediate\s*/i, "中间体 ")
    .trim();
  if (text.length > max) text = `${text.slice(0, max - 1)}…`;
  return text;
}

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  return Array.from({ length: count }, (_, i) => min + ((max - min) * i) / (count - 1));
}

// ---------- main energy chart ----------
export function renderEnergyChart(chart) {
  const host = $("#energyChart");
  if (!host) return;

  if (!chart?.values?.length || !chart?.labels?.length) {
    host.innerHTML = `
      <div class="chart-empty">
        <strong>没有可绘制的能量曲线</strong>
        <p>${escapeXml(chart?.note || "单点计算不会生成反应能垒曲线。")}</p>
      </div>`;
    return;
  }

  const values = chart.values.map(Number);
  const labels = chart.labels;
  const compact = isCompact();
  const width = compact ? 320 : 560, height = compact ? 280 : 330;
  const padL = compact ? 38 : 52, padR = compact ? 10 : 18, padT = compact ? 32 : 38, padB = compact ? 38 : 44;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const pad = Math.max((max - min) * 0.16, 1);
  const lo = min - (min === 0 ? 0 : pad);
  const hi = max + pad;
  const range = Math.max(hi - lo, 1);

  const xFor = (i) => padL + (innerW * i) / Math.max(values.length - 1, 1);
  const yFor = (v) => padT + innerH - ((v - lo) / range) * innerH;
  const points = values.map((v, i) => ({ x: xFor(i), y: yFor(v), value: v, label: labels[i] || `点 ${i + 1}` }));

  const ticks = niceTicks(lo, hi, 5);
  const path = points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const titleId = nextId("energy-title");
  const descId = nextId("energy-desc");

  host.innerHTML = `
    <svg class="energy-svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${titleId}" preserveAspectRatio="xMidYMid meet">
      <title id="${titleId}">相对能量曲线</title>
      <desc id="${descId}">${points.map((p) => `${escapeXml(p.label)} ${p.value.toFixed(2)} ${UNIT_KCAL}`).join("；")}</desc>
      <defs>
        <linearGradient id="energy-line" x1="0" x2="1">
          <stop offset="0%" stop-color="var(--brand)"/>
          <stop offset="100%" stop-color="#2563eb"/>
        </linearGradient>
      </defs>

      ${ticks.map((t) => {
        const y = yFor(t);
        return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>
                <text x="${padL - 9}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" fill="var(--ink-muted)" font-size="12">${t.toFixed(1)}</text>`;
      }).join("")}

      <text x="${padL}" y="18" fill="var(--ink-muted)" font-size="12">相对能量 / ${UNIT_KCAL}</text>
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${height - padB}" stroke="var(--line-strong)" stroke-width="1"/>
      <line x1="${padL}" y1="${height - padB}" x2="${width - padR}" y2="${height - padB}" stroke="var(--line-strong)" stroke-width="1"/>

      <path d="${path}" fill="none" stroke="url(#energy-line)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>

      ${points.map((p, i) => {
        const isMax = p.value === max && values.filter((v) => v === max).length === 1;
        const anchor = i === 0 ? "start" : i === points.length - 1 ? "end" : "middle";
        const dx = i === 0 ? 8 : i === points.length - 1 ? -8 : 0;
        return `<g class="energy-point" data-index="${i}" tabindex="0" role="button" aria-label="${escapeXml(p.label)}，${p.value.toFixed(2)} ${UNIT_KCAL}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
          <title>${escapeXml(p.label)}：${p.value.toFixed(2)} ${UNIT_KCAL}</title>
          <circle r="10" fill="transparent"></circle>
          <circle r="5.5" fill="${isMax ? "#b42318" : "var(--brand)"}" stroke="var(--surface)" stroke-width="2"></circle>
          <text x="${dx}" y="-13" text-anchor="${anchor}" fill="var(--ink-soft)" font-size="12" font-weight="600">${p.value.toFixed(2)}</text>
        </g>`;
      }).join("")}

      ${points.map((p, i) => {
        const anchor = i === 0 ? "start" : i === points.length - 1 ? "end" : "middle";
        return `<text x="${p.x.toFixed(1)}" y="${height - padB + 19}" text-anchor="${anchor}" fill="var(--ink-muted)" font-size="12">${escapeXml(shortLabel(p.label, 13))}</text>`;
      }).join("")}
    </svg>`;
}

// ---------- simple line chart ----------
export function renderMiniLineChart({ labels, values, title, unit, color }) {
  const compact = isCompact();
  const width = compact ? 320 : 560, height = compact ? 210 : 220;
  const padL = compact ? 40 : 48, padR = compact ? 12 : 20, padT = 34, padB = 34;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const nums = values.map(Number);
  const min = Math.min(...nums), max = Math.max(...nums);
  const range = Math.max(max - min, 1e-6);

  const xFor = (i) => padL + (innerW * i) / Math.max(nums.length - 1, 1);
  const yFor = (v) => padT + (1 - (v - min) / range) * innerH;
  const points = nums.map((v, i) => ({ x: xFor(i), y: yFor(v), v }));
  const d = points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const titleId = nextId("mini-title");

  return `
    <svg class="mini-svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${titleId}">
      <title id="${titleId}">${escapeXml(title)}</title>
      <text x="${padL}" y="16" fill="var(--ink-soft)" font-size="13" font-weight="600">${escapeXml(title)}</text>
      <text x="${width - padR}" y="16" text-anchor="end" fill="var(--ink-muted)" font-size="12">${escapeXml(unit)}</text>
      ${niceTicks(min, max, 4).map((t) => {
        const y = padT + (1 - (t - min) / range) * innerH;
        return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" stroke="var(--line)"/>
                <text x="${padL - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="var(--ink-muted)" font-size="11">${formatTick(t)}</text>`;
      }).join("")}
      <path d="${d}" fill="none" stroke="${color || "var(--brand)"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${points.map((p, i) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${i === points.length - 1 ? 4.5 : 2.5}" fill="${i === points.length - 1 ? "#b42318" : color || "var(--brand)"}"/>`).join("")}
      <text x="${padL}" y="${height - 8}" fill="var(--ink-muted)" font-size="11.5">${escapeXml(labels[0])}</text>
      <text x="${width - padR}" y="${height - 8}" text-anchor="end" fill="var(--ink-muted)" font-size="11.5">${escapeXml(labels[labels.length - 1])}</text>
    </svg>`;
}

function formatTick(value) {
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

// ---------- optimization trajectory ----------
export function renderOptimizationTrajectoryChart(trajectory, selectedIndex) {
  const values = trajectory.map((p) => (Number.isFinite(p.relativeEnergyKcal) ? p.relativeEnergyKcal : null));
  const valid = values.filter(Number.isFinite);
  if (valid.length < 2) {
    return `<div class="chart-empty compact"><strong>没有可用的能量序列</strong><p>检出了结构帧，但缺少逐步能量数据。</p></div>`;
  }

  const compact = isCompact();
  const width = compact ? 320 : 620, height = compact ? 220 : 240;
  const padL = compact ? 42 : 52, padR = compact ? 12 : 20, padT = compact ? 34 : 38, padB = 34;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const min = Math.min(...valid), max = Math.max(...valid);
  const range = Math.max(max - min, 1e-6);

  const points = values.map((v, i) => {
    if (!Number.isFinite(v)) return null;
    return {
      x: padL + (innerW * i) / Math.max(values.length - 1, 1),
      y: padT + (1 - (v - min) / range) * innerH,
      value: v,
      step: trajectory[i].step,
    };
  });

  const d = points.filter(Boolean).map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const titleId = nextId("opt-title");

  return `
    <svg class="mini-svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${titleId}">
      <title id="${titleId}">优化轨迹：相对能量随优化步变化</title>
      <text x="${padL}" y="16" fill="var(--ink-soft)" font-size="13" font-weight="600">相对能量随优化步变化</text>
      <text x="${width - padR}" y="16" text-anchor="end" fill="var(--ink-muted)" font-size="12">${UNIT_KCAL}</text>
      ${niceTicks(min, max, 4).map((t) => {
        const y = padT + (1 - (t - min) / range) * innerH;
        return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" stroke="var(--line)"/>
                <text x="${padL - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="var(--ink-muted)" font-size="11">${t.toFixed(1)}</text>`;
      }).join("")}
      <path d="${d}" fill="none" stroke="#275cd8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      ${points.map((p, i) => {
        if (!p) return "";
        const selected = i === selectedIndex;
        return `<g class="optimization-point" data-index="${i}" tabindex="0" role="button" aria-label="第 ${p.step} 步，相对能量 ${p.value.toFixed(2)} ${UNIT_KCAL}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
          <title>第 ${p.step} 步：${p.value.toFixed(2)} ${UNIT_KCAL}</title>
          <circle r="9" fill="transparent"></circle>
          <circle r="${selected ? 5 : 3.4}" fill="${selected ? "#b42318" : "#275cd8"}" stroke="var(--surface)" stroke-width="2"></circle>
          ${selected ? `<text y="-12" text-anchor="middle" fill="var(--ink-soft)" font-size="11.5" font-weight="600">${p.value.toFixed(2)}</text>` : ""}
        </g>`;
      }).join("")}
      <text x="${padL}" y="${height - 8}" fill="var(--ink-muted)" font-size="11.5">第 ${trajectory[0]?.step ?? 1} 步</text>
      <text x="${width - padR}" y="${height - 8}" text-anchor="end" fill="var(--ink-muted)" font-size="11.5">第 ${trajectory[trajectory.length - 1]?.step ?? trajectory.length} 步</text>
    </svg>`;
}

// ---------- IR spectrum ----------
export function renderSpectrum(modes, selectedIndex) {
  const host = $("#vibrationChart");
  if (!host) return;

  const compact = isCompact();
  const width = compact ? 320 : 560, height = compact ? 210 : 220;
  const padL = compact ? 40 : 46, padR = compact ? 12 : 18, padT = 30, padB = compact ? 34 : 36;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const freqs = modes.map((m) => Number(m.frequency)).filter(Number.isFinite);
  const minX = Math.min(0, ...freqs);
  const maxX = Math.max(500, ...freqs);
  const intensities = modes.map((m) => Math.max(0, Number(m.intensity) || 0));
  const maxI = Math.max(...intensities);
  const hasIntensity = maxI > 0.001;

  if (!hasIntensity) {
    const sample = [...new Set(freqs)].slice(0, 8).map((f) => f.toFixed(1)).join("、");
    host.innerHTML = `
      <div class="chart-empty compact">
        <strong>没有可绘制的红外强度</strong>
        <p>这组数据没有记录 IR 强度（可能红外非活性，或输出中未包含强度）。频率位置：${sample} cm⁻¹。</p>
      </div>`;
    return;
  }
  const scaleI = maxI;

  const bars = modes.map((mode) => {
    const freq = Number(mode.frequency);
    if (!Number.isFinite(freq)) return "";
    const intensity = Math.max(0, Number(mode.intensity) || 0);
    const x = padL + ((freq - minX) / Math.max(maxX - minX, 1)) * innerW;
    const y = padT + innerH - (hasIntensity ? (intensity / scaleI) * innerH : 0);
    const selected = mode.index === selectedIndex;
    const label = selected
      ? `<text x="${x.toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" fill="${selected ? "#b42318" : "var(--ink-muted)"}" font-size="11">${Number(mode.frequency).toFixed(0)}</text>`
      : "";
    return `<g>
        <title>模式 ${mode.index}：${Number(mode.frequency).toFixed(1)} cm⁻¹，强度 ${intensity.toFixed(2)}</title>
        <line x1="${x.toFixed(1)}" y1="${padT + innerH}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"
              stroke="${selected ? "#b42318" : "var(--ink-faint)"}" stroke-width="${selected ? 2.4 : 1.2}" stroke-linecap="round"/>
        ${label}
      </g>`;
  }).join("");

  const selectedMode = modes.find((m) => m.index === selectedIndex) || modes[0];
  const titleId = nextId("ir-title");

  host.innerHTML = `
    <svg class="mini-svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${titleId}">
      <title id="${titleId}">红外光谱：${modes.length} 个振动模式</title>
      <text x="${padL}" y="16" fill="var(--ink-soft)" font-size="13" font-weight="600">红外强度 vs 频率</text>
      <text x="${width - padR}" y="16" text-anchor="end" fill="var(--ink-muted)" font-size="12">强度 (a.u.)</text>
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + innerH}" stroke="var(--line-strong)"/>
      <line x1="${padL}" y1="${padT + innerH}" x2="${width - padR}" y2="${padT + innerH}" stroke="var(--line-strong)"/>
      ${[0, 1000, 2000, 3000].filter((f) => f <= maxX).map((f) => {
        const x = padL + ((f - minX) / Math.max(maxX - minX, 1)) * innerW;
        return `<text x="${x.toFixed(1)}" y="${height - 14}" text-anchor="middle" fill="var(--ink-muted)" font-size="11">${f}</text>`;
      }).join("")}
      ${bars}
      <text x="${width / 2}" y="${height - 1}" text-anchor="middle" fill="var(--ink-muted)" font-size="11">频率 / cm⁻¹</text>
    </svg>
    <div class="mode-note">
      模式 ${selectedMode.index}：${Number(selectedMode.frequency).toFixed(1)} cm⁻¹，强度 ${Number(selectedMode.intensity || 0).toFixed(2)}
    </div>`;
}

// ---------- expanded charts (zoom modal) ----------
export function renderExpandedEnergyChart(chartData) {
  const { values, labels, note } = chartData;
  if (!values?.length) return "<p>没有数据</p>";

  const compact = isCompact();
  const width = Math.max(compact ? 320 : 760, values.length * (compact ? 80 : 110) + (compact ? 40 : 120));
  const height = compact ? 320 : 400;
  const padL = compact ? 42 : 64, padR = compact ? 14 : 34, padT = compact ? 40 : 48, padB = compact ? 44 : 56;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const nums = values.map(Number);
  const min = Math.min(...nums, 0), max = Math.max(...nums, 0);
  const pad = Math.max((max - min) * 0.16, 1);
  const lo = min - (min === 0 ? 0 : pad), hi = max + pad;
  const range = Math.max(hi - lo, 1);

  const yFor = (v) => padT + innerH - ((v - lo) / range) * innerH;
  const points = nums.map((v, i) => ({
    x: padL + (innerW * i) / Math.max(nums.length - 1, 1),
    y: yFor(v),
    value: v,
    label: labels[i] || `点 ${i + 1}`,
  }));
  const d = points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  return `
    <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto" role="img" aria-label="放大的相对能量曲线">
      <text x="${padL}" y="24" fill="var(--ink-muted)" font-size="13">相对能量 / ${UNIT_KCAL}</text>
      ${niceTicks(lo, hi, 5).map((t) => {
        const y = yFor(t);
        return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" stroke="var(--line)"/>
                <text x="${padL - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="var(--ink-muted)" font-size="12">${t.toFixed(1)}</text>`;
      }).join("")}
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${height - padB}" stroke="var(--line-strong)"/>
      <line x1="${padL}" y1="${height - padB}" x2="${width - padR}" y2="${height - padB}" stroke="var(--line-strong)"/>
      <path d="${d}" fill="none" stroke="var(--brand)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      ${points.map((p) => `<g transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
          <circle r="5" fill="#b42318" stroke="var(--surface)" stroke-width="2"/>
          <text y="-14" text-anchor="middle" fill="var(--ink-soft)" font-size="13" font-weight="600">${p.value.toFixed(2)}</text>
          <text y="26" text-anchor="middle" fill="var(--ink-muted)" font-size="12">${escapeXml(shortLabel(p.label, 16))}</text>
        </g>`).join("")}
    </svg>
    ${note ? `<p style="margin-top:12px;color:var(--ink-muted);font-size:12.5px;text-align:center">${escapeXml(note)}</p>` : ""}`;
}

export function renderExpandedTrajectoryChart(trajectory, selectedIndex) {
  if (!trajectory?.length) return "<p>没有数据</p>";
  const values = trajectory.map((p) => (Number.isFinite(p.relativeEnergyKcal) ? p.relativeEnergyKcal : null));
  const valid = values.filter(Number.isFinite);
  if (valid.length < 2) return "<p>数据点不足</p>";

  const compact = isCompact();
  const n = trajectory.length;
  const width = Math.max(compact ? 320 : 640, n * (compact ? 70 : 90) + (compact ? 40 : 100));
  const height = compact ? 320 : 360;
  const padL = compact ? 44 : 58, padR = compact ? 14 : 30, padT = compact ? 40 : 44, padB = compact ? 42 : 50;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const min = Math.min(...valid), max = Math.max(...valid);
  const range = Math.max(max - min, 1e-6);

  const points = values.map((v, i) => {
    if (!Number.isFinite(v)) return null;
    return {
      x: padL + (innerW * i) / Math.max(n - 1, 1),
      y: padT + (1 - (v - min) / range) * innerH,
      value: v,
      step: trajectory[i].step,
    };
  });
  const d = points.filter(Boolean).map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  return `
    <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto" role="img" aria-label="放大的优化轨迹">
      <text x="${padL}" y="22" fill="var(--ink-soft)" font-size="15" font-weight="600">相对能量随优化步变化</text>
      <text x="${width - padR}" y="22" text-anchor="end" fill="var(--ink-muted)" font-size="12">${UNIT_KCAL}</text>
      ${niceTicks(min, max, 5).map((t) => {
        const y = padT + (1 - (t - min) / range) * innerH;
        return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" stroke="var(--line)"/>
                <text x="${padL - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="var(--ink-muted)" font-size="12">${t.toFixed(1)}</text>`;
      }).join("")}
      <path d="${d}" fill="none" stroke="#275cd8" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
      ${points.map((p, i) => {
        if (!p) return "";
        const selected = i === selectedIndex;
        return `<g transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
          <circle r="${selected ? 6.5 : 3.6}" fill="${selected ? "#b42318" : "#275cd8"}" stroke="var(--surface)" stroke-width="2"/>
          <text y="-13" text-anchor="middle" fill="var(--ink-soft)" font-size="12">${p.value.toFixed(2)}</text>
          ${i % Math.max(1, Math.floor(n / 12)) === 0 || i === selectedIndex ? `<text y="22" text-anchor="middle" fill="var(--ink-muted)" font-size="11.5">步 ${p.step}</text>` : ""}
        </g>`;
      }).join("")}
    </svg>`;
}

// ---------- modal ----------
export function openChartZoom(title, renderFn) {
  const modal = $("#chartModal");
  if (!modal) return;
  $("#chartModalTitle").textContent = title;
  $("#chartModalBody").innerHTML = renderFn();
  modal.classList.remove("hidden");
  $("#chartModalClose")?.focus();
}

export function closeChartZoom() {
  const modal = $("#chartModal");
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
}

export function attachEnergyChartZoom(chartData) {
  const el = $("#energyChart");
  if (!el || !chartData?.values?.length) return;
  const svg = el.querySelector("svg");
  if (!svg) return;
  svg.style.cursor = "zoom-in";
  svg.setAttribute("title", "点击空白处放大图表");
  svg.onclick = (event) => {
    if (event.target.closest(".energy-point")) return;
    openChartZoom("相对能量曲线", () => renderExpandedEnergyChart(chartData));
  };
}

export function attachOptimizationChartZoom(trajectory, selectedIndex) {
  const el = $("#optimizationChart");
  if (!el || !trajectory?.length) return;
  el.style.cursor = "zoom-in";
  el.title = "点击空白处放大查看";
  el.onclick = (event) => {
    if (event.target.closest(".optimization-point")) return;
    openChartZoom("优化轨迹", () => renderExpandedTrajectoryChart(trajectory, selectedIndex));
  };
}

