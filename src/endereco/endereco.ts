import { lookupCep } from "./viacep";

/**
 * Endereço a partir do que o cliente escreveu ("rua serra de japi, 242",
 * "Rua heitor peixoto, 820 apartamento 56"): separa o número, o complemento e
 * o CEP escrito junto, e descobre bairro, cidade, estado e CEP, para não
 * perguntar um por um.
 *
 * Geocodificação pelo OpenStreetMap — Nominatim e, se ele não achar (erro de
 * digitação, por exemplo), o Photon, que tolera erro. No Brasil, com o CEP
 * encontrado, os nomes oficiais (rua, bairro, cidade, UF) vêm do ViaCEP,
 * como no site.
 *
 * Nunca chuta: se a mesma rua aparece em cidades diferentes e nenhuma bate
 * com o número, devolve "ambíguo" com as cidades, e a conversa pergunta.
 */

// O Nominatim exige um User-Agent que identifique quem chama (política de uso do OSM).
const UA = { "User-Agent": process.env.GEO_USER_AGENT || "agente-cadastro-whatsapp/1.0" };

export interface EnderecoAchado {
  rua: string;
  numero: string;
  bairro: string;
  cidade: string;
  estado: string;
  /** Apartamento, bloco, casa... como o cliente escreveu (pode ser vazio). */
  complemento: string;
  /** No Brasil, só dígitos (8). Fora, como o geocodificador devolveu. */
  cep: string;
}

export type Localizacao =
  | { status: "ok"; achado: EnderecoAchado }
  | { status: "ambiguo"; cidades: string[] }
  | { status: "nada" };

/**
 * Separa o número que veio junto da rua: "rua x, 242", "rua x 242",
 * "rua x nº 242", "rua 7 de setembro, 100" (fica o 100), "rua x, s/n",
 * "rua x 242, cambuci" (o que vem depois do número volta em `resto`).
 */
export function separarNumero(texto: string): { rua: string; numero: string; resto: string } {
  const t = texto.trim().replace(/\s+/g, " ");
  const sn = t.match(/^(.*?)[,\s]+(s\/n|sn|sem n[uú]mero)\b\.?(.*)$/i);
  if (sn) return { rua: limparRua(sn[1]), numero: "s/n", resto: sn[3] };
  // Depois de vírgula, "nº"/"n."/"número": o primeiro (o que vem depois é bairro, cidade...).
  const marcado = [...t.matchAll(/(?:,|\bn[º°o.]|\bn[uú]mero)\s*(\d{1,6}[a-z]?)\b/gi)][0];
  if (marcado && marcado.index !== undefined) {
    return { rua: limparRua(t.slice(0, marcado.index)), numero: marcado[1], resto: t.slice(marcado.index + marcado[0].length) };
  }
  // Rodovia/estrada rural: "km 12" é o "número".
  const km = t.match(/^(.*?)[,\s]+(km\s*\d+(?:[.,]\d+)?)\b(.*)$/i);
  if (km) return { rua: limparRua(km[1]), numero: km[2].replace(/\s+/, " ").toLowerCase(), resto: km[3] };
  const fim = t.match(/^(.*\D)\s(\d{1,6}[a-z]?)$/i);
  if (fim) return { rua: limparRua(fim[1]), numero: fim[2], resto: "" };
  // "rua x 242, cambuci": número sem vírgula antes, seguido de vírgula.
  const meio = t.match(/^(.*\p{L}.*?)\s(\d{1,6}[a-z]?)\s*,(.*)$/iu);
  if (meio) return { rua: limparRua(meio[1]), numero: meio[2], resto: meio[3] };
  return { rua: limparRua(t), numero: "", resto: "" };
}

function limparRua(r: string): string {
  return r.replace(/[,\s-]+$/, "").trim();
}

// Complemento: "apartamento 56", "apto 56", "ap. 12b", "bloco B", "casa 2",
// "fundos"... Precisa de um código (número ou letra) depois da palavra, para
// não confundir com nome de rua ("Rua Casa Verde"); fundos/frente valem sozinhos.
const COMPL_COM_CODIGO =
  "apartamento|apto|apt|ap|bloco|bl|casa|cs|sala|sl|conjunto|conj|cj|andar|torre|lote|lt|quadra|qd|loja|lj|box|galp[aã]o|chal[eé]|unidade|un";
