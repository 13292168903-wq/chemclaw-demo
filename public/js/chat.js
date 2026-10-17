// ===== Teaching assistant chat =====
import { state, $ } from "./state.js";
import { chat as chatApi } from "./api.js";

export function addMessage(role, text, { pending = false } = {}) {
  const node = document.createElement("div");
  node.className = `msg ${role}${pending ? " pending" : ""}`;
  node.textContent = text;
  const log = $("#chatLog");
  if (!log) return node;
  log.appendChild(node);
  log.scrollTop = log.scrollHeight;
  return node;
}

export async function askAgent(event) {
  event.preventDefault();
  const input = $("#chatInput");
  const question = input?.value.trim();
  if (!question) return;

  const send = $("#chatForm")?.querySelector(".chat-send");
  input.value = "";
  input.disabled = true;
  if (send) send.disabled = true;
  addMessage("user", question);
  const pending = addMessage("assistant", "正在思考", { pending: true });

  try {
    const data = await chatApi({ question, context: state.analysisResult });
    pending.remove();
    addMessage("assistant", data.answer || "没有收到回复，请稍后再试。");
  } catch (error) {
    pending.remove();
    addMessage("assistant", `请求失败：${error.message}`);
  } finally {
    input.disabled = false;
    if (send) send.disabled = false;
    input.focus();
  }
}
