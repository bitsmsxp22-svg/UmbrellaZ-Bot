# Logo Studio: gerador de logos em SVG

O cliente descreve a logo (e, se quiser, envia até 3 imagens de referência) e recebe **5 opções diferentes em SVG vetorial**, com download em SVG e PNG (2048 px).

Os modelos de criação são sempre os mesmos: **GPT-5.6 Sol** (direção de arte) e **GPT Image 2** (imagens, qualidade `high`). O visitante não faz login nem vê nenhuma tela de terceiros.

## Custo zero: como funciona e quanto rende

Por padrão, tudo roda **no servidor**, usando a **cota grátis** de uma conta Pollinations. Não há cartão nem cobrança: a conta recebe pollen grátis que recarrega sozinho. Quando a cota acaba, o cliente vê *"Agenda de criação cheia no momento. Tente novamente a partir das HH:MM"* até a próxima recarga.

O limite é este: a cota grátis é pequena, e o GPT Image 2 em qualidade premium é o modelo mais caro. Estimativa por pedido de 5 logos:

| Qualidade (`IMAGE_QUALITY`) | Custo por pedido | Conta **Seed** (0,15 pollen/hora, grátis) | Conta Spore (conta nova, 0,01/hora) |
|---|---|---|---|
| `high` (padrão, premium) | ~0,53 pollen | ~1 pedido a cada 3,5 h (~7/dia) | inviável |
| `medium` | ~0,16 pollen | ~1 pedido por hora (~22/dia) | inviável |
| `low` | ~0,07 pollen | ~2 pedidos por hora (~48/dia) | ~1 a cada 7 h |

- Os números são estimativas conservadoras. O rendimento real depende de como o Pollinations desconta o saldo que fica negativo depois de um pedido grande.
- A conta sobe para **Seed** sozinha, conforme a atividade da conta do GitHub (8 "pontos de dev": idade da conta, commits, repositórios, estrelas).
- O nível **Flower** (10 pollen/dia) exige código aberto e o selo "Powered by Pollinations" visível. Não é compatível com esconder a fonte.
- O próprio Pollinations diz que a cota grátis é para uso leve, não para produção.

Para mais volume, as alternativas são:
- **Comprar pollen** (1 pollen ≈ US$ 1). `DAILY_BUDGET` limita o gasto por dia.
- **Ligar a cota do visitante** (`CLIENT_FALLBACK=puter`). Fica grátis para você, mas o visitante vê uma tela de acesso do Puter, então não é indicado para uso comercial.

## Testar rápido

1. Instale o **Node.js 22 ou mais novo**: <https://nodejs.org> (botão LTS).
2. Baixe e extraia o projeto. Entre na pasta `logo-studio`.
3. **Windows:** dê dois cliques em `iniciar.bat`. **Mac/Linux:** rode `./iniciar.sh`.
4. O navegador abre em <http://localhost:3000>. Na primeira vez a instalação leva 1 a 2 minutos.

Sem chave do Pollinations no `.env`, o app roda em **modo simulado** (logos de teste, não de IA), só para conferir a interface.

## Rodar localmente

Requisito: **Node.js 22 ou mais novo**. Funciona no Windows, Linux e macOS.

```bash
cd logo-studio
npm install
cp .env.example .env        # no Windows: copy .env.example .env
npm run dev
```

Abra <http://localhost:3000>. Sem chave, as logos são simuladas. Para logos reais, siga o passo abaixo.

### Ativar a cota grátis (necessário para logos reais)

1. Entre em <https://enter.pollinations.ai> com o GitHub e crie uma **Secret key** (`sk_...`) em *Keys*. Não precisa de cartão.
2. Coloque a chave em `POLLINATIONS_API_KEY` no `.env`.
3. A conta começa no nível **Spore**. Ela sobe sozinha para **Seed** quando a conta do GitHub soma 8 "pontos de dev": idade da conta, commits, repositórios e estrelas.
4. Para o servidor ler o saldo e trocar de camada antes de esgotar, dê à chave a permissão `account:usage`. Sem ela, a troca acontece no primeiro erro de cota esgotada.

A chave fica **somente no servidor**. O navegador nunca a recebe.

Para simular a cota acabando depois de N imagens: `PROVIDER=mock` e `MOCK_QUOTA=2`.

## Produção (24/7)

### Build

```bash
npm ci
npm run build     # gera dist/public (JS/CSS minificados, sem comentários, sem source maps)
npm test
```

### Opção A: PM2 + nginx (recomendado para VPS/Plesk com SSH)

