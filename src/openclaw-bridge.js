/**
 * OpenClaw Bridge — connects the Web Demo to the OpenClaw agent framework.
 *
 * Architecture:
 *   Web Demo Frontend
 *        ↓ HTTP
 *   Web Demo Backend (server.js)
 *        ↓ child_process
 *   openclaw agent --local --json
 *        ↓
 *   OpenClaw Framework (Qwen3_6 model)
 *        ↓ auto-triggers
 *   chemclaw-analyze / chemclaw-grade Skill
 *        ↓
 *   Python scripts (analyze.py / grade.py)
 *        ↓
 *   Structured JSON + LLM-enhanced explanations
 *
 * This is the REAL OpenClaw integration — the Web Demo's intelligence
 * comes from the OpenClaw agent framework, not from its own LLM calls.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);

const OPENCLAW_BIN = "openclaw";
const DEFAULT_TIMEOUT = 180_000; // 3 min — LLM analysis can be slow
const MAX_INPUT_CHARS = 150_000;  // Write up to 150K to workspace file

/**
 * Smart truncation for computation output files.
 * Keep header + key data lines + tail; cut repetitive optimization steps.
 */
function smartTruncate(text, maxChars) {
  if (text.length <= maxChars) return text;

  const lines = text.split("\n");

  // Keep first 300 lines (route, title, initial coords, first pop analysis)
  const headerLines = 300;

  // Extract ALL important lines from the entire file
  const important = [];
  const importantPatterns = [
    /SCF Done/i, /Population analysis/i, /HOMO/i, /LUMO/i,
    /Standard orientation/i, /Input orientation/i, /NAtoms/i,
    /Frequencies/i, /imaginary/i, /Zero-point/i, /Thermal/i,
    /Dipole/i, /Converged/i, /Stationary point/i, /Normal termination/i,
    /Item\s+Value/i, /Maximum Force/i, /RMS\s+Force/i,
    /optimization completed/i, /#p/i, /#n/i,
  ];

  const importantIndices = new Set();
  for (let i = 0; i < lines.length; i++) {
    for (const pat of importantPatterns) {
      if (pat.test(lines[i])) {
        importantIndices.add(i);
        // Also keep surrounding context (2 lines before/after)
        for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) {
          importantIndices.add(j);
        }
      }
    }
  }

  // Tail: last 600 lines
  const tailLines = 600;
  for (let i = Math.max(0, lines.length - tailLines); i < lines.length; i++) {
    importantIndices.add(i);
  }

  // Header lines
  for (let i = 0; i < Math.min(headerLines, lines.length); i++) {
    importantIndices.add(i);
  }

  // Build result: header + important lines in order + tail
  const sorted = [...importantIndices].sort((a, b) => a - b);
  const resultLines = [];
  let lastIdx = -10;
  for (const idx of sorted) {
    if (idx > lastIdx + 2) resultLines.push(`\n...[${idx - lastIdx - 1} lines omitted]...\n`);
    resultLines.push(lines[idx]);
    lastIdx = idx;
  }

  let result = resultLines.join("\n");
  if (result.length > maxChars) result = result.slice(0, maxChars);
  return result;
}

/**
 * Detect whether OpenClaw is available on this system.
 * Result is cached for 60 seconds to avoid repeated CLI calls.
 */
let _openclawCache = null;
let _openclawCacheTime = 0;
const CACHE_TTL = 60_000; // 1 minute cache

export async function isOpenClawAvailable() {
  const now = Date.now();
  if (_openclawCache !== null && (now - _openclawCacheTime) < CACHE_TTL) {
    return _openclawCache;
  }
  try {
    const { stdout } = await execFileAsync(OPENCLAW_BIN, ["--version"], {
      timeout: 5_000,
    });
    _openclawCache = stdout.includes("OpenClaw");
    _openclawCacheTime = now;
    return _openclawCache;
  } catch {
    _openclawCache = false;
    _openclawCacheTime = now;
    return false;
  }
}

/**
 * Call the OpenClaw agent with a message and return the parsed response.
 *
 * @param {object} options
 * @param {string} options.message  — The user message / prompt
 * @param {string} options.sessionId — Session ID for conversation continuity
 * @param {number} [options.timeout] — Timeout in ms
 * @returns {Promise<{text: string, durationMs: number, model: string, provider: string, skillUsed: string|null, raw: object}>}
 */
