import type { Saida } from "../motor/saida";

/** Por onde o motor fala com o cliente. Devolve o id da mensagem (para o vigia de entrega). */
export interface Canal {
  enviar(telefone: string, saida: Saida): Promise<string | undefined>;
}
