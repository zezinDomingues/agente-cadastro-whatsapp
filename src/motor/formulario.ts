/**
 * Definição declarativa de um cadastro.
 *
 * Um formulário é uma lista de PASSOS, cada um com seus CAMPOS. O agente não
 * conhece nenhum negócio: ele só sabe conduzir campos de um tipo (nome, e-mail,
 * CPF, endereço, escolha, foto, grupo repetível...). Para cadastrar paciente,
 * cliente de SaaS, inscrito de evento ou lead de imobiliária, escreve-se um
 * arquivo em `formularios/` — o motor, a validação e o WhatsApp são os mesmos.
 */

export type Registro = Record<string, unknown>;

export interface Opcao {
  /** Valor gravado (o que a sua aplicação recebe). */
  id: string;
  /** Texto do botão/opção (até 20 caracteres num botão, 24 numa lista). */
  rotulo: string;
  /** Linha cinza abaixo da opção, só nas listas (até 72 caracteres). */
  descricao?: string;
}

interface CampoBase {
  /** Chave no JSON entregue. Única no formulário (dentro de um grupo, única no grupo). */
  id: string;
  /** Nome curto, usado na revisão e na lista de correção ("E-mail", "CPF"). */
  rotulo: string;
  /** A pergunta como vai no WhatsApp (aceita *negrito* e _itálico_). */
  pergunta: string;
  /** Campo opcional: a pergunta ganha o botão "Pular" e o valor gravado é null. */
  opcional?: boolean;
  /** Contexto para a IA tirar dúvidas sobre ESTE campo ("onde acho o número da carteirinha?"). */
  ajuda?: string;
  /** Só pergunta se a condição for verdadeira (ex.: nome do convênio só se tem convênio). */
  quando?: (dados: Registro) => boolean;
  /** Não vai para o histórico, para a IA nem para o suporte; aparece mascarado na revisão. */
  sensivel?: boolean;
  /**
   * Regra a mais, da sua aplicação, depois da validação do tipo (ex.: e-mail
   * que já tem conta). Devolve a mensagem para o cliente, ou null se vale.
   */
  valida?: (valor: unknown, dados: Registro) => string | null | Promise<string | null>;
}

export type CampoSimples =
  | (CampoBase & { tipo: "texto"; min?: number; max?: number; conferirComIa?: boolean })
  | (CampoBase & { tipo: "nome" })
  | (CampoBase & { tipo: "email" })
  | (CampoBase & { tipo: "telefone" })
  | (CampoBase & { tipo: "cpf" | "cnpj" | "cpf_cnpj" })
  | (CampoBase & { tipo: "data"; idadeMinima?: number; futura?: boolean })
  | (CampoBase & { tipo: "numero"; min?: number; max?: number; inteiro?: boolean })
  | (CampoBase & { tipo: "escolha"; opcoes: Opcao[]; outra?: string })
  | (CampoBase & { tipo: "sim_nao" })
  | (CampoBase & { tipo: "endereco" })
  | (CampoBase & { tipo: "imagem" });

/** Grupo repetível: "quantos dependentes?" e, para cada um, os mesmos campos. */
export type CampoGrupo = CampoBase & {
  tipo: "grupo";
  /** "dependente" — usado em "Dependente 2 de 3". */
  item: string;
  /** "dependentes" — usado em "Quantos dependentes...". */
  plural: string;
  min?: number;
  max: number;
  campos: CampoSimples[];
};

export type Campo = CampoSimples | CampoGrupo;

export interface Passo {
  titulo: string;
  campos: Campo[];
}

export interface Formulario {
  /** Identificador (rota /api/iniciar, variável FORMULARIO). */
  id: string;
  /** "Cadastro de paciente" */
  nome: string;
  /** Quem fala com o cliente: "Clínica Exemplo". */
  organizacao: string;
  /** Primeira mensagem (antes da primeira pergunta). */
  saudacao?: string;
  /** O que a IA sabe para tirar dúvidas: regras, prazos, onde achar cada informação. */
  conhecimento?: string;
  passos: Passo[];
  /** Mensagem depois do envio. */
  concluido?: (dados: Registro, protocolo: string) => string;
  /** Botão de link na mensagem final (ex.: "Acessar o portal"). */
  link?: { rotulo: string; url: string };
}

const TIPOS = new Set(["texto", "nome", "email", "telefone", "cpf", "cnpj", "cpf_cnpj", "data", "numero", "escolha", "sim_nao", "endereco", "imagem", "grupo"]);

