import fs from "node:fs/promises";
import path from "node:path";
import type { Sessao } from "../motor/sessao";
import type { Armazenamento } from "./armazenamento";

/**
 * Uma conversa por arquivo JSON em `pasta` (padrão `data/sessoes`). Gravação
 * atômica (arquivo temporário + rename): uma queda no meio não corrompe a
 * conversa. Serve bem até alguns milhares de conversas; acima disso, troque
 * por um banco implementando `Armazenamento`.
 */
export class ArmazenamentoArquivos implements Armazenamento {
  constructor(private pasta: string) {}

  private async todas(): Promise<Sessao[]> {
    await fs.mkdir(this.pasta, { recursive: true });
    const nomes = (await fs.readdir(this.pasta)).filter((n) => n.endsWith(".json"));
    const out: Sessao[] = [];
    for (const n of nomes) {
      try {
        out.push(JSON.parse(await fs.readFile(path.join(this.pasta, n), "utf8")));
      } catch {
        // arquivo pela metade de uma versão antiga: ignora
      }
    }
    return out;
  }

  async porTelefone(telefones: string[]): Promise<Sessao | null> {
    const achadas = (await this.todas()).filter((s) => telefones.includes(s.telefone));
    achadas.sort((a, b) => b.atualizadaEm.localeCompare(a.atualizadaEm));
    return achadas[0] ?? null;
  }

  async porReferencia(referencia: string): Promise<Sessao | null> {
    const achadas = (await this.todas()).filter((s) => s.referencia === referencia);
    achadas.sort((a, b) => b.atualizadaEm.localeCompare(a.atualizadaEm));
    return achadas[0] ?? null;
  }

  async salvar(s: Sessao): Promise<void> {
    await fs.mkdir(this.pasta, { recursive: true });
    const destino = path.join(this.pasta, `${s.id}.json`);
    const tmp = `${destino}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(s, null, 1), { mode: 0o600 });
    await fs.rename(tmp, destino);
  }

  async apagar(id: string): Promise<void> {
    await fs.rm(path.join(this.pasta, `${id}.json`), { force: true });
  }
}