export async function callOpenClawAgent({ message, sessionId, timeout }) {
  if (!message || message.trim().length === 0) {
    throw new Error("Empty message");
  }

  // For large analysis data, write to workspace file and let agent read from file
  const isLarge = message.length > 5000;
  let safeMessage = message;
  if (isLarge) {
    // Smart truncate: keep header + tail, cut intermediate optimization steps
    let fileContent = smartTruncate(message, MAX_INPUT_CHARS);
    fileContent = fileContent.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

    // Write to OpenClaw workspace so the agent can access it directly
    const wsDir = path.join(
      process.env.HOME || process.env.USERPROFILE || "/tmp",
      ".openclaw/workspace"
    );
    const inputFile = path.join(wsDir, `chemclaw-input-${Date.now()}.txt`);
    try {
      const fs = await import("node:fs/promises");
      await fs.mkdir(wsDir, { recursive: true });
      await fs.writeFile(inputFile, fileContent, "utf-8");
      safeMessage = `请使用 chemclaw-analyze 技能分析文件: ${inputFile}`;
    } catch (e) {
      console.error("Cannot write to workspace:", e.message);
      safeMessage = fileContent.slice(0, 8000);
    }
  }

  const args = [
    "agent",
    "--local",
    "--session-id", sessionId || `chemclaw-${Date.now()}`,
    "--message", safeMessage,
    "--json",
    "--timeout", String(Math.floor((timeout || DEFAULT_TIMEOUT) / 1000)),
  ];

  const { stdout, stderr } = await execFileAsync(OPENCLAW_BIN, args, {
    timeout: (timeout || DEFAULT_TIMEOUT) * 2,
    maxBuffer: 5 * 1024 * 1024,
    env: { ...process.env },
  });

  // OpenClaw prints plugin warnings to stderr; the JSON goes to stdout
  // but sometimes the plugin warning also goes to stdout before the JSON
  const lines = stdout.split("\n");
  let jsonStr = "";
  let foundJson = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{") || foundJson) {
      foundJson = true;
      jsonStr += line + "\n";
    }
  }

  if (!jsonStr.trim()) {
    throw new Error("No JSON response from OpenClaw agent");
  }

  const data = JSON.parse(jsonStr.trim());
  const payloads = data.payloads || [];
  const meta = data.meta || {};
  const agentMeta = meta.agentMeta || {};

  // Detect which skill was triggered
  const toolSummary = meta.toolSummary || {};
  const skillsUsed = (meta.systemPromptReport?.skills?.entries || [])
    .filter(s => s.name.startsWith("chemclaw"))
    .map(s => s.name);

  // Save raw response for debugging
  try {
    const fs = await import("node:fs");
    fs.writeFileSync("/tmp/openclaw-raw.json", jsonStr.trim().slice(0, 50000));
  } catch {}

  // Use first payload text as the analysis (may include thinking; we clean below)
  const payload = payloads[0] || {};
  let rawText = payload.text || "";

  // Also check ALL payloads for longer text (sometimes analysis is in later payloads)
  for (const p of payloads) {
    if ((p.text || "").length > rawText.length) rawText = p.text;
  }

  // Check tool results for Python script output
  for (const p of payloads) {
    for (const r of (p.toolResults || [])) {
      if ((r.output || "").length > rawText.length) rawText = r.output;
    }
  }

  const cleanedText = cleanAgentResponse(rawText) || rawText.trim();

  return {
    text: cleanedText,
    durationMs: meta.durationMs || 0,
    model: agentMeta.model || "unknown",
    provider: agentMeta.provider || "unknown",
    skillUsed: skillsUsed.length > 0 ? skillsUsed[0] : null,
    toolsCalled: toolSummary.tools || [],
    usage: agentMeta.usage || {},
    raw: data,
  };
}

/**
 * Convert structured skill JSON output into readable markdown.
 */
