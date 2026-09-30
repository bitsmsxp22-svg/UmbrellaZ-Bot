// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// Sistema 100% local: o servidor só escuta em 127.0.0.1.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { host: '127.0.0.1', port: 4321 },
  devToolbar: { enabled: false },
  vite: {
    ssr: {
      // Dependências nativas / com binários ficam fora do bundle.
      external: ['playwright', 'playwright-core', 'sharp', 'adm-zip'],
    },
    server: {
      watch: { ignored: ['**/data/**', '**/tools/**'] },
    },
  },
});
