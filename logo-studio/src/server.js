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
    log.warn('Provedor SIMULADO ativo: as logos são de teste. Defina POLLINATIONS_API_KEY no .env para usar GPT-5.6 Sol + GPT Image 2.');
  } else {
    log.info(`Provedor: ${config.provider.name} | texto: ${config.provider.textModels.join(' > ')} | imagem: ${config.provider.imageModels.join(' > ')}`);
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
