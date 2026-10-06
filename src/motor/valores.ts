import { formatarCnpj, formatarCpf, formatarData, formatarTelefone } from "../validadores/basicos";
import type { Campo, CampoGrupo, Registro } from "./formulario";

/** Endereço como é entregue à sua aplicação (no Brasil, nomes oficiais dos Correios). */
export interface Endereco {
  cep: string;
  rua: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
}

/** Foto recebida: guardada em disco (`arquivo`, relativo à pasta de arquivos), entregue em base64. */
export interface Arquivo {
  arquivo: string;
  tipo: string;
  bytes: number;
}

export function enderecoEscrito(e: Endereco): string {
  const linha1 = [e.rua, e.numero].filter(Boolean).join(", ") + (e.complemento ? ` – ${e.complemento}` : "");
  const linha2 = [e.bairro, [e.cidade, e.uf].filter(Boolean).join("/")].filter(Boolean).join(" – ");
  const cep = e.cep ? `CEP ${e.cep.slice(0, 5)}-${e.cep.slice(5)}` : "";
  return [linha1, linha2, cep].filter(Boolean).join("\n");
}

/** O valor como aparece na revisão. */
export function valorEscrito(campo: Campo, valor: unknown, outra?: unknown): string {
  if (valor === null) return "_(pulado)_";
  if (campo.sensivel) return "••••••";
  switch (campo.tipo) {
    case "cpf":
      return formatarCpf(String(valor));
    case "cnpj":
      return formatarCnpj(String(valor));
    case "cpf_cnpj":
      return String(valor).length === 11 ? formatarCpf(String(valor)) : formatarCnpj(String(valor));
    case "telefone":
      return formatarTelefone(String(valor));
    case "data":
      return formatarData(String(valor));
    case "sim_nao":
      return valor ? "Sim" : "Não";
    case "escolha": {
      if (valor === "outra") return String(outra ?? "Outra");
      return campo.opcoes.find((o) => o.id === valor)?.rotulo ?? String(valor);
    }
    case "endereco":
      return enderecoEscrito(valor as Endereco).replace(/\n/g, ", ");
    case "imagem":
      return "📎 foto recebida";
    case "grupo":
      return String((valor as unknown[]).length);
    default:
      return String(valor);
  }
}

/** Resumo de um grupo para a revisão: uma linha por item. */
export function grupoEscrito(g: CampoGrupo, itens: Registro[]): string {
  if (!itens.length) return "nenhum";
  return itens
    .map((item, i) => {
      const partes = g.campos
        .filter((c) => item[c.id] !== undefined && item[c.id] !== null)
        .map((c) => valorEscrito(c, item[c.id], item[`${c.id}_outra`]));
      return `   ${i + 1}. ${partes.join(" · ")}`;
    })
    .join("\n");
}

/** O que o campo pede, em palavras: vai para a IA. */
export function oQuePede(campo: Campo): string {
  const r = campo.rotulo.toLowerCase();
  switch (campo.tipo) {
    case "nome":
      return `${r} (nome completo de uma pessoa)`;
    case "email":
      return `${r} (endereço de e-mail)`;
    case "telefone":
      return `${r} (telefone com DDD; valor só com dígitos)`;
    case "cpf":
      return `${r} (CPF, 11 dígitos; valor só com dígitos)`;
    case "cnpj":
      return `${r} (CNPJ, 14 dígitos; valor só com dígitos)`;
    case "cpf_cnpj":
      return `${r} (CPF ou CNPJ; valor só com dígitos)`;
    case "data":
      return `${r} (uma data; valor no formato DD/MM/AAAA)`;
    case "numero":
      return `${r} (um número; valor só com o número)`;
    case "sim_nao":
      return `${r} (sim ou não; valor "sim" ou "nao")`;
    case "escolha":
      return (
        `${r}: uma destas opções (valor = o id da opção): ` +
        campo.opcoes.map((o) => `${o.id} = ${o.rotulo}${o.descricao ? ` (${o.descricao})` : ""}`).join("; ") +
        (campo.outra ? `; se não for nenhuma, valor = o que o cliente escreveu` : "")
      );
    case "endereco":
      return `${r} (CEP, ou rua e número)`;
    case "imagem":
      return `${r} (uma foto; texto não serve como valor)`;
    case "grupo":
      return `quantos ${campo.plural} (um número de ${campo.min ?? 0} a ${campo.max})`;
    default:
      return r;
  }
}
