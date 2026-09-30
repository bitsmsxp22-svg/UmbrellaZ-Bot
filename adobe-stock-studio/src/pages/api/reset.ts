import fs from 'node:fs/promises';
import path from 'node:path';
import type { APIRoute } from 'astro';
import { log } from '../../lib/bus';
import { engine } from '../../lib/engine';
import { json } from '../../lib/http';
import { paths, resolveOutputDir } from '../../lib/paths';
import { resetSiteStates } from '../../lib/providers/free-sites';
import { loadSettings } from '../../lib/settings';
import { removeQuiet } from '../../lib/util';

/**
 * Recomeçar do zero: apaga os lotes pendentes da pasta de produção (imagens, CSV e manifesto),
 * libera todos os sites de GPT Image 2 e limpa as capturas antigas. NÃO mexe no login do navegador,
 * no histórico de envios nem na pesquisa das mais vendidas.
 */
export const POST: APIRoute = async () => {
  if (engine.isRunning()) return json({ ok: false, message: 'Pare a produção antes de recomeçar do zero.' }, 409);
  const settings = await loadSettings();
  const outputDir = resolveOutputDir(settings.outputDir);
  let batches = 0;
  for (const entry of await fs.readdir(outputDir).catch(() => [] as string[])) {
    if (!entry.startsWith('lote-')) continue;
    if (await removeQuiet(path.join(outputDir, entry), true)) batches++;
  }
  await resetSiteStates();
  await removeQuiet(paths.screenshots, true);
  log.info(`Recomeço do zero: ${batches} lote(s) pendente(s) apagado(s), todos os sites de GPT Image 2 liberados, capturas antigas limpas.`);
  return json({ ok: true, message: `Pronto: ${batches} lote(s) pendente(s) apagado(s) e todos os sites liberados. Ligue a produção para testar do zero.` });
};
