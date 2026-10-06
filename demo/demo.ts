import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formularios } from "../formularios/index";
import { chat, iaConfigurada } from "../src/ia/llm";
import { iaSimulada } from "./falsos";
import { cinza, imprimirSaida, motorDeTeste, negrito, verde, violeta } from "./conversa";
import { roteiros } from "./roteiros";

/**
 * Demo: as três conversas de exemplo (clínica, abertura de conta, evento)
 * rodando no MESMO motor da produção, com WhatsApp, CEP e mapa trocados por
 * falsos em memória. Imprime a conversa e grava o JSON que a sua aplicação
 * receberia em demo/saida/.
 *
 *   npm run demo               # as três
 *   npm run demo -- evento     # só uma
 *
 * Sem LLM_API_KEYS, usa a IA simulada (determinística); com a chave, o modelo de verdade.
 */

const aqui = path.dirname(fileURLToPath(import.meta.url));
const saida = path.join(aqui, "saida");
fs.mkdirSync(saida, { recursive: true });
const raiz = path.join(aqui, "..");
if (fs.existsSync(path.join(raiz, ".env"))) process.loadEnvFile(path.join(raiz, ".env"));

const escolhidos = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const ia = iaConfigurada() && !process.argv.includes("--ia-simulada") ? chat : iaSimulada;
console.log(cinza(`IA: ${ia === chat ? `modelo de verdade (${process.env.LLM_MODEL || "nvidia/nemotron-3-super-120b-a12b"})` : "simulada (sem LLM_API_KEYS)"}\n`));

for (const f of formularios) {
  if (escolhidos.length && !escolhidos.includes(f.id)) continue;
  const falas = roteiros[f.id];
  if (!falas) continue;
  console.log(violeta(negrito(`━━━ ${f.organizacao} · ${f.nome} ━━━\n`)));
  const t = motorDeTeste({ formularios: [f], chat: ia, pasta: path.join(saida, "arquivos"), suporte: "5511900009999" });
  for (const fala of falas) {
    const dito = typeof fala === "string" ? fala : "botao" in fala ? `[toca: ${fala.rotulo}]` : "[📷 foto]";
    console.log(`${" ".repeat(40)}${verde(`🙋 ${dito}`)}\n`);
    const r = await t.dizer(fala);
    for (const o of r.cliente) imprimirSaida(o);
    for (const o of r.equipe) imprimirSaida(o, cinza("   → equipe: "));
  }
  const e = t.entregues[0];
  if (e) {
    const arq = path.join(saida, `${f.id}.json`);
    fs.writeFileSync(arq, JSON.stringify(e, null, 2));
    console.log(verde(`✔ cadastro entregue → ${path.relative(raiz, arq)}\n`));
  } else console.log(cinza("(o roteiro terminou antes do envio)\n"));
}
