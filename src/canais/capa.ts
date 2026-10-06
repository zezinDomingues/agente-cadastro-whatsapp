import sharp from "sharp";
import type { Capa } from "../motor/saida";

/**
 * Capa de abertura de cada passo: nome da organização, título, subtítulo e a
 * barra de progresso com o passo atual em destaque. Desenhada em SVG e
 * convertida em JPEG no servidor (nenhum arquivo de imagem no repositório,
 * nenhuma logo de terceiros); vai como data URI, que a Z-API aceita no lugar
 * de uma URL. Cores por `CAPA_COR` (acento) e `CAPA_FUNDO`.
 */

const cache = new Map<string, string>();

function esc(t: string): string {
  return t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function svgCapa(c: Capa): string {
  const acento = process.env.CAPA_COR || "#855FF3";
  const fundo = process.env.CAPA_FUNDO || "#0A0E1B";
  const n = c.passos.length;
  const gap = 14;
  const largura = Math.min(168, (720 - (n - 1) * gap) / n);
  const x0 = 400 - (n * largura + (n - 1) * gap) / 2;
  const fonte = (n > 4 ? 18 : 21).toString();
  const barra = c.passos
    .map((nome, i) => {
      const x = x0 + i * (largura + gap);
      const feito = i + 1 < c.atual;
      const atual = i + 1 === c.atual;
      const cor = feito ? "#32D39A" : atual ? acento : "#1E2740";
      const txt = atual ? "#E6E9F2" : feito ? "#32D39A" : "#5B6480";
      const rotulo = nome.length > 14 ? `${nome.slice(0, 13)}…` : nome;
      return (
        `<rect x="${x}" y="298" width="${largura}" height="10" rx="5" fill="${cor}"/>` +
        `<text x="${x + largura / 2}" y="342" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fonte}" font-weight="${atual ? 700 : 400}" fill="${txt}" text-anchor="middle">${feito ? "✓ " : ""}${esc(rotulo)}</text>`
      );
    })
    .join("");
  const tamanho = c.titulo.length > 22 ? 50 : c.titulo.length > 16 ? 58 : 66;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="418">
  <defs>
    <linearGradient id="f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#121a33"/><stop offset="1" stop-color="${fundo}"/></linearGradient>
    <linearGradient id="b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#A38BF5"/><stop offset="1" stop-color="#5C93F0"/></linearGradient>
  </defs>
  <rect width="800" height="418" fill="url(#f)"/>
  <rect x="14" y="14" width="772" height="390" rx="22" fill="none" stroke="url(#b)" stroke-width="3"/>
  <text x="400" y="76" font-family="DejaVu Sans, Arial, sans-serif" font-size="21" letter-spacing="5" fill="#A38BF5" text-anchor="middle">${esc(c.marca.toUpperCase())}</text>
  <text x="400" y="176" font-family="DejaVu Sans, Arial, sans-serif" font-size="${tamanho}" font-weight="700" fill="#E6E9F2" text-anchor="middle">${esc(c.titulo)}</text>
  <text x="400" y="232" font-family="DejaVu Sans, Arial, sans-serif" font-size="28" fill="#8B93A7" text-anchor="middle">${esc(c.subtitulo)}</text>
  ${barra}
</svg>`;
}

export async function capaJpeg(c: Capa): Promise<string> {
  const chave = JSON.stringify(c);
  const pronto = cache.get(chave);
  if (pronto) return pronto;
  const jpeg = await sharp(Buffer.from(svgCapa(c))).jpeg({ quality: 88 }).toBuffer();
  const uri = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  if (cache.size > 200) cache.clear();
  cache.set(chave, uri);
  return uri;
}
