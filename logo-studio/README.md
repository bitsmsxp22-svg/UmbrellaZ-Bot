# Logo Studio: gerador de logos em SVG

O cliente descreve a logo (e, se quiser, envia até 3 imagens de referência) e recebe **5 opções diferentes em SVG vetorial**, com download em SVG e PNG (2048 px). O visitante não precisa de cadastro, login ou chave.

## Como funciona

```
Navegador ──► /api/generate ──► fila (24/7) ──► GPT-5.6 Sol ──► 5 conceitos (diretor de arte)
                                                     │  (lê as imagens de referência por visão)
                                                     ▼
                                   GPT Image 2 ──► 5 imagens (em paralelo; usa as referências)
                                                     ▼
                              vetorização ──► remove fundo ► reduz às cores reais ► traça (vtracer) ► otimiza
                                                     ▼
                              SVG sanitizado ──► o navegador consulta /api/jobs/:id e mostra cada logo que fica pronta
```

- **Plano B automático:** se a geração de imagem falhar, o GPT-5.6 Sol desenha o SVG direto. Se o modelo de texto cair, o app usa conceitos locais. Se o modelo principal falhar, entra o modelo reserva (`gpt-5.5` / `gpt-image-1.5`).
- **Novas tentativas:** a cada erro temporário (429/5xx/timeout) o app tenta de novo com espera crescente e respeita `Retry-After`.

## Rodar localmente

Requisito: **Node.js 22 ou mais novo**. Funciona no Windows, Linux e macOS.

```bash
cd logo-studio
npm install
cp .env.example .env        # no Windows: copy .env.example .env
# edite o .env e coloque sua chave em POLLINATIONS_API_KEY
npm run dev
```

Abra <http://localhost:3000>.

Sem chave no `.env`, o app sobe em **modo simulado** (`PROVIDER=mock`): as logos são desenhos de teste. Serve para conferir a interface e o fluxo completo sem internet.

### Chave do Pollinations (só você, dono do site, precisa dela)

1. Entre em <https://enter.pollinations.ai/keys> e crie uma **Secret key** (`sk_...`).
2. Coloque em `POLLINATIONS_API_KEY` no `.env`.
3. Cada geração consome créditos ("pollen") da sua conta Pollinations, e o GPT Image 2 é dos modelos mais caros. Mantenha saldo; se ele acabar, o app tenta o modelo reserva e, por último, o plano B em SVG direto.

A chave fica **somente no servidor**. O navegador nunca a recebe.

Para usar a API oficial da OpenAI em vez do Pollinations: `PROVIDER=openai` e `OPENAI_API_KEY=...`.

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

Um subdomínio evita conflito com a CSP do site principal. Para usar uma pasta (`seusite.com.br/logos/`), use `location /logos/ { proxy_pass http://127.0.0.1:3000/; ... }`. O front usa caminhos relativos, então funciona nos dois casos.

Para embutir o app numa página do seu site via `<iframe>`, defina `FRAME_ANCESTORS=https://seusite.com.br`.

### Opção B: Docker

```bash
docker compose up -d --build
```

O container tem `restart: unless-stopped` e healthcheck em `/healthz`. Aponte o nginx para `127.0.0.1:3000` como na opção A.

### Monitoramento

`GET /healthz` devolve `{ ok, uptime, running, queued }` e pode ser usado no UptimeRobot, no workflow `production-monitor` do site etc.

## O que fica escondido em produção

- **Chave, provedor, modelos e prompts** ficam só no servidor. O navegador fala apenas com `/api/*`, e as respostas não citam GPT, OpenAI ou Pollinations (há teste automatizado para isso).
- **Código do servidor** (`src/`), `.env`, `package.json` e `node_modules` não são servidos (404). Só `dist/public` é público.
- **Front-end** minificado, com nomes de arquivo com hash e sem source maps.
- **Erros** chegam ao cliente como mensagens genéricas em português. Os detalhes vão só para o log do servidor.
- **SVGs** limpos: sem comentários ou assinatura do gerador, sanitizados (sem scripts, links ou eventos).

## Proteções e limites (ajustáveis no `.env`)

| Variável | Padrão | Para quê |
|---|---|---|
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | 6 por hora por IP | evita abuso e gasto de créditos |
| `MAX_CONCURRENT_JOBS` | 2 | pedidos processados ao mesmo tempo |
| `MAX_QUEUED_JOBS` | 20 | fila máxima (acima disso: "tente em 1 minuto") |
| `IMAGE_CONCURRENCY` | 5 | imagens geradas em paralelo no total |
| `JOB_TIMEOUT_MS` | 8 min | um pedido travado nunca bloqueia a fila |
| `UPLOAD_MAX_FILES` / `UPLOAD_MAX_MB` | 3 / 8 MB | imagens de referência (validadas e sem metadados) |
| `SAMPLES` | 5 | número de opções por pedido |

Os resultados ficam disponíveis por 1 hora (`JOB_TTL_MS`). O cliente deve baixar as logos nesse período.

## Estrutura

```
src/server.js        inicialização, desligamento gracioso, reinício seguro
src/app.js           rotas HTTP, upload, segurança (helmet/CSP), limites
src/jobs.js          fila, concorrência, pipeline das 5 amostras
src/director.js      prompts do GPT-5.6 Sol (conceitos e plano B em SVG)
src/vectorize.js     imagem → SVG (fundo, cores, traçado, otimização)
src/sanitize.js      sanitização de SVG
src/providers/       Pollinations/OpenAI (formato OpenAI) e simulado
public/              interface (fonte); dist/public é a versão de produção
test/                testes (npm test)
```
