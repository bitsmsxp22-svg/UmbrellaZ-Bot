# Logo Studio: gerador de logos em SVG

O cliente descreve a logo (e, se quiser, envia até 3 imagens de referência) e recebe **5 opções diferentes em SVG vetorial**, com download em SVG e PNG (2048 px).

Os modelos de criação são sempre os mesmos: **GPT-5.6 Sol** (conceitos) e **GPT Image 2** (imagens). **Custo zero para o dono do site.**

## Custo zero: como funciona

O app combina duas cotas gratuitas, sempre com os mesmos dois modelos:

| Camada | Quem paga | O visitante vê | Quando é usada |
|---|---|---|---|
| **1. Cota grátis do servidor** (Pollinations) | ninguém: a conta grátis recarrega sozinha | nada: roda escondido no servidor | enquanto houver saldo |
| **2. Cota grátis do visitante** ([Puter.js](https://docs.puter.com/user-pays-model/), modelo "User-Pays") | ninguém: cada visitante tem uma cota mensal grátis própria | uma janela rápida do Puter no 1º uso (conta temporária, sem cadastro) | quando a cota do servidor acaba, ou se você não configurar chave |

A troca entre as camadas é automática:

- Antes de aceitar um pedido, o servidor consulta o saldo.
- Se a cota acabar no meio de um pedido, as logos que faltam são terminadas no navegador do visitante (botão "Continuar geração").
- Quando a cota do servidor recarrega, os pedidos voltam a rodar no servidor.

Nas duas camadas, a **vetorização em SVG roda no seu servidor**.

```
                     ┌─ cota do servidor OK ─► GPT-5.6 Sol + GPT Image 2 (Pollinations, no servidor)
Pedido ─► servidor ──┤                                                                         ├─► vetorização ─► SVG
                     └─ cota esgotada ───────► GPT-5.6 Sol + GPT Image 2 (Puter, no navegador) ┘   (no servidor)
```

### Quanto rende de graça

Valores estimados com a qualidade padrão `low`. O SVG final é vetorizado, então a diferença visual para `medium` é pequena.

| Conta Pollinations | Cota grátis | Pedidos de 5 logos no servidor |
|---|---|---|
| sem chave | — | 0 (tudo pela cota do visitante) |
| Spore (conta nova) | 0,01 pollen/hora | praticamente 0 |
| **Seed** (automático pela atividade no GitHub) | 0,15 pollen/hora | **~2 por hora (~48/dia)** |
| Flower (10 pollen/dia) | ⚠️ exige código aberto e o selo "Powered by Pollinations" visível | não recomendado, porque revela a fonte |

Acima disso, cada visitante usa a própria cota grátis do Puter. Um pedido custa cerca de US$ 0,07 nessa cota: 5 × US$ 0,0059 do GPT Image 2 mais o GPT-5.6 Sol. Se a cota do visitante acabar, o Puter oferece mais a ele. **Você nunca é cobrado.**

## Rodar localmente

Requisito: **Node.js 22 ou mais novo**. Funciona no Windows, Linux e macOS.

```bash
cd logo-studio
npm install
cp .env.example .env        # no Windows: copy .env.example .env
npm run dev
```

Abra <http://localhost:3000>. **Sem nenhuma chave, o app já funciona:** tudo roda pela cota grátis do visitante. No 1º clique em "Gerar", aparece a janela rápida de acesso.

### Ativar a cota grátis do servidor (opcional, recomendado)

1. Entre em <https://enter.pollinations.ai> com o GitHub e crie uma **Secret key** (`sk_...`) em *Keys*. Não precisa de cartão.
2. Coloque a chave em `POLLINATIONS_API_KEY` no `.env`.
3. A conta começa no nível **Spore**. Ela sobe sozinha para **Seed** quando a conta do GitHub soma 8 "pontos de dev": idade da conta, commits, repositórios e estrelas.
4. Para o servidor ler o saldo e trocar de camada antes de esgotar, dê à chave a permissão `account:usage`. Sem ela, a troca acontece no primeiro erro de cota esgotada.

A chave fica **somente no servidor**. O navegador nunca a recebe.

Para testar a interface sem internet: `PROVIDER=mock`. Para simular a cota acabando depois de N imagens: `MOCK_QUOTA=2`.

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

Use um **subdomínio**: a CSP do site principal bloquearia o Puter. Para embutir o app numa página do seu site via `<iframe>`, defina `FRAME_ANCESTORS=https://seusite.com.br`.

### Opção B: Docker

```bash
docker compose up -d --build
```

O container tem `restart: unless-stopped` e healthcheck em `/healthz`. Aponte o nginx para `127.0.0.1:3000` como na opção A.

### Monitoramento

`GET /healthz` devolve `{ ok, uptime, running, queued }` e pode ser usado no UptimeRobot, no workflow `production-monitor` do site etc.

## O que fica escondido

**Na cota do servidor (camada 1), tudo fica escondido:**
- **Chave, provedor, modelos e prompts** ficam só no servidor. O navegador fala apenas com `/api/*`, e as respostas não citam GPT, OpenAI ou Pollinations (há teste automatizado para isso).
- **Código do servidor** (`src/`), `.env`, `package.json` e `node_modules` não são servidos (404). Só `dist/public` é público.
- **Front-end** minificado, com nomes de arquivo com hash e sem source maps.
- **Erros** chegam ao cliente como mensagens genéricas em português. Os detalhes vão só para o log do servidor.
- **SVGs** limpos: sem comentários ou assinatura do gerador, sanitizados (sem scripts, links ou eventos).

**Na cota do visitante (camada 2), parte fica visível.** A geração roda no navegador, então quem abrir as ferramentas de desenvolvedor vê o Puter, os nomes dos modelos e os prompts. A janela de acesso também mostra a marca Puter. É a troca necessária para o custo zero. A chave do servidor, o código do servidor e a vetorização continuam escondidos. Para desligar essa camada: `CLIENT_FALLBACK=off`. Nesse caso, quando a cota acaba, o app avisa o horário da recarga.

## Proteções e limites (ajustáveis no `.env`)

| Variável | Padrão | Para quê |
|---|---|---|
| `IMAGE_QUALITY` | `low` | qualidade do GPT Image 2 (`low`/`medium`/`high`): quanto maior, menos pedidos grátis |
| `POLLEN_REFILL` | `hourly` | recarga da cota grátis (`hourly` para Spore/Seed, `daily` para Flower) |
| `CLIENT_FALLBACK` | `puter` | cota do visitante quando a do servidor acaba (`off` desliga) |
| `CLIENT_QUEUE_THRESHOLD` | 2 | com a fila maior que isso, novos pedidos vão direto para a cota do visitante |
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
src/vectorize.js     imagem → SVG (fundo, cores, traçado, otimização)
src/fetch-image.js   download seguro (anti-SSRF) de imagens geradas no navegador
src/sanitize.js      sanitização de SVG
src/providers/       Pollinations/OpenAI (formato OpenAI) e simulado
public/              interface (fonte); dist/public é a versão de produção
test/                testes (npm test)
```
