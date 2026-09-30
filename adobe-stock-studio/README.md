# Stock Studio: produção automática para o Adobe Stock

Sistema web em **Astro** que roda **no seu computador** (`http://127.0.0.1:4321`). Você aperta **▶ Ligar produção** e ele trabalha sozinho, o dia inteiro se você quiser:

1. **Pesquisa as mais vendidas.** Abre a busca do Adobe Stock ordenada por *mais baixadas* em cada nicho e em datas sazonais próximas (Halloween, Natal…), lê títulos e palavras-chave das campeãs e monta um ranking.
2. **Desenvolve os prompts pelo ranking.** O **ChatGPT, sem login**, recebe as referências mais baixadas e cria conceitos melhores e originais: prompt, título, palavras-chave e categoria.
3. **Gera as imagens com GPT Image 2, sem login e sem API.** Usa em rodízio os sites gratuitos que oferecem GPT Image 2. Quando o limite grátis de um acaba, passa para o próximo.
4. **Amplia com IA.** O **Real-ESRGAN x4** roda na sua placa de vídeo e leva a imagem para 6000×4000 px (24 MP), em JPEG sRGB, no padrão do Adobe.
5. **Cria o CSV** do lote no formato oficial (`Filename, Title, Keywords, Category, Releases`).
6. **Envia ao Adobe Stock** pelo portal do colaborador: imagens + CSV, marca **"Criado com ferramentas de IA generativa"** e **"Pessoas e propriedades fictícias"** e envia para revisão.
7. **Registra o log e limpa o desktop.** Grava tudo o que foi enviado (miniatura, título, palavras-chave, prompt, origem) e apaga as imagens da Área de Trabalho.

O painel mostra o status ao vivo: etapa atual, imagem sendo produzida, lote, contadores, ranking e log. Tem botão para **ligar** e para **parar**.

---

## Instalação (uma vez)

