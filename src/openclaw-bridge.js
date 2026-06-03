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
const DEFAULT_TIMEOUT = 120_000; // 2 min — LLM can be slow
const MAX_INPUT_CHARS = 50_000;   // Don't send more than 50K to the agent

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

  // Truncate overly long input
  const safeMessage = message.length > MAX_INPUT_CHARS
    ? message.slice(0, MAX_INPUT_CHARS) + "\n...[truncated]"
    : message;

  const args = [
    "agent",
    "--local",
    "--session-id", sessionId || `chemclaw-${Date.now()}`,
    "--message", safeMessage,
    "--json",
    "--timeout", String(Math.floor((timeout || DEFAULT_TIMEOUT) / 1000)),
  ];

  const { stdout, stderr } = await execFileAsync(OPENCLAW_BIN, args, {
    timeout: timeout || DEFAULT_TIMEOUT,
    maxBuffer: 5 * 1024 * 1024, // 5 MB
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
  const payload = data.payloads?.[0] || {};
  const meta = data.meta || {};
  const agentMeta = meta.agentMeta || {};

  // Detect which skill was triggered
  const toolSummary = meta.toolSummary || {};
  const skillsUsed = (meta.systemPromptReport?.skills?.entries || [])
    .filter(s => s.name.startsWith("chemclaw"))
    .map(s => s.name);

  return {
    text: payload.text || "",
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