```bash
npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup       # executa o comando que ele imprimir: o app volta sozinho após reboot
```

O PM2 reinicia o app se ele cair ou passar de 800 MB de memória. Use **1 instância**, porque a fila e os resultados ficam na memória.

No **Plesk**, crie um subdomínio (ex.: `logos.seusite.com.br`). Em *Apache e nginx › Diretivas adicionais do nginx*, cole:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 30m;   # upload de até 3 imagens de 8 MB
    proxy_read_timeout 120s;
}
```

Use um **subdomínio** para não conflitar com a CSP do site principal. Para embutir o app numa página do seu site via `<iframe>`, defina `FRAME_ANCESTORS=https://seusite.com.br`.

### Opção B: Docker

```bash
docker compose up -d --build
```

O container tem `restart: unless-stopped` e healthcheck em `/healthz`. Aponte o nginx para `127.0.0.1:3000` como na opção A.

### Monitoramento

`GET /healthz` devolve `{ ok, uptime, running, queued }` e pode ser usado no UptimeRobot, no workflow `production-monitor` do site etc.

## O que fica escondido

- **Chave, provedor, modelos e prompts** ficam só no servidor. O navegador fala apenas com `/api/*`, e as respostas não citam GPT, OpenAI ou Pollinations (há teste automatizado para isso).
- **Código do servidor** (`src/`), `.env`, `package.json` e `node_modules` não são servidos (404). Só `dist/public` é público.
- **Front-end** minificado, com nomes de arquivo com hash e sem source maps.
- **Erros** chegam ao cliente como mensagens genéricas em português. Os detalhes vão só para o log do servidor.
- **SVGs** limpos: sem comentários ou assinatura do gerador, sanitizados (sem scripts, links ou eventos).
- **Repositório:** deixe o repositório do GitHub **privado**. Hoje o `UmbrellaZ-Bot` é público.

Se você ligar a cota do visitante (`CLIENT_FALLBACK=puter`), a geração passa a rodar no navegador: aparece a tela de acesso do Puter, e os prompts e modelos ficam visíveis nas ferramentas de desenvolvedor.

## Proteções e limites (ajustáveis no `.env`)

| Variável | Padrão | Para quê |
|---|---|---|
| `IMAGE_QUALITY` | `high` | qualidade do GPT Image 2 (`low`/`medium`/`high`): quanto maior, menos pedidos grátis |
| `DAILY_BUDGET` | 0 (sem teto) | teto de gasto por dia em pollen, se você comprar créditos |
| `PLAN_B_SVG` | off | se a imagem falhar, o GPT-5.6 Sol desenha o SVG à mão (qualidade inferior) |
| `POLLEN_REFILL` | `hourly` | recarga da cota grátis (`hourly` para Spore/Seed, `daily` para Flower) |
| `CLIENT_FALLBACK` | `off` | `puter` liga a cota do visitante (mostra a tela de acesso do Puter) |
| `IMAGE_RPM` | 6 | limite do Pollinations para o GPT Image 2 (imagens/minuto) |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | 6 por hora por IP | evita abuso |
| `MAX_CONCURRENT_JOBS` | 2 | pedidos processados ao mesmo tempo no servidor |
| `MAX_QUEUED_JOBS` | 20 | fila máxima (acima disso: "tente em 1 minuto") |
| `JOB_TIMEOUT_MS` | 8 min | um pedido travado nunca bloqueia a fila |
| `UPLOAD_MAX_FILES` / `UPLOAD_MAX_MB` | 3 / 8 MB | imagens de referência (validadas e sem metadados) |
| `SAMPLES` | 5 | número de opções por pedido |

Os resultados ficam disponíveis por 1 hora (`JOB_TTL_MS`). O cliente deve baixar as logos nesse período.

## Estrutura

```
src/server.js        inicialização, desligamento gracioso, reinício seguro
src/app.js           rotas HTTP, upload, segurança (helmet/CSP), limites
src/jobs.js          fila, escolha da cota (servidor ou visitante), pipeline das 5 amostras
src/budget.js        controle da cota grátis do servidor (saldo, recarga)
src/director.js      prompts do GPT-5.6 Sol (conceitos e plano B em SVG)
src/vectorize.js     imagem → SVG em 2048 px (fundo, cores, traçado, otimização)
src/fetch-image.js   download seguro (anti-SSRF) de imagens geradas no navegador
src/sanitize.js      sanitização de SVG
src/providers/       Pollinations/OpenAI (formato OpenAI) e simulado
public/              interface (fonte); dist/public é a versão de produção
test/                testes (npm test)
```
