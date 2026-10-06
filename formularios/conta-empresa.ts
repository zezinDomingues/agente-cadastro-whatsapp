import { definirFormulario } from "../src/motor/formulario";

/** Exemplo: abertura de conta de uma empresa num software (SaaS), com os usuários convidados. */
export default definirFormulario({
  id: "conta-empresa",
  nome: "Abertura de conta",
  organizacao: "Nuvem Exemplo",
  conhecimento: `
A Nuvem Exemplo é um software de gestão na nuvem. Este cadastro abre a conta da empresa e convida os primeiros usuários.
Planos: Essencial (até 3 usuários), Profissional (até 15 usuários, com relatórios) e Empresarial (usuários ilimitados, com suporte dedicado).
O plano pode ser trocado depois, a qualquer momento, dentro do sistema. Os 14 primeiros dias são de teste, sem cobrança.
Cada usuário convidado recebe um e-mail para criar a própria senha. Preço, nota fiscal e contrato: com a equipe comercial.
`,
  passos: [
    {
      titulo: "Responsável",
      campos: [
        { id: "nome", tipo: "nome", rotulo: "Nome", pergunta: "Qual é o seu *nome completo*?" },
        { id: "email", tipo: "email", rotulo: "E-mail", pergunta: "Qual é o seu *e-mail*? Ele vai ser o login de administrador." },
      ],
    },
    {
      titulo: "Empresa",
      campos: [
        { id: "cnpj", tipo: "cnpj", rotulo: "CNPJ", pergunta: "Qual é o *CNPJ* da empresa?" },
        { id: "razao_social", tipo: "texto", rotulo: "Razão social", pergunta: "E a *razão social*? (o nome que está no cartão do CNPJ)", min: 3, max: 150 },
        {
          id: "segmento",
          tipo: "escolha",
          rotulo: "Segmento",
          pergunta: "Qual é o *segmento* da empresa?",
          opcoes: [
            { id: "varejo", rotulo: "Varejo" },
            { id: "servicos", rotulo: "Serviços" },
            { id: "industria", rotulo: "Indústria" },
            { id: "saude", rotulo: "Saúde" },
            { id: "educacao", rotulo: "Educação" },
            { id: "tecnologia", rotulo: "Tecnologia" },
          ],
          outra: "Outro segmento",
        },
        { id: "funcionarios", tipo: "numero", rotulo: "Funcionários", pergunta: "Quantos *funcionários* a empresa tem, mais ou menos?", min: 1, max: 100000 },
      ],
    },
    {
      titulo: "Plano",
      campos: [
        {
          id: "plano",
          tipo: "escolha",
          rotulo: "Plano",
          pergunta: "Qual *plano* você quer testar? Dá para trocar depois.",
          opcoes: [
            { id: "essencial", rotulo: "Essencial" },
            { id: "profissional", rotulo: "Profissional" },
            { id: "empresarial", rotulo: "Empresarial" },
          ],
        },
        {
          id: "usuarios",
          tipo: "grupo",
          rotulo: "Usuários convidados",
          item: "usuário",
          plural: "usuários",
          pergunta: "Quantas *pessoas da equipe* você quer convidar agora? (dá para convidar mais depois)",
          min: 0,
          max: 5,
          campos: [
            { id: "nome", tipo: "nome", rotulo: "Nome", pergunta: "Qual é o *nome* dessa pessoa?" },
            { id: "email", tipo: "email", rotulo: "E-mail", pergunta: "E o *e-mail* dela?" },
          ],
        },
      ],
    },
  ],
  concluido: (_d, protocolo) => `Conta criada ✅\n\nProtocolo *${protocolo}*. Você e as pessoas convidadas vão receber um e-mail para criar a senha. Bom teste! 🚀`,
  link: { rotulo: "Acessar o sistema", url: "https://example.com/entrar" },
});
