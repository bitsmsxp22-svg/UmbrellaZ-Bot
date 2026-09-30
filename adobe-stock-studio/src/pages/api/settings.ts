import type { APIRoute } from 'astro';
import { json } from '../../lib/http';
import { detectDesktop, resolveOutputDir } from '../../lib/paths';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../lib/settings';
import { errorMessage } from '../../lib/util';

export const GET: APIRoute = async () => {
  const settings = await loadSettings();
  return json({ settings, defaults: DEFAULT_SETTINGS, desktop: detectDesktop(), outputDir: resolveOutputDir(settings.outputDir) });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    if (typeof body?.selectorOverrides === 'string') {
      body.selectorOverrides = body.selectorOverrides.trim() ? JSON.parse(body.selectorOverrides) : {};
    }
    const settings = await saveSettings(body ?? {});
    return json({ ok: true, settings, outputDir: resolveOutputDir(settings.outputDir) });
  } catch (err) {
    return json({ ok: false, message: `Configurações inválidas: ${errorMessage(err)}` }, 400);
  }
};
