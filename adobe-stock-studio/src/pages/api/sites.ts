import type { APIRoute } from 'astro';
import { json } from '../../lib/http';
import { loadSiteStates, resetSiteStates } from '../../lib/providers/free-sites';
import { loadSettings } from '../../lib/settings';

/** Situação de cada site gratuito de GPT Image 2 (sucessos, falhas, pausa por limite). */
export const GET: APIRoute = async () => {
  const settings = await loadSettings();
  const states = await loadSiteStates();
  const now = Date.now();
  return json({
    sites: settings.freeSites.map((url) => {
      const s = states[url];
      const paused = !!s?.pausedUntil && Date.parse(s.pausedUntil) > now;
      return { url, ok: s?.ok ?? 0, fail: s?.fail ?? 0, paused, pausedUntil: paused ? s?.pausedUntil : null, pauseReason: paused ? s?.pauseReason : null, lastError: s?.lastError ?? null, lastOkAt: s?.lastOkAt ?? null };
    }),
  });
};

/** Libera todos os sites pausados (ex.: depois de virar o dia). */
export const POST: APIRoute = async () => {
  await resetSiteStates();
  return json({ ok: true, message: 'Situação dos sites zerada: todos liberados.' });
};
