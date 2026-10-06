import type { Sessao } from "../motor/sessao";

/**
 * Onde as conversas ficam. Reiniciar o agente não perde conversa nenhuma.
 * Vem com dois: arquivos JSON (padrão, zero dependência) e memória (testes).
 * Para Postgres, Redis, Supabase... implemente estas quatro funções.
 */
export interface Armazenamento {
  /** A conversa mais recente deste telefone (qualquer das variantes do número). */
  porTelefone(telefones: string[]): Promise<Sessao | null>;
  porReferencia(referencia: string): Promise<Sessao | null>;
  salvar(s: Sessao): Promise<void>;
  apagar(id: string): Promise<void>;
}

export class ArmazenamentoMemoria implements Armazenamento {
  private sessoes = new Map<string, Sessao>();

  async porTelefone(telefones: string[]): Promise<Sessao | null> {
    const achadas = [...this.sessoes.values()].filter((s) => telefones.includes(s.telefone));
    achadas.sort((a, b) => b.atualizadaEm.localeCompare(a.atualizadaEm));
    return achadas[0] ? structuredClone(achadas[0]) : null;
  }
  async porReferencia(referencia: string): Promise<Sessao | null> {
    const s = [...this.sessoes.values()].find((x) => x.referencia === referencia);
    return s ? structuredClone(s) : null;
  }
  async salvar(s: Sessao): Promise<void> {
    this.sessoes.set(s.id, structuredClone(s));
  }
  async apagar(id: string): Promise<void> {
    this.sessoes.delete(id);
  }
}
