import type { Saida } from "../motor/saida";
import { textoDe } from "../motor/saida";
import type { Canal } from "./canal";
import { capaJpeg } from "./capa";
import { sendButtonActions, sendCarousel, sendImage, sendOptionList, sendText } from "./zapi";

/**
 * WhatsApp pela Z-API, com uma escada de reservas: cada mensagem interativa
 * tenta o formato mais rico e, se a Z-API recusar, desce um degrau, até o
 * texto com as opções numeradas (que o cliente responde digitando "2" — o
 * motor entende igual ao toque no botão). Ninguém fica sem pergunta.
 *
 *   botões de ação (title/footer/imagem)  →  carrossel de 1 cartão  →  texto
 *   lista de opções                        →  texto
 *   capa + pergunta de texto               →  texto
 *
 * Os "botões de ação" (`send-button-actions`) são a versão beta dos botões da
 * Z-API, ligada no painel da instância; `ZAPI_BOTOES=0` pula direto para o
 * carrossel, que funciona em qualquer instância.
 */
export class CanalWhatsApp implements Canal {
  private botoesAtivos(): boolean {
    return process.env.ZAPI_BOTOES?.trim() !== "0";
  }

  async enviar(telefone: string, o: Saida): Promise<string | undefined> {
    try {
      if (o.tipo === "texto") {
        if (o.capa) return await sendImage(telefone, await capaJpeg(o.capa), o.texto);
        return await sendText(telefone, o.texto);
      }
      if (o.tipo === "lista") {
        const texto = o.rodape ? `${o.texto}\n\n_${o.rodape}_` : o.texto;
        return await sendOptionList(telefone, texto, {
          title: o.titulo,
          buttonLabel: o.botao,
          options: o.itens.map((i) => ({ id: i.id, title: i.titulo.slice(0, 24), description: i.descricao?.slice(0, 72) })),
        });
      }
      const image = o.capa ? await capaJpeg(o.capa) : undefined;
      if (this.botoesAtivos()) {
        try {
          const alvo =
            o.tipo === "botoes"
              ? { reply: o.botoes.map((b) => ({ id: b.id, label: b.rotulo })) }
              : { links: o.links.map((l) => ({ label: l.rotulo, url: l.url })) };
          return await sendButtonActions(telefone, o.texto, alvo, { title: o.titulo, footer: o.rodape, image });
        } catch (e) {
          console.error("[whatsapp] botões de ação recusados, descendo um degrau:", e);
        }
      }
      // Link sem os botões novos: vai no texto, que o WhatsApp deixa clicável.
      if (o.tipo === "links") return await sendText(telefone, textoDe(o));
      const texto = o.titulo ? `*${o.titulo}*\n${o.texto}` : o.texto;
      const cartao = image ?? (await capaJpeg({ marca: o.titulo ?? "", titulo: o.titulo ?? "Cadastro", subtitulo: o.rodape ?? "", passos: [], atual: 0 }));
      return await sendCarousel(telefone, texto, [
        { text: o.titulo ?? "Cadastro", image: cartao, buttons: o.botoes.map((b) => ({ id: b.id, label: b.rotulo })) },
      ]);
    } catch (e) {
      // Interativo recusado: o texto numerado. As respostas digitadas valem igual.
      if (o.tipo === "texto" && !o.capa) throw e;
      console.error("[whatsapp] interativo recusado, mandando texto:", e);
      return sendText(telefone, textoDe(o));
    }
  }
}
