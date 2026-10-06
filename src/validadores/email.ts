import { Resolver } from "node:dns/promises";

/**
 * Validador de e-mail do cadastro pelo WhatsApp.
 *
 * Três conferências, da mais barata à mais cara:
 * 1. formato: parte local e domínio com caracteres válidos, sem ponto
 *    sobrando, e terminação só de letras (".com", ".com.br");
 * 2. erro de digitação em provedor conhecido ("gmial.com", "hotmail.con",
 *    "gmail.com.br"): vira uma SUGESTÃO, que o cliente aceita ou não;
 * 3. o domínio existe (DNS: MX, ou A/AAAA quando não há MX). Falha de rede
 *    ou demora não trava ninguém: o e-mail passa.
 */

const LOCAL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const ROTULO_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Provedores comuns no Brasil (e alguns parecidos com eles, para não sugerir troca errada). */
const CONHECIDOS = [
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.com.br",
  "outlook.com",
  "outlook.com.br",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.com.br",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "uol.com.br",
  "bol.com.br",
  "terra.com.br",
  "ig.com.br",
  "globo.com",
  "globomail.com",
  "r7.com",
  "zipmail.com.br",
  "mail.com",
  "gmx.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "zoho.com",
  "yandex.com",
];

/** Erros que a distância de edição não pega (ou pega errado). */
const TROCAS: Record<string, string> = {
  "gmail.com.br": "gmail.com",
  "gmail.br": "gmail.com",
  "icloud.com.br": "icloud.com",
  "outlook.br": "outlook.com.br",
  "hotmail.br": "hotmail.com.br",
  "uol.com": "uol.com.br",
  "bol.com": "bol.com.br",
  "terra.com": "terra.com.br",
  "ig.com": "ig.com.br",
};

/** Terminações que não existem, digitadas errado: ".con" → ".com", ".com.bt" → ".com.br". */
const TERMINACOES: [RegExp, string][] = [
  [/\.(con|cpm|cim|cmo|ocm|vom|xom|comm|coom)$/, ".com"],
  [/\.com\.(bt|vr|rb|b|brr|bre)$/, ".com.br"],
  [/\.(con|cpm|cmo|vom|cm|co)\.br$/, ".com.br"],
];
/** Terminações que existem (Colômbia, Camarões, Omã): só viram ".com" num provedor conhecido ("gmail.co"). */
const TERMINACOES_REAIS = /\.(co|cm|om)$/;

export type ConferenciaEmail =
  | { ok: true; email: string; sugestao?: string }
  | { ok: false; motivo: string };

/** Espaços, maiúsculas e "mailto:" fora; vírgula no lugar do ponto do domínio corrigida. */
export function normalizarEmail(v: string): string {
  let e = v.trim().replace(/^mailto:/i, "").replace(/\s+/g, "").toLowerCase();
  // "joao@gmail,com" (vírgula do teclado do celular) → ponto.
  const arroba = e.lastIndexOf("@");
  if (arroba > 0) e = e.slice(0, arroba + 1) + e.slice(arroba + 1).replace(/,/g, ".");
  return e.replace(/[.;:!?)]+$/, "");
}

/** Só o formato. Devolve a mensagem de erro (falando com o cliente) ou null. */
export function formatoEmail(email: string): string | null {
  if (!email.includes("@")) return "Esse e-mail está sem o *@* 🤔. Mande o e-mail completo (ex.: _joao.silva@gmail.com_).";
  if (email.split("@").length > 2) return "Esse e-mail tem mais de um *@* 🤔. Mande só um e-mail, por favor.";
  if (email.length > 254) return "Esse e-mail é longo demais. Confira e mande de novo, por favor.";
  const [local, dominio] = email.split("@");
  if (!local) return "Falta a parte antes do *@* 🤔 (ex.: _joao.silva_@gmail.com).";
  if (!dominio) return "Falta a parte depois do *@* 🤔 (ex.: joao.silva@_gmail.com_).";
  if (local.length > 64 || !LOCAL_RE.test(local))
    return `A parte antes do @ (*${local.slice(0, 40)}*) tem caractere que não vale em e-mail (acento, espaço ou ponto sobrando). Confira e mande de novo.`;
  const rotulos = dominio.split(".");
  if (rotulos.length < 2) return `Falta a terminação do e-mail depois de *${dominio}* (ex.: _.com_ ou _.com.br_).`;
  if (rotulos.some((r) => !ROTULO_RE.test(r) || r.length > 63))
    return `O endereço depois do @ (*${dominio.slice(0, 60)}*) não parece válido. Confira e mande de novo.`;
  if (!/^[a-z]{2,}$/.test(rotulos[rotulos.length - 1]))
    return `A terminação de *${dominio.slice(0, 60)}* não parece válida (ex.: _.com_ ou _.com.br_).`;
  return null;
}

