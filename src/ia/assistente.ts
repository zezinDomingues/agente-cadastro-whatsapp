import type { ChatMessage } from "./llm";
import { parseJsonObject } from "./llm";

/**
 * O que a IA faz no cadastro — e só isso. Ela NUNCA grava nada: devolve uma
 * leitura da mensagem, e o motor passa o valor pela mesma validação de uma
 * resposta digitada. Sem chave de IA (ou com ela fora do ar), o cadastro
 * funciona do mesmo jeito; só fica menos tolerante a respostas soltas.
 */

export type Chat = (messages: ChatMessage[], opts?: { maxTokens?: number; temperature?: number }) => Promise<string>;

export interface Contexto {
  organizacao: string;
  formulario: string;
  conhecimento?: string;
  /** A pergunta como o cliente a viu. */
  pergunta: string;
  /** O que ela pede, em palavras (vem do tipo e do rótulo do campo). */
  oQue: string;
  /** Ajuda específica do campo (de onde tirar a informação, regras). */
  ajuda?: string;
  /** Últimas mensagens (já sem nada sensível). */
  historico: string;
}

export interface LeituraIa {
  acao: "valor" | "duvida" | "suporte";
  valor?: string;
  resposta?: string;
}

/**
 * Lê a mensagem do cliente: é a resposta (e qual o valor, já limpo), uma
 * dúvida (e a resposta para ela) ou assunto que só a equipe resolve.
 */
export async function lerMensagem(chat: Chat, ctx: Contexto, mensagem: string): Promise<LeituraIa | null> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        `Você é o assistente de cadastro de ${ctx.organizacao} no WhatsApp, conduzindo o "${ctx.formulario}". ` +
        "Fala português do Brasil, com tom cordial e respostas curtas (até 3 frases), sem markdown além de *negrito*.\n\n" +
        (ctx.conhecimento ? `O que você sabe:\n${ctx.conhecimento.trim()}\n\n` : "") +
        `Pergunta atual do cadastro: ${ctx.pergunta.slice(0, 700)}\n` +
        `O que ela pede: ${ctx.oQue}.\n` +
        (ctx.ajuda ? `Sobre este campo: ${ctx.ajuda}\n` : "") +
        "\nResponda SOMENTE com um JSON, sem texto fora dele:\n" +
        '- {"acao":"valor","valor":"..."} se a mensagem RESPONDE à pergunta (valor já limpo e no formato pedido; ex.: e-mail "joao ponto silva arroba gmail ponto com" vira "joao.silva@gmail.com"; data "dia 5 de maio de 92" vira "05/05/1992");\n' +
        '- {"acao":"duvida","resposta":"..."} se for dúvida, pedido de ajuda ou outra coisa (responda com o que está escrito acima; não repita a pergunta, ela é reenviada depois);\n' +
        '- {"acao":"suporte","resposta":"..."} se for assunto que só a equipe resolve (preço, contrato, pagamento, cancelamento, reclamação, problema técnico), com uma frase curta e cordial.\n' +
        "Nunca invente um valor que o cliente não disse. Não prometa nada que não está escrito acima.",
    },
    ...(ctx.historico ? [{ role: "user" as const, content: `Conversa recente:\n${ctx.historico}` }] : []),
    { role: "user", content: `Mensagem do cliente: ${mensagem.slice(0, 1000)}` },
  ];
  try {
    const r = parseJsonObject(await chat(messages, { maxTokens: 400 }));
    if (!r || !["valor", "duvida", "suporte"].includes(String(r.acao))) return null;
    return {
      acao: r.acao as LeituraIa["acao"],
      valor: typeof r.valor === "string" || typeof r.valor === "number" ? String(r.valor).trim() : undefined,
      resposta: typeof r.resposta === "string" && r.resposta.trim() ? r.resposta.trim().slice(0, 600) : undefined,
    };
  } catch (e) {
    console.error("[ia] leitura:", e);
    return null;
  }
}

/**
 * A resposta é o TIPO de informação pedido? Para texto livre (nome, cidade,
 * razão social), onde a validação por regra não basta: um CEP mandado como
 * cidade, o nome de um bar como rua. Devolve o que dizer ao cliente, ou null
 * se serve. Sem IA (ou se ela falhar), aceita: a IA não trava ninguém.
 */
export async function naoServe(chat: Chat, pergunta: string, oQue: string, mensagem: string): Promise<string | null> {
  let r: Record<string, unknown> | null = null;
  try {
    const out = await chat(
      [
        {
          role: "system",
          content:
            "Você confere respostas de clientes num cadastro feito pelo WhatsApp.\n" +
            `Pergunta feita ao cliente: ${pergunta.slice(0, 400)}\n` +
            `O que ela pede: ${oQue}.\n\n` +
            "Diga se a mensagem do cliente é uma resposta com o TIPO de informação pedido. Seja tolerante com erro de digitação, " +
            "abreviação, letras maiúsculas/minúsculas e nomes pouco comuns: recuse só quando for claramente outra coisa " +
            "(ex.: um CEP ou um número quando se pede uma cidade; nome de loja quando se pede o nome de uma pessoa; frase sem relação com a pergunta). " +
            'Responda SOMENTE com um JSON: {"serve":true} ou {"serve":false,"motivo":"..."}. O motivo é uma frase curta e cordial ' +
            'falando COM o cliente (você), começando com letra maiúscula e terminando com ponto. Ex.: "Isso parece um CEP, não o nome de uma cidade."',
        },
        { role: "user", content: `Mensagem do cliente: ${mensagem.slice(0, 300)}` },
      ],
      { maxTokens: 150, temperature: 0 }
    );
    r = parseJsonObject(out);
  } catch (e) {
    console.error("[ia] conferência:", e);
    return null;
  }
  if (!r || r.serve !== false) return null;
  let motivo = typeof r.motivo === "string" && r.motivo.trim() ? r.motivo.trim().slice(0, 300) : "Acho que essa resposta não é o que eu perguntei 🤔.";
  motivo = motivo.charAt(0).toUpperCase() + motivo.slice(1);
  if (!/[.!?…)]$/u.test(motivo) && !/\p{Extended_Pictographic}$/u.test(motivo)) motivo += ".";
  return motivo;
}
