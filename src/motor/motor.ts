import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Armazenamento } from "../armazenamento/armazenamento";
import type { Canal } from "../canais/canal";
import { separarComplemento, separarEndereco, ufDe, type Localizacao } from "../endereco/endereco";
import type { CepAddress } from "../endereco/viacep";
import { lerMensagem, naoServe, type Chat, type Contexto } from "../ia/assistente";
import {
  NAO,
  PEDE_ATENDENTE,
  PULAR,
  SIM,
  conferirData,
  conferirDocumento,
  conferirNome,
  conferirNumero,
  conferirTelefone,
  pareceDuvida,
  semAcento,
  soCumprimento,
  type Conferido,
} from "../validadores/basicos";
import { normalizarEmail, type ConferenciaEmail } from "../validadores/email";
import {
  apagarValor,
  dadosValidos,
  gravarValor,
  lerValor,
  proximaPergunta,
  roteiro,
  type CampoGrupo,
  type Formulario,
  type Pergunta,
  type Registro,
} from "./formulario";
import { compactar, texto, textoDe, type Botao, type Capa, type ItemLista, type Saida } from "./saida";
import type { Sessao } from "./sessao";
import { enderecoEscrito, grupoEscrito, oQuePede, valorEscrito, type Endereco } from "./valores";

/**
 * O motor do cadastro: recebe uma mensagem, decide o que ela é e responde.
 *
 * O ROTEIRO É DO FORMULÁRIO, NÃO DA IA. A próxima pergunta é sempre a
 * primeira sem resposta (`proximaPergunta`); cada resposta passa pela
 * validação do tipo do campo antes de ser gravada, e resposta errada não
 * avança — o agente diz o que está errado e repete a pergunta.
 *
 * A IA só AJUDA: entende respostas soltas ("é joao ponto silva arroba
 * gmail"), tira dúvidas com o que o formulário ensina a ela e confere se um
 * texto livre é mesmo o que se perguntou. Todo valor que ela devolve passa
 * pela MESMA validação de uma resposta digitada.
 *
 * O que nem a validação nem a IA resolvem (pedido de atendente, assunto de
 * preço/contrato, áudio, foto fora de hora) vai para a equipe, e o cadastro
 * continua: a pergunta é repetida.
 */

export interface Recebida {
  /** Só dígitos, como o WhatsApp manda (ex. 5511988887777). */
  telefone: string;
  messageId: string;
  /** Texto digitado, ou o id do botão/opção tocado. */
  texto?: string;
  /** Rótulo do botão/opção tocado (para o histórico). */
  rotulo?: string;
  imagemUrl?: string;
}

/** Tudo o que fala com o mundo de fora: trocável no teste e no demo. */
export interface Servicos {
  cep(cep: string): Promise<CepAddress | "nao_existe" | null>;
  localizar(texto: string, pais: string, cidade?: string): Promise<Localizacao>;
  conferirEmail(email: string): Promise<ConferenciaEmail>;
  baixarImagem(url: string): Promise<Buffer>;
}

/** O cadastro concluído, como a sua aplicação recebe. */
export interface Entrega {
  protocolo: string;
  formulario: { id: string; nome: string };
  telefone: string;
  referencia?: string;
  dados: Registro;
  enviadoEm: string;
}

export interface Encaminhamento {
  formulario: string;
  telefone: string;
  referencia?: string;
  motivo: string;
  mensagem: string;
  ondeEsta: string;
}

export interface OpcoesMotor {
  formularios: Formulario[];
  /** Formulário de quem escreve sem ter sido convidado (com `aberto`). */
  padrao?: string;
  /** Quem escrever para o número começa um cadastro (inscrição, lead). Fechado: só quem a sua aplicação convidou. */
  aberto?: boolean;
  armazenamento: Armazenamento;
  canal: Canal;
  servicos: Servicos;
  /** LLM (qualquer API compatível com a da OpenAI). Sem ele, o cadastro funciona igual, menos tolerante. */
  chat?: Chat | null;
  /** WhatsApp da equipe: recebe as dúvidas encaminhadas e vira o botão "Falar c/ a equipe". */
  suporteWhatsApp?: string;
  /** Onde as fotos recebidas ficam. */
  pastaArquivos: string;
  entregar(e: Entrega): Promise<void>;
  aoEncaminhar?(e: Encaminhamento): void;
  /** Cada mensagem aceita pelo canal (o vigia confere a entrega das que importam). */
  aoEnviar?(info: { messageId: string; destino: string; texto: string; tipo: "cliente" | "suporte" }): void;
  agora?: () => Date;
}

interface Ctx {
  s: Sessao;
  f: Formulario;
  /** Mensagens ao cliente, em ordem (cada uma vira um balão). */
  out: Saida[];
  /** Mensagens ao WhatsApp da equipe (saem depois das do cliente). */
  equipe: string[];
  /** A próxima pergunta abre um passo: vai com a capa. */
  capa: boolean;
  /** É a primeira mensagem da conversa (o vigia confere a entrega). */
  primeira?: boolean;
}

const MAX_HISTORICO = 12;
const REPETIDA_MS = 30 * 60 * 1000;
const POR_PAGINA = 9;

/** No Brasil, o WhatsApp às vezes identifica celulares sem o 9 depois do DDD. Procura as duas formas. */
export function variantes(telefone: string): string[] {
  const d = telefone.replace(/\D/g, "");
  const out = new Set([d]);
  if (d.startsWith("55") && d.length === 13 && d[4] === "9") out.add(d.slice(0, 4) + d.slice(5));
  if (d.startsWith("55") && d.length === 12) out.add(d.slice(0, 4) + "9" + d.slice(4));
  return [...out];
}

function cepSozinho(t: string): string {
  const s = t.replace(/\bcep\b[:\s]*/gi, "").trim();
  return /^\d{5}[-.\s]?\d{3}$/.test(s) ? s.replace(/\D/g, "") : "";
}

