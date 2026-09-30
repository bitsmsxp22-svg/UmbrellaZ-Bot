import type { APIRoute } from 'astro';
import { AdobeContributorWeb } from '../../lib/adobe';
import { engine } from '../../lib/engine';
import { json } from '../../lib/http';
import { loadSettings } from '../../lib/settings';
import { errorMessage } from '../../lib/util';

/** Testa se o navegador do sistema está logado no portal do colaborador do Adobe Stock. */
export const POST: APIRoute = async () => {
  if (engine.isRunning()) return json({ ok: false, message: 'Pare a produção para testar a conexão.' }, 409);
  const settings = await loadSettings();
  try {
    await AdobeContributorWeb.open({ ...settings, headless: false }, new AbortController().signal);
    return json({ ok: true, message: 'Conectado: o portal do colaborador do Adobe Stock está logado e pronto para receber envios.' });
  } catch (err) {
    return json({ ok: false, message: errorMessage(err) }, 200);
  }
};
