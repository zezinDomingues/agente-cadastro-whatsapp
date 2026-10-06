import type { Saida } from "../motor/saida";
import type { Canal } from "./canal";

/** Canal que só guarda as mensagens: testes, demo e o chat no terminal. */
export class CanalMemoria implements Canal {
  enviadas: { telefone: string; saida: Saida }[] = [];
  private seq = 0;
  /** Chamado a cada mensagem (o chat do terminal imprime na hora). */
  aoEnviar?: (telefone: string, saida: Saida) => void;

  async enviar(telefone: string, saida: Saida): Promise<string> {
    this.enviadas.push({ telefone, saida });
    this.aoEnviar?.(telefone, saida);
    return `mem-${++this.seq}`;
  }

  /** As mensagens mandadas desde a última chamada. */
  novas(): Saida[] {
    const out = this.enviadas.map((e) => e.saida);
    this.enviadas = [];
    return out;
  }
}
