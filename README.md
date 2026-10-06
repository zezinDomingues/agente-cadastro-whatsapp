<p align="center"><img src="brand/mark.svg" width="96" alt=""></p>

# Agente de Cadastro pelo WhatsApp

**Qualquer formulário vira uma conversa no WhatsApp.** Você descreve os campos num
arquivo (nome, CPF, e-mail, endereço, escolhas, foto, grupos repetíveis...). O agente
conduz o cliente pergunta a pergunta, com **botões, listas e capas de progresso**,
confere cada resposta antes de gravar e entrega o cadastro pronto à sua aplicação
num **webhook JSON assinado**.

Cadastro de paciente, abertura de conta de SaaS, inscrição em evento, lead de
imobiliária, ficha de matrícula: o motor é o mesmo, só muda o arquivo do formulário.

```bash
npm install
npm run demo        # 3 conversas completas, SEM WhatsApp, SEM chave, SEM rede (comece aqui)
npm run chat        # converse você mesmo com o agente no terminal
npm test            # 11 testes do motor e dos validadores
```

---

## O que ele resolve

Formulário longo no celular é onde o cadastro morre: o cliente abre o link, vê vinte
campos, para no CEP e não volta. Ele já está no WhatsApp, mas cadastro "pelo WhatsApp"
costuma ser uma pessoa digitando o que o cliente manda, ou um bot que aceita qualquer
coisa e entrega dado errado para alguém consertar depois.

Este agente faz as duas coisas que faltam:

- **conversa de verdade**: uma pergunta por vez, botões em vez de "digite 1, 2 ou 3",
  CEP que preenche o endereço sozinho e IA que entende resposta solta
  (_"é maria ponto souza arroba gmail"_);
- **dado certo na entrada**: CPF/CNPJ pelos dígitos verificadores, e-mail com domínio
  conferido no DNS e erro de digitação corrigido (_gmial → gmail_), data que existe,
  CEP que existe nos Correios. **Resposta errada não avança**: o agente diz o que está
  errado e repete a pergunta.

## Como é a conversa

Trecho real do `npm run demo` (formulário `clinica`):

```
🙋 12345
🤖 Isso não parece um nome 🤔. Mande o nome completo, por favor.
   Para começar, qual é o nome completo do paciente?
🙋 maria aparecida souza
🤖 Qual é a data de nascimento? (ex.: 12/03/1990)
🙋 dia 5 de maio de 92                              ← a IA lê; o validador confere
🤖 Qual é o CPF do paciente?
🙋 123.456.789-00
🤖 Esse CPF não é válido 🤔 (os dígitos verificadores não batem). Confira e mande de novo.
🙋 maria ponto souza arroba gmial ponto com
🤖 Você quis dizer maria.souza@gmail.com?   [✅ Sim, corrigir] [Não, está certo]
🙋 01310-100
🤖 Encontrei: Avenida Paulista – Bela Vista, São Paulo/SP 📍
   Qual é o número? Se tiver complemento, mande junto (ex.: 120 apto 32).
🙋 onde acho a carteirinha?                         ← dúvida: a IA responde e o cadastro segue
🤖 ...a foto pode ser da frente do cartão ou do cartão digital no aplicativo do convênio.
   Mande uma foto da carteirinha do convênio (frente) 📸.
```

No fim, a revisão com tudo o que foi respondido, os botões **Enviar** / **Corrigir**
(o cliente escolhe o campo numa lista e só ele é perguntado de novo) e o protocolo.

## Como funciona

```
Sua aplicação ── POST /api/iniciar ──▶ agente ──▶ 1ª mensagem no WhatsApp do cliente
                                         ▲
Cliente responde ─▶ Z-API ─▶ /api/whatsapp/webhook ─▶ motor ─▶ valida ─▶ grava ─▶ responde
                                                        │
                                                        ├─ dúvida ─▶ IA responde com o que o formulário ensina
                                                        ├─ assunto da equipe ─▶ WhatsApp da equipe (+ evento)
                                                        └─ enviado ─▶ POST assinado para a sua aplicação
```

- **O roteiro é do formulário, não da IA.** A próxima pergunta é sempre a primeira
  sem resposta, calculada a partir do que já foi respondido. Por isso "voltar",
  corrigir na revisão e campos condicionais (_"qual convênio?" só se tem convênio_)
  saem de graça, sem máquina de estados escrita à mão.
- **A IA só ajuda, nunca decide.** Ela lê respostas soltas, tira dúvidas com o
  `conhecimento` do formulário e confere se um texto livre é o que se perguntou
  (_"Bar do Zé" como nome de pessoa_). Todo valor que ela devolve passa pela
  **mesma validação** de uma resposta digitada. Sem chave de IA, o cadastro funciona
  do mesmo jeito, só menos tolerante.
- **O que nem a regra nem a IA resolvem vai para uma pessoa.** Pedido de atendente,
  preço/contrato, áudio, foto fora de hora: a mensagem vai para o WhatsApp da equipe
  com nome, telefone e em que pergunta o cliente parou. O cadastro não para.
