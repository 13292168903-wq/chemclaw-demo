// ===== API Client =====
import { $ } from "./state.js";

export async function fetchStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    return data;
  } catch {
    return { agent: "offline", model: null };
  }
}

export async function analyze({ datasetName, datasetText, moleculeText }) {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ datasetName, datasetText, moleculeText })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

export async function grade({ studentReport, analysisContext }) {
  const res = await fetch("/api/grade", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ studentReport, analysisContext })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

export async function chat({ question, context }) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, context })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}