const COMPL_SOZINHO = "fundos|frente|sobreloja|t[eé]rreo|cobertura";
const COMPL_RE = new RegExp(
  `(?:^|[\\s,;/-])((?:(?:${COMPL_COM_CODIGO})\\.?\\s*(?:n[º°o.]?\\s*)?(?:\\d+[a-z]?|[a-z])\\b|(?:${COMPL_SOZINHO})\\b)` +
    `(?:\\s*(?:(?:${COMPL_COM_CODIGO})\\.?\\s*(?:n[º°o.]?\\s*)?(?:\\d+[a-z]?|[a-z])\\b|(?:${COMPL_SOZINHO})\\b))*)`,
  "iu"
);

/**
 * Tira o complemento do texto: "820 apartamento 56" → resto "820",
 * complemento "apartamento 56". Pedaços seguidos ("apto 56, bloco B")
 * entram juntos. A palavra só conta depois de algum número ou vírgula, para
 * não cortar o nome da rua.
 */
export function separarComplemento(texto: string): { resto: string; complemento: string } {
  let t = texto.trim().replace(/\s+/g, " ");
  const partes: string[] = [];
  for (let i = 0; i < 4; i++) {
    const m = t.match(COMPL_RE);
    if (!m || m.index === undefined) break;
    const inicio = m.index + m[0].indexOf(m[1]);
    const antes = t.slice(0, inicio);
    // Palavra no começo ou sem número/vírgula antes: é o nome da rua, não complemento.
    if (inicio > 0 && !/[\d,]|s\/n/i.test(antes)) break;
    if (inicio === 0 && partes.length === 0 && t.length > m[1].length + 3) break;
    partes.push(m[1].trim().replace(/[.\s-]+$/, ""));
    t = (antes.replace(/[\s,;/-]+$/, "") + t.slice(inicio + m[1].length)).trim();
  }
  return { resto: t.replace(/^[\s,;-]+|[\s,;-]+$/g, ""), complemento: partes.join(", ") };
}

const LOGRADOURO_RE =
  /\b(rua|r\.|avenida|av\.?|estrada|estr\.|rodovia|rod\.|alameda|al\.|travessa|tv\.|pra[cç]a|largo|viela|servid[aã]o|s[ií]tio|fazenda|ch[aá]cara|condom[ií]nio|vicinal)\s+\S/iu;

export interface EnderecoSeparado {
  rua: string;
  numero: string;
  complemento: string;
  /** CEP que veio no meio do texto (só dígitos). */
  cep: string;
  /** Pedaços depois do número (bairro, cidade, UF...): pistas para achar a rua certa. */
  dicas: string[];
}

/**
 * Endereço solto em partes: "Rua heitor peixoto, 820 apartamento 56, Cambuci,
 * São Paulo - SP, 01543-001" → rua, número, complemento, CEP e as pistas.
 */
export function separarEndereco(texto: string): EnderecoSeparado {
  let t = texto.trim().replace(/\s+/g, " ");
  // "fica na rua x, 242", "não sei o cep, é av. y 100": começa no tipo do logradouro.
  const tipo = t.match(LOGRADOURO_RE);
  if (tipo && tipo.index && !/\d/.test(t.slice(0, tipo.index))) t = t.slice(tipo.index);
  let cep = "";
  const c = t.match(/(?:\bcep\s*:?\s*)?\b(\d{5})[-.\s]?(\d{3})\b/i);
  if (c && c.index !== undefined) {
    cep = c[1] + c[2];
    t = (t.slice(0, c.index) + t.slice(c.index + c[0].length)).trim();
  }
  const { resto, complemento } = separarComplemento(t);
  const { rua, numero, resto: depois } = separarNumero(resto);
  const dicas: string[] = [];
  const comp: string[] = complemento ? [complemento] : [];
  for (const pedaco of depois.split(/[,;]|\s-\s|\//)) {
    const p = pedaco.replace(/^\s*(bairro|cidade|estado|uf)\s*:?\s*/i, "").trim();
    if (!p) continue;
    // Número solto depois do número da casa ("820, 56"): é o apartamento.
    if (/^\d{1,5}[a-z]?$/i.test(p)) comp.push(p);
    else dicas.push(p);
  }
  return { rua, numero, complemento: comp.join(", ").slice(0, 200), cep, dicas };
}

const UFS: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE", "distrito federal": "DF",
  "espirito santo": "ES", goias: "GO", maranhao: "MA", "mato grosso": "MT", "mato grosso do sul": "MS",
  "minas gerais": "MG", para: "PA", paraiba: "PB", parana: "PR", pernambuco: "PE", piaui: "PI",
  "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO", roraima: "RR",
  "santa catarina": "SC", "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
};