- **Informação sensível fica fora.** Campo `sensivel` nunca vai para o histórico,
  para a IA nem para a equipe, e aparece mascarado na revisão.

## Escreva o seu formulário

Um arquivo em `formularios/`, registrado em `formularios/index.ts`:

```ts
import { definirFormulario } from "../src/motor/formulario";

export default definirFormulario({
  id: "imobiliaria",
  nome: "Cadastro de interessado",
  organizacao: "Imobiliária Exemplo",
  conhecimento: "Visitas de segunda a sábado, das 9h às 18h. A documentação para locação é...",
  passos: [
    {
      titulo: "Você",
      campos: [
        { id: "nome", tipo: "nome", rotulo: "Nome", pergunta: "Qual é o seu *nome completo*?" },
        { id: "cpf", tipo: "cpf", rotulo: "CPF", pergunta: "Qual é o seu *CPF*?", sensivel: true },
        { id: "renda", tipo: "numero", rotulo: "Renda", pergunta: "Qual a sua *renda mensal*?", min: 0 },
      ],
    },
    {
      titulo: "Imóvel",
      campos: [
        { id: "tipo", tipo: "escolha", rotulo: "Tipo", pergunta: "Procura *casa* ou *apartamento*?",
          opcoes: [{ id: "casa", rotulo: "Casa" }, { id: "apto", rotulo: "Apartamento" }] },
        { id: "quartos", tipo: "numero", rotulo: "Quartos", pergunta: "Quantos *quartos*?", min: 1, max: 6 },
        { id: "regiao", tipo: "endereco", rotulo: "Região", pergunta: "Qual o *CEP* da região que você quer?" },
      ],
    },
  ],
});
```

A definição é conferida na carga: id repetido, tipo desconhecido ou grupo dentro de
grupo dão erro na hora de subir o agente, não no meio de uma conversa.

### Tipos de campo

| tipo | o que confere | como pergunta |
|---|---|---|
| `nome` | nome e sobrenome, sem números; capitaliza ("joão da silva" → "João da Silva") | texto |
| `texto` | tamanho (`min`/`max`); a IA confere se é o que se pediu (`conferirComIa`) | texto |
| `email` | formato, domínio existe (DNS/MX), sugere correção de digitação | texto + botões da sugestão |
| `telefone` | DDD e tamanho; entrega com o 55 | botão **📱 Este número** |
| `cpf` · `cnpj` · `cpf_cnpj` | dígitos verificadores | texto |
| `data` | data que existe; `idadeMinima`, `futura` | texto (aceita "5 de maio de 92") |
| `numero` | `min`, `max`, `inteiro` (aceita "uns vinte" com IA) | texto |
| `escolha` | uma das `opcoes`; `outra` libera texto livre | até 3 → botões; até 10 → lista; mais → lista paginada |
| `sim_nao` | sim/não | botões |
| `endereco` | CEP nos Correios (ViaCEP) ou rua+número no mapa (OpenStreetMap); rua em várias cidades → pergunta qual | CEP → número → confirmação |
| `imagem` | foto recebida, convertida para JPEG ≤ 1600 px | texto |
| `grupo` | "quantos?" (`min`/`max`) e os mesmos `campos` para cada item | botões/lista + perguntas por item |

Em qualquer campo: `opcional` (botão **Pular**, valor `null`), `quando` (só pergunta
se a condição valer), `sensivel`, `ajuda` (contexto para a IA) e `valida` (regra da
sua aplicação, ex.: _e-mail que já tem conta_).

## Integração com a sua aplicação

**Convidar** alguém (ou deixe `CADASTRO_ABERTO=1`: quem escrever para o número começa):

```bash
curl -X POST https://agente/api/iniciar -H "Authorization: Bearer $API_SECRET" \
  -d '{"telefone":"5511988887777","formulario":"clinica","referencia":"paciente-123","dados":{"nome":"Maria Souza"}}'
```

Ele confere antes se o número tem WhatsApp (`404 not_on_whatsapp`, nada é mandado).
`dados` já conhecidos não são perguntados (aparecem na revisão).

**Receber** o cadastro: com `CADASTRO_WEBHOOK_URL`, cada envio chega como

```json
{
  "evento": "cadastro.concluido",
  "cadastro": {
    "protocolo": "20261006-WVK5",
    "formulario": { "id": "clinica", "nome": "Cadastro de paciente" },
    "telefone": "5511988887777",
    "referencia": "paciente-123",
    "dados": {
      "nome": "Maria Aparecida Souza", "nascimento": "1992-05-05", "cpf": "52998224725",
      "endereco": { "cep": "01310100", "rua": "Avenida Paulista", "numero": "1578", "complemento": "apto 52",
                    "bairro": "Bela Vista", "cidade": "São Paulo", "uf": "SP" },
      "carteirinha": { "arquivo": "…/carteirinha.jpg", "tipo": "image/jpeg", "bytes": 48211, "conteudo": "<base64>" }
    },
    "enviadoEm": "2026-10-06T19:21:52.700Z"
  }
}
```

com `X-Assinatura: sha256=<HMAC-SHA256 do corpo>`. Confira assim:

