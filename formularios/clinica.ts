import { definirFormulario } from "../src/motor/formulario";

/** Exemplo: cadastro de paciente antes da primeira consulta. */
export default definirFormulario({
  id: "clinica",
  nome: "Cadastro de paciente",
  organizacao: "Clínica Exemplo",
  conhecimento: `
A Clínica Exemplo faz este cadastro antes da primeira consulta, para o atendimento na recepção ser rápido.
Os dados ficam só com a clínica e são usados no prontuário e no contato sobre consultas.
Carteirinha do convênio: é o cartão do plano de saúde; o número fica na frente, e a foto pode ser da frente do cartão ou do cartão digital no aplicativo do convênio.
Para marcar, remarcar ou desmarcar consulta, e para saber valores, o paciente fala com a equipe da recepção.
`,
  passos: [
    {
      titulo: "Seus dados",
      campos: [
        { id: "nome", tipo: "nome", rotulo: "Nome", pergunta: "Para começar, qual é o *nome completo* do paciente?" },
        { id: "nascimento", tipo: "data", rotulo: "Nascimento", pergunta: "Qual é a *data de nascimento*? (ex.: _12/03/1990_)" },
        { id: "cpf", tipo: "cpf", rotulo: "CPF", pergunta: "Qual é o *CPF* do paciente?", ajuda: "O CPF é pedido para o prontuário e para emitir recibos." },
        { id: "email", tipo: "email", rotulo: "E-mail", pergunta: "Qual é o seu *e-mail*? Mandamos por ele os lembretes de consulta.", opcional: true },
        { id: "telefone", tipo: "telefone", rotulo: "Telefone", pergunta: "Qual *telefone* usamos para falar com você?" },
      ],
    },
    {
      titulo: "Endereço",
      campos: [{ id: "endereco", tipo: "endereco", rotulo: "Endereço", pergunta: "Qual é o *CEP* do seu endereço?" }],
    },
    {
      titulo: "Convênio",
      campos: [
        {
          id: "atendimento",
          tipo: "escolha",
          rotulo: "Atendimento",
          pergunta: "O atendimento vai ser *particular* ou pelo *convênio*?",
          opcoes: [
            { id: "particular", rotulo: "Particular" },
            { id: "convenio", rotulo: "Convênio" },
          ],
        },
        {
          id: "convenio",
          tipo: "texto",
          rotulo: "Convênio",
          pergunta: "Qual é o *nome do convênio* e o *plano*? (ex.: _Saúde Total – Plano Ouro_)",
          quando: (d) => d.atendimento === "convenio",
        },
        {
          id: "carteirinha",
          tipo: "imagem",
          rotulo: "Carteirinha",
          pergunta: "Mande uma *foto da carteirinha* do convênio (frente) 📸.",
          ajuda: "Pode ser a foto do cartão físico ou um print do cartão digital no aplicativo do convênio.",
          quando: (d) => d.atendimento === "convenio",
        },
        { id: "tem_alergia", tipo: "sim_nao", rotulo: "Alergia", pergunta: "Você tem *alergia* a algum medicamento?" },
        { id: "alergias", tipo: "texto", rotulo: "Alergias", pergunta: "A quais *medicamentos*?", quando: (d) => d.tem_alergia === true, conferirComIa: false },
      ],
    },
  ],
  concluido: (d, protocolo) =>
    `Cadastro feito ✅\n\nProtocolo *${protocolo}*. Na recepção, é só dizer o seu nome${d.atendimento === "convenio" ? " e levar a carteirinha" : ""}. Até breve! 🩺`,
});