function semAcento(t: string): string {
  return t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

// Palavras que não identificam a rua (tipo do logradouro e ligações).
const TIPOS = new Set(["rua", "r", "avenida", "av", "estrada", "est", "rodovia", "rod", "alameda", "al", "travessa", "tv", "praca", "largo", "viela", "via", "servidao", "sitio", "fazenda", "chacara", "de", "do", "da", "dos", "das", "e"]);

function palavras(s: string): string[] {
  return semAcento(s)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t && !TIPOS.has(t));
}

function distancia(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** O nome encontrado é a rua que o cliente escreveu? Tolera um erro de letra por palavra. */
export function mesmaRua(escrita: string, achada: string): boolean {
  const a = palavras(escrita);
  const b = palavras(achada);
  if (a.length === 0 || b.length === 0) return false;
  const batem = a.filter((x) => b.some((y) => x === y || (x.length >= 4 && y.length >= 4 && distancia(x, y) <= 1)));
  return batem.length / a.length >= 0.67;
}

interface Candidato {
  rua: string;
  numero: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
}

async function nominatim(q: string, pais: string): Promise<Candidato[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({ q, countrycodes: pais.toLowerCase(), format: "jsonv2", addressdetails: "1", limit: "5" }).toString();
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const data = (await res.json()) as { address?: Record<string, string> }[];
  return data
    .map((r) => r.address ?? {})
    .filter((a) => a.road)
    .map((a) => ({
      rua: a.road ?? "",
      numero: a.house_number ?? "",
      bairro: a.suburb ?? a.neighbourhood ?? a.city_district ?? a.quarter ?? "",
      cidade: a.city ?? a.town ?? a.village ?? a.municipality ?? "",
      estado: (a["ISO3166-2-lvl4"] ?? "").replace(/^[A-Z]{2}-/, "") || a.state || "",
      cep: a.postcode ?? "",
    }));
}

async function photon(q: string, pais: string): Promise<Candidato[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.search = new URLSearchParams({ q, limit: "5", lang: "default" }).toString();
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const data = (await res.json()) as { features?: { properties: Record<string, string> }[] };
  return (data.features ?? [])
    .map((f) => f.properties)
    .filter((p) => p.countrycode?.toUpperCase() === pais.toUpperCase() && (p.street || p.type === "street"))
    .map((p) => ({
      rua: p.street ?? p.name ?? "",
      numero: p.housenumber ?? "",
      bairro: p.district ?? p.locality ?? "",
      cidade: p.city ?? "",
      estado: pais.toUpperCase() === "BR" ? (UFS[semAcento(p.state ?? "")] ?? p.state ?? "") : (p.state ?? ""),
      cep: p.postcode ?? "",
    }));
}

/** UF escrita como pista ("SP", "São Paulo", "sp"). */
export function ufDe(texto: string): string {
  const t = semAcento(texto);
  if (/^[a-z]{2}$/.test(t) && Object.values(UFS).includes(t.toUpperCase())) return t.toUpperCase();
  return UFS[t] ?? "";
}

/** "até 429/430", "de 431/432 ao fim", "de 101 a 299 - lado ímpar": o número está na faixa? */
export function numeroNaFaixa(numero: string, faixa: string): boolean {
  const n = Number(numero.match(/^\d+/)?.[0] ?? NaN);
  const f = semAcento(faixa);
  if (!Number.isFinite(n) || !f) return !f; // CEP da rua inteira (sem faixa) vale para qualquer número
  if (/lado impar/.test(f) && n % 2 === 0) return false;
  if (/lado par/.test(f) && n % 2 === 1) return false;
  const num = (x?: string) => Number(x);
  let m = f.match(/^ate (\d+)(?:\/(\d+))?/);
  if (m) return n <= Math.max(num(m[1]), num(m[2] ?? m[1]));
  m = f.match(/^de (\d+)(?:\/(\d+))? ao fim/);
  if (m) return n >= Math.min(num(m[1]), num(m[2] ?? m[1]));
  m = f.match(/^de (\d+)(?:\/(\d+))? a (\d+)(?:\/(\d+))?/);
  if (m) return n >= Math.min(num(m[1]), num(m[2] ?? m[1])) && n <= Math.max(num(m[3]), num(m[4] ?? m[3]));
  if (/^lado (im)?par$/.test(f)) return true;
  return false; // "715 Loja B" e afins: CEP de um prédio ou empresa
}

interface RuaViaCep {
  cep: string;
  logradouro: string;
  complemento: string;
  unidade?: string;
  bairro: string;
  localidade: string;
  uf: string;
}

/** Busca de rua do ViaCEP (Correios): precisa de UF e cidade. */
async function viaCepPorRua(uf: string, cidade: string, rua: string): Promise<RuaViaCep[]> {
  // Só sai o tipo do logradouro: os Correios precisam do "do"/"de" ("Serra do Japi", não "Serra Japi").
  const nome = rua
    .replace(/^\s*(rua|r\.?|avenida|av\.?|estrada|estr?\.?|rodovia|rod\.?|alameda|al\.?|travessa|tv\.?|pra[cç]a|largo|viela)\s+/i, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!uf || !cidade || nome.length < 3) return [];
  const url = `https://viacep.com.br/ws/${encodeURIComponent(uf)}/${encodeURIComponent(cidade)}/${encodeURIComponent(nome)}/json/`;
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as RuaViaCep[] | { erro?: boolean };
    return Array.isArray(data) ? data.filter((r) => mesmaRua(rua, r.logradouro)) : [];
  } catch {
    return [];
  }
}

