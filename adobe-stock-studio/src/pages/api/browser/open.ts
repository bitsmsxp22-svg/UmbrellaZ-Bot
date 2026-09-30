import type { APIRoute } from 'astro';
import { browser } from '../../../lib/browser';
import { log } from '../../../lib/bus';
import { json } from '../../../lib/http';
import { loadSettings } from '../../../lib/settings';
import { errorMessage } from '../../../lib/util';

/** Abre o navegador do sistema no ChatGPT e no portal do Adobe para o login manual (feito uma vez). */
export const POST: APIRoute = async () => {
  try {
    const settings = await loadSettings();
    await browser.openLoginPages({ ...settings, headless: false });
    log.info('Navegador aberto para login. Entre no ChatGPT e no portal do colaborador do Adobe Stock; depois é só ligar a produção.');
    return json({ ok: true, message: 'Navegador aberto. Faça login no ChatGPT e no Adobe Stock Contributor.' });
  } catch (err) {
    return json({ ok: false, message: `Não consegui abrir o navegador: ${errorMessage(err)}` }, 500);
  }
};
