/**
 * Validadores dos tipos de campo. Cada um recebe o texto como o cliente
 * escreveu e devolve o valor normalizado ou a mensagem de erro, falando com
 * o cliente. Nenhum depende de rede: rodam igual no teste e na produção.
 */

export type Conferido<T> = { ok: true; valor: T } | { ok: false; erro: string };

const ok = <T>(valor: T): Conferido<T> => ({ ok: true, valor });
const erro = (e: string): Conferido<never> => ({ ok: false, erro: e });

export function semAcento(t: string): string {
  return t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/* ── Nome ───────────────────────────────────────────────── */

const PARTICULAS = new Set(["da", "de", "do", "das", "dos", "e"]);

/** "joão da silva" → "João da Silva". */
export function capitalizarNome(nome: string): string {
  return nome
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((p, i) => (i > 0 && PARTICULAS.has(p) ? p : p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1)))
    .join(" ");
}

export function conferirNome(texto: string): Conferido<string> {
  const t = texto.trim().replace(/\s+/g, " ");
  if (/[\d@]/.test(t)) return erro("Isso não parece um nome 🤔. Mande o *nome completo*, por favor.");
  if (t.replace(/[^\p{L}]/gu, "").length < 3) return erro("Preciso do nome completo.");
  if (!/\p{L}+[\s'-]+\p{L}+/u.test(t)) return erro("Mande o *nome e o sobrenome*, por favor.");
  if (t.length > 120) return erro("Esse nome ficou longo demais. Confira e mande de novo.");
  return ok(capitalizarNome(t));
}

/* ── CPF / CNPJ ─────────────────────────────────────────── */

function digitos(t: string): string {
  return t.replace(/\D/g, "");
}

export function cpfValido(cpf: string): boolean {
  const d = digitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(d[n])) return false;
  }
  return true;
}

export function cnpjValido(cnpj: string): boolean {
  const d = digitos(cnpj);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const n of [12, 13]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * pesos[i + (13 - n)];
    const resto = soma % 11;
    const dv = resto < 2 ? 0 : 11 - resto;
    if (dv !== Number(d[n])) return false;
  }
  return true;
}

export function formatarCpf(d: string): string {
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatarCnpj(d: string): string {
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function conferirDocumento(texto: string, tipo: "cpf" | "cnpj" | "cpf_cnpj"): Conferido<string> {
  const d = digitos(texto);
  if (/[a-z]{3,}/i.test(texto) && d.length < 11) return erro(`Mande só os números do ${tipo === "cnpj" ? "CNPJ" : "CPF"}, por favor.`);
  if (tipo !== "cnpj" && d.length === 11) return cpfValido(d) ? ok(d) : erro("Esse CPF não é válido 🤔 (os dígitos verificadores não batem). Confira e mande de novo.");
  if (tipo !== "cpf" && d.length === 14) return cnpjValido(d) ? ok(d) : erro("Esse CNPJ não é válido 🤔 (os dígitos verificadores não batem). Confira e mande de novo.");
  if (tipo === "cpf") return erro("O CPF tem *11 números*. Confira e mande de novo.");
  if (tipo === "cnpj") return erro("O CNPJ tem *14 números*. Confira e mande de novo.");
  return erro("Mande o CPF (11 números) ou o CNPJ (14 números).");
}

/* ── Telefone (Brasil) ──────────────────────────────────── */

/** Telefone em dígitos com o 55: "(11) 98888-7777" → "5511988887777". */
export function conferirTelefone(texto: string): Conferido<string> {
  let d = digitos(texto);
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 8 || d.length === 9) return erro("Faltou o *DDD* 🙂. Mande o número com o DDD (ex.: _11 98888-7777_).");
  if (d.length !== 10 && d.length !== 11) return erro("Esse número não parece um telefone 🤔. Mande com o DDD (ex.: _11 98888-7777_).");
  if (Number(d.slice(0, 2)) < 11) return erro("Esse DDD não existe 🤔. Confira e mande de novo.");
  if (d.length === 11 && d[2] !== "9") return erro("Celular com 11 números começa com 9 depois do DDD. Confira e mande de novo.");
  return ok(`55${d}`);
}

export function formatarTelefone(digitosCom55: string): string {
  const d = digitos(digitosCom55).replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `+${digitosCom55}`;
}

/* ── Data ───────────────────────────────────────────────── */

const MESES: Record<string, number> = {
  janeiro: 1, jan: 1, fevereiro: 2, fev: 2, marco: 3, mar: 3, abril: 4, abr: 4, maio: 5, mai: 5, junho: 6, jun: 6,
  julho: 7, jul: 7, agosto: 8, ago: 8, setembro: 9, set: 9, outubro: 10, out: 10, novembro: 11, nov: 11, dezembro: 12, dez: 12,
};

/** "12/03/1990", "12-3-90", "12 de março de 1990", "1990-03-12" → "1990-03-12". */
export function lerData(texto: string, hoje = new Date()): string | null {
  const t = semAcento(texto).replace(/\s+/g, " ");
  let d: number, m: number, a: number;
  let r = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (r) [a, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = t.match(/^(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2}|\d{4})$/))) [d, m, a] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = t.match(/^(\d{1,2})\s*(?:de\s+)?([a-z]+)\.?\s*(?:de\s+)?(\d{2}|\d{4})$/)) && MESES[r[2]]) [d, m, a] = [Number(r[1]), MESES[r[2]], Number(r[3])];
  else return null;
  if (a < 100) {
    // Ano com 2 dígitos: o século que deixa a data no passado mais próximo.
    const seculo = Math.floor(hoje.getFullYear() / 100) * 100;
    a = seculo + a > hoje.getFullYear() ? seculo - 100 + a : seculo + a;
  }
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function formatarData(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function anosEntre(iso: string, hoje: Date): number {
  const [a, m, d] = iso.split("-").map(Number);
  let anos = hoje.getFullYear() - a;
  if (hoje.getMonth() + 1 < m || (hoje.getMonth() + 1 === m && hoje.getDate() < d)) anos--;
  return anos;
}

export function conferirData(texto: string, regra: { idadeMinima?: number; futura?: boolean } = {}, hoje = new Date()): Conferido<string> {
  const iso = lerData(texto, hoje);
  if (!iso) return erro("Não entendi a data 🤔. Mande no formato *dia/mês/ano* (ex.: _12/03/1990_).");
  const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  if (regra.futura && iso < hojeIso) return erro("Essa data já passou 🤔. Mande uma data a partir de hoje.");
  if (!regra.futura) {
    if (iso > hojeIso) return erro("Essa data ainda não chegou 🤔. Confira e mande de novo.");
    if (anosEntre(iso, hoje) > 130) return erro("Essa data ficou antiga demais 🤔. Confira o ano e mande de novo.");
    if (regra.idadeMinima && anosEntre(iso, hoje) < regra.idadeMinima)
      return erro(`Este cadastro é para maiores de ${regra.idadeMinima} anos.`);
  }
  return ok(iso);
}

/* ── Número ─────────────────────────────────────────────── */

const POR_EXTENSO: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, vinte: 20, trinta: 30, cem: 100,
};