function formatSkillJson(json) {
  const parts = [];
  if (json.calculationType) parts.push(`**计算类型:** ${json.calculationType}`);

  if (json.explanations?.length) {
    for (const exp of json.explanations) {
      parts.push(`### ${exp.concept || ""}`);
      parts.push(exp.evidence || "");
      if (exp.teaching) parts.push(exp.teaching);
    }
  }
  if (json.grading) {
    parts.push(`**得分:** ${json.grading.score}`);
    if (json.grading.strengths?.length) parts.push(`**优点:** ${json.grading.strengths.join("；")}`);
    if (json.grading.improvements?.length) parts.push(`**改进:** ${json.grading.improvements.join("；")}`);
  }
  if (json.learningGoals?.length) {
    parts.push("## 学习目标");
    for (const g of json.learningGoals) {
      parts.push(`- **${g.concept || ""}:** ${g.outcome || ""} (${g.evidence || ""})`);
    }
  }
  if (json.quiz?.length) {
    parts.push("## 练习题");
    for (const q of json.quiz) {
      parts.push(`- [${q.type || "Q"}] ${q.question || q}`);
    }
  }
  if (json.researchSuggestions?.length) {
    parts.push("## 科研建议");
    for (const s of json.researchSuggestions) {
      parts.push(`- ${typeof s === "string" ? s : s.suggestion || ""}`);
    }
  }
  return parts.join("\n\n") || "";
}

/**
 * Strip internal monologue from agent response.
 * Finds where the actual analysis content starts (heading, key phrase, etc.)
 * and removes everything before it.
 */
function cleanAgentResponse(text) {
  if (!text) return "";

  // Look for content start markers
  const markers = [
    /(?:^|\n)#{1,3}\s/,           // markdown heading
    /(?:^|\n)\*\*/,               // bold text start
    /(?:^|\n)(?:分析结果|计算结果|摘要|报告|根据分析|关键发现|计算参数|1\.\s)/,
    /(?:^|\n)(?:Summary|Results|Analysis|Key\s)/i,
  ];

  for (const re of markers) {
    const match = text.match(re);
    if (match && match.index > 0) {
      return text.slice(match.index).replace(/^\n+/, "").trim();
    }
  }

  // Fallback: strip just the very first sentence if it's a known preamble
  const m = text.match(/^([^。．\n]*[。．])\s*/);
  if (m && /(?:好的|我来|现在运行|让我|首先|使用技能|查看脚本)/.test(m[1])) {
    return text.slice(m[0].length).trim();
  }

  return text.trim();
}

/**
 * Build a prompt for the analyze skill.
 * We include the raw data and ask OpenClaw to analyze it,
 * which will trigger the chemclaw-analyze skill.
 */
export function buildAnalyzePrompt({ datasetName, datasetText, moleculeText }) {
  let prompt = `请分析以下计算化学输出文件，使用 chemclaw-analyze 技能。\n\n`;
  prompt += `文件名: ${datasetName || "unknown"}\n\n`;
  prompt += `计算输出数据:\n\`\`\`\n${datasetText}\n\`\`\`\n`;
  if (moleculeText) {
    prompt += `\n分子坐标 (XYZ):\n\`\`\`\n${moleculeText}\n\`\`\`\n`;
  }
  prompt += `\n请提取关键指标（能量、虚频、HOMO-LUMO等），给出化学解释和教学建议。`;
  return prompt;
}

/**
 * Build a prompt for the grade skill.
 */
export function buildGradePrompt({ report, rubric }) {
  let prompt = `请批改以下学生实验报告，使用 chemclaw-grade 技能。\n\n`;
  prompt += `学生报告:\n\`\`\`\n${report}\n\`\`\`\n`;
  if (rubric) {
    prompt += `\n评分标准:\n${rubric}\n`;
  }
  prompt += `\n请按四个维度（数据解析25%、概念解释30%、科研设计25%、报告表达20%）评分并给出改进建议。`;
  return prompt;
}

/**
 * Build a chat prompt for follow-up questions.
 */
export function buildChatPrompt({ question, context }) {
  let prompt = question;
  if (context) {
    prompt = `[上下文: 用户正在分析计算化学数据，之前的分析结果概要: ${context.slice(0, 500)}]\n\n用户问题: ${question}`;
  }
  return prompt;
}
