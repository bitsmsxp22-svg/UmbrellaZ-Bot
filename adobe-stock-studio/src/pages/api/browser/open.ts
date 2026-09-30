import type { APIRoute } from 'astro';
import { browser } from '../../../lib/browser';
import { log } from '../../../lib/bus';
import { json } from '../../../lib/http';
import { loadSettings } from '../../../lib/settings';
import { errorMessage } from '../../../lib/util';

/** Abre o navegador do sistema: login do Adobe Stock (uma vez) + ChatGPT e site de GPT Image 2 sem login. */
export const POST: APIRoute = async () => {
  try {
    const settings = await loadSettings();
    await browser.openLoginPages({ ...settings, headless: false });
    log.info('Navegador aberto. Entre na sua conta do portal do colaborador do Adobe Stock (o único login necessário); ChatGPT e GPT Image 2 funcionam sem login.');
    return json({ ok: true, message: 'Navegador aberto. Entre no portal do colaborador do Adobe Stock — é o único login.' });
  } catch (err) {
    return json({ ok: false, message: `Não consegui abrir o navegador: ${errorMessage(err)}` }, 500);
  }
};
