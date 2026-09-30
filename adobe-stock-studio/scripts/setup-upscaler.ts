// npm run setup:upscaler — instala o Real-ESRGAN antes do primeiro uso (o painel também instala sozinho).
import { installRealEsrgan } from '../src/lib/realesrgan-install';

installRealEsrgan()
  .then((bin) => console.log(`Pronto: ${bin}`))
  .catch((err) => {
    console.error(`Erro: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