/** UF de uma cidade brasileira pelo mapa; vazio se não achar ou se houver cidades com esse nome em mais de um estado. */
export async function ufDaCidade(cidade: string): Promise<string> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({ q: cidade, countrycodes: "br", format: "jsonv2", addressdetails: "1", limit: "8" }).toString();
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return "";
    const data = (await res.json()) as { address?: Record<string, string> }[];
    const c = semAcento(cidade);
    const ufs = new Set(
      data
        .map((r) => r.address ?? {})
        .filter((a) => [a.city, a.town, a.village, a.municipality].some((x) => x && semAcento(x) === c))
        .map((a) => (a["ISO3166-2-lvl4"] ?? "").replace(/^BR-/, ""))
        .filter(Boolean)
    );
    return ufs.size === 1 ? [...ufs][0] : "";
  } catch {
    return "";
  }
}

/** CEP e bairro pela faixa de números da rua no ViaCEP (um só resultado possível, senão fica sem). */
function escolherNaFaixa(ruas: RuaViaCep[], numero: string): { cep: string; bairro: string } {
  const validas = ruas.filter((r) => !r.unidade);
  const naFaixa = validas.filter((r) => numeroNaFaixa(numero, r.complemento));
  const ceps = [...new Set(naFaixa.map((r) => r.cep.replace(/\D/g, "")))];
  const bairros = [...new Set((naFaixa.length ? naFaixa : validas).map((r) => r.bairro).filter(Boolean))];
  return { cep: ceps.length === 1 ? ceps[0] : "", bairro: bairros.length === 1 ? bairros[0] : "" };
}

/** Nominatim e, se ele não achar e `tolerante`, o Photon (aceita erro de digitação, mas é mais lento). */
async function geocodificar(consulta: string, pais: string, tolerante: boolean): Promise<Candidato[]> {
  const n = await nominatim(consulta, pais);
  return n.length || !tolerante ? n : photon(consulta, pais);
}

/**
 * Localiza o endereço que o cliente escreveu. Tira o complemento e o CEP do
 * texto, busca "rua, número" no mapa com as pistas que vieram depois do número
 * (bairro, cidade, UF) e, sem resultado, sem elas. `cidade` (quando o cliente
 * já disse) restringe a busca. No Brasil, se o mapa não conhece a rua mas a
 * cidade é conhecida, tenta a busca de ruas dos Correios (ViaCEP).
 * `pais`: código ISO (ex. "BR").
 */
