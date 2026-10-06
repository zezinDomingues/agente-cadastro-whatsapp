import { localizar } from "./endereco/endereco";
import { consultarCep } from "./endereco/viacep";
import type { Servicos } from "./motor/motor";
import { downloadMedia } from "./canais/zapi";
import { conferirEmail } from "./validadores/email";

/** Os serviços de verdade: ViaCEP, OpenStreetMap, DNS do e-mail e a mídia da Z-API. */
export const servicosReais: Servicos = {
  cep: consultarCep,
  localizar,
  conferirEmail,
  baixarImagem: (url) => downloadMedia(url),
};
