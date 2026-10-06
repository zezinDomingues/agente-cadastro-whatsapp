import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

/** Corpo JSON da requisição (até 1 MB). `null` se não for JSON. */
export async function lerJson(req: IncomingMessage, limite = 1024 * 1024): Promise<unknown> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const p of req) {
    total += (p as Buffer).length;
    if (total > limite) return null;
    partes.push(p as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(partes).toString("utf8"));
  } catch {
    return null;
  }
}

export function responder(res: ServerResponse, status: number, corpo: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(corpo));
}

/** Comparação em tempo constante (segredos). */
export function iguais(dado: string | null | undefined, esperado: string | undefined): boolean {
  if (!dado || !esperado) return false;
  const a = Buffer.from(dado);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `Authorization: Bearer <API_SECRET>` (a sua aplicação). */
export function autorizado(req: IncomingMessage): boolean {
  const secret = process.env.API_SECRET;
  return iguais(req.headers.authorization ?? null, secret ? `Bearer ${secret}` : undefined);
}
