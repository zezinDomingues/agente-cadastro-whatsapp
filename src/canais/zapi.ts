
/**
 * Z-API (z-api.io): envio de mensagens pelo número do cadastro.
 *
 * Atenção: a Z-API devolve erro com HTTP 200. O que prova o envio é o
 * `messageId` na resposta, não o status.
 */

function config() {
  const instance = process.env.ZAPI_INSTANCE?.trim();
  const token = process.env.ZAPI_TOKEN?.trim();
  if (!instance || !token) throw new Error("ZAPI_INSTANCE e ZAPI_TOKEN não configurados");
  return {
    base: `https://api.z-api.io/instances/${instance}/token/${token}`,
    clientToken: process.env.ZAPI_CLIENT_TOKEN?.trim() ?? "",
  };
}

export function zapiConfigured(): boolean {
  return Boolean(process.env.ZAPI_INSTANCE?.trim() && process.env.ZAPI_TOKEN?.trim());
}

async function call(path: string, method: "POST" | "PUT", body: unknown): Promise<Record<string, unknown>> {
  const c = config();
  const res = await fetch(`${c.base}/${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(c.clientToken ? { "Client-Token": c.clientToken } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text);
  } catch {
    // corpo não-JSON: cai no erro abaixo
  }
  if (!res.ok) throw new Error(`Z-API ${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return data;
}

/** Texto para um contato (`phone`: só dígitos, com 55 + DDD). Aceita *negrito* e _itálico_ do WhatsApp. */
export async function sendText(phone: string, message: string): Promise<string> {
  // Modo simulação (testes): não manda nada, só registra no log do servidor.
  const dry = dryRun(phone, message);
  if (dry) return dry;
  const data = await call("send-text", "POST", { phone, message });
  const id = data.messageId ?? data.zaapId;
  if (!id) throw new Error(`Z-API send-text sem messageId: ${JSON.stringify(data).slice(0, 200)}`);
  return String(id);
}

/**
 * O número tem WhatsApp? A Z-API manda mensagem para qualquer número sem dar
 * erro, então quem começa uma conversa confere antes. Devolve o número como o
 * WhatsApp o conhece (a Z-API acerta o nono dígito, ex.: 551130000001 →
 * 5511930000001), ou null se não tem WhatsApp. Em simulação, devolve o próprio.
 */
export async function phoneExists(phone: string): Promise<string | null> {
  if (simulado(phone)) return phone;
  const c = config();
  const res = await fetch(`${c.base}/phone-exists/${phone}`, {
    headers: c.clientToken ? { "Client-Token": c.clientToken } : {},
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Z-API phone-exists: HTTP ${res.status} ${text.slice(0, 200)}`);
  let data: { exists?: unknown; phone?: unknown } = {};
  try {
    data = JSON.parse(text);
  } catch {
    // corpo não-JSON: cai no erro abaixo
  }
  if (typeof data.exists !== "boolean") throw new Error(`Z-API phone-exists: resposta inesperada ${text.slice(0, 200)}`);
  if (!data.exists) return null;
  return typeof data.phone === "string" && /^\d{10,15}$/.test(data.phone) ? data.phone : phone;
}

function messageIdOf(path: string, data: Record<string, unknown>): string {
  const id = data.messageId ?? data.zaapId;
  if (!id) throw new Error(`Z-API ${path} sem messageId: ${JSON.stringify(data).slice(0, 200)}`);
  return String(id);
}

/**
 * Simulação (testes): `ZAPI_DRY_RUN=1` para tudo, ou `ZAPI_DRY_RUN_PREFIX`
 * só para os números que começam com ele (ex. 5511900000, números falsos).
 */
export function simulado(phone: string): boolean {
  if (process.env.ZAPI_DRY_RUN === "1") return true;
  const prefix = process.env.ZAPI_DRY_RUN_PREFIX?.trim();
  return Boolean(prefix && phone.startsWith(prefix));
}

function dryRun(phone: string, what: string): string | null {
  if (!simulado(phone)) return null;
  console.log(`[zapi dry-run] → ${phone}: ${JSON.stringify(what)}`);
  return "dry-run";
}

export interface Botao {
  id: string;
  /** Até 20 caracteres (limite do WhatsApp). */
  label: string;
}

/** Texto com botões de resposta rápida (até 3). A resposta chega em `buttonsResponseMessage.buttonId`. */
export async function sendButtons(phone: string, message: string, buttons: Botao[]): Promise<string> {
  const dry = dryRun(phone, `${message}\n[botões: ${buttons.map((b) => `${b.label} (${b.id})`).join(" | ")}]`);
  if (dry) return dry;
  const data = await call("send-button-list", "POST", { phone, message, buttonList: { buttons } });
  return messageIdOf("send-button-list", data);
}

/** Botão de link: abre o endereço (site, wa.me do suporte) sem sair da conversa. */
export interface BotaoLink {
  /** Até 20 caracteres. */
  label: string;
  url: string;
}

export interface Acoes {
  /** Cabeçalho em negrito, acima do texto (até 60 caracteres). */
  title?: string;
  /** Rodapé cinza, abaixo do texto (até 60 caracteres). */
  footer?: string;
  /** Imagem no topo: URL ou data URI (base64). */
  image?: string;
}

/**
 * Botões de ação (versão "beta" dos botões da Z-API, ligada no painel): até 3
 * botões de resposta (REPLY) OU até 2 de link (URL), com cabeçalho, rodapé e
 * imagem opcionais. Os dois tipos não vão juntos (o WhatsApp Web dá erro). A
 * resposta de um REPLY chega como a de um botão comum (`buttonsResponseMessage`).
 */
export async function sendButtonActions(
  phone: string,
  message: string,
  botoes: { reply: Botao[] } | { links: BotaoLink[] },
  extra: Acoes = {}
): Promise<string> {
  const buttonActions =
    "reply" in botoes
      ? botoes.reply.map((b) => ({ id: b.id, type: "REPLY", label: b.label.slice(0, 20) }))
      : botoes.links.map((b, i) => ({ id: `url${i + 1}`, type: "URL", url: b.url, label: b.label.slice(0, 20) }));
  const dry = dryRun(
    phone,
    `${extra.title ? `[${extra.title}] ` : ""}${message}${extra.footer ? `\n(${extra.footer})` : ""}${extra.image ? " [imagem]" : ""}\n[ações: ${buttonActions
      .map((b) => ("url" in b ? `${b.label} → ${b.url}` : `${b.label} (${b.id})`))
      .join(" | ")}]`
  );
  if (dry) return dry;
  const body: Record<string, unknown> = { phone, message, buttonActions };
  if (extra.title) body.title = extra.title.slice(0, 60);
  if (extra.footer) body.footer = extra.footer.slice(0, 60);
  if (extra.image) body.image = extra.image;
  const data = await call("send-button-actions", "POST", body);
  return messageIdOf("send-button-actions", data);
}

/** Imagem com legenda (capa de abertura de um passo antes de uma pergunta de texto). */
export async function sendImage(phone: string, image: string, caption: string): Promise<string> {
  const dry = dryRun(phone, `[imagem] ${caption}`);
  if (dry) return dry;
  const data = await call("send-image", "POST", { phone, image, caption });
  return messageIdOf("send-image", data);
}

export interface Opcao {
  id: string;
  /** Até 24 caracteres. */
  title: string;
  /** Até 72 caracteres. */
  description?: string;
}

/** Lista de opções (até 10). A resposta chega em `listResponseMessage.selectedRowId`. */
export async function sendOptionList(
  phone: string,
  message: string,
  list: { title: string; buttonLabel: string; options: Opcao[] }
): Promise<string> {
  const dry = dryRun(phone, `${message}\n[lista "${list.buttonLabel}": ${list.options.map((o) => `${o.title} (${o.id})`).join(" | ")}]`);
  if (dry) return dry;
  const data = await call("send-option-list", "POST", { phone, message, optionList: list });
  return messageIdOf("send-option-list", data);
}

export interface Cartao {
  text: string;
  /** URL ou data URI (base64) da imagem do cartão. */
  image: string;
  buttons: Botao[];
}

/** Carrossel de cartões com imagem e botões de resposta (REPLY). */
export async function sendCarousel(phone: string, message: string, cards: Cartao[]): Promise<string> {
  const dry = dryRun(
    phone,
    `${message}\n[carrossel: ${cards.map((c) => `${c.text.split("\n")[0]} → ${c.buttons.map((b) => `${b.label} (${b.id})`).join("/")}`).join(" | ")}]`
  );
  if (dry) return dry;
  const data = await call("send-carousel", "POST", {
    phone,
    message,
    carousel: cards.map((c) => ({ text: c.text, image: c.image, buttons: c.buttons.map((b) => ({ ...b, type: "REPLY" })) })),
  });
  return messageIdOf("send-carousel", data);
}

/** Aponta o webhook "ao receber" da instância para `url` (precisa ser HTTPS). */
export async function setReceivedWebhook(url: string): Promise<void> {
  const data = await call("update-webhook-received", "PUT", { value: url });
  if (data.value !== true) throw new Error(`Z-API update-webhook-received: ${JSON.stringify(data).slice(0, 200)}`);
}

/** Baixa a mídia de uma mensagem recebida (a Z-API guarda por 30 dias). */
export async function downloadMedia(url: string, maxBytes = 15 * 1024 * 1024): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`mídia: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`mídia grande demais (${buf.length} bytes)`);
  return buf;
}

async function get(caminho: string): Promise<Record<string, unknown>> {
  const c = config();
  const res = await fetch(`${c.base}/${caminho}`, {
    headers: c.clientToken ? { "Client-Token": c.clientToken } : {},
    signal: AbortSignal.timeout(15_000),
  });
  return (await res.json()) as Record<string, unknown>;
}

/** Conexão da instância com o WhatsApp. */
export async function zapiStatus(): Promise<{ connected: boolean; error?: string }> {
  const d = await get("status");
  return { connected: d.connected === true, error: typeof d.error === "string" ? d.error : undefined };
}

/** Identificador interno do contato (lid): outro endereçamento para a nova tentativa. */
export async function phoneLid(phone: string): Promise<string | null> {
  const d = await get(`phone-exists/${phone.replace(/\D/g, "")}`);
  return typeof d.lid === "string" && d.lid.endsWith("@lid") ? d.lid : null;
}

/** Aponta o webhook de status das mensagens (entregue, lida) para `url`. */
export async function setStatusWebhook(url: string): Promise<void> {
  const data = await call("update-webhook-message-status", "PUT", { value: url });
  if (data.value !== true) throw new Error(`Z-API update-webhook-message-status: ${JSON.stringify(data).slice(0, 200)}`);
}