/** Confere a definição na carga: erro de configuração aparece na hora, não no meio de uma conversa. */
export function definirFormulario(f: Formulario): Formulario {
  const erro = (m: string) => {
    throw new Error(`formulário "${f.id}": ${m}`);
  };
  if (!/^[a-z0-9_-]+$/.test(f.id)) erro("id só com letras minúsculas, números, _ e -");
  if (!f.passos.length) erro("sem passos");
  const ids = new Set<string>();
  const conferir = (c: Campo, onde: Set<string>, dentroDeGrupo: boolean) => {
    if (!TIPOS.has(c.tipo)) erro(`campo "${c.id}": tipo desconhecido "${c.tipo}"`);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.id)) erro(`campo "${c.id}": id inválido`);
    if (onde.has(c.id)) erro(`campo "${c.id}" repetido`);
    onde.add(c.id);
    if (c.tipo === "escolha" && c.opcoes.length < 2) erro(`campo "${c.id}": escolha com menos de 2 opções`);
    if (c.tipo === "grupo") {
      if (dentroDeGrupo) erro(`campo "${c.id}": grupo dentro de grupo`);
      if (c.max < 1 || (c.min ?? 0) > c.max) erro(`campo "${c.id}": min/max do grupo`);
      const internos = new Set<string>();
      for (const s of c.campos) conferir(s, internos, true);
    }
  };
  for (const p of f.passos) for (const c of p.campos) conferir(c, ids, false);
  return f;
}

/* ── Roteiro: a ordem das perguntas, calculada a partir do que já foi respondido ── */

/**
 * Uma pergunta do roteiro. `chave` é o caminho do valor nos dados:
 *   "email"                → dados.email
 *   "dependentes#qtd"      → quantos itens o grupo tem (dados.dependentes = [{}, {}])
 *   "dependentes.1.nome"   → dados.dependentes[1].nome
 */
export interface Pergunta {
  chave: string;
  campo: Campo;
  /** Índice do passo (0..n-1). */
  passo: number;
  grupo?: { campo: CampoGrupo; indice: number };
  /** A pergunta "quantos itens" de um grupo. */
  quantidade?: boolean;
}

/** Valor respondido (null = pulado). `undefined` = ainda não perguntado. */
export function lerValor(dados: Registro, chave: string): unknown {
  const [raiz, i, sub] = chave.replace(/#qtd$/, "").split(".");
  const v = dados[raiz];
  if (chave.endsWith("#qtd")) return Array.isArray(v) ? v.length : undefined;
  if (i === undefined) return v;
  const item = Array.isArray(v) ? (v[Number(i)] as Registro | undefined) : undefined;
  return item ? item[sub] : undefined;
}

export function gravarValor(dados: Registro, chave: string, valor: unknown): void {
  if (chave.endsWith("#qtd")) {
    const raiz = chave.slice(0, -4);
    const atual = Array.isArray(dados[raiz]) ? (dados[raiz] as Registro[]) : [];
    const n = Number(valor);
    dados[raiz] = Array.from({ length: n }, (_, k) => atual[k] ?? {});
    return;
  }
  const [raiz, i, sub] = chave.split(".");
  if (i === undefined) {
    dados[raiz] = valor;
    return;
  }
  const lista = dados[raiz] as Registro[];
  lista[Number(i)][sub] = valor;
}

/** Tira o valor (correção a partir da revisão): o roteiro volta a perguntar. */
export function apagarValor(dados: Registro, chave: string): void {
  const [raiz, i, sub] = chave.replace(/#qtd$/, "").split(".");
  if (i === undefined || chave.endsWith("#qtd")) {
    delete dados[raiz];
    // O texto do "Outra" de uma escolha vai junto.
    delete dados[`${raiz}_outra`];
    return;
  }
  const item = (dados[raiz] as Registro[] | undefined)?.[Number(i)];
  if (item) {
    delete item[sub];
    delete item[`${sub}_outra`];
  }
}

/** Todas as perguntas que valem agora, na ordem. Grupos se expandem pela quantidade respondida. */
export function roteiro(f: Formulario, dados: Registro): Pergunta[] {
  const out: Pergunta[] = [];
  f.passos.forEach((p, passo) => {
    for (const campo of p.campos) {
      if (campo.quando && !campo.quando(dados)) continue;
      if (campo.tipo !== "grupo") {
        out.push({ chave: campo.id, campo, passo });
        continue;
      }
      out.push({ chave: `${campo.id}#qtd`, campo, passo, quantidade: true });
      const itens = Array.isArray(dados[campo.id]) ? (dados[campo.id] as Registro[]) : [];
      itens.forEach((item, indice) => {
        for (const sub of campo.campos) {
          if (sub.quando && !sub.quando({ ...dados, ...item })) continue;
          out.push({ chave: `${campo.id}.${indice}.${sub.id}`, campo: sub, passo, grupo: { campo, indice } });
        }
      });
    }
  });
  return out;
}

/** A próxima pergunta sem resposta, ou null se o cadastro está completo. */
export function proximaPergunta(f: Formulario, dados: Registro): Pergunta | null {
  return roteiro(f, dados).find((q) => lerValor(dados, q.chave) === undefined) ?? null;
}

/** Os dados só com o que o roteiro pergunta (resposta de um campo que deixou de valer sai). */
export function dadosValidos(f: Formulario, dados: Registro): Registro {
  const out: Registro = {};
  for (const q of roteiro(f, dados)) {
    const v = lerValor(dados, q.chave);
    if (v === undefined) continue;
    if (q.quantidade) {
      out[q.campo.id] = Array.from({ length: Number(v) }, () => ({}));
      continue;
    }
    gravarValor(out, q.chave, v);
    const outra = lerValor(dados, `${q.chave}_outra`);
    if (outra !== undefined) gravarValor(out, `${q.chave}_outra`, outra);
  }
  return out;
}
