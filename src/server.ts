import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

// .env da raiz do agente (o systemd não precisa repetir as variáveis).
const raiz = fileURLToPath(new URL("..", import.meta.url));
if (existsSync(path.join(raiz, ".env"))) process.loadEnvFile(path.join(raiz, ".env"));

const { formularios } = await import("../formularios/index");
const { Motor } = await import("./motor/motor");
const { ArmazenamentoArquivos } = await import("./armazenamento/arquivos");
const { CanalWhatsApp } = await import("./canais/whatsapp");
const { zapiConfigured } = await import("./canais/zapi");
const { chat, iaConfigurada } = await import("./ia/llm");
const { servicosReais } = await import("./servicos");
const { criarEntrega } = await import("./entrega");
const { Vigia } = await import("./vigia");
const { criarRotas } = await import("./rotas/rotas");
const { responder } = await import("./rotas/http");

const DATA = path.resolve(raiz, process.env.DATA_DIR || "data");
const ARQUIVOS = path.join(DATA, "arquivos");
const PORT = Number(process.env.PORT || 3210);
const HOST = process.env.HOST || "127.0.0.1";

const vigia = new Vigia(path.join(DATA, "entregas-whatsapp.json"));
const entrega = criarEntrega({
  pastaDados: DATA,
  pastaArquivos: ARQUIVOS,
  webhookUrl: process.env.CADASTRO_WEBHOOK_URL?.trim() || undefined,
  segredo: process.env.CADASTRO_WEBHOOK_SEGREDO?.trim() || undefined,
});
const motor = new Motor({
  formularios,
  padrao: process.env.FORMULARIO?.trim() || formularios[0].id,
  aberto: process.env.CADASTRO_ABERTO?.trim() !== "0",
  armazenamento: new ArmazenamentoArquivos(path.join(DATA, "sessoes")),
  canal: new CanalWhatsApp(),
  servicos: servicosReais,
  chat: iaConfigurada() ? chat : null,
  suporteWhatsApp: process.env.SUPORTE_WHATSAPP?.trim(),
  pastaArquivos: ARQUIVOS,
  entregar: entrega.entregar,
  aoEncaminhar: entrega.encaminhado,
  aoEnviar: (i) => vigia.registrar(i.messageId, i.destino, i.texto, i.tipo),
});
const rotas = criarRotas(motor, vigia);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://agente");
  const inicio = Date.now();
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      const w = vigia.estado();
      return responder(res, 200, {
        ok: w.conectado !== false,
        zapi: zapiConfigured(),
        whatsapp: w.conectado === null ? "conferindo" : w.conectado ? "conectado" : "DESCONECTADO",
        conferido_em: w.conferidoEm,
        entregas_pendentes: w.pendentes,
        ia: iaConfigurada(),
        formularios: formularios.map((f) => f.id),
      });
    }
    if (req.method === "POST" && url.pathname === "/api/whatsapp/webhook") return await rotas.webhook(req, res, url);
    if (req.method === "POST" && url.pathname === "/api/whatsapp/status") return await rotas.status(req, res, url);
    if (req.method === "POST" && url.pathname === "/api/iniciar") return await rotas.iniciar(req, res);
    if (req.method === "POST" && url.pathname === "/api/avisar") return await rotas.avisar(req, res);
    responder(res, 404, { error: "Not found" });
  } catch (e) {
    console.error("[agente]", req.method, url.pathname, e);
    if (!res.headersSent) responder(res, 500, { error: "Internal error" });
  } finally {
    // Sem a query: o segredo do webhook vai na URL e não pode parar no log.
    console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - inicio}ms`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `agente-cadastro-whatsapp em http://${HOST}:${PORT} · formulários: ${formularios.map((f) => f.id).join(", ")} · ` +
      `Z-API ${zapiConfigured() ? "ok" : "SEM CONFIGURAÇÃO"} · IA ${iaConfigurada() ? "ok" : "desligada"}`
  );
  vigia.iniciar();
  setInterval(() => entrega.reenviarPendentes().catch((e) => console.error("[entrega]", e)), 10 * 60_000).unref();
});

for (const sinal of ["SIGTERM", "SIGINT"] as const) process.on(sinal, () => server.close(() => process.exit(0)));
