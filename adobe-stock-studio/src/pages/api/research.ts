import type { APIRoute } from 'astro';
import { engine } from '../../lib/engine';
import { json } from '../../lib/http';
import { loadResearch, nicheTargets, runResearch } from '../../lib/research';
import { loadSettings } from '../../lib/settings';
import { errorMessage } from '../../lib/util';
import { browser } from '../../lib/browser';

export const GET: APIRoute = async () => {
  const settings = await loadSettings();
  return json({ research: await loadResearch(), targets: nicheTargets(settings) });
};

/** Atualiza a pesquisa manualmente (só com a produção parada). */
export const POST: APIRoute = async () => {
  if (engine.isRunning()) return json({ ok: false, message: 'A produção está ligada — a pesquisa roda automaticamente dentro dela.' }, 409);
  try {
    const settings = await loadSettings();
    const research = await runResearch(settings, new AbortController().signal, true);
    if (!settings.simulationMode) await browser.close();
    return json({ ok: true, research });
  } catch (err) {
    return json({ ok: false, message: errorMessage(err) }, 500);
  }
};
