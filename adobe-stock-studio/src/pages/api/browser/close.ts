import type { APIRoute } from 'astro';
import { browser } from '../../../lib/browser';
import { engine } from '../../../lib/engine';
import { json } from '../../../lib/http';

export const POST: APIRoute = async () => {
  if (engine.isRunning()) return json({ ok: false, message: 'Pare a produção antes de fechar o navegador.' }, 409);
  await browser.close();
  return json({ ok: true, message: 'Navegador fechado. O login continua salvo no perfil.' });
};
