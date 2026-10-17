// LLM 客户端 — 支持 OpenAI / DeepSeek / 兼容 Chat Completions API

export class LLMClient {
  constructor({ apiKey, baseUrl, model }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || "https://api.deepseek.com";
    this.model = model || "deepseek-chat";
  }

  async call(systemPrompt, userPrompt, timeoutMs = 120_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${this.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 4096
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LLM API ${response.status}: ${text.slice(0, 400)}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || "";
    } finally {
      clearTimeout(timer);
    }
  }

  async chat(prompt) {
    return this.call("你是 ChemClaw 计算化学科研训练助教，请用中文回答。", prompt);
  }
}

// 根据环境变量创建 LLM 客户端
export function createLLMClient() {
  // 优先 DeepSeek
  if (process.env.DEEPSEEK_API_KEY) {
    return new LLMClient({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat"
    });
  }
  // 其次 OpenAI 兼容
  if (process.env.OPENAI_API_KEY) {
    return new LLMClient({
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com",
      model: process.env.OPENAI_MODEL || "gpt-4o"
    });
  }
  return null;
}
