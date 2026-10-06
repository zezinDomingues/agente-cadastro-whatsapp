import { ArmazenamentoMemoria } from "../src/armazenamento/armazenamento";
import { CanalMemoria } from "../src/canais/memoria";
import type { Chat } from "../src/ia/assistente";
import type { Formulario } from "../src/motor/formulario";
import { Motor, type Entrega } from "../src/motor/motor";
import type { Saida } from "../src/motor/saida";
import { servicosFalsos } from "./falsos";

/** Um motor completo em memória (sem rede, sem WhatsApp): demo, chat no terminal e testes. */
export function motorDeTeste(o: { formularios: Formulario[]; chat?: Chat | null; agora?: () => Date; pasta: string; suporte?: string; servicos?: typeof servicosFalsos }) {
  const canal = new CanalMemoria();
  const entregues: Entrega[] = [];
  const motor = new Motor({
    formularios: o.formularios,
    padrao: o.formularios[0].id,
    aberto: true,
    armazenamento: new ArmazenamentoMemoria(),
    canal,
    servicos: o.servicos ?? servicosFalsos,
    chat: o.chat ?? null,
    suporteWhatsApp: o.suporte,
    pastaArquivos: o.pasta,
    entregar: async (e) => {
      entregues.push(e);
    },
    agora: o.agora,
  });
  let seq = 0;
  const tel = "5511900000001";
  /** Manda uma mensagem do cliente e devolve as respostas ao cliente (e à equipe). */
  const dizer = async (m: string | { botao: string; rotulo?: string } | { imagem: string }) => {
    const base = { telefone: tel, messageId: `m${++seq}` };
    if (typeof m === "string") await motor.receber({ ...base, texto: m });
    else if ("botao" in m) await motor.receber({ ...base, texto: m.botao, rotulo: m.rotulo });
    else await motor.receber({ ...base, imagemUrl: m.imagem });
    const todas = canal.enviadas;
    canal.enviadas = [];
    return {
      cliente: todas.filter((e) => e.telefone === tel).map((e) => e.saida),
      equipe: todas.filter((e) => e.telefone !== tel).map((e) => e.saida),
    };
  };
  return { motor, canal, entregues, dizer, telefone: tel };
}

/* ── Impressão no terminal ──────────────────────────────── */

const cor = (n: number) => (t: string) => (process.stdout.isTTY || process.env.FORCE_COLOR ? `\x1b[${n}m${t}\x1b[0m` : t);
export const violeta = cor(35);
export const azul = cor(34);
export const verde = cor(32);
export const cinza = cor(90);
export const negrito = cor(1);

/** *negrito* e _itálico_ do WhatsApp no terminal. */
function whatsapp(t: string): string {
  return t.replace(/\*([^*\n]+)\*/g, (_, x) => negrito(x)).replace(/(^|\s)_([^_\n]+)_/g, (_, a, x) => `${a}${cinza(x)}`);
}

export function imprimirSaida(o: Saida, prefixo = "🤖 ") {
  const recuo = " ".repeat(3);
  const capa = "capa" in o && o.capa ? cinza(`[capa: ${o.capa.titulo} · ${o.capa.passos.map((p, i) => (i + 1 < o.capa!.atual ? `✓${p}` : i + 1 === o.capa!.atual ? `[${p}]` : p)).join(" › ")}]`) + "\n" : "";
  const corpo = whatsapp(o.texto).split("\n").join(`\n${recuo}`);
  let extra = "";
  if (o.tipo === "botoes") extra = `\n${recuo}` + o.botoes.map((b, i) => violeta(`[${i + 1} ${b.rotulo}]`)).join(" ");
  if (o.tipo === "links") extra = `\n${recuo}` + o.links.map((l) => azul(`[🔗 ${l.rotulo}]`)).join(" ");
  if (o.tipo === "lista") extra = `\n${recuo}` + violeta(`☰ ${o.botao}: `) + o.itens.map((x, i) => violeta(`${i + 1}·${x.titulo}`)).join(cinza("  "));
  const rodape = "rodape" in o && o.rodape ? `\n${recuo}${cinza(o.rodape)}` : "";
  console.log(`${prefixo}${capa ? capa + recuo : ""}${corpo}${extra}${rodape}\n`);
}
