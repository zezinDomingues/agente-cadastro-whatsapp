/**
 * O que o motor manda ao cliente, independente do canal. O canal do WhatsApp
 * (`canais/whatsapp.ts`) transforma em botões, listas e capas da Z-API; o de
 * memória (testes e demo) só guarda.
 */

export interface Botao {
  id: string;
  /** Até 20 caracteres (limite do WhatsApp). */
  rotulo: string;
}

export interface Link {
  rotulo: string;
  url: string;
}

export interface ItemLista {
  id: string;
  /** Até 24 caracteres. */
  titulo: string;
  /** Até 72 caracteres. */
  descricao?: string;
}

/** Imagem de abertura de um passo: título, subtítulo e a barra de progresso. */
export interface Capa {
  marca: string;
  titulo: string;
  subtitulo: string;
  passos: string[];
  /** Passo atual (1..n); n+1 = concluído. */
  atual: number;
}

export type Saida =
  | { tipo: "texto"; texto: string; capa?: Capa }
  | { tipo: "botoes"; texto: string; botoes: Botao[]; titulo?: string; rodape?: string; capa?: Capa }
  | { tipo: "links"; texto: string; links: Link[]; titulo?: string; rodape?: string; capa?: Capa }
  | { tipo: "lista"; texto: string; titulo: string; botao: string; itens: ItemLista[]; rodape?: string };

export const texto = (t: string, capa?: Capa): Saida => ({ tipo: "texto", texto: t, ...(capa ? { capa } : {}) });

/** Versão em texto puro: histórico, IA e reserva quando o interativo falha. */
export function textoDe(o: Saida): string {
  const titulo = "titulo" in o && o.titulo && o.tipo !== "lista" ? `*${o.titulo}*\n` : "";
  if (o.tipo === "texto") return o.texto;
  if (o.tipo === "botoes") return `${titulo}${o.texto}\n${o.botoes.map((b, i) => `*${i + 1}* – ${b.rotulo}`).join("\n")}`;
  if (o.tipo === "links") return `${titulo}${o.texto}\n${o.links.map((l) => `• ${l.rotulo}: ${l.url}`).join("\n")}`;
  return `${o.texto}\n${o.itens.map((x, i) => `*${i + 1}* – ${x.titulo}`).join("\n")}`;
}

/** Corpo de mensagem interativa: o WhatsApp corta acima de 1024 caracteres. */
const MAX_CORPO = 1000;

/**
 * Menos balões: textos seguidos viram um só, e o texto que vem logo antes de
 * uma pergunta interativa entra no corpo dela ("Encontrei: Rua X 📍" + a
 * pergunta do número numa mensagem só). Mexe na lista no lugar.
 */
export function compactar(out: Saida[]): void {
  for (let i = 0; i < out.length - 1; ) {
    const a = out[i];
    const b = out[i + 1];
    if (a.tipo !== "texto" || a.capa) {
      i++;
      continue;
    }
    if (!a.texto.trim()) {
      out.splice(i, 1);
      continue;
    }
    if (a.texto.length + b.texto.length + 2 > MAX_CORPO) {
      i++;
      continue;
    }
    out.splice(i, 2, { ...b, texto: `${a.texto}\n\n${b.texto}` } as Saida);
  }
}
