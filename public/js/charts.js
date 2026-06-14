// ===== Chart Rendering Module =====
import { $ } from "./state.js";

export function renderEnergyChart(chart) {
  if (!chart?.values?.length || !chart.labels?.length) {
    $("#energyChart").innerHTML = `
      <div class="chart-empty">
        <strong>无能量曲线可显示</strong>
        <p>${chart?.note || "单点计算不会生成反应能垒曲线。"}</p>
      </div>`;
    return;
  }

  const labels = chart.labels?.length ? chart.labels : ["反应物", "过渡态", "产物"];
  const rawValues = chart.values?.length ? chart.values.map(Number) : [0, 18.6, -8.4];
  const width = 700, height = 300, padX = 52, padY = 32;
  const innerW = width - padX * 2, innerH = height - padY * 2;
  const min = Math.min(...rawValues), max = Math.max(...rawValues), range = Math.max(max - min, 1);

  const points = rawValues.map((v, i) => ({
    x: padX + (innerW * i) / Math.max(labels.length - 1, 1),
    y: padY + innerH - ((v - min) / range) * innerH,
    value: v,
    label: labels[i]
  }));

  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const yTicks = [max, min + range / 2, min].map(v => Number(v.toFixed(1)));
  const dark = document.documentElement.classList.contains("dark");
  const bg = dark ? "#0f172a" : "#fbfcfd";
  const textMuted = dark ? "#64748b" : "#667085";
  const textInk = dark ? "#e2e8f0" : "#17202a";
  const gridLine = dark ? "#1e293b" : "#d9e1e8";

  $("#energyChart").innerHTML = `
    <svg class="energy-svg" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="eg" x1="0" x2="1"><stop offset="0%" stop-color="#0f766e"/><stop offset="100%" stop-color="#2563eb"/></linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="2.5"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="${bg}"/>
      ${[0,1,2,3].map(i => `<line x1="${padX}" y1="${padY+innerH*i/3}" x2="${width-padX}" y2="${padY+innerH*i/3}" stroke="${gridLine}" stroke-width="1"/>`).join("")}
      <line x1="${padX}" y1="${padY}" x2="${padX}" y2="${height-padY}" stroke="${dark ? '#334155' : 'rgba(23,32,42,.35)'}" stroke-width="1.2"/>
      <line x1="${padX}" y1="${height-padY}" x2="${width-padX}" y2="${height-padY}" stroke="${dark ? '#334155' : 'rgba(23,32,42,.35)'}" stroke-width="1.2"/>
      ${yTicks.map((t,i) => `<text x="${padX-10}" y="${padY+innerH*i/2+4}" text-anchor="end" fill="${textMuted}" font-size="12" font-weight="800">${t}</text>`).join("")}
      <path d="${d}" fill="none" stroke="url(#eg)" stroke-width="4" stroke-linecap="round" filter="url(#glow)"/>
      ${points.map((p,i) => `<g class="energy-point" data-index="${i}" transform="translate(${p.x},${p.y})" style="cursor:pointer"><circle r="${i===1?10:8}" fill="${i===1?'#b42318':'#0f766e'}" stroke="${bg}" stroke-width="3"/><text y="-16" text-anchor="middle" fill="${textInk}" font-size="11" font-weight="900">${rawValues[i].toFixed(2)}</text></g>`).join("")}
      ${points.map((p,i) => `<text x="${p.x}" y="${height-14}" text-anchor="middle" fill="${textMuted}" font-size="12" font-weight="800">${p.label}</text>`).join("")}
    </svg>`;
}

