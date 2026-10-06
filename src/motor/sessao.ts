import type { Registro } from "./formulario";

/** Uma conversa de cadastro. Tudo o que o motor precisa para continuar de onde parou. */
export interface Sessao {
  id: string;
  /** Só dígitos, como o WhatsApp identifica (ex. 5511988887777). */
  telefone: string;
  formulario: string;
  /** Id do cadastro na SUA aplicação (veio no /api/iniciar), devolvido na entrega. */
  referencia?: string;
  dados: Registro;
  fase: "inicio" | "coletando" | "revisao" | "corrigir" | "enviado";
  /** Sub-etapa de um campo de várias mensagens (endereço, sugestão de e-mail, "Outra"...). */
  sub?: Registro & { chave: string; etapa: string };
  /** Ids das opções da última pergunta interativa: "2" digitado vale a 2ª. */
  opcoes?: string[];
  /** Página da lista (escolha com muitas opções, correção). */
  pagina?: number;
  /** Última resposta que a IA recusou ("chave\ntexto"): se o cliente mandar de novo, vale. */
  recusada?: string;
  historico: { de: "cliente" | "agente"; texto: string }[];
  /** Encaminhamentos à equipe (os últimos 20). */
  suporte: { em: string; motivo: string; texto: string }[];
  ultimaMensagemId?: string;
  protocolo?: string;
  criadaEm: string;
  atualizadaEm: string;
  enviadaEm?: string;
}