const formatarCep = (cep: string) => `${cep.slice(0, 5)}-${cep.slice(5)}`;
const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export class Motor {
  private filas = new Map<string, Promise<void>>();
  private readonly suporte: string;

  constructor(private o: OpcoesMotor) {
    if (!o.formularios.length) throw new Error("nenhum formulário");
    this.suporte = (o.suporteWhatsApp ?? "").replace(/\D/g, "");
  }

  formulario(id?: string): Formulario | undefined {
    return id ? this.o.formularios.find((f) => f.id === id) : this.o.formularios[0];
  }

  private agora(): Date {
    return this.o.agora?.() ?? new Date();
  }

  /* ── Entrada ─────────────────────────────────────────── */

  /**
   * Uma conversa por vez por telefone: duas mensagens seguidas não podem
   * gravar em paralelo (a segunda leria o estado antigo).
   */
  private enfileirar<T>(telefone: string, fn: () => Promise<T>): Promise<T> {
    const chave = variantes(telefone).sort()[0];
    const anterior = this.filas.get(chave) ?? Promise.resolve();
    const atual = anterior.then(fn);
    const fim = atual.then(
      () => undefined,
      () => undefined
    );
    this.filas.set(chave, fim);
    void fim.finally(() => {
      if (this.filas.get(chave) === fim) this.filas.delete(chave);
    });
    return atual;
  }

  /** Mensagem recebida pelo webhook. Nunca lança: erro vira log. */
  receber(msg: Recebida): Promise<void> {
    return this.enfileirar(msg.telefone, () => this.processar(msg)).catch((e) => console.error("[motor] conversa:", e));
  }

  /** A sua aplicação convida alguém para o cadastro (rota /api/iniciar). */
  iniciar(p: { telefone: string; formulario?: string; dados?: Registro; referencia?: string }): Promise<Sessao> {
    const f = this.formulario(p.formulario ?? this.o.padrao);
    if (!f) throw new Error(`formulário "${p.formulario}" não existe`);
    return this.enfileirar(p.telefone, async () => {
      const s = this.novaSessao(p.telefone, f);
      s.referencia = p.referencia;
      // Dados que a aplicação já tem (nome, e-mail...): só os campos de topo do formulário.
      const ids = new Set(f.passos.flatMap((x) => x.campos.map((c) => c.id)));
      for (const [k, v] of Object.entries(p.dados ?? {})) if (ids.has(k) && v !== undefined && v !== "") s.dados[k] = v;
      const ctx = this.ctx(s, f);
      ctx.primeira = true;
      this.boasVindas(ctx);
      await this.concluir(ctx, null);
      return s;
    });
  }

  /** Aviso solto da sua aplicação ao cliente (ex.: "cadastro aprovado"). */
  async avisar(p: { telefone?: string; referencia?: string; mensagem: string }): Promise<boolean> {
    const s = p.referencia
      ? await this.o.armazenamento.porReferencia(p.referencia)
      : p.telefone
        ? await this.o.armazenamento.porTelefone(variantes(p.telefone))
        : null;
    const destino = s?.telefone ?? p.telefone?.replace(/\D/g, "");
    if (!destino) return false;
    const id = await this.o.canal.enviar(destino, texto(p.mensagem));
    if (s) {
      s.historico = [...s.historico, { de: "agente" as const, texto: p.mensagem }].slice(-MAX_HISTORICO);
      await this.o.armazenamento.salvar(s);
    }
    return Boolean(id);
  }

  private novaSessao(telefone: string, f: Formulario): Sessao {
    const agora = this.agora().toISOString();
    return {
      id: randomUUID(),
      telefone: telefone.replace(/\D/g, ""),
      formulario: f.id,
      dados: {},
      fase: "inicio",
      historico: [],
      suporte: [],
      criadaEm: agora,
      atualizadaEm: agora,
    };
  }

  private ctx(s: Sessao, f: Formulario): Ctx {
    return { s, f, out: [], equipe: [], capa: false };
  }

  private async processar(msg: Recebida): Promise<void> {
    const tels = variantes(msg.telefone);
    // A própria equipe escrevendo para o número do cadastro: não é cliente.
    if (this.suporte && tels.includes(this.suporte)) return;

    const txt = (msg.texto ?? "").trim();
    let s = await this.o.armazenamento.porTelefone(tels);
    if (s && s.ultimaMensagemId === msg.messageId) return; // a Z-API reentrega webhooks

    const novo = !s || (s.fase === "enviado" && (txt === "__novo" || /^novo cadastro[.!\s]*$/i.test(txt)));
    if (novo) {
      const f = this.formulario(this.o.padrao);
      if (!this.o.aberto || !f) {
        const qualquer = this.formulario()!;
        await this.o.canal.enviar(
          msg.telefone,
          this.comEquipe(
            `Olá! 👋 Aqui é o assistente virtual · *${qualquer.organizacao}*. Não encontrei um cadastro ligado a este número. ` +
              "Se você recebeu um convite, use o mesmo número do convite."
          )
        );
        return;
      }
      s = this.novaSessao(msg.telefone, f);
    }
    const f = this.formulario(s!.formulario);
    if (!f) {
      console.error(`[motor] sessão ${s!.id}: formulário "${s!.formulario}" não existe mais`);
      await this.o.canal.enviar(msg.telefone, this.comEquipe("Este cadastro não está mais disponível. Fale com a nossa equipe, por favor."));
      return;
    }

    const ctx = this.ctx(s!, f);
    const antes = s!.fase === "coletando" ? proximaPergunta(f, s!.dados) : null;
    try {
      if (s!.fase === "inicio") {
        ctx.primeira = true;
        this.boasVindas(ctx);
      } else if (s!.fase === "coletando") await this.responderPergunta(ctx, msg);
      else if (s!.fase === "revisao") await this.responderRevisao(ctx, msg);
      else if (s!.fase === "corrigir") await this.responderCorrecao(ctx, msg);
      else await this.posEnvio(ctx, msg);
    } catch (e) {
      console.error("[motor] fase", s!.fase, e);
      ctx.out.push(texto("Tive um problema aqui do meu lado 😕. Pode mandar de novo, por favor?"));
    }
    await this.concluir(ctx, msg, Boolean(antes?.campo.sensivel));
  }

  /** Grava a sessão e manda as mensagens. */
  private async concluir(ctx: Ctx, msg: Recebida | null, sensivel = false): Promise<void> {
    const { s } = ctx;
    compactar(ctx.out);
    if (msg) {
      s.ultimaMensagemId = msg.messageId;
      const dito = sensivel ? "[informação sensível]" : (msg.rotulo ?? msg.texto ?? "") || (msg.imagemUrl ? "[imagem]" : "[mensagem sem texto]");
      s.historico.push({ de: "cliente", texto: dito.slice(0, 500) });
    }
    for (const o of ctx.out) s.historico.push({ de: "agente", texto: textoDe(o).slice(0, 500) });
    s.historico = s.historico.slice(-MAX_HISTORICO);
    // Respostas numeradas ("2") valem como toque na opção da última pergunta interativa.
    const ultima = [...ctx.out].reverse().find((o) => o.tipo === "botoes" || o.tipo === "lista");
    if (ctx.out.length) s.opcoes = ultima ? (ultima.tipo === "botoes" ? ultima.botoes.map((b) => b.id) : ultima.itens.map((i) => i.id)) : undefined;
    s.atualizadaEm = this.agora().toISOString();
    await this.o.armazenamento.salvar(s);

    for (const [i, o] of ctx.out.entries()) {
      try {
        const id = await this.o.canal.enviar(s.telefone, o);
        if (id && ctx.primeira && i === 0) this.o.aoEnviar?.({ messageId: id, destino: s.telefone, texto: textoDe(o), tipo: "cliente" });
      } catch (e) {
        console.error("[motor] envio ao cliente:", e);
      }
    }
    for (const t of ctx.equipe) {
      try {
        const id = await this.o.canal.enviar(this.suporte, texto(t));
        if (id) this.o.aoEnviar?.({ messageId: id, destino: this.suporte, texto: t, tipo: "suporte" });
      } catch (e) {
        console.error("[motor] envio à equipe:", e);
      }
    }
  }

  /* ── Perguntas ───────────────────────────────────────── */

  private boasVindas(ctx: Ctx) {
    const { f, s } = ctx;
    const nome = typeof s.dados.nome === "string" ? `, ${s.dados.nome.split(" ")[0]}` : "";
    ctx.out.push(
      texto(
        f.saudacao ??
          `Olá${nome}! 👋 Aqui é o assistente virtual · *${f.organizacao}*.\n\n` +
            `*${f.nome}* por aqui mesmo, em ${f.passos.length} passos rápidos: ${f.passos.map((p) => p.titulo).join(" → ")}.\n\n` +
            "Dúvida no caminho? É só perguntar. Errou uma resposta? Mande *voltar*."
      )
    );
    s.fase = "coletando";
    ctx.capa = true;
    this.perguntar(ctx);
  }

  private capaDe(f: Formulario, titulo: string, subtitulo: string, atual: number): Capa {
    return { marca: f.organizacao, titulo, subtitulo, passos: f.passos.map((p) => p.titulo), atual };
  }

  /** Manda a pergunta da vez (ou a revisão, se não falta nada). */
  private perguntar(ctx: Ctx) {
    const q = proximaPergunta(ctx.f, ctx.s.dados);
    if (!q) return this.mostrarRevisao(ctx);
    ctx.out.push(...this.render(ctx, q, ctx.capa));
    ctx.capa = false;
  }

  private repetirCom(ctx: Ctx, aviso: string) {
    ctx.out.push(texto(aviso));
    this.perguntar(ctx);
  }

  /** A pergunta como mensagem(ns). Não muda a sessão. */
  private render(ctx: Ctx, q: Pergunta, comCapa: boolean): Saida[] {
    const { f, s } = ctx;
    const passo = f.passos[q.passo];
    const rodape = `Passo ${q.passo + 1} de ${f.passos.length} · ${passo.titulo}`;
    const capa = comCapa ? this.capaDe(f, passo.titulo, f.nome, q.passo + 1) : undefined;
    const c = q.campo;
    const prefixo = q.grupo ? `*${maiuscula(q.grupo.campo.item)} ${q.grupo.indice + 1} de ${(s.dados[q.grupo.campo.id] as unknown[]).length}*\n` : "";
    const pular: Botao[] = c.opcional ? [{ id: "__pular", rotulo: "Pular" }] : [];

    const botoes = (t: string, b: Botao[]): Saida[] => [{ tipo: "botoes", texto: t, botoes: b, rodape, ...(capa ? { capa } : {}) }];
    const lista = (t: string, itens: ItemLista[]): Saida[] => [
      ...(capa ? [texto(`*${passo.titulo}*`, capa)] : []),
      { tipo: "lista", texto: t, titulo: c.rotulo, botao: "Escolher", itens, rodape },
    ];
    const simples = (t: string): Saida[] => (pular.length ? botoes(t, pular) : [texto(t, capa)]);

    if (s.sub && s.sub.chave === q.chave) return this.renderSub(ctx, q, rodape);

    if (q.quantidade) {
      const g = c as CampoGrupo;
      const nums = Array.from({ length: g.max - (g.min ?? 0) + 1 }, (_, i) => (g.min ?? 0) + i);
      const rot = (n: number) => (n === 0 ? "Nenhum" : String(n));
      if (nums.length <= 3) return botoes(prefixo + c.pergunta, nums.map((n) => ({ id: `__n${n}`, rotulo: rot(n) })));
      if (nums.length <= 10) return lista(prefixo + c.pergunta, nums.map((n) => ({ id: `__n${n}`, titulo: rot(n) })));
      return [texto(`${c.pergunta}\n_(mande um número de ${nums[0]} a ${nums[nums.length - 1]})_`, capa)];
    }

    const t = prefixo + c.pergunta;
    switch (c.tipo) {
      case "escolha": {
        const opcoes: { id: string; rotulo: string; descricao?: string }[] = [
          ...c.opcoes,
          ...(c.outra ? [{ id: "__outra", rotulo: `✏️ ${c.outra}` }] : []),
          ...pular,
        ];
        if (opcoes.length <= 3) return botoes(t, opcoes.map((o) => ({ id: o.id, rotulo: o.rotulo })));
        const todos: ItemLista[] = opcoes.map((o) => ({ id: o.id, titulo: o.rotulo, descricao: o.descricao }));
        if (todos.length <= 10) return lista(t, todos);
        const paginas = Math.ceil(todos.length / POR_PAGINA);
        const p = (s.pagina ?? 0) % paginas;
        return lista(t, [...todos.slice(p * POR_PAGINA, (p + 1) * POR_PAGINA), { id: "__mais", titulo: "Ver mais opções ▸", descricao: `Página ${p + 1} de ${paginas}` }]);
      }
      case "sim_nao":
        return botoes(t, [{ id: "__sim", rotulo: "Sim" }, { id: "__nao", rotulo: "Não" }, ...pular]);
      case "telefone":
        return botoes(t, [{ id: "__este", rotulo: "📱 Este número" }, ...pular]);
      case "endereco":
        return botoes(t, [{ id: "__sem_cep", rotulo: "Não sei o CEP" }, ...pular]);
      default:
        return simples(t);
    }
  }

  /** As sub-perguntas de um campo de várias mensagens. */
  private renderSub(ctx: Ctx, q: Pergunta, rodape: string): Saida[] {
    const sub = ctx.s.sub!;
    const e = sub.parcial as Endereco | undefined;
    const botoes = (t: string, b: Botao[]): Saida[] => [{ tipo: "botoes", texto: t, botoes: b, rodape }];
    switch (sub.etapa) {
      case "email_sugestao":
        return botoes(`Você quis dizer *${sub.sugestao}*?`, [
          { id: "__usar_sug", rotulo: "✅ Sim, corrigir" },
          { id: "__manter", rotulo: "Não, está certo" },
        ]);
      case "outra":
        return [texto("Escreva qual é, por favor ✏️.")];
      case "outra_confirma":
        return botoes(`*${sub.digitado}* não está entre as opções.`, [
          { id: "__usar", rotulo: "✅ Usar o que escrevi" },
          { id: "__ver", rotulo: "📋 Ver as opções" },
        ]);
      case "end_numero":
        return botoes(
          `${e?.rua ? `Encontrei: *${e.rua}*${e.bairro ? ` – ${e.bairro}` : ""}, ${e.cidade}/${e.uf} 📍\n\n` : ""}Qual é o *número*? Se tiver complemento, mande junto (ex.: _120 apto 32_).`,
          [{ id: "__sn", rotulo: "Sem número" }]
        );
      case "end_rua":
        return [texto("Mande a *rua e o número* (ex.: _Rua das Flores, 120_). Se souber, o bairro e a cidade também.")];
      case "end_cidade_escolha":
        return [
          {
            tipo: "lista",
            texto: "Essa rua existe em mais de uma cidade. Em qual delas fica?",
            titulo: "Cidade",
            botao: "Escolher",
            itens: (sub.cidades as string[]).map((c, i) => ({ id: `__cid${i}`, titulo: c.slice(0, 24) })),
            rodape,
          },
        ];
      case "end_cidade":
        return [texto("Não achei essa rua no mapa 🤔. Em qual *cidade* ela fica?")];
      case "end_uf":
        return [texto("E o *estado* (UF)? (ex.: _SP_)")];
      case "end_confirma":
        return botoes(`Confira o endereço:\n\n${enderecoEscrito(e!)}`, [
          { id: "__ok", rotulo: "✅ Está certo" },
          { id: "__corrigir", rotulo: "✏️ Corrigir" },
        ]);
      default:
        ctx.s.sub = undefined;
        return this.render(ctx, q, false);
    }
  }

  /** "2" digitado = a 2ª opção da última pergunta interativa (quando a pergunta é de opções). */
  private mapearNumero(ctx: Ctx, q: Pergunta | null, t: string): string {
    const m = t.match(/^(\d{1,2})[.)]?$/);
    if (!m || !ctx.s.opcoes) return t;
    const sub = ctx.s.sub?.etapa;
    const deOpcoes =
      ctx.s.fase === "revisao" ||
      ctx.s.fase === "corrigir" ||
      ctx.s.fase === "enviado" ||
      (sub ? ["email_sugestao", "outra_confirma", "end_confirma", "end_cidade_escolha"].includes(sub) : q && !q.quantidade && ["escolha", "sim_nao"].includes(q.campo.tipo));
    return deOpcoes ? (ctx.s.opcoes[Number(m[1]) - 1] ?? t) : t;
  }

  /* ── Respostas ───────────────────────────────────────── */

  private async responderPergunta(ctx: Ctx, msg: Recebida): Promise<void> {
    const { s, f } = ctx;
    const q = proximaPergunta(f, s.dados);
    if (!q) return this.mostrarRevisao(ctx);
    const c = q.campo;
    const t = this.mapearNumero(ctx, q, (msg.texto ?? "").trim());

    if (msg.imagemUrl && c.tipo !== "imagem") {
      ctx.out.push(texto("Recebi a imagem 👍, mas agora preciso de outra informação."));
      this.encaminhar(ctx, "[imagem]", "o cliente mandou uma imagem fora da pergunta de foto");
      return this.perguntar(ctx);
    }
    if (!t && !msg.imagemUrl) {
      ctx.out.push(texto("Por aqui eu só consigo ler texto e fotos 🙂."));
      this.encaminhar(ctx, "[áudio, figurinha ou outro tipo de mensagem]", "mensagem que o assistente não lê");
      return this.perguntar(ctx);
    }
    if (!c.sensivel) {
      if (soCumprimento(t)) {
        ctx.out.push(texto("Oi! 👋"));
        return this.perguntar(ctx);
      }
      if (PEDE_ATENDENTE.test(t)) {
        this.encaminhar(ctx, t, "o cliente pediu para falar com a equipe");
        return this.perguntar(ctx);
      }
    }
    if (/^(voltar|volta|anterior)[.!\s]*$/i.test(t)) return this.voltar(ctx, q);
    if (t === "__pular" || (c.opcional && PULAR.test(t) && c.tipo !== "sim_nao" && c.tipo !== "endereco")) {
      if (!c.opcional) return this.repetirCom(ctx, "Essa informação é obrigatória 🙂.");
      return this.aceitar(ctx, q, null, t, false);
    }
    if (s.sub?.chave === q.chave) return this.responderSub(ctx, q, t, msg);
    if (c.tipo === "endereco") return this.enderecoInicio(ctx, q, t, msg, true);

    const direta = pareceDuvida(t) && !c.sensivel ? null : await this.interpretar(ctx, q, t, msg);
    if (direta === "pendente") return;
    if (direta && "valor" in direta) return this.aceitar(ctx, q, direta.valor, t, true);
    if (c.sensivel || (c.tipo === "imagem" && msg.imagemUrl)) return this.repetirCom(ctx, direta?.erro ?? "Não entendi 😅.");
    return this.comIa(ctx, q, t, msg, direta?.erro);
  }

  /**
   * A leitura direta não serviu (ou a mensagem parece dúvida): a IA lê. O
   * valor que ela devolve passa pela mesma validação de uma resposta digitada.
   */
  private async comIa(ctx: Ctx, q: Pergunta, t: string, msg: Recebida, erroDireto?: string): Promise<void> {
    const c = q.campo;
    const ia = this.o.chat ? await lerMensagem(this.o.chat, this.contextoIa(ctx, q), t) : null;
    if (ia?.acao === "valor" && ia.valor) {
      if (c.tipo === "endereco") return this.enderecoInicio(ctx, q, ia.valor, msg, false);
      const r = await this.interpretar(ctx, q, ia.valor, { ...msg, texto: ia.valor });
      if (r === "pendente") return;
      if (r && "valor" in r) return this.aceitar(ctx, q, r.valor, t, false);
      if (c.tipo === "escolha" && c.outra) return this.oferecerDigitado(ctx, q, ia.valor);
      return this.repetirCom(ctx, r?.erro ?? erroDireto ?? "Não entendi 😅.");
    }
    if (ia?.acao === "suporte") {
      if (ia.resposta) ctx.out.push(texto(ia.resposta));
      this.encaminhar(ctx, t, "assunto para a equipe", ia.resposta);
      return this.perguntar(ctx);
    }
    // Escolha com "Outra": o que não bateu com nenhuma opção pode ser a outra.
    if (c.tipo === "escolha" && c.outra && !pareceDuvida(t) && t.length <= 60) return this.oferecerDigitado(ctx, q, t);
    if (ia?.acao === "duvida" && ia.resposta) {
      // Dúvida: a IA responde. Resposta errada: vale o erro da validação, que é exato
      // ("os dígitos do CPF não batem"); sem ele, a explicação da IA. A pergunta se repete.
      return this.repetirCom(ctx, erroDireto && !pareceDuvida(t) ? erroDireto : ia.resposta);
    }
    if (pareceDuvida(t)) {
      this.encaminhar(ctx, t, "dúvida que o assistente não soube responder");
      return this.perguntar(ctx);
    }
    this.repetirCom(ctx, erroDireto ?? "Não entendi 😅.");
  }

  private oferecerDigitado(ctx: Ctx, q: Pergunta, digitado: string) {
    ctx.s.sub = { chave: q.chave, etapa: "outra_confirma", digitado: digitado.slice(0, 80) };
    this.perguntar(ctx);
  }

  private contextoIa(ctx: Ctx, q: Pergunta): Contexto {
    // O histórico já chega sem nada sensível (ver `concluir`).
    return {
      organizacao: ctx.f.organizacao,
      formulario: ctx.f.nome,
      conhecimento: ctx.f.conhecimento,
      pergunta: this.render(ctx, q, false).map(textoDe).join("\n"),
      oQue: oQuePede(q.campo),
      ajuda: q.campo.ajuda,
      historico: ctx.s.historico
        .slice(-6)
        .map((h) => `${h.de === "cliente" ? "Cliente" : "Assistente"}: ${h.texto.slice(0, 300)}`)
        .join("\n"),
    };
  }

  /**
   * Leitura direta da resposta pelo tipo do campo: o valor, o erro (falando
   * com o cliente), "pendente" (abriu uma sub-pergunta) ou null (não sei ler).
   */
  private async interpretar(ctx: Ctx, q: Pergunta, t: string, msg: Recebida): Promise<{ valor: unknown } | { erro: string } | "pendente" | null> {
    const { s } = ctx;
    const c = q.campo;
    const de = <T>(r: Conferido<T>) => (r.ok ? { valor: r.valor } : { erro: r.erro });

    if (q.quantidade) {
      const g = c as CampoGrupo;
      const min = g.min ?? 0;
      if (min === 0 && NAO.test(t)) return { valor: 0 };
      const r = conferirNumero(t.replace(/^__n/, ""), { min, max: g.max, inteiro: true });
      return r.ok ? { valor: r.valor } : { erro: `Mande um número de ${min} a ${g.max}, por favor.` };
    }
    switch (c.tipo) {
      case "texto": {
        const v = t.replace(/\s+/g, " ").trim();
        if (v.length < (c.min ?? 1)) return { erro: `Mande um pouco mais de detalhe, por favor (mínimo de ${c.min ?? 1} caracteres).` };
        if (v.length > (c.max ?? 500)) return { erro: `Ficou longo demais: o máximo é ${c.max ?? 500} caracteres.` };
        return { valor: v };
      }
      case "nome":
        return de(conferirNome(t));
      case "email": {
        const r = await this.o.servicos.conferirEmail(normalizarEmail(t));
        if (!r.ok) return { erro: r.motivo };
        if (r.sugestao) {
          s.sub = { chave: q.chave, etapa: "email_sugestao", email: r.email, sugestao: r.sugestao };
          this.perguntar(ctx);
          return "pendente";
        }
        return { valor: r.email };
      }
      case "telefone": {
        if (t === "__este") {
          const r = conferirTelefone(s.telefone);
          return { valor: r.ok ? r.valor : s.telefone };
        }
        return de(conferirTelefone(t));
      }
      case "cpf":
      case "cnpj":
      case "cpf_cnpj":
        return de(conferirDocumento(t, c.tipo));
      case "data":
        return de(conferirData(t, { idadeMinima: c.idadeMinima, futura: c.futura }, this.agora()));
      case "numero":
        return de(conferirNumero(t, c));
      case "sim_nao":
        if (t === "__sim" || SIM.test(t)) return { valor: true };
        if (t === "__nao" || NAO.test(t)) return { valor: false };
        return null;
      case "escolha": {
        if (t === "__mais") {
          s.pagina = (s.pagina ?? 0) + 1;
          this.perguntar(ctx);
          return "pendente";
        }
        if (t === "__outra" && c.outra) {
          s.sub = { chave: q.chave, etapa: "outra" };
          this.perguntar(ctx);
          return "pendente";
        }
        const porId = c.opcoes.find((o) => o.id === t);
        if (porId) return { valor: porId.id };
        const n = semAcento(t);
        if (n.length < 2) return null;
        const exata = c.opcoes.find((o) => semAcento(o.rotulo).replace(/[^\p{L}\d ]/gu, "").trim() === n || semAcento(o.id) === n);
        if (exata) return { valor: exata.id };
        const parecidas = c.opcoes.filter((o) => semAcento(o.rotulo).includes(n));
        return parecidas.length === 1 ? { valor: parecidas[0].id } : null;
      }
      case "imagem": {
        if (!msg.imagemUrl) return null;
        try {
          const original = await this.o.servicos.baixarImagem(msg.imagemUrl);
          const jpeg = await sharp(original).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
          const rel = path.join(s.id, `${q.chave.replace(/[^\w.-]/g, "_")}.jpg`);
          await fs.mkdir(path.join(this.o.pastaArquivos, s.id), { recursive: true });
          await fs.writeFile(path.join(this.o.pastaArquivos, rel), jpeg, { mode: 0o600 });
          return { valor: { arquivo: rel, tipo: "image/jpeg", bytes: jpeg.length } };
        } catch (e) {
          console.error("[motor] imagem:", e);
          return { erro: "Não consegui abrir essa imagem 😕. Pode mandar de novo?" };
        }
      }
      default:
        return null;
    }
  }

  /** Valor aceito pela leitura: conferências finais, grava e segue. */
  private async aceitar(ctx: Ctx, q: Pergunta, valor: unknown, original: string, direto: boolean, outra?: string): Promise<void> {
    const { s } = ctx;
    const c = q.campo;
    // Texto livre: a IA confere se é o TIPO de informação pedido ("bar do zé" como nome de pessoa).
    if (valor !== null && direto && this.o.chat && !c.sensivel && (c.tipo === "nome" || (c.tipo === "texto" && c.conferirComIa !== false))) {
      const chave = `${q.chave}\n${semAcento(original)}`;
      if (s.recusada === chave) s.recusada = undefined; // mandou de novo, igual: vale
      else {
        const motivo = await naoServe(this.o.chat, c.pergunta, oQuePede(c), original);
        if (motivo) {
          s.recusada = chave;
          return this.repetirCom(ctx, `${motivo} Se estiver certo assim, é só mandar de novo.`);
        }
      }
    }
    if (valor !== null && c.valida) {
      const erro = await c.valida(valor, s.dados);
      if (erro) return this.repetirCom(ctx, erro);
    }
    gravarValor(s.dados, q.chave, valor);
    if (outra !== undefined) gravarValor(s.dados, `${q.chave}_outra`, outra);
    s.sub = undefined;
    s.pagina = undefined;
    s.recusada = undefined;
    const prox = proximaPergunta(ctx.f, s.dados);
    if (prox && prox.passo !== q.passo) ctx.capa = true;
    this.perguntar(ctx);
  }

  private voltar(ctx: Ctx, q: Pergunta) {
    const { s, f } = ctx;
    const qs = roteiro(f, s.dados);
    const i = qs.findIndex((x) => x.chave === q.chave);
    const anterior = qs
      .slice(0, i)
      .reverse()
      .find((x) => lerValor(s.dados, x.chave) !== undefined);
    s.sub = undefined;
    if (!anterior) return this.repetirCom(ctx, "Essa é a primeira pergunta 🙂.");
    apagarValor(s.dados, anterior.chave);
    this.repetirCom(ctx, "Certo, voltando uma pergunta ↩️.");
  }

  private async responderSub(ctx: Ctx, q: Pergunta, t: string, msg: Recebida): Promise<void> {
    const { s } = ctx;
    const sub = s.sub!;
    if (pareceDuvida(t) && !q.campo.sensivel && !t.startsWith("__")) {
      const ia = this.o.chat ? await lerMensagem(this.o.chat, this.contextoIa(ctx, q), t) : null;
      if (ia?.resposta) ctx.out.push(texto(ia.resposta));
      else this.encaminhar(ctx, t, "dúvida que o assistente não soube responder");
      return this.perguntar(ctx);
    }
    switch (sub.etapa) {
      case "email_sugestao":
        if (t === "__usar_sug" || SIM.test(t)) return this.aceitar(ctx, q, sub.sugestao, t, false);
        if (t === "__manter" || NAO.test(t)) return this.aceitar(ctx, q, sub.email, t, false);
        s.sub = undefined;
        return this.responderPergunta(ctx, msg);
      case "outra":
        if (t.length > 80) return this.repetirCom(ctx, "Ficou longo demais 🙂. Escreva só o nome, por favor.");
        return this.aceitar(ctx, q, "outra", t, false, t);
      case "outra_confirma":
        if (t === "__usar") return this.aceitar(ctx, q, "outra", t, false, String(sub.digitado));
        s.sub = undefined;
        if (t === "__ver") return this.perguntar(ctx);
        return this.responderPergunta(ctx, msg);
      default:
        return this.responderEndereco(ctx, q, t, msg);
    }
  }

  /* ── Endereço: CEP → número, ou rua → mapa → cidade ──── */

  private async enderecoInicio(ctx: Ctx, q: Pergunta, t: string, msg: Recebida, podeIa: boolean): Promise<void> {
    const { s } = ctx;
    if (t === "__sem_cep" || /^(n[aã]o sei( o cep)?|sem cep|n[aã]o tenho( cep)?)[.!\s]*$/i.test(t)) {
      s.sub = { chave: q.chave, etapa: "end_rua" };
      return this.perguntar(ctx);
    }
    const cep = cepSozinho(t);
    if (cep) return this.usarCep(ctx, q, cep);
    if (/\p{L}{3,}/u.test(t) && /\d/.test(t) && !pareceDuvida(t)) return this.localizarEndereco(ctx, q, t);
    if (podeIa && /\p{L}/u.test(t)) return this.comIa(ctx, q, t, msg, "Mande o *CEP* (ex.: _01310-100_) ou a rua e o número.");
    this.repetirCom(ctx, "O CEP tem *8 números* (ex.: _01310-100_). Se não souber, toque em *Não sei o CEP*.");
  }

  private async usarCep(ctx: Ctx, q: Pergunta, cep: string): Promise<void> {
    const { s } = ctx;
    const r = await this.o.servicos.cep(cep);
    if (r === "nao_existe")
      return this.repetirCom(ctx, `Não encontrei o CEP *${formatarCep(cep)}* nos Correios 🤔. Confira e mande de novo, ou toque em *Não sei o CEP*.`);
    if (r === null) {
      s.sub = { chave: q.chave, etapa: "end_rua" };
      return this.repetirCom(ctx, "Não consegui consultar o CEP agora 😕.");
    }
    const parcial: Endereco = { cep, rua: r.street, numero: "", complemento: "", bairro: r.neighborhood, cidade: r.city, uf: r.state };
    if (!r.street) {
      s.sub = { chave: q.chave, etapa: "end_rua", parcial };
      return this.repetirCom(ctx, `Esse CEP é de *${r.city}/${r.state}* inteira (não tem rua própria).`);
    }
    s.sub = { chave: q.chave, etapa: "end_numero", parcial };
    this.perguntar(ctx);
  }

  private async localizarEndereco(ctx: Ctx, q: Pergunta, t: string, cidade?: string): Promise<void> {
    const { s } = ctx;
    const parcial = s.sub?.parcial as Endereco | undefined;
    const r = await this.o.servicos.localizar(t, "BR", cidade ?? parcial?.cidade);
    if (r.status === "ok") {
      const a = r.achado;
      return this.enderecoAchado(ctx, q, {
        cep: a.cep || parcial?.cep || "",
        rua: a.rua,
        numero: a.numero,
        complemento: a.complemento,
        bairro: a.bairro || parcial?.bairro || "",
        cidade: a.cidade || parcial?.cidade || "",
        uf: a.estado || parcial?.uf || "",
      });
    }
    if (r.status === "ambiguo") {
      s.sub = { chave: q.chave, etapa: "end_cidade_escolha", texto: t, cidades: r.cidades };
      return this.perguntar(ctx);
    }
    const sep = separarEndereco(t);
    // O mapa não conhece a rua, mas a cidade já se sabe (CEP de cidade, ou o cliente disse): vale o que ele escreveu.
    const cidadeSabida = cidade ?? parcial?.cidade;
    if (cidadeSabida) {
      const e: Endereco = { cep: sep.cep || parcial?.cep || "", rua: sep.rua, numero: sep.numero, complemento: sep.complemento, bairro: parcial?.bairro ?? "", cidade: maiuscula(cidadeSabida), uf: parcial?.uf ?? "" };
      if (!e.uf) {
        s.sub = { chave: q.chave, etapa: "end_uf", parcial: e };
        return this.perguntar(ctx);
      }
      return this.enderecoAchado(ctx, q, e);
    }
    s.sub = { chave: q.chave, etapa: "end_cidade", texto: t };
    this.perguntar(ctx);
  }

  private enderecoAchado(ctx: Ctx, q: Pergunta, e: Endereco) {
    ctx.s.sub = { chave: q.chave, etapa: e.numero ? "end_confirma" : "end_numero", parcial: e };
    this.perguntar(ctx);
  }

  private async responderEndereco(ctx: Ctx, q: Pergunta, t: string, msg: Recebida): Promise<void> {
    const { s } = ctx;
    const sub = s.sub!;
    const e = sub.parcial as Endereco;
    switch (sub.etapa) {
      case "end_numero": {
        if (t === "__sn") return this.enderecoAchado(ctx, q, { ...e, numero: "s/n" });
        const cep = cepSozinho(t);
        if (cep) return this.usarCep(ctx, q, cep);
        const { resto, complemento } = separarComplemento(t);
        const numero = resto.match(/\b\d{1,6}[a-z]?\b/i)?.[0] ?? (/\bs\/?n\b|sem n[uú]mero/i.test(resto) ? "s/n" : "");
        if (!numero) return this.repetirCom(ctx, "Mande só o *número* (e o complemento, se tiver) 🙂.");
        return this.enderecoAchado(ctx, q, { ...e, numero, complemento: complemento || e.complemento });
      }
      case "end_rua": {
        const cep = cepSozinho(t);
        if (cep) return this.usarCep(ctx, q, cep);
        if (!/\p{L}{3,}/u.test(t)) return this.repetirCom(ctx, "Preciso do *nome da rua* e do número 🙂.");
        return this.localizarEndereco(ctx, q, t);
      }
      case "end_cidade_escolha": {
        const cidades = sub.cidades as string[];
        const i = /^__cid(\d+)$/.exec(t)?.[1];
        const cidade = i !== undefined ? cidades[Number(i)] : cidades.find((c) => semAcento(c) === semAcento(t)) ?? t;
        return this.localizarEndereco(ctx, q, String(sub.texto), cidade);
      }
      case "end_cidade": {
        const cep = cepSozinho(t);
        if (cep) return this.usarCep(ctx, q, cep);
        if (/\d/.test(t) || t.length < 2) return this.repetirCom(ctx, "Mande só o *nome da cidade*, por favor.");
        return this.localizarEndereco(ctx, q, String(sub.texto), t.trim());
      }
      case "end_uf": {
        const uf = ufDe(t);
        if (!uf) return this.repetirCom(ctx, "Mande a sigla do estado (ex.: _SP_), por favor.");
        return this.enderecoAchado(ctx, q, { ...e, uf });
      }
      case "end_confirma": {
        if (t === "__ok" || SIM.test(t)) return this.aceitar(ctx, q, e, t, false);
        s.sub = undefined;
        if (t === "__corrigir" || NAO.test(t)) return this.repetirCom(ctx, "Sem problema! Vamos de novo.");
        // Mandou outro endereço no lugar da confirmação: recomeça com ele.
        return this.enderecoInicio(ctx, q, t, msg, false);
      }
    }
  }

  /* ── Revisão, correção e envio ───────────────────────── */

  private resumo(ctx: Ctx): string {
    const { f, s } = ctx;
    const qs = roteiro(f, s.dados).filter((q) => !q.grupo);
    return f.passos
      .map((p, i) => {
        const linhas = qs
          .filter((q) => q.passo === i)
          .map((q) => {
            if (q.quantidade) return `• *${q.campo.rotulo}:*\n${grupoEscrito(q.campo as CampoGrupo, (s.dados[q.campo.id] as Registro[]) ?? [])}`;
            return `• *${q.campo.rotulo}:* ${valorEscrito(q.campo, lerValor(s.dados, q.chave), lerValor(s.dados, `${q.chave}_outra`))}`;
          });
        return linhas.length ? `*${p.titulo}*\n${linhas.join("\n")}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
  }

  private mostrarRevisao(ctx: Ctx) {
    const { f, s } = ctx;
    s.fase = "revisao";
    s.sub = undefined;
    const capa = this.capaDe(f, "Revisão", "Confira antes de enviar", f.passos.length + 1);
    const corpo = `Pronto! Confira os seus dados:\n\n${this.resumo(ctx)}`;
    const botoes: Botao[] = [
      { id: "__enviar", rotulo: "✅ Enviar" },
      { id: "__corrigir", rotulo: "✏️ Corrigir" },
    ];
    if (corpo.length <= 950) ctx.out.push({ tipo: "botoes", texto: corpo, botoes, rodape: "Revisão · tudo certo? É só enviar", capa });
    else ctx.out.push(texto(corpo, capa), { tipo: "botoes", texto: "Está tudo certo?", botoes, rodape: "Revisão" });
  }

  private async responderRevisao(ctx: Ctx, msg: Recebida): Promise<void> {
    const t = this.mapearNumero(ctx, null, (msg.texto ?? "").trim());
    if (t === "__enviar" || /^(enviar|envia|pode enviar|sim|ok|confirmo|est[aá] certo|tudo certo)[.!\s]*$/i.test(t)) return this.enviar(ctx);
    if (/^(voltar|volta|anterior)[.!\s]*$/i.test(t)) {
      // Da revisão, "voltar" reabre a última pergunta respondida.
      const ultima = roteiro(ctx.f, ctx.s.dados).at(-1);
      if (ultima) {
        apagarValor(ctx.s.dados, ultima.chave);
        ctx.s.fase = "coletando";
        return this.repetirCom(ctx, "Certo, voltando uma pergunta ↩️.");
      }
    }
    if (t === "__corrigir" || /corrig|errad|mudar|alterar|trocar/i.test(t)) {
      ctx.s.fase = "corrigir";
      ctx.s.pagina = 0;
      return this.mostrarCorrecao(ctx);
    }
    await this.foraDoRoteiro(ctx, t, "revisão");
    ctx.out.push({ tipo: "botoes", texto: "Posso enviar o cadastro?", botoes: [{ id: "__enviar", rotulo: "✅ Enviar" }, { id: "__corrigir", rotulo: "✏️ Corrigir" }] });
  }

  /** Mensagem que não é resposta (na revisão, depois do envio): cumprimento, dúvida para a IA ou para a equipe. */
  private async foraDoRoteiro(ctx: Ctx, t: string, onde: string) {
    if (!t) {
      ctx.out.push(texto("Por aqui eu só consigo ler texto e fotos 🙂."));
      return;
    }
    if (soCumprimento(t)) {
      ctx.out.push(texto("Oi! 👋"));
      return;
    }
    if (!PEDE_ATENDENTE.test(t) && this.o.chat) {
      const ia = await lerMensagem(
        this.o.chat,
        {
          organizacao: ctx.f.organizacao,
          formulario: ctx.f.nome,
          conhecimento: ctx.f.conhecimento,
          pergunta: onde === "revisão" ? "Revisão: o cliente confere os dados e toca em Enviar ou Corrigir." : "O cadastro já foi enviado.",
          oQue: "nada (não há pergunta aberta)",
          historico: ctx.s.historico.slice(-6).map((h) => `${h.de === "cliente" ? "Cliente" : "Assistente"}: ${h.texto.slice(0, 300)}`).join("\n"),
        },
        t
      );
      if (ia?.acao === "duvida" && ia.resposta) {
        ctx.out.push(texto(ia.resposta));
        return;
      }
      if (ia?.resposta) ctx.out.push(texto(ia.resposta));
    }
    this.encaminhar(ctx, t, `mensagem na ${onde}`);
  }

  private mostrarCorrecao(ctx: Ctx) {
    const { f, s } = ctx;
    const itens: ItemLista[] = roteiro(f, s.dados)
      .filter((q) => !q.grupo && lerValor(s.dados, q.chave) !== undefined)
      .map((q) => ({
        id: `c:${q.chave}`,
        titulo: q.campo.rotulo.slice(0, 24),
        descricao: (q.quantidade ? `${(s.dados[q.campo.id] as unknown[]).length}` : valorEscrito(q.campo, lerValor(s.dados, q.chave), lerValor(s.dados, `${q.chave}_outra`)))
          .replace(/[*_]/g, "")
          .slice(0, 72),
      }));
    const porPagina = 8;
    const paginas = Math.max(1, Math.ceil(itens.length / porPagina));
    const p = (s.pagina ?? 0) % paginas;
    const pagina = itens.slice(p * porPagina, (p + 1) * porPagina);
    if (paginas > 1) pagina.push({ id: "__mais", titulo: "Ver mais ▸", descricao: `Página ${p + 1} de ${paginas}` });
    pagina.push({ id: "__revisao", titulo: "↩️ Voltar à revisão" });
    ctx.out.push({ tipo: "lista", texto: "O que você quer corrigir?", titulo: "Corrigir", botao: "Escolher", itens: pagina });
  }

  private async responderCorrecao(ctx: Ctx, msg: Recebida): Promise<void> {
    const { f, s } = ctx;
    const t = this.mapearNumero(ctx, null, (msg.texto ?? "").trim());
    if (t === "__mais") {
      s.pagina = (s.pagina ?? 0) + 1;
      return this.mostrarCorrecao(ctx);
    }
    if (t === "__revisao" || /^(voltar|nada|cancelar)[.!\s]*$/i.test(t)) return this.mostrarRevisao(ctx);
    const qs = roteiro(f, s.dados).filter((q) => !q.grupo);
    const alvo = t.startsWith("c:") ? qs.find((q) => `c:${q.chave}` === t) : qs.find((q) => semAcento(q.campo.rotulo) === semAcento(t));
    if (!alvo) {
      ctx.out.push(texto("Escolha na lista o que você quer corrigir 🙂."));
      return this.mostrarCorrecao(ctx);
    }
    apagarValor(s.dados, alvo.chave);
    s.fase = "coletando";
    s.pagina = undefined;
    ctx.out.push(texto("Certo, vamos corrigir ✏️."));
    this.perguntar(ctx);
  }

  private protocolo(): string {
    const d = this.agora();
    const dia = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const sufixo = Array.from(randomBytes(4), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
    return `${dia}-${sufixo}`;
  }

  private async enviar(ctx: Ctx): Promise<void> {
    const { f, s } = ctx;
    const protocolo = this.protocolo();
    const dados = dadosValidos(f, s.dados);
    const enviadoEm = this.agora().toISOString();
    try {
      await this.o.entregar({ protocolo, formulario: { id: f.id, nome: f.nome }, telefone: s.telefone, referencia: s.referencia, dados, enviadoEm });
    } catch (e) {
      console.error("[motor] entrega:", e);
      ctx.out.push(texto("Tive um problema para enviar o cadastro 😕. Toque em *Enviar* de novo em alguns instantes, por favor."));
      return this.mostrarRevisao(ctx);
    }
    s.fase = "enviado";
    s.protocolo = protocolo;
    s.enviadaEm = enviadoEm;
    const capa = this.capaDe(f, "Cadastro enviado", `Protocolo ${protocolo}`, f.passos.length + 1);
    const final = f.concluido?.(dados, protocolo) ?? `Cadastro enviado ✅\n\nSeu protocolo é *${protocolo}*. A equipe de ${f.organizacao} já recebeu os seus dados.`;
    ctx.out.push(f.link ? { tipo: "links", texto: final, links: [f.link], capa } : texto(final, capa));
  }

  private async posEnvio(ctx: Ctx, msg: Recebida): Promise<void> {
    const t = this.mapearNumero(ctx, null, (msg.texto ?? "").trim());
    const { s } = ctx;
    if (soCumprimento(t) || !t) {
      const aviso = `Oi! 👋 Seu cadastro já foi enviado ✅ (protocolo *${s.protocolo}*).`;
      ctx.out.push(this.o.aberto ? { tipo: "botoes", texto: aviso, botoes: [{ id: "__novo", rotulo: "📝 Novo cadastro" }] } : texto(aviso));
      return;
    }
    await this.foraDoRoteiro(ctx, t, "conversa depois do envio");
  }

  /* ── Equipe ──────────────────────────────────────────── */

  private comEquipe(t: string): Saida {
    return this.suporte ? { tipo: "links", texto: t, links: [{ rotulo: "💬 Falar c/ a equipe", url: `https://wa.me/${this.suporte}` }] } : texto(t);
  }

  /**
   * Leva a mensagem à equipe (WhatsApp da equipe e/ou evento para a sua
   * aplicação) com o contexto: quem é, onde parou, o que disse e o que o
   * assistente respondeu. O cadastro não para: quem chama repete a pergunta.
   */
  private encaminhar(ctx: Ctx, t: string, motivo: string, respostaIa?: string) {
    const { s, f } = ctx;
    const q = s.fase === "coletando" ? proximaPergunta(f, s.dados) : null;
    const mensagem = q?.campo.sensivel ? "[informação sensível]" : t.slice(0, 700);
    const agora = this.agora();
    if (s.suporte.some((r) => r.texto === mensagem && agora.getTime() - Date.parse(r.em) < REPETIDA_MS)) {
      ctx.out.push(texto("Sua mensagem já está com a nossa equipe 🙋."));
      return;
    }
    s.suporte = [...s.suporte, { em: agora.toISOString(), motivo, texto: mensagem }].slice(-20);
    const ondeEsta = q ? `${f.passos[q.passo].titulo} › ${q.campo.rotulo}` : s.fase === "enviado" ? `enviado (protocolo ${s.protocolo})` : s.fase;
    const nomeCampo = roteiro(f, s.dados).find((x) => x.campo.tipo === "nome" && !x.grupo);
    const nome = nomeCampo ? lerValor(s.dados, nomeCampo.chave) : undefined;
    this.o.aoEncaminhar?.({ formulario: f.id, telefone: s.telefone, referencia: s.referencia, motivo, mensagem, ondeEsta });
    if (this.suporte) {
      ctx.equipe.push(
        [
          `📩 *${f.nome}* — ${motivo}`,
          typeof nome === "string" ? `Cliente: ${nome}` : null,
          `WhatsApp: wa.me/${s.telefone}`,
          s.referencia ? `Referência: ${s.referencia}` : null,
          `Onde está: ${ondeEsta}`,
          `Mensagem: "${mensagem}"`,
          respostaIa ? `O assistente respondeu: "${respostaIa}"` : null,
        ]
          .filter(Boolean)
          .join("\n")
      );
      ctx.out.push(this.comEquipe("Encaminhei sua mensagem para a nossa equipe 🙋, que vai falar com você. Enquanto isso, seguimos com o cadastro."));
    } else {
      ctx.out.push(texto("Anotei sua mensagem para a nossa equipe 🙋, que vai falar com você. Enquanto isso, seguimos com o cadastro."));
    }
  }
}
