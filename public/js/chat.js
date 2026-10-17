// ===== Chat Module =====
import { state, $ } from "./state.js";
import { chat as chatApi } from "./api.js";

export function addMessage(role, text) {
  const node = document.createElement("div");
  node.className = `msg ${role}`;
  node.textContent = text;
  const log = $("#chatLog");
  log.appendChild(node);
  log.scrollTop = log.scrollHeight;
}

export async function askAgent(e) {
  e.preventDefault();
  const input = $("#chatInput");
  const question = input.value.trim();
  if (!question) return;
  input.value = "";
  addMessage("user", question);

  try {
    const data = await chatApi({ question, context: state.analysisResult });
    addMessage("assistant", data.answer || "未收到回复");
  } catch (err) {
    addMessage("assistant", `请求失败：${err.message}`);
  }
}
