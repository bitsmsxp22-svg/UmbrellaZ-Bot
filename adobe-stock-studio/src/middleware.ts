import { defineMiddleware } from 'astro:middleware';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * O painel controla navegador e arquivos do computador: só aceita requisições feitas para
 * o próprio computador (bloqueia DNS rebinding e acesso pela rede).
 */
export const onRequest = defineMiddleware((context, next) => {
  const host = (context.request.headers.get('host') ?? '').replace(/:\d+$/, '').toLowerCase();
  if (host && !LOCAL_HOSTS.has(host)) {
    return new Response('Acesso permitido apenas pelo próprio computador (localhost).', { status: 403 });
  }
  return next();
});