```js
const ok = req.headers["x-assinatura"] === "sha256=" + crypto.createHmac("sha256", SEGREDO).update(corpoBruto).digest("hex");
```

Sem resposta 2xx, ele tenta de novo (1 s, 10 s, 1 min, 5 min) e depois a cada 10 min
a partir de `data/entregas-pendentes/`. O cadastro também fica sempre em
`data/cadastros/<protocolo>.json`. Os encaminhamentos à equipe chegam como evento
`cadastro.suporte`, para abrir chamado se quiser.

**Avisar** o cliente depois (ex.: aprovado): `POST /api/avisar {"referencia":"paciente-123","mensagem":"..."}`.

## Robustez

- **Escada de reserva no WhatsApp:** botões com capa → carrossel de 1 cartão → texto
  com opções numeradas. O cliente que só vê texto responde "2" e vale igual ao toque.
- **Uma conversa por vez por telefone** (fila): duas mensagens seguidas não gravam em
  paralelo. Webhook reentregue pela Z-API é ignorado pelo `messageId`.
- **Vigia de entrega:** aceitar o envio não prova nada. A primeira mensagem a cada
  cliente e todo encaminhamento à equipe ficam pendentes até o status **RECEIVED**;
  sem ele em 3 min, sai uma nova tentativa e o responsável recebe o alarme. A conexão
  da instância é conferida a cada 2 min (`/health`).
- **Reiniciar não perde conversa:** cada sessão é um JSON gravado de forma atômica em
  `data/sessoes/`. Para Postgres/Redis, implemente as 4 funções de `Armazenamento`.
- **Celular brasileiro sem o 9:** o WhatsApp às vezes identifica 5511 8888-7777 em vez
  de 5511 98888-7777; a sessão é achada pelas duas formas.

## IA

Qualquer API compatível com a da OpenAI (`/chat/completions`): NVIDIA NIM (padrão,
`nvidia/nemotron-3-super-120b-a12b`, tem cota gratuita), OpenAI, OpenRouter, Groq, um
Ollama/vLLM local. `LLM_API_KEYS` aceita várias chaves: a que tomar 429 fica de castigo
60 s e a próxima assume na hora, porque numa conversa não dá para esperar.

O `npm run demo` usa uma **IA simulada** (determinística, `demo/falsos.ts`) para rodar
sem chave; com `LLM_API_KEYS` no `.env`, usa o modelo de verdade.

## Instalar

Precisa de **Node 20+** e de uma instância da [Z-API](https://z-api.io) (WhatsApp Web).

```bash
cp .env.example .env              # preencha Z-API, segredos e (opcional) IA e webhook
scripts/instalar-servico.sh       # systemd --user, restart automático, sobrevive ao logout
```

A Z-API só entrega webhook em **HTTPS**: ponha na frente um túnel (Cloudflare Tunnel)
ou proxy (Caddy, Nginx) apontando para `127.0.0.1:3210` e rode

```bash
scripts/apontar-webhook.sh https://cadastro.seudominio.com
```

Teste sem mandar nada: `ZAPI_DRY_RUN=1` (tudo vai só para o log) ou
`ZAPI_DRY_RUN_PREFIX=5511900000` (só números falsos).

| Rota | Quem chama | Autorização |
|---|---|---|
| `GET /health` | monitoramento | — |
| `POST /api/whatsapp/webhook?secret=…` | Z-API (ao receber) | `WHATSAPP_WEBHOOK_SECRET` |
| `POST /api/whatsapp/status?secret=…` | Z-API (status da mensagem) | `WHATSAPP_WEBHOOK_SECRET` |
| `POST /api/iniciar` | sua aplicação | `Bearer API_SECRET` |
| `POST /api/avisar` | sua aplicação | `Bearer API_SECRET` |

## Estrutura

```
formularios/          os cadastros (clinica, conta-empresa, evento) — escreva o seu aqui
src/motor/            formulario.ts (definição + roteiro), motor.ts (a conversa), valores.ts, saida.ts
src/validadores/      CPF/CNPJ, data, telefone, número, nome, e-mail (formato, DNS, sugestão)
src/endereco/         ViaCEP + OpenStreetMap (Nominatim/Photon): rua+número → bairro, cidade, CEP
src/ia/               cliente LLM com anel de chaves + as duas leituras que a IA faz
src/canais/           Z-API (botões, listas, carrossel, imagem), capa de progresso, canal em memória
src/armazenamento/    sessões em arquivo JSON (ou memória); interface para o seu banco
src/entrega.ts        webhook assinado com novas tentativas
src/vigia.ts          confirmação de entrega e conexão da instância
demo/                 demo sem rede, chat no terminal, IA simulada
test/                 node:test
```

## Limites conhecidos

- Os botões `send-button-actions` são a versão beta da Z-API e precisam ser ligados no
  painel da instância. Sem eles (`ZAPI_BOTOES=0`), as perguntas com botões saem como
  carrossel de um cartão, que funciona em qualquer instância.
- Endereço com busca por CEP e UF é do Brasil. Fora dele, use um campo `texto`.
- Áudio não é transcrito: vai para a equipe.

## Licença

MIT.
