import fs from "node:fs";
import path from "node:path";
import { phoneLid, sendText, zapiConfigured, zapiStatus } from "./canais/zapi";

/**
 * Vigia de entrega e de conexão.
 *
 * A Z-API devolver um `messageId` prova só que ela ACEITOU a mensagem. Já
 * aconteceu de o celular de destino ter o número do cadastro bloqueado (ou
 * marcado como spam) e a mensagem nunca chegar — e de a instância cair sem
 * ninguém saber. Só a confirmação de ENTREGA (status RECEIVED do webhook de
 * status) prova. Então:
 *
 *  1. a primeira mensagem a cada cliente e todo encaminhamento à equipe ficam
 *     pendentes até a confirmação (rota /api/whatsapp/status);
 *  2. sem confirmação em VIGIA_PRAZO_MIN (padrão 3 min), a mensagem vai de
 *     novo, endereçada pelo lid do contato, e o responsável (ALERTA_WHATSAPP)
 *     recebe o alarme com o que conferir; quando a entrega sai, ele é avisado;
 *  3. a conexão da instância é conferida a cada 2 min (log e /health).
 *
 * Pendentes em data/entregas-whatsapp.json: reiniciar não perde nenhum.
 */

const PRAZO_MS = Number(process.env.VIGIA_PRAZO_MIN || 3) * 60_000;
const GUARDA_MS = 48 * 3600_000;
const ENTREGUE = new Set(["RECEIVED", "READ", "READ_BY_ME", "PLAYED"]);

interface Pendente {
  messageId: string;
  tipo: "cliente" | "suporte";
  destino: string;
  texto: string;
  enviadoEm: number;
  status: string;
  entregueEm?: number;
  alarmadoEm?: number;
  novaId?: string;
}

export class Vigia {
  private pendentes: Pendente[];
  private conectado: boolean | null = null;
  private conferidoEm = 0;
  private alarmadoEm = 0;
  private readonly alerta: string;

  constructor(private arquivo: string) {
    this.alerta = (process.env.ALERTA_WHATSAPP || "").replace(/\D/g, "");
    try {
      this.pendentes = JSON.parse(fs.readFileSync(arquivo, "utf8")) as Pendente[];
    } catch {
      this.pendentes = [];
    }
  }

  private gravar() {
    const agora = Date.now();
    this.pendentes = this.pendentes.filter((p) => agora - p.enviadoEm < GUARDA_MS);
    try {
      fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
      fs.writeFileSync(this.arquivo, JSON.stringify(this.pendentes, null, 1));
    } catch (e) {
      console.error("[vigia] gravar:", e);
    }
  }

  private async alarmar(texto: string) {
    let ok = false;
    if (this.alerta && this.conectado !== false) {
      try {
        await sendText(this.alerta, `🚨 *Agente de cadastro (WhatsApp)*\n\n${texto}`);
        ok = true;
      } catch (e) {
        console.error("[vigia] alarme:", e);
      }
    }
    console.error(`[vigia] ALARME${ok ? "" : " (só no log)"}: ${texto.replace(/\n/g, " ")}`);
  }

  /** Mensagem aceita pelo canal: pendente até a confirmação de entrega. */
  registrar(messageId: string, destino: string, texto: string, tipo: "cliente" | "suporte") {
    if (messageId === "dry-run") return;
    this.pendentes.push({ messageId, destino, texto, tipo, enviadoEm: Date.now(), status: "SENT" });
    this.gravar();
  }

  /** Webhook de status da Z-API (a nova tentativa também conta). */
  atualizar(ids: string[], status: string) {
    let mudou = false;
    for (const p of this.pendentes) {
      if (!ids.includes(p.messageId) && !(p.novaId && ids.includes(p.novaId))) continue;
      p.status = status;
      if (ENTREGUE.has(status) && !p.entregueEm) {
        p.entregueEm = Date.now();
        if (p.alarmadoEm) void this.alarmar(`✅ A mensagem ${p.tipo === "suporte" ? "à equipe" : `ao cliente ${p.destino}`} acabou de ser entregue.`);
      }
      mudou = true;
    }
    if (mudou) this.gravar();
  }

  private async tentarDeNovo(p: Pendente) {
    p.alarmadoEm = Date.now();
    const lid = await phoneLid(p.destino).catch(() => null);
    try {
      p.novaId = await sendText(lid ?? p.destino, p.texto);
    } catch (e) {
      console.error("[vigia] nova tentativa:", e);
    }
    this.gravar();
    await this.alarmar(
      `${p.tipo === "suporte" ? "Um encaminhamento à *equipe*" : `A primeira mensagem ao *cliente* ${p.destino}`} NÃO foi entregue ` +
        `em ${Math.round(PRAZO_MS / 60000)} min (status: ${p.status}).\n\n` +
        (p.novaId ? "Tentei de novo; aviso aqui se for entregue." : "A nova tentativa também falhou.") +
        "\n\nConfira: a instância está conectada? O celular de destino bloqueou ou marcou o número do cadastro como spam?" +
        `\n\nMensagem:\n${p.texto.slice(0, 600)}`
    );
  }

  private async conferirPendentes() {
    const agora = Date.now();
    for (const p of this.pendentes) {
      if (p.entregueEm || p.alarmadoEm || agora - p.enviadoEm < PRAZO_MS) continue;
      await this.tentarDeNovo(p);
    }
  }

  private async conferirConexao() {
    const antes = this.conectado;
    let detalhe = "";
    try {
      const st = await zapiStatus();
      this.conectado = st.connected;
      detalhe = st.error ?? "";
    } catch (e) {
      this.conectado = false;
      detalhe = String(e).slice(0, 150);
    }
    this.conferidoEm = Date.now();
    if (!this.conectado && (antes !== false || Date.now() - this.alarmadoEm > 30 * 60_000)) {
      this.alarmadoEm = Date.now();
      await this.alarmar(`A instância da Z-API está *DESCONECTADA* (${detalhe || "sem detalhe"}): o agente não recebe nem manda mensagens. Reconecte pelo QR code no painel da Z-API.`);
    } else if (this.conectado && antes === false) {
      this.alarmadoEm = 0;
      await this.alarmar("✅ A Z-API voltou a ficar conectada.");
    }
  }

  estado() {
    return {
      conectado: this.conectado,
      conferidoEm: this.conferidoEm ? new Date(this.conferidoEm).toISOString() : null,
      pendentes: this.pendentes.filter((p) => !p.entregueEm).length,
    };
  }

  iniciar() {
    if (!zapiConfigured()) return;
    const volta = (fn: () => Promise<void>, ms: number) => {
      const rodar = () => fn().catch((e) => console.error("[vigia]", e));
      setTimeout(rodar, 5_000);
      setInterval(rodar, ms).unref();
    };
    volta(() => this.conferirPendentes(), 60_000);
    volta(() => this.conferirConexao(), 2 * 60_000);
    console.log(`[vigia] ligado: entrega em até ${PRAZO_MS / 60000} min, conexão a cada 2 min, alarmes ${this.alerta ? `para ${this.alerta}` : "só no log (ALERTA_WHATSAPP vazio)"}`);
  }
}
