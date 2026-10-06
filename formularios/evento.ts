import { definirFormulario } from "../src/motor/formulario";

/** Exemplo: inscrição num evento, aberta — quem escrever para o número se inscreve. */
export default definirFormulario({
  id: "evento",
  nome: "Inscrição no evento",
  organizacao: "Conferência Exemplo",
  conhecimento: `
A Conferência Exemplo acontece em 14 e 15 de novembro, das 9h às 18h, no Centro de Convenções Exemplo.
A inscrição é gratuita. Cada inscrito pode levar até 2 acompanhantes, que também precisam ser cadastrados aqui.
O credenciamento é na entrada, com documento com foto. Haverá almoço; restrições alimentares são atendidas se avisadas na inscrição.
Programação, palestrantes e patrocínio: com a organização.
`,
  passos: [
    {
      titulo: "Inscrito",
      campos: [
        { id: "nome", tipo: "nome", rotulo: "Nome", pergunta: "Qual é o seu *nome completo*? (vai no crachá)" },
        { id: "email", tipo: "email", rotulo: "E-mail", pergunta: "Qual é o seu *e-mail*? Mandamos por ele o ingresso." },
        { id: "empresa", tipo: "texto", rotulo: "Empresa", pergunta: "Em qual *empresa* você trabalha?", opcional: true, max: 120 },
        {
          id: "camiseta",
          tipo: "escolha",
          rotulo: "Camiseta",
          pergunta: "Qual o *tamanho da camiseta* do evento?",
          opcoes: [
            { id: "p", rotulo: "P" },
            { id: "m", rotulo: "M" },
            { id: "g", rotulo: "G" },
            { id: "gg", rotulo: "GG" },
          ],
        },
      ],
    },
    {
      titulo: "Almoço",
      campos: [
        { id: "tem_restricao", tipo: "sim_nao", rotulo: "Restrição alimentar", pergunta: "Você tem alguma *restrição alimentar*?" },
        { id: "restricao", tipo: "texto", rotulo: "Qual restrição", pergunta: "Qual? (ex.: _vegetariano, sem lactose_)", quando: (d) => d.tem_restricao === true, conferirComIa: false },
      ],
    },
    {
      titulo: "Acompanhantes",
      campos: [
        {
          id: "acompanhantes",
          tipo: "grupo",
          rotulo: "Acompanhantes",
          item: "acompanhante",
          plural: "acompanhantes",
          pergunta: "Vai levar *acompanhantes*? Quantos?",
          min: 0,
          max: 2,
          campos: [
            { id: "nome", tipo: "nome", rotulo: "Nome", pergunta: "Qual é o *nome completo* do acompanhante?" },
            { id: "cpf", tipo: "cpf", rotulo: "CPF", pergunta: "E o *CPF* dele (para o credenciamento)?" },
          ],
        },
      ],
    },
  ],
  concluido: (d, protocolo) => {
    const n = Array.isArray(d.acompanhantes) ? d.acompanhantes.length : 0;
    return `Inscrição confirmada 🎟️\n\nProtocolo *${protocolo}*${n ? ` (você + ${n} acompanhante${n > 1 ? "s" : ""})` : ""}. O ingresso chega no seu e-mail. Até lá!`;
  },
});