Requisitos:
- **Node.js 22.12 ou mais novo** ([nodejs.org](https://nodejs.org));
- **Google Chrome** instalado;
- uma placa de vídeo com **Vulkan** para o Real-ESRGAN. Quase qualquer placa dos últimos anos serve, inclusive as integradas Intel/AMD e os Macs com chip Apple.

**Pacote pronto para Windows (tudo dentro, sem instalar nada além do Chrome):** 4 partes `StockStudio-parte-1..4.zip`, geradas por `scripts/empacotar-windows.sh`. Traz Node.js portátil, dependências de Windows, o painel já compilado e o Real-ESRGAN. Extraia a parte 1, dê dois cliques em `iniciar.bat` e, na primeira vez, ele encontra as outras partes (em Downloads ou ao lado da pasta), monta tudo e confere as assinaturas SHA-256. Veja o `COMO USAR.txt` que vem dentro do pacote.

A partir do código:
- **Windows:** dê dois cliques em `iniciar.bat`.
- **macOS/Linux:** rode `./iniciar.sh`.

Na primeira vez o script instala as dependências. Depois ele abre o painel no navegador. O Real-ESRGAN é baixado automaticamente quando você liga a produção pela primeira vez; se preferir, use o botão *Instalar Real-ESRGAN* em Configurações.

> Sem o Chrome instalado, rode `npm run setup:browser` para usar o Chromium do Playwright.

---

## Como configurar o Adobe Stock

O Adobe Stock é **o único login do sistema**, porque as imagens vão para a **sua** conta. Não precisa de FTP nem de API: o envio é feito pelo próprio site do portal (botões *Upload* e *Upload CSV*), do mesmo jeito que você faria à mão.

1. **Conta de colaborador.** Se ainda não tiver, crie grátis em [contributor.stock.adobe.com](https://contributor.stock.adobe.com/) com seu Adobe ID, aceite os termos de colaborador e preencha os dados de pagamento e impostos.
2. **Login no navegador do sistema.** No painel, vá em **Configurações → Abrir navegador** e entre na sua conta de colaborador na janela que abrir. O login fica salvo em `data/browser-profile`.
   - *Por que não usar o Chrome em que você já está logado?* Desde a versão 136, o Chrome **bloqueia** qualquer programa de controlar o seu perfil principal. É uma proteção contra roubo de sessão. Por isso o sistema usa o mesmo Chrome instalado, com um perfil próprio, e você entra uma única vez nele.
   - Se o login com Google recusar a janela automatizada, entre com e-mail e senha do Adobe ID.
3. **Teste.** Em **Configurações → Testar conexão com o Adobe Stock**, deve aparecer *"Conectado"*.
4. **Opções** (Configurações → 6):
   - *Enviar para revisão automaticamente* (ligado por padrão). Desligado, os arquivos ficam na aba *Novos* com os metadados do CSV para você revisar antes.
   - *Espera após o CSV*: tempo para o portal aplicar títulos e palavras-chave antes do envio para revisão.

O que o sistema já faz para seguir as regras do Adobe ([diretrizes de IA generativa](https://helpx.adobe.com/stock/contributor/submit-your-content/submit-generative-ai-content/generative-ai-content-guidelines.html) e [CSV](https://helpx.adobe.com/stock/contributor/manage-your-portfolio/create-csv-file.html)):
- marca sempre *"Criado com ferramentas de IA generativa"*. Se essa opção não for encontrada, ele **não** envia para revisão;
- nome de arquivo com no máximo **30 caracteres**;
- título com até **70 caracteres, sem vírgulas** e sem "AI/generative";
- até **49 palavras-chave**, na ordem de relevância;
- remove marcas, personagens e nomes de ferramentas dos prompts e metadados;
- pede ao ChatGPT pessoas fictícias, sem texto, sem logos, sem artistas e sem propriedades reconhecíveis;
- envia as imagens em grupos de até 20 (o portal costuma travar com mais de uma vez).

O Adobe também tem um **limite semanal de envios para revisão**, que varia por conta. Quando ele aparece, as imagens ficam na aba *Novos* com os metadados, e você envia depois.

---

## Funcionando o dia inteiro

- **Rodízio de sites GPT Image 2.** Cada site grátis tem um limite diário. Quando um avisa que acabou ou passa a pedir cadastro, ele é pausado (12 h por padrão; 7 dias se pedir login) e o próximo assume. A situação de cada site aparece em Configurações.
- **Todos os limites esgotados?** O que já está pronto é enviado. A produção **continua ligada**, espera o primeiro site liberar e volta sozinha.
- **Login do Adobe expirou?** A produção não desliga: o lote fica guardado no desktop e o envio é tentado de novo a cada 10 min até você entrar na conta.
- **Parou no meio (botão, queda de energia, travamento)?** Cada lote tem um manifesto (`lote.json`). Ao ligar de novo, o sistema retoma de onde parou, sem refazer imagens e sem reenviar o que já está no portal.
- **O computador não dorme** enquanto a produção está ligada (opção em Configurações). O navegador é reiniciado a cada lote para não acumular memória.

Quantas imagens por dia saem depende da soma dos limites gratuitos dos sites da lista. Esses limites **não são burlados**: sem troca de IP e sem resolver captcha. Para produzir mais, acrescente mais sites à lista em Configurações.

---

## Sites de GPT Image 2 gratuitos (pesquisa de set/2026)

Pesquisados em inglês, português, espanhol, chinês, japonês e russo. Todos anunciam GPT Image 2 **sem cadastro e sem chave de API**. A lista é editável:

`imagegpt2.com` · `minigpt.org/gpt-image-2` · `aifreeforever.com/image-generators/gpt-image-2` · `photogpt.io/ai-models/gpt-image-2` · `visualgpt.io/ai-models/gpt-image-2` · `notegpt.io/gpt-image-2` · `freeimgen.com/gpt-image-2` · `flyne.ai/free-gpt-image-2` · `toolxox.com/gpt-image-generator.php` · `chat4o.ai/free-gpt-image-2` · `gptimage.com` · `easemate.ai/gpt-2-ai-image-generator` · `gptimage2ai.com` · `aitryon.art/free-gpt-image-2`

Pontos importantes:
- O sistema opera esses sites pelo navegador com heurísticas genéricas: acha o campo do prompt, o botão "Generate/Gerar", a imagem nova e a baixa. Se um site mudar o layout, dá para ajustar em **Configurações → Seletores avançados** com as chaves `site.<domínio>.prompt`, `site.<domínio>.generate` e `site.<domínio>.image`.
- Os sites dizem que as imagens seguem a política de uso da OpenAI, que permite uso comercial. Mesmo assim, confira os termos de cada site antes de vender, porque a responsabilidade pelo envio ao Adobe é do colaborador.
- `freegpt.im` também aparece nas buscas, mas anuncia "GPT Image 2.5" e por isso ficou fora da lista padrão.

---

## Onde ficam os arquivos

| O quê | Onde |
|---|---|
| Lotes em produção (imagens, CSV, manifesto) | `Área de Trabalho/AdobeStock-Producao/lote-AAAAMMDD-hhmmss/`, apagados após o envio |
| Log de envios (tudo o que foi enviado) | `data/logs/envios.jsonl`, também em **Histórico** no painel e para baixar em CSV |
| Log de atividade | `data/logs/atividade-AAAA-MM-DD.log` |
| CSVs enviados | `data/csv/` |
| Miniaturas | `data/thumbs/` |
| Configurações | `data/settings.json` |
| Perfil do navegador (login do Adobe) | `data/browser-profile/` |
| Real-ESRGAN | `tools/realesrgan/` |

---

## Modo simulação

Em Configurações, o **modo simulação** roda o fluxo inteiro sem gerar nada de verdade e sem enviar ao Adobe: imagens abstratas locais, ampliação, CSV, log e limpeza. Serve só para conhecer o painel. **Desligue para produzir.**

## Desenvolvimento

```bash
npm install
npm run dev          # painel em modo desenvolvimento
npm test             # testes (CSV, metadados, ranking, sazonais, nomes de arquivo, ampliação…)
npm run check        # checagem de tipos
npm run build && npm start
```

Estrutura principal (`src/lib`):
- `engine.ts`: motor de produção (etapas, retomada, pausas, status ao vivo);
- `research.ts`, `trends.ts`, `seasonal.ts`: pesquisa das mais vendidas e ranking;
- `prompts.ts`, `chatgpt.ts`: prompts pelo ranking (ChatGPT sem login, com gerador local de reserva);
- `providers/free-sites.ts`, `providers/web-helpers.ts`: GPT Image 2 nos sites gratuitos, em rodízio;
- `upscale.ts`, `realesrgan-install.ts`: ampliação com Real-ESRGAN;
- `csv.ts`, `metadata.ts`, `categories.ts`: CSV e regras de metadados do Adobe;
- `adobe.ts`: envio pelo portal do colaborador;
- `history.ts`: log de envios.

O painel só aceita acessos do próprio computador (`localhost`).