export function renderMiniLineChart({ labels, values, title, unit, color }) {
  const width = 500, height = 220, padX = 42, padY = 28;
  const min = Math.min(...values), max = Math.max(...values);
  const range = Math.max(max - min, 1e-6);
  const dark = document.documentElement.classList.contains("dark");
  const bg = dark ? "#0f172a" : "#fbfcfd";
  const gridLine = dark ? "#1e293b" : "#d9e1e8";

  const points = values.map((v, i) => ({
    x: padX + (i / Math.max(values.length - 1, 1)) * (width - padX * 2),
    y: padY + (1 - ((v - min) / range)) * (height - padY * 2),
    value: v
  }));
  const d = points.map((p, i) => `${i ? "L" : "M"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  return `
    <svg class="mini-svg" viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" rx="8" fill="${bg}"></rect>
      <text x="${padX}" y="18" fill="${dark ? '#e2e8f0' : '#344054'}" font-size="13" font-weight="900">${title}</text>
      <text x="${width-padX}" y="18" fill="${dark ? '#64748b' : '#667085'}" font-size="11" font-weight="800" text-anchor="end">${unit}</text>
      ${[0,1,2,3].map(i => `<line x1="${padX}" y1="${padY+(height-padY*2)*i/3}" x2="${width-padX}" y2="${padY+(height-padY*2)*i/3}" stroke="${gridLine}"></line>`).join("")}
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2.5"></path>
      ${points.map((p,i) => `<circle cx="${p.x}" cy="${p.y}" r="${i===points.length-1?6:4}" fill="${i===points.length-1?"#b42318":color}"></circle>`).join("")}
      <text x="${padX}" y="${height-8}" fill="${dark ? '#64748b' : '#667085'}" font-size="11" font-weight="800">1</text>
      <text x="${width-padX}" y="${height-8}" text-anchor="end" fill="${dark ? '#64748b' : '#667085'}" font-size="11" font-weight="800">${labels[labels.length-1]}</text>
    </svg>`;
}

export function renderOptimizationTrajectoryChart(trajectory, selectedIndex) {
  const values = trajectory.map(p => Number.isFinite(p.relativeEnergyKcal) ? p.relativeEnergyKcal : null);
  const valid = values.filter(Number.isFinite);
  if (valid.length < 2) {
    return `<div class="chart-empty compact"><strong>Structure sequence detected</strong><p>Multiple frames found, but insufficient stepwise energy data.</p></div>`;
  }

  const width = 600, height = 250, padX = 48, padY = 30;
  const min = Math.min(...valid), max = Math.max(...valid);
  const range = Math.max(max - min, 1e-6);
  const dark = document.documentElement.classList.contains("dark");
  const bg = dark ? "#0f172a" : "#fbfcfd";
  const gridLine = dark ? "#1e293b" : "#d9e1e8";
  const textInk = dark ? "#e2e8f0" : "#17202a";
  const textMuted = dark ? "#64748b" : "#667085";

  const points = values.map((v, i) => {
    if (!Number.isFinite(v)) return null;
    return {
      x: padX + (i / Math.max(values.length - 1, 1)) * (width - padX * 2),
      y: padY + (1 - ((v - min) / range)) * (height - padY * 2),
      value: v,
      step: trajectory[i].step
    };
  });

  const d = points.filter(Boolean).map((p, i) => `${i ? "L" : "M"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  return `
    <svg class="mini-svg optimization-svg" viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" rx="8" fill="${bg}"></rect>
      <text x="${padX}" y="19" fill="${textInk}" font-size="13" font-weight="900">总能量 vs 优化步</text>
      <text x="${width-padX}" y="19" fill="${textMuted}" font-size="11" font-weight="800" text-anchor="end">相对能量 / kcal mol&sup1;</text>
      ${[0,1,2,3].map(i => `<line x1="${padX}" y1="${padY+(height-padY*2)*i/3}" x2="${width-padX}" y2="${padY+(height-padY*2)*i/3}" stroke="${gridLine}"></line>`).join("")}
      <path d="${d}" fill="none" stroke="#275cd8" stroke-width="2.8" stroke-linecap="round"></path>
      ${points.map((p, i) => p ? `
        <g class="optimization-point" data-index="${i}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
          <circle r="${i===selectedIndex?7:4.5}" fill="${i===selectedIndex?"#b42318":"#275cd8"}" stroke="${bg}" stroke-width="2.5"></circle>
          ${i===selectedIndex?`<text y="-14" text-anchor="middle" fill="${textInk}" font-size="11" font-weight="900">${p.value.toFixed(2)}</text>`:""}
        </g>` : "").join("")}
      <text x="${padX}" y="${height-8}" fill="${textMuted}" font-size="11" font-weight="800">步 ${trajectory[0]?.step ?? 1}</text>
      <text x="${width-padX}" y="${height-8}" text-anchor="end" fill="${textMuted}" font-size="11" font-weight="800">步 ${trajectory[trajectory.length-1]?.step ?? trajectory.length}</text>
    </svg>`;
}

export function renderSpectrum(modes, selectedIndex) {
  const width = 500, height = 220, padX = 40, padY = 24;
  const freqs = modes.map(m => Number(m.frequency)).filter(Number.isFinite);
  const minX = Math.min(0, ...freqs), maxX = Math.max(3500, ...freqs);
  const maxI = Math.max(1, ...modes.map(m => Number(m.intensity) || 0));
  const dark = document.documentElement.classList.contains("dark");
  const bg = dark ? "#0f172a" : "#fbfcfd";
  const axisColor = dark ? "#334155" : "#98a6b3";

  const bars = modes.map(mode => {
    const freq = Number(mode.frequency);
    const intensity = Number(mode.intensity) || (freq < 0 ? 0.2 : 0.05);
    const x = padX + ((freq - minX) / Math.max(maxX - minX, 1)) * (width - padX * 2);
    const y = height - padY - (intensity / maxI) * (height - padY * 2);
    const selected = mode.index === selectedIndex;
    return `<line x1="${x.toFixed(1)}" y1="${height-padY}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${selected ? "#b42318" : (dark ? "#94a3b8" : "#17202a")}" stroke-width="${selected ? 3 : 1.5}" />`;
  }).join("");

  const selectedMode = modes.find(m => m.index === selectedIndex) || modes[0];
  $("#vibrationChart").innerHTML = `
    <svg class="mini-svg" viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" rx="8" fill="${bg}"></rect>
      <line x1="${padX}" y1="${height-padY}" x2="${width-padX}" y2="${height-padY}" stroke="${axisColor}"></line>
      <line x1="${padX}" y1="${padY}" x2="${padX}" y2="${height-padY}" stroke="${axisColor}"></line>
      ${bars}
      <text x="${width/2}" y="${height-6}" text-anchor="middle" fill="${dark ? '#64748b' : '#667085'}" font-size="12" font-weight="800">频率 / cm&sup1;</text>
      <text x="${padX+8}" y="${padY+14}" fill="${dark ? '#e2e8f0' : '#344054'}" font-size="12" font-weight="900">红外光谱</text>
    </svg>
    <div class="mode-note">模式 ${selectedMode.index}，频率 ${Number(selectedMode.frequency).toFixed(2)} cm&sup1;，强度 ${Number(selectedMode.intensity||0).toFixed(2)}</div>`;
}

// ===== Expanded Chart Renderers (for zoom modal) =====

// Shared theme helper
function getColors() {
  const dark = document.documentElement.classList.contains("dark");
  return {
    bg: dark ? "#0f172a" : "#fbfcfd",
    gridLine: dark ? "#1e293b" : "#d9e1e8",
    textInk: dark ? "#e2e8f0" : "#17202a",
    textMuted: dark ? "#64748b" : "#667085",
    axis: dark ? "#334155" : "#98a6b3",
  };
}

export function renderExpandedEnergyChart(chartData) {
  const { labels, values, note } = chartData;
  if (!values?.length) return "<p>无数据</p>";

  const c = getColors();
  const n = values.length;
  // Dynamic width: minimum 700, but enough space per point
  const pointSpacing = Math.max(80, 700 / n);
  const width = Math.max(700, n * pointSpacing + 100);
  const height = 360, padX = 60, padY = 40;
  const innerW = width - padX * 2, innerH = height - padY * 2;

  const rawValues = values.map(Number);
  const min = Math.min(...rawValues), max = Math.max(...rawValues);
  const range = Math.max(max - min, 1);

  const points = rawValues.map((v, i) => ({
    x: padX + (innerW * i) / Math.max(n - 1, 1),
    y: padY + innerH - ((v - min) / range) * innerH,
    value: v,
    label: labels[i] || `点${i + 1}`
  }));

  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const yTicks = 5;
  const yTickValues = Array.from({length: yTicks}, (_, i) => (min + (range * i) / (yTicks - 1)).toFixed(2));

  // Determine which points to label: first, last, extremes, and transition state
  const extremeIdx = rawValues.indexOf(max); // highest energy point (likely TS)
  const labelIndices = new Set([0, n - 1, extremeIdx]);

  return `
    <svg viewBox="0 0 ${width} ${height}" style="width:100%; height:auto; min-height:360px">
      <defs>
        <linearGradient id="eg2" x1="0" x2="1"><stop offset="0%" stop-color="#0f766e"/><stop offset="100%" stop-color="#2563eb"/></linearGradient>
      </defs>
      <rect width="${width}" height="${height}" rx="8" fill="${c.bg}"/>
      ${Array.from({length: yTicks}, (_, i) => `<line x1="${padX}" y1="${padY+innerH*i/(yTicks-1)}" x2="${width-padX}" y2="${padY+innerH*i/(yTicks-1)}" stroke="${c.gridLine}" stroke-width="1"/>`).join("")}
      <line x1="${padX}" y1="${padY}" x2="${padX}" y2="${height-padY}" stroke="${c.axis}" stroke-width="1.2"/>
      <line x1="${padX}" y1="${height-padY}" x2="${width-padX}" y2="${height-padY}" stroke="${c.axis}" stroke-width="1.2"/>
      ${yTickValues.map((t, i) => `<text x="${padX-10}" y="${padY+innerH*i/(yTicks-1)+4}" text-anchor="end" fill="${c.textMuted}" font-size="13" font-weight="800">${t}</text>`).join("")}
      <path d="${d}" fill="none" stroke="url(#eg2)" stroke-width="4" stroke-linecap="round"/>
      ${points.map((p, i) => {
        const isLabeled = labelIndices.has(i);
        const isTS = i === extremeIdx;
        return `<g transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
          <circle r="${isTS ? 10 : 6}" fill="${isTS ? '#b42318' : '#0f766e'}" stroke="${c.bg}" stroke-width="3"/>
          <text y="-18" text-anchor="middle" fill="${c.textInk}" font-size="12" font-weight="900">${p.value.toFixed(2)}</text>
          ${isLabeled ? `<text y="${isTS ? 28 : 22}" text-anchor="middle" fill="${c.textMuted}" font-size="11" font-weight="800">${p.label}</text>` : ""}
        </g>`;
      }).join("")}
    </svg>
    ${note ? `<p style="margin-top:12px; color:${c.textMuted}; font-size:13px; text-align:center">${note}</p>` : ""}`;
}

export function renderExpandedTrajectoryChart(trajectory, selectedIndex) {
  if (!trajectory?.length) return "<p>无数据</p>";

  const values = trajectory.map(p => Number.isFinite(p.relativeEnergyKcal) ? p.relativeEnergyKcal : null);
  const valid = values.filter(Number.isFinite);
  if (valid.length < 2) return "<p>数据点不足</p>";

  const c = getColors();
  const n = trajectory.length;
  const pointSpacing = Math.max(60, 600 / n);
  const width = Math.max(600, n * pointSpacing + 80);
  const height = 320, padX = 50, padY = 36;
  const innerW = width - padX * 2, innerH = height - padY * 2;
  const min = Math.min(...valid), max = Math.max(...valid);
  const range = Math.max(max - min, 1e-6);

  const points = values.map((v, i) => {
    if (!Number.isFinite(v)) return null;
    return {
      x: padX + (i / Math.max(n - 1, 1)) * innerW,
      y: padY + (1 - ((v - min) / range)) * innerH,
      value: v,
      step: trajectory[i].step
    };
  });

  const d = points.filter(Boolean).map((p, i) => `${i ? "L" : "M"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const yTicks = 4;
  const yTickValues = Array.from({length: yTicks}, (_, i) => (min + (range * i) / (yTicks - 1)).toFixed(2));

  return `
    <svg viewBox="0 0 ${width} ${height}" style="width:100%; height:auto; min-height:320px">
      <rect width="${width}" height="${height}" rx="8" fill="${c.bg}"/>
      <text x="${padX}" y="20" fill="${c.textInk}" font-size="14" font-weight="900">总能量 vs 优化步</text>
      <text x="${width-padX}" y="20" fill="${c.textMuted}" font-size="12" font-weight="800" text-anchor="end">相对能量 / kcal mol&sup1;</text>
      ${Array.from({length: yTicks}, (_, i) => `<line x1="${padX}" y1="${padY+innerH*i/(yTicks-1)}" x2="${width-padX}" y2="${padY+innerH*i/(yTicks-1)}" stroke="${c.gridLine}"/>`).join("")}
      ${yTickValues.map((t, i) => `<text x="${padX-8}" y="${padY+innerH*i/(yTicks-1)+4}" text-anchor="end" fill="${c.textMuted}" font-size="12" font-weight="800">${t}</text>`).join("")}
      <path d="${d}" fill="none" stroke="#275cd8" stroke-width="3" stroke-linecap="round"/>
      ${points.map((p, i) => p ? `
        <g class="optimization-point" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
          <circle r="${i===selectedIndex?8:4}" fill="${i===selectedIndex?"#b42318":"#275cd8"}" stroke="${c.bg}" stroke-width="2.5"/>
          <text y="-14" text-anchor="middle" fill="${c.textInk}" font-size="11" font-weight="900">${p.value.toFixed(2)}</text>
          ${i % Math.max(1, Math.floor(n/15)) === 0 || i === selectedIndex ? `<text y="20" text-anchor="middle" fill="${c.textMuted}" font-size="10" font-weight="800">步${p.step}</text>` : ""}
        </g>` : "").join("")}
      <text x="${padX}" y="${height-8}" fill="${c.textMuted}" font-size="11" font-weight="800">步 ${trajectory[0]?.step ?? 1}</text>
      <text x="${width-padX}" y="${height-8}" text-anchor="end" fill="${c.textMuted}" font-size="11" font-weight="800">步 ${trajectory[trajectory.length-1]?.step ?? trajectory.length}</text>
    </svg>`;
}

// ===== Chart Zoom Facility =====
export function openChartZoom(title, renderFn) {
  $("#chartModalTitle").textContent = title;
  $("#chartModalBody").innerHTML = renderFn();
  $("#chartModal").classList.remove("hidden");
}

export function closeChartZoom() {
  $("#chartModal").classList.add("hidden");
}

// Attach click-to-zoom to energy chart
export function attachEnergyChartZoom(chartData) {
  const el = $("#energyChart");
  if (!el || !chartData?.values?.length) return;
  el.style.cursor = "pointer";
  el.title = "点击放大查看";
  el.onclick = () => openChartZoom("相对能量曲线", () => renderExpandedEnergyChart(chartData));
}

// Attach click-to-zoom to optimization chart
export function attachOptimizationChartZoom(trajectory, selectedIndex) {
  const el = $("#optimizationChart");
  if (!el || !trajectory?.length) return;
  el.style.cursor = "pointer";
  el.title = "点击放大查看";
  el.onclick = () => openChartZoom("优化轨迹", () => renderExpandedTrajectoryChart(trajectory, selectedIndex));
}