export async function localizar(texto: string, pais: string, cidade?: string): Promise<Localizacao> {
  const sep = separarEndereco(texto);
  const { rua, numero, complemento, dicas } = sep;
  const br = pais.toUpperCase() === "BR";
  const comNumeroNaBusca = numero && numero !== "s/n" && !/^km/i.test(numero) ? `${rua}, ${numero}` : rua;

  // CEP escrito junto do endereço: os Correios dizem onde é.
  if (br && sep.cep) {
    const oficial = await lookupCep(sep.cep).catch(() => null);
    if (oficial && (!oficial.street || !palavras(rua).length || mesmaRua(rua, oficial.street))) {
      return {
        status: "ok",
        achado: {
          rua: oficial.street || rua,
          numero,
          complemento,
          bairro: oficial.neighborhood,
          cidade: oficial.city,
          estado: oficial.state,
          cep: sep.cep,
        },
      };
    }
  }

  const consultas = [
    [comNumeroNaBusca, ...dicas, cidade],
    [comNumeroNaBusca, cidade],
    [rua, ...dicas, cidade],
    [rua, cidade],
  ]
    .map((q) => q.filter(Boolean).join(", "))
    .filter((q, i, todas) => q && todas.indexOf(q) === i);

  let candidatos: Candidato[] = [];
  try {
    for (const [i, q] of consultas.entries()) {
      candidatos = await geocodificar(q, pais, i === 0);
      // Só ruas com o nome que o cliente escreveu (o geocodificador traz vizinhas).
      if (palavras(rua).length) candidatos = candidatos.filter((x) => mesmaRua(rua, x.rua));
      if (candidatos.length) break;
    }
  } catch (e) {
    console.error("[endereco] geocodificação:", e);
    candidatos = [];
  }
  if (cidade) {
    const c = semAcento(cidade);
    const naCidade = candidatos.filter((x) => semAcento(x.cidade) === c);
    if (naCidade.length) candidatos = naCidade;
  }
  // Pistas escritas pelo cliente (bairro, cidade, UF) desempatam.
  if (dicas.length && candidatos.length > 1) {
    const d = dicas.map(semAcento);
    const batem = candidatos.filter((x) => [x.cidade, x.bairro, x.estado].some((v) => v && d.includes(semAcento(v))) || d.some((u) => ufDe(u) && ufDe(u) === x.estado));
    if (batem.length) candidatos = batem;
  }

  if (candidatos.length === 0) {
    // O mapa não conhece a rua: com a cidade (dita antes ou escrita no texto), tenta os Correios.
    if (br) {
      const ufEscrita = dicas.map(ufDe).find(Boolean) ?? "";
      for (const c of [cidade, ...dicas].filter((x): x is string => Boolean(x) && !ufDe(x!))) {
        const uf = ufEscrita || (await ufDaCidade(c));
        const ruas = await viaCepPorRua(uf, c, rua);
        if (!ruas.length) continue;
        const { cep, bairro } = escolherNaFaixa(ruas, numero);
        return {
          status: "ok",
          achado: { rua: ruas[0].logradouro, numero, complemento, bairro, cidade: ruas[0].localidade, estado: ruas[0].uf, cep },
        };
      }
    }
    return { status: "nada" };
  }

  // Confiável: o número bate com um resultado, ou todos são da mesma cidade.
  const comNumero = numero ? candidatos.find((x) => x.numero === numero) : undefined;
  const cidades = [...new Set(candidatos.map((x) => x.cidade).filter(Boolean))];
  const escolhido = comNumero ?? (cidades.length <= 1 ? candidatos[0] : undefined);
  if (!escolhido) return { status: "ambiguo", cidades: cidades.slice(0, 8) };

  const achado: EnderecoAchado = {
    rua: escolhido.rua || rua,
    numero: numero || escolhido.numero,
    complemento,
    bairro: escolhido.bairro,
    cidade: escolhido.cidade,
    estado: escolhido.estado,
    cep: escolhido.cep,
  };
  // No Brasil, o CEP leva aos nomes oficiais (Correios), os mesmos do site.
  if (br) {
    const digitos = achado.cep.replace(/\D/g, "");
    achado.cep = digitos.length === 8 ? digitos : "";
    if (achado.cep) {
      const oficial = await lookupCep(achado.cep).catch(() => null);
      // CEP de cidade inteira (sem rua) dá cidade/UF; CEP de rua só vale se
      // for a mesma rua (o CEP do mapa às vezes é o da rua vizinha).
      if (oficial && (!oficial.street || mesmaRua(achado.rua, oficial.street))) {
        achado.rua = oficial.street || achado.rua;
        achado.bairro = oficial.neighborhood || achado.bairro;
        achado.cidade = oficial.city || achado.cidade;
        achado.estado = oficial.state || achado.estado;
      } else {
        // CEP que não existe ou é de outra rua: melhor sem CEP do que com o errado.
        achado.cep = "";
      }
    }
    // Sem CEP pelo mapa: a faixa de números da rua nos Correios.
    if (!achado.cep && achado.estado && achado.cidade) {
      const { cep, bairro } = escolherNaFaixa(await viaCepPorRua(achado.estado, achado.cidade, achado.rua), achado.numero);
      achado.cep = cep;
      // Com o CEP dos Correios, o bairro oficial vale (como no CEP digitado).
      if (bairro && (cep || !achado.bairro)) achado.bairro = bairro;
    }
  }
  return { status: "ok", achado };
}
