import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Encaminhamento, Entrega } from "./motor/motor";
import type { Registro } from "./motor/formulario";

/**
 * Como o cadastro chega à SUA aplicação.
 *
 * 1. Sempre: `data/cadastros/<protocolo>.json` (o registro local nunca falta).
 * 2. Com `CADASTRO_WEBHOOK_URL`: POST JSON assinado —
 *      X-Evento: cadastro.concluido
 *      X-Assinatura: sha256=<HMAC-SHA256 do corpo com CADASTRO_WEBHOOK_SEGREDO>
 *    As fotos vão em base64 dentro do próprio JSON (`conteudo`). Se a sua
 *    aplicação não responder 2xx, o agente tenta de novo (1 s, 10 s, 1 min,
 *    5 min) e, esgotadas as tentativas, deixa em `data/entregas-pendentes/`,
 *    reenviadas a cada 10 min até sair. O cliente nunca espera por isso.
 *
 * Encaminhamentos à equipe também viram evento (`cadastro.suporte`), numa
 * tentativa só: servem para abrir um chamado no seu sistema, se quiser.
 */

export interface OpcoesEntrega {
  pastaDados: string;
  pastaArquivos: string;
  webhookUrl?: string;
  segredo?: string;
}

const ESPERAS = [1_000, 10_000, 60_000, 5 * 60_000];

function assinatura(corpo: string, segredo?: string): Record<string, string> {
  return segredo ? { "X-Assinatura": `sha256=${createHmac("sha256", segredo).update(corpo).digest("hex")}` } : {};
}

/** Troca cada foto ({arquivo, tipo, bytes}) pela mesma com o `conteudo` em base64. */
async function comConteudo(v: unknown, pasta: string): Promise<unknown> {
  if (Array.isArray(v)) return Promise.all(v.map((x) => comConteudo(x, pasta)));
  if (v && typeof v === "object") {
    const o = v as Registro;
    if (typeof o.arquivo === "string" && typeof o.tipo === "string") {
      const buf = await fs.readFile(path.join(pasta, o.arquivo)).catch(() => null);
      return { ...o, conteudo: buf ? buf.toString("base64") : null };
    }
    const out: Registro = {};
    for (const [k, x] of Object.entries(o)) out[k] = await comConteudo(x, pasta);
    return out;
  }
  return v;
}

export function criarEntrega(o: OpcoesEntrega) {
  const cadastros = path.join(o.pastaDados, "cadastros");
  const pendentes = path.join(o.pastaDados, "entregas-pendentes");

  async function postar(evento: string, corpo: string): Promise<boolean> {
    if (!o.webhookUrl) return true;
    try {
      const res = await fetch(o.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Evento": evento, ...assinatura(corpo, o.segredo) },
        body: corpo,
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return true;
      console.error(`[entrega] ${evento}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    } catch (e) {
      console.error(`[entrega] ${evento}:`, e instanceof Error ? e.message : e);
    }
    return false;
  }

  async function tentar(protocolo: string, corpo: string) {
    for (const espera of [0, ...ESPERAS]) {
      if (espera) await new Promise((r) => setTimeout(r, espera));
      if (await postar("cadastro.concluido", corpo)) {
        await fs.rm(path.join(pendentes, `${protocolo}.json`), { force: true });
        console.log(`[entrega] ${protocolo} entregue à aplicação`);
        return;
      }
    }
    await fs.mkdir(pendentes, { recursive: true });
    await fs.writeFile(path.join(pendentes, `${protocolo}.json`), corpo, { mode: 0o600 });
    console.error(`[entrega] ALERTA: ${protocolo} não foi aceito pela aplicação; fica em ${pendentes} e é reenviado a cada 10 min`);
  }

  /** Reenvia o que ficou pendente (chamado a cada 10 min pelo servidor). */
  async function reenviarPendentes() {
    const nomes = await fs.readdir(pendentes).catch(() => [] as string[]);
    for (const n of nomes.filter((x) => x.endsWith(".json"))) {
      const corpo = await fs.readFile(path.join(pendentes, n), "utf8");
      if (await postar("cadastro.concluido", corpo)) {
        await fs.rm(path.join(pendentes, n), { force: true });
        console.log(`[entrega] pendente ${n} entregue`);
      }
    }
  }

  async function entregar(e: Entrega): Promise<void> {
    await fs.mkdir(cadastros, { recursive: true });
    await fs.writeFile(path.join(cadastros, `${e.protocolo}.json`), JSON.stringify(e, null, 2), { mode: 0o600 });
    if (!o.webhookUrl) return;
    const corpo = JSON.stringify({ evento: "cadastro.concluido", cadastro: { ...e, dados: await comConteudo(e.dados, o.pastaArquivos) } });
    void tentar(e.protocolo, corpo).catch((err) => console.error("[entrega]", err));
  }

  function encaminhado(e: Encaminhamento) {
    if (!o.webhookUrl) return;
    void postar("cadastro.suporte", JSON.stringify({ evento: "cadastro.suporte", ...e, em: new Date().toISOString() }));
  }

  return { entregar, encaminhado, reenviarPendentes };
}
