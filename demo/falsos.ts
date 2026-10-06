import sharp from "sharp";
import type { Chat } from "../src/ia/assistente";
import type { Servicos } from "../src/motor/motor";
import { semAcento } from "../src/validadores/basicos";
import { formatoEmail, sugerirDominio } from "../src/validadores/email";

/**
 * Serviços FALSOS para o demo e os testes rodarem sem rede: um punhado de
 * CEPs, um "mapa" de duas ruas e uma foto gerada na hora. O motor é o mesmo
 * da produção; só o que fala com o mundo de fora foi trocado.
 */

const CEPS: Record<string, { street: string; neighborhood: string; city: string; state: string }> = {
  "01310100": { street: "Avenida Paulista", neighborhood: "Bela Vista", city: "São Paulo", state: "SP" },
  "20040020": { street: "Rua da Assembleia", neighborhood: "Centro", city: "Rio de Janeiro", state: "RJ" },
  "13010000": { street: "", neighborhood: "", city: "Campinas", state: "SP" },
};

export const servicosFalsos: Servicos = {
  async cep(cep) {
    return CEPS[cep] ?? "nao_existe";
  },
  async localizar(texto, _pais, cidade) {
    const t = semAcento(texto);
    const numero = texto.match(/\b\d{1,5}\b/)?.[0] ?? "";
    if (t.includes("flores")) {
      if (!cidade) return { status: "ambiguo", cidades: ["Campinas", "Sorocaba", "Curitiba"] };
      return { status: "ok", achado: { rua: "Rua das Flores", numero, complemento: "", bairro: "Centro", cidade, estado: cidade === "Curitiba" ? "PR" : "SP", cep: "" } };
    }
    if (t.includes("paulista")) return { status: "ok", achado: { rua: "Avenida Paulista", numero, complemento: "", bairro: "Bela Vista", cidade: "São Paulo", estado: "SP", cep: "01310100" } };
    return { status: "nada" };
  },
  async conferirEmail(email) {
    const erro = formatoEmail(email);
    if (erro) return { ok: false, motivo: erro };
    const [local, dominio] = email.split("@");
    const sug = sugerirDominio(dominio);
    return sug ? { ok: true, email, sugestao: `${local}@${sug}` } : { ok: true, email };
  },
  async baixarImagem() {
    return sharp({ create: { width: 640, height: 400, channels: 3, background: "#5C93F0" } }).png().toBuffer();
  },
};

/* ── IA simulada ─────────────────────────────────────────── */

const NUMEROS: Record<string, number> = { um: 1, dois: 2, tres: 3, quatro: 4, cinco: 5, dez: 10, quinze: 15, vinte: 20, trinta: 30, cinquenta: 50, cem: 100 };

const json = (o: unknown) => JSON.stringify(o);

/**
 * Uma "IA" determinística, só para o demo funcionar sem chave: lê o mesmo
 * prompt que o modelo de verdade recebe e responde no mesmo formato JSON.
 * Entende e-mail ditado, números por extenso, "o do meio" numa escolha e
 * responde dúvidas com a frase do conhecimento do formulário que mais se
 * parece com a pergunta. Com LLM_API_KEYS, o demo usa o modelo de verdade.
 */
export const iaSimulada: Chat = async (messages) => {
  const sistema = messages[0].content;
  const msg = messages[messages.length - 1].content.replace(/^Mensagem do cliente:\s*/, "");
  const m = semAcento(msg);

  if (sistema.startsWith("Você confere respostas")) {
    const pede = semAcento(sistema.match(/O que ela pede: (.*)\./)?.[1] ?? "");
    if (pede.includes("pessoa") && /\b(bar|loja|lanchonete|mercado|padaria|restaurante|oficina)\b/.test(m))
      return json({ serve: false, motivo: "Isso parece o nome de um estabelecimento, não o de uma pessoa." });
    return json({ serve: true });
  }

  const pede = semAcento(sistema.match(/O que ela pede: (.*)/)?.[1] ?? "");
  if (/\b(preco|valor|quanto custa|mensalidade|contrato|cancelar)\b/.test(m))
    return json({ acao: "suporte", resposta: "Sobre valores e contrato, quem responde é a nossa equipe 🙂." });

  if (pede.includes("e-mail") && /\barroba\b/.test(m)) {
    const email = m.replace(/^(e|o meu e|meu e-?mail e|e-?mail)\s+/, "").replace(/\s*arroba\s*/g, "@").replace(/\s*ponto\s*/g, ".").replace(/\s+/g, "");
    return json({ acao: "valor", valor: email });
  }
  if (pede.includes("data")) {
    const limpo = m.replace(/^(nasci (em|no dia)|dia|em)\s+/, "");
    if (/\d/.test(limpo)) return json({ acao: "valor", valor: limpo });
  }
  if (pede.includes("numero")) {
    const palavra = m.split(/\s+/).find((w) => NUMEROS[w] !== undefined);
    if (palavra) return json({ acao: "valor", valor: String(NUMEROS[palavra]) });
  }
  if (pede.includes("destas opcoes")) {
    const opcoes = [...(sistema.match(/valor = o id da opção\): (.*)/)?.[1] ?? "").matchAll(/(\w+) = ([^;(\n]+)/g)].map((x) => ({ id: x[1], rotulo: semAcento(x[2]).replace(/[.\s]+$/, "") }));
    if (/\bdo meio\b/.test(m) && opcoes.length >= 3) return json({ acao: "valor", valor: opcoes[Math.floor((opcoes.length - 1) / 2)].id });
    const achada = opcoes.find((o) => m.includes(o.rotulo));
    if (achada) return json({ acao: "valor", valor: achada.id });
  }

  if (msg.includes("?") || /^(onde|como|qual|quando|posso)\b/.test(m)) {
    const saber = sistema.match(/O que você sabe:\n([\s\S]*?)\n\nPergunta atual/)?.[1] ?? "";
    const ajuda = sistema.match(/Sobre este campo: (.*)/)?.[1] ?? "";
    const frases = `${ajuda}\n${saber}`.split(/(?<=[.!])\s+|\n/).map((f) => f.trim()).filter(Boolean);
    const palavras = m.split(/\W+/).filter((w) => w.length > 3);
    let melhor = "";
    let pontos = 0;
    for (const f of frases) {
      const n = palavras.filter((w) => semAcento(f).includes(w.replace(/s$/, ""))).length;
      if (n > pontos) [melhor, pontos] = [f, n];
    }
    if (melhor) return json({ acao: "duvida", resposta: melhor });
    return json({ acao: "suporte", resposta: "Essa a nossa equipe responde melhor 🙂." });
  }
  return json({ acao: "duvida", resposta: "Acho que essa resposta não é o que eu perguntei 🤔." });
};
