import assert from "node:assert/strict";
import { test } from "node:test";
import { cnpjValido, conferirData, conferirNome, conferirNumero, conferirTelefone, cpfValido, lerData } from "../src/validadores/basicos";
import { normalizarEmail, sugerirDominio } from "../src/validadores/email";
import { compactar, texto, type Saida } from "../src/motor/saida";

test("CPF e CNPJ pelos dígitos verificadores", () => {
  assert.ok(cpfValido("529.982.247-25"));
  assert.ok(!cpfValido("123.456.789-00"));
  assert.ok(!cpfValido("111.111.111-11"));
  assert.ok(cnpjValido("11.222.333/0001-81"));
  assert.ok(!cnpjValido("11.222.333/0001-80"));
});

test("datas em vários formatos", () => {
  const hoje = new Date(2026, 9, 6);
  assert.equal(lerData("12/03/1990", hoje), "1990-03-12");
  assert.equal(lerData("5 de maio de 92", hoje), "1992-05-05");
  assert.equal(lerData("31/02/2000", hoje), null);
  assert.ok(!conferirData("01/01/2030", {}, hoje).ok, "nascimento no futuro");
  assert.ok(conferirData("01/01/2030", { futura: true }, hoje).ok);
  assert.ok(!conferirData("01/01/2015", { idadeMinima: 18 }, hoje).ok);
});

test("nome, telefone e número", () => {
  assert.deepEqual(conferirNome("maria da silva"), { ok: true, valor: "Maria da Silva" });
  assert.ok(!conferirNome("maria").ok, "só o primeiro nome");
  assert.ok(!conferirNome("rua 7").ok);
  assert.deepEqual(conferirTelefone("(11) 98888-7777"), { ok: true, valor: "5511988887777" });
  assert.ok(!conferirTelefone("98888-7777").ok, "sem DDD");
  assert.deepEqual(conferirNumero("uns 20", { min: 1 }), { ok: true, valor: 20 });
  assert.ok(!conferirNumero("7", { max: 5 }).ok);
});

test("e-mail: normalização e sugestão de domínio", () => {
  assert.equal(normalizarEmail(" Joao@Gmail,com. "), "joao@gmail.com");
  assert.equal(sugerirDominio("gmial.com"), "gmail.com");
  assert.equal(sugerirDominio("hotmail.con"), "hotmail.com");
  assert.equal(sugerirDominio("gmail.com"), null);
});

test("compactar junta textos seguidos e o texto antes da pergunta", () => {
  const out: Saida[] = [texto("a"), texto("b"), { tipo: "botoes", texto: "c", botoes: [{ id: "x", rotulo: "X" }] }];
  compactar(out);
  assert.equal(out.length, 1);
  assert.equal(out[0].texto, "a\n\nb\n\nc");
});