export function conferirNumero(texto: string, regra: { min?: number; max?: number; inteiro?: boolean } = {}): Conferido<number> {
  const t = semAcento(texto).replace(/[^\p{L}\d,.\s-]/gu, " ").trim();
  let n: number | undefined;
  const m = t.match(/-?\d+(?:[.,]\d+)?/);
  if (m) n = Number(m[0].replace(",", "."));
  else if (POR_EXTENSO[t.split(" ")[0]] !== undefined) n = POR_EXTENSO[t.split(" ")[0]];
  if (n === undefined || Number.isNaN(n)) return erro("Mande só o *número*, por favor (ex.: _3_).");
  if (regra.inteiro !== false && !Number.isInteger(n)) return erro("Mande um número inteiro, por favor.");
  if (regra.min !== undefined && n < regra.min) return erro(`O mínimo é *${regra.min}*.`);
  if (regra.max !== undefined && n > regra.max) return erro(`O máximo é *${regra.max}*.`);
  return ok(n);
}

/* ── Respostas curtas ───────────────────────────────────── */

export const SIM = /^(s|sim|ss|isso|correto|certo|ok|okay|pode ser|confirmo|isso mesmo|tenho|tem|quero|claro|👍)[.!\s]*$/i;
export const NAO = /^(n|não|nao|nope|negativo|não tenho|nao tenho|não tem|nao tem|nenhum|nenhuma|não quero|nao quero)[.!\s]*$/i;
export const PULAR = /^(pular|pula|prefiro não|prefiro nao|não sei|nao sei|sem|-|n\/a)[.!\s]*$/i;

/** Parece pergunta ou pedido de ajuda (vai para a IA antes de virar valor). */
export function pareceDuvida(t: string): boolean {
  return /\?|^(como|onde|qual|quais|o que|oq|por ?que|pq|preciso|ajuda|dúvida|duvida|não entendi|nao entendi)\b/i.test(t.trim());
}

export function soCumprimento(t: string): boolean {
  return /^(oi+|ol[aá]|opa|e a[ií]|bom dia|boa tarde|boa noite|hey|hello|hi)[\s!.,🙂👋😊]*$/i.test(t.trim());
}

export const PEDE_ATENDENTE =
  /\b(falar|conversar|quero|preciso)\b.{0,25}\b(atendente|humano|pessoa|algu[eé]m|suporte|equipe)\b|^(atendente|humano|suporte)[.!?\s]*$/i;