/** Distância de edição com troca de letras vizinhas contando 1 ("gmial" → "gmail"). */
function distancia(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + custo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/** Domínio parecido com um provedor conhecido, mas escrito diferente: o domínio certo; senão null. */
export function sugerirDominio(dominio: string): string | null {
  if (CONHECIDOS.includes(dominio)) return null;
  if (TROCAS[dominio]) return TROCAS[dominio];
  let corrigido = dominio;
  for (const [re, fim] of TERMINACOES) corrigido = corrigido.replace(re, fim);
  if (TROCAS[corrigido]) return TROCAS[corrigido];
  if (corrigido !== dominio && CONHECIDOS.includes(corrigido)) return corrigido;
  const comCom = corrigido.replace(TERMINACOES_REAIS, ".com");
  if (comCom !== corrigido && CONHECIDOS.includes(comCom)) return comCom;
  // Nome do provedor errado ("gmial.com", "hotmal.com", "outllok.com.br").
  let melhor: string | null = null;
  let menor = Infinity;
  for (const c of CONHECIDOS) {
    const dist = distancia(corrigido, c);
    if (dist < menor) [melhor, menor] = [c, dist];
  }
  const limite = corrigido.length <= 8 ? 1 : 2;
  if (melhor && menor <= limite) return melhor;
  // Só a terminação estava errada num domínio qualquer ("empresa.con" → "empresa.com").
  return corrigido !== dominio ? corrigido : null;
}

const resolver = new Resolver({ timeout: 2500, tries: 2 });

/** O domínio recebe e-mail? false só quando o DNS diz que ele NÃO existe; erro de rede vira null (não sei). */
export async function dominioExiste(dominio: string): Promise<boolean | null> {
  const codigo = (e: unknown) => (e as { code?: string })?.code ?? "";
  const NAO_EXISTE = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);
  try {
    const mx = await resolver.resolveMx(dominio);
    if (mx.some((m) => m.exchange && m.exchange !== ".")) return true;
    // "MX nulo" (RFC 7505): o domínio declara que não recebe e-mail.
    if (mx.length) return false;
  } catch (e) {
    if (!NAO_EXISTE.has(codigo(e))) return null;
    if (codigo(e) === "ENOTFOUND") return false;
  }
  // Sem MX: vale o endereço do próprio domínio (A ou AAAA).
  for (const tipo of ["resolve4", "resolve6"] as const) {
    try {
      if ((await resolver[tipo](dominio)).length) return true;
    } catch (e) {
      if (!NAO_EXISTE.has(codigo(e))) return null;
    }
  }
  return false;
}

/**
 * Confere o e-mail inteiro (já normalizado). Com erro de digitação num
 * provedor conhecido, devolve ok com a `sugestao`; domínio que não existe
 * e sem sugestão, recusa.
 */
export async function conferirEmail(email: string): Promise<ConferenciaEmail> {
  const erro = formatoEmail(email);
  if (erro) return { ok: false, motivo: erro };
  const [local, dominio] = email.split("@");
  const sugerido = sugerirDominio(dominio);
  if (sugerido) return { ok: true, email, sugestao: `${local}@${sugerido}` };
  if ((await dominioExiste(dominio)) === false)
    return {
      ok: false,
      motivo: `Não encontrei o endereço *${dominio}* 🤔: parece que ele não recebe e-mails. Confira o que vem depois do @ e mande de novo.`,
    };
  return { ok: true, email };
}
