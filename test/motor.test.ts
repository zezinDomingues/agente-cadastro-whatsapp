import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { motorDeTeste } from "../demo/conversa";
import { iaSimulada } from "../demo/falsos";
import { definirFormulario, proximaPergunta } from "../src/motor/formulario";
import { textoDe, type Saida } from "../src/motor/saida";

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "cadastro-teste-"));
const agora = () => new Date(2026, 9, 6, 12);
const tudo = (s: Saida[]) => s.map(textoDe).join("\n---\n");

const form = definirFormulario({
  id: "teste",
  nome: "Cadastro de teste",
  organizacao: "Empresa Teste",
  passos: [
    {
      titulo: "Dados",
      campos: [
        { id: "nome", tipo: "nome", rotulo: "Nome", pergunta: "Seu nome?" },
        { id: "cpf", tipo: "cpf", rotulo: "CPF", pergunta: "Seu CPF?", sensivel: true },
        { id: "apelido", tipo: "texto", rotulo: "Apelido", pergunta: "Apelido?", opcional: true },
      ],
    },
    {
      titulo: "Extra",
      campos: [
        { id: "tem_pet", tipo: "sim_nao", rotulo: "Pet", pergunta: "Tem pet?" },
        { id: "pets", tipo: "grupo", rotulo: "Pets", item: "pet", plural: "pets", pergunta: "Quantos?", min: 1, max: 3, quando: (d) => d.tem_pet === true, campos: [{ id: "nome_pet", tipo: "texto", rotulo: "Nome do pet", pergunta: "Nome do pet?" }] },
        { id: "endereco", tipo: "endereco", rotulo: "Endereço", pergunta: "CEP?" },
      ],
    },
  ],
});

test("cadastro completo: valida, pula opcional, expande grupo e entrega", async () => {
  const t = motorDeTeste({ formularios: [form], pasta, agora });
  let r = await t.dizer("oi");
  assert.match(tudo(r.cliente), /Seu nome\?/);

  r = await t.dizer("123");
  assert.match(tudo(r.cliente), /não parece um nome/);
  assert.match(tudo(r.cliente), /Seu nome\?/, "resposta errada repete a pergunta");

  await t.dizer("ana paula costa");
  r = await t.dizer("111.111.111-11");
  assert.match(tudo(r.cliente), /CPF não é válido/);
  await t.dizer("529.982.247-25");
  r = await t.dizer({ botao: "__pular" });
  assert.match(tudo(r.cliente), /Tem pet\?/);

  await t.dizer({ botao: "__sim" });
  r = await t.dizer("2");
  assert.match(tudo(r.cliente), /Pet 1 de 2/);
  await t.dizer("Rex");
  await t.dizer("Mia");
  r = await t.dizer("01310100");
  assert.match(tudo(r.cliente), /Avenida Paulista/);
  r = await t.dizer("1000");
  assert.match(tudo(r.cliente), /Confira o endereço/);
  r = await t.dizer({ botao: "__ok" });
  assert.match(tudo(r.cliente), /Confira os seus dados/);
  assert.match(tudo(r.cliente), /CPF:\* ••••••/, "sensível mascarado na revisão");

  await t.dizer({ botao: "__enviar" });
  assert.equal(t.entregues.length, 1);
  const d = t.entregues[0].dados;
  assert.equal(d.nome, "Ana Paula Costa");
  assert.equal(d.cpf, "52998224725");
  assert.equal(d.apelido, null);
  assert.deepEqual(d.pets, [{ nome_pet: "Rex" }, { nome_pet: "Mia" }]);
  assert.equal((d.endereco as { cep: string }).cep, "01310100");
});

test("campo sensível nunca vai para o histórico", async () => {
  const t = motorDeTeste({ formularios: [form], pasta, agora });
  await t.dizer("oi");
  await t.dizer("ana paula costa");
  await t.dizer("529.982.247-25");
  const s = await (t.motor as unknown as { o: { armazenamento: { porTelefone(x: string[]): Promise<{ historico: { texto: string }[] }> } } }).o.armazenamento.porTelefone([t.telefone]);
  assert.ok(!JSON.stringify(s.historico).includes("529"), "CPF no histórico");
  assert.ok(JSON.stringify(s.historico).includes("[informação sensível]"));
});

test("voltar desfaz a última resposta", async () => {
  const t = motorDeTeste({ formularios: [form], pasta, agora });
  await t.dizer("oi");
  await t.dizer("ana paula costa");
  const r = await t.dizer("voltar");
  assert.match(tudo(r.cliente), /Seu nome\?/);
});

test("condição: sem pet, o grupo não é perguntado", async () => {
  const dados = { nome: "X Y", cpf: "52998224725", apelido: null, tem_pet: false };
  assert.equal(proximaPergunta(form, dados)?.chave, "endereco");
});

test("com IA: e-mail ditado vira e-mail e o erro de domínio vira sugestão", async () => {
  const f = definirFormulario({
    id: "email",
    nome: "E-mail",
    organizacao: "Teste",
    passos: [{ titulo: "Contato", campos: [{ id: "email", tipo: "email", rotulo: "E-mail", pergunta: "Seu e-mail?" }] }],
  });
  const t = motorDeTeste({ formularios: [f], pasta, agora, chat: iaSimulada });
  await t.dizer("oi");
  let r = await t.dizer("joao ponto silva arroba gmial ponto com");
  assert.match(tudo(r.cliente), /joao\.silva@gmail\.com/);
  r = await t.dizer({ botao: "__usar_sug" });
  assert.match(tudo(r.cliente), /Confira os seus dados/);
});

test("pedido de atendente vai para a equipe e o cadastro continua", async () => {
  const t = motorDeTeste({ formularios: [form], pasta, agora, suporte: "5511900009999" });
  await t.dizer("oi");
  const r = await t.dizer("quero falar com um atendente");
  assert.equal(r.equipe.length, 1);
  assert.match(tudo(r.equipe), /pediu para falar com a equipe/);
  assert.match(tudo(r.cliente), /Seu nome\?/);
});
