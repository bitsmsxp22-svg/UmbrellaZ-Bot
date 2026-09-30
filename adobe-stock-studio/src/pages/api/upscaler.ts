import type { APIRoute } from 'astro';
import { log } from '../../lib/bus';
import { json } from '../../lib/http';
import { installRealEsrgan } from '../../lib/realesrgan-install';
import { loadSettings } from '../../lib/settings';
import { realEsrganStatus } from '../../lib/upscale';
import { errorMessage } from '../../lib/util';

export const GET: APIRoute = async () => json(realEsrganStatus(await loadSettings()));

/** Instala o Real-ESRGAN (IA de ampliação) em tools/realesrgan. */
export const POST: APIRoute = async () => {
  try {
    await installRealEsrgan((m) => log.info(m));
    const status = realEsrganStatus(await loadSettings());
    return json({ ok: status.available, ...status });
  } catch (err) {
    return json({ ok: false, message: errorMessage(err) }, 500);
  }
};
