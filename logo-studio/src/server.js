import { assertProductionConfig, config } from './config.js';
import { createApp } from './app.js';
import { log } from './log.js';
import { createProvider } from './providers/index.js';

assertProductionConfig();

const provider = createProvider(config.provider);
const { app, jobs } = createApp({ config, provider });

const server = app.listen(config.port, config.host, () => {
  log.info(`Logo Studio em http://localhost:${config.port} (modo: ${config.isProduction ? 'produção' : 'desenvolvimento'})`);
  if (config.provider.name === 'mock') {
    log.warn('Provedor SIMULADO ativo: as logos são de teste (PROVIDER=mock).');
  } else if (config.provider.name === 'none') {
    log.info(`Sem chave no servidor: todas as gerações usam a cota grátis do visitante (${config.puter.textModel} + ${config.puter.imageModel}).`);
  } else {
    log.info(`Servidor: ${config.provider.name} | texto: ${config.provider.textModels.join(' > ')} | imagem: ${config.provider.imageModels.join(' > ')} | qualidade: ${config.provider.imageQuality}`);
    log.info(config.clientFallback
      ? `Quando a cota grátis do servidor acabar: cota do visitante (${config.puter.textModel} + ${config.puter.imageModel}).`
      : 'Modo do visitante desativado (CLIENT_FALLBACK=off).');
  }
});

// Conexões longas atrás de proxy: mantém keep-alive acima do timeout do nginx.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 120_000;

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} recebido; encerrando com segurança...`);
  jobs.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => log.error('unhandledRejection:', reason));
process.on('uncaughtException', (err) => {
  // Estado desconhecido: registra e sai para o gerenciador (PM2/Plesk/Docker) reiniciar limpo.
  log.error('uncaughtException:', err);
  process.exit(1);
});
