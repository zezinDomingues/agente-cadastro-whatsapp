import type { IncomingMessage, ServerResponse } from "node:http";
import { phoneExists, simulado } from "../canais/zapi";
import type { Motor, Recebida } from "../motor/motor";
import type { Vigia } from "../vigia";
import { autorizado, iguais, lerJson, responder } from "./http";

/**
 * Rotas HTTP. A Z-API não assina os webhooks, então a URL cadastrada nela
 * leva um segredo: /api/whatsapp/webhook?secret=<WHATSAPP_WEBHOOK_SECRET>.
 * As rotas da sua aplicação pedem `Authorization: Bearer <API_SECRET>`.
 */

interface ZapiRecebida {
  type?: string;
  instanceId?: string;
  messageId?: string;
  phone?: string;
  fromMe?: boolean;
  isGroup?: boolean;
  isNewsletter?: boolean;
  broadcast?: boolean;
  isStatusReply?: boolean;
  isEdit?: boolean;
  text?: { message?: string };
  image?: { imageUrl?: string; caption?: string };
  buttonsResponseMessage?: { buttonId?: string; message?: string };
  listResponseMessage?: { selectedRowId?: string; title?: string; message?: string };
  buttonReply?: { id?: string; buttonId?: string; message?: string; title?: string };
  templateButtonReplyMessage?: { selectedId?: string; selectedDisplayText?: string };
  [key: string]: unknown;
}

/** Id e rótulo do botão ou opção tocados (os formatos que a Z-API usa). */
function escolha(m: ZapiRecebida): { id: string; rotulo: string } | null {
  const b = m.buttonsResponseMessage;
  if (b?.buttonId) return { id: b.buttonId, rotulo: b.message ?? b.buttonId };
  const l = m.listResponseMessage;
  if (l?.selectedRowId) return { id: l.selectedRowId, rotulo: l.title ?? l.selectedRowId };
  const r = m.buttonReply;
  if (r && (r.id || r.buttonId)) return { id: (r.id || r.buttonId)!, rotulo: r.message ?? r.title ?? "" };
  const t = m.templateButtonReplyMessage;
  if (t?.selectedId) return { id: t.selectedId, rotulo: t.selectedDisplayText ?? t.selectedId };
  return null;
}

/** Converte o webhook "ao receber" da Z-API numa mensagem do motor (null = ignorar). */
export function lerWebhookZapi(m: ZapiRecebida | null, instancia?: string): Recebida | null {
  // Só mensagem de um contato: fora grupos, listas, canais, status, edições e o que o próprio número enviou.
  if (
    !m ||
    m.type !== "ReceivedCallback" ||
    (instancia && m.instanceId && m.instanceId !== instancia) ||
    m.fromMe ||
    m.isGroup ||
    m.isNewsletter ||
    m.broadcast ||
    m.isStatusReply ||
    m.isEdit ||
    !m.phone ||
    !m.messageId
  )
    return null;
  const tocado = escolha(m);
  const texto = tocado?.id ?? m.text?.message ?? m.image?.caption ?? "";
  if (!texto && !m.image?.imageUrl) {
    // Áudio, figurinha... ou um formato de resposta ainda desconhecido: registra as chaves.
    console.warn("[webhook] mensagem sem texto/imagem:", Object.keys(m).filter((k) => typeof m[k] === "object").join(","));
  }
  return { telefone: m.phone.replace(/\D/g, ""), messageId: m.messageId, texto, rotulo: tocado?.rotulo, imagemUrl: m.image?.imageUrl };
}

export function criarRotas(motor: Motor, vigia: Vigia) {
  const segredoOk = (url: URL) => iguais(url.searchParams.get("secret"), process.env.WHATSAPP_WEBHOOK_SECRET);

  return {
    /** Z-API "ao receber": responde depois de processar (~1-3 s com a IA). */
    async webhook(req: IncomingMessage, res: ServerResponse, url: URL) {
      if (!segredoOk(url)) return responder(res, 401, { error: "Unauthorized" });
      const msg = lerWebhookZapi((await lerJson(req)) as ZapiRecebida | null, process.env.ZAPI_INSTANCE?.trim());
      if (!msg) return responder(res, 200, { ok: true, ignored: true });
      await motor.receber(msg);
      responder(res, 200, { ok: true });
    },

    /** Z-API "ao atualizar status da mensagem": SENT, RECEIVED, READ... (o vigia usa). */
    async status(req: IncomingMessage, res: ServerResponse, url: URL) {
      if (!segredoOk(url)) return responder(res, 401, { error: "Unauthorized" });
      const m = (await lerJson(req)) as { status?: string; ids?: unknown; messageId?: unknown } | null;
      const ids = [...(Array.isArray(m?.ids) ? m!.ids : []), m?.messageId].filter((x): x is string => typeof x === "string");
      if (m?.status && ids.length) vigia.atualizar(ids, String(m.status).toUpperCase());
      responder(res, 200, { ok: true });
    },

    /**
     * A sua aplicação convida alguém: POST /api/iniciar
     * { "telefone": "5511988887777", "formulario": "clinica", "referencia": "pedido-123", "dados": { "nome": "..." } }
     * Confere antes se o número tem WhatsApp (404 not_on_whatsapp, nada é mandado).
     */
    async iniciar(req: IncomingMessage, res: ServerResponse) {
      if (!autorizado(req)) return responder(res, 401, { error: "Unauthorized" });
      const b = (await lerJson(req)) as { telefone?: unknown; formulario?: unknown; referencia?: unknown; dados?: unknown } | null;
      const tel = typeof b?.telefone === "string" ? b.telefone.replace(/\D/g, "") : "";
      if (!/^\d{10,15}$/.test(tel)) return responder(res, 400, { error: "telefone inválido (só dígitos, com DDI)" });
      const formulario = typeof b?.formulario === "string" ? b.formulario : undefined;
      if (formulario && !motor.formulario(formulario)) return responder(res, 400, { error: `formulário "${formulario}" não existe` });
      let numero: string | null = tel;
      try {
        numero = simulado(tel) ? tel : await phoneExists(tel);
      } catch (e) {
        console.error("[iniciar] phone-exists:", e);
      }
      if (!numero) return responder(res, 404, { error: "not_on_whatsapp" });
      const s = await motor.iniciar({
        telefone: numero,
        formulario,
        referencia: typeof b?.referencia === "string" ? b.referencia : undefined,
        dados: b?.dados && typeof b.dados === "object" ? (b.dados as Record<string, unknown>) : undefined,
      });
      responder(res, 200, { ok: true, sessao: s.id, telefone: numero });
    },

    /** Aviso solto ao cliente: POST /api/avisar { "referencia" | "telefone", "mensagem" } */
    async avisar(req: IncomingMessage, res: ServerResponse) {
      if (!autorizado(req)) return responder(res, 401, { error: "Unauthorized" });
      const b = (await lerJson(req)) as { telefone?: unknown; referencia?: unknown; mensagem?: unknown } | null;
      if (typeof b?.mensagem !== "string" || !b.mensagem.trim()) return responder(res, 400, { error: "mensagem vazia" });
      const enviado = await motor.avisar({
        telefone: typeof b.telefone === "string" ? b.telefone : undefined,
        referencia: typeof b.referencia === "string" ? b.referencia : undefined,
        mensagem: b.mensagem.trim().slice(0, 4000),
      });
      responder(res, 200, { sent: enviado });
    },
  };
}
