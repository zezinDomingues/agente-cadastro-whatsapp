import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { formularios } from "../formularios/index";
import { chat, iaConfigurada } from "../src/ia/llm";
import type { Saida } from "../src/motor/saida";
import { servicosReais } from "../src/servicos";
import { cinza, imprimirSaida, motorDeTeste, verde } from "./conversa";
import { iaSimulada, servicosFalsos } from "./falsos";

/**
 * Converse com o agente no terminal, como se fosse o WhatsApp:
 *
 *   npm run chat                    # o primeiro formulário
 *   npm run chat -- evento          # um formulário pelo id
 *   npm run chat -- clinica --offline   # CEP/mapa/e-mail falsos (sem rede)
 *
 * Digite normalmente; "#2" toca a 2ª opção da última mensagem; "/foto" manda
 * uma foto; "/sair" encerra. CEP, mapa e DNS do e-mail são os de verdade
 * (exceto com --offline); a IA é a do .env (LLM_API_KEYS) ou a simulada.
 */

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
if (fs.existsSync(path.join(raiz, ".env"))) process.loadEnvFile(path.join(raiz, ".env"));
const id = process.argv.slice(2).find((a) => !a.startsWith("-"));
const f = formularios.find((x) => x.id === id) ?? formularios[0];
const offline = process.argv.includes("--offline");
const ia = iaConfigurada() ? chat : iaSimulada;

const pasta = path.join(raiz, "demo", "saida", "arquivos");
const t = motorDeTeste({ formularios: [f], chat: ia, pasta, suporte: "5511900009999", servicos: offline ? servicosFalsos : { ...servicosReais, baixarImagem: servicosFalsos.baixarImagem } });
let ultima: Saida | undefined;

console.log(cinza(`${f.organizacao} · ${f.nome} · IA ${ia === chat ? "de verdade" : "simulada"} · ${offline ? "offline" : "CEP/mapa reais"}`));
console.log(cinza('Digite como no WhatsApp. "#2" toca a 2ª opção, "/foto" manda uma foto, "/sair" encerra.\n'));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: verde("você › ") });
rl.prompt();
for await (const bruta of rl) {
  const linha = bruta.trim();
  if (linha === "/sair") break;
  let fala: Parameters<typeof t.dizer>[0] = linha;
  const n = linha.match(/^#(\d+)$/)?.[1];
  if (n && ultima && (ultima.tipo === "botoes" || ultima.tipo === "lista")) {
    const op = ultima.tipo === "botoes" ? ultima.botoes[Number(n) - 1] : ultima.itens[Number(n) - 1];
    if (op) fala = { botao: op.id, rotulo: "rotulo" in op ? op.rotulo : op.titulo };
  }
  if (linha === "/foto") fala = { imagem: "foto-de-teste" };
  console.log();
  const r = await t.dizer(fala);
  for (const o of r.cliente) imprimirSaida(o);
  for (const o of r.equipe) imprimirSaida(o, cinza("   → equipe: "));
  ultima = [...r.cliente].reverse().find((o) => o.tipo === "botoes" || o.tipo === "lista") ?? ultima;
  if (t.entregues.length) {
    console.log(verde("✔ cadastro entregue:"), JSON.stringify(t.entregues[0].dados, null, 2));
    break;
  }
  rl.prompt();
}
rl.close();
