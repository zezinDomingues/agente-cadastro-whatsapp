
/**
 * Cliente de LLM para qualquer API compatível com a da OpenAI
 * (`/chat/completions`): NVIDIA NIM (padrão, tem cota gratuita), OpenAI,
 * OpenRouter, Groq, um Ollama/vLLM local...
 *
 * Anel de chaves: APIs gratuitas devolvem 429/503 com facilidade, então a
 * chave que recusou fica de castigo e a tentativa passa na hora para a
 * próxima. Numa conversa não dá para esperar.
 *
 * Nos modelos Nemotron, o raciocínio longo fica desligado
 * (`enable_thinking: false`): com ele, o modelo escreve o raciocínio na
 * resposta e demora ~6 s em vez de ~1,5 s. Outras APIs ignoram o campo.
 */

interface Key {
  value: string;
  lastUse: number;
  punishedUntil: number;
}

const BASE_URL = (process.env.LLM_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");
const MODEL = process.env.LLM_MODEL || "nvidia/nemotron-3-super-120b-a12b";
const PUNISH_MS = Number(process.env.LLM_CASTIGO_SEGUNDOS || 60) * 1000;

let ring: Key[] | null = null;

function keys(): Key[] {
  if (!ring) {
    const list = (process.env.LLM_API_KEYS || process.env.LLM_API_KEY || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    ring = list.map((value) => ({ value, lastUse: 0, punishedUntil: 0 }));
  }
  return ring;
}

export function iaConfigurada(): boolean {
  return keys().length > 0;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Uma resposta do modelo (texto). Lança erro se nenhuma chave conseguir. */
export async function chat(messages: ChatMessage[], opts: { maxTokens?: number; temperature?: number } = {}): Promise<string> {
  const all = keys();
  if (all.length === 0) throw new Error("LLM_API_KEYS não configurado");
  let lastError = "sem tentativa";
  for (let attempt = 0; attempt < Math.max(3, all.length); attempt++) {
    const free = all.filter((k) => k.punishedUntil <= Date.now());
    if (free.length === 0) break; // numa conversa não dá para esperar o castigo passar
    const key = free.reduce((a, b) => (a.lastUse <= b.lastUse ? a : b));
    key.lastUse = Date.now();
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key.value}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 500,
          ...(/nemotron/i.test(MODEL) ? { chat_template_kwargs: { enable_thinking: false } } : {}),
        }),
        signal: AbortSignal.timeout(25_000),
      });
      if (res.ok) {
        const data = await res.json();
        return String(data?.choices?.[0]?.message?.content ?? "").trim();
      }
      lastError = `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`;
      // 400/401/403 não melhoram com outra chave.
      if (res.status < 500 && ![408, 409, 425, 429].includes(res.status)) break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    // Uma chave só: a sobrecarga (503/429) costuma passar em segundos. Tenta de
    // novo uma vez antes do castigo, senão a IA some por PUNISH_MS inteiro.
    if (all.length === 1 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    key.punishedUntil = Date.now() + PUNISH_MS;
  }
  throw new Error(`LLM: ${lastError}`);
}

/** Primeiro objeto JSON da resposta (o modelo às vezes cerca com ``` ou texto). */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
