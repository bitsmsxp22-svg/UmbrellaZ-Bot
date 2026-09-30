import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { APIRoute } from 'astro';
import { paths } from '../../lib/paths';
import { timestamp } from '../../lib/util';

const newest = (dir: string, count: number, filter: (f: string) => boolean = () => true): string[] => {
  try {
    return fs
      .readdirSync(dir)
      .filter(filter)
      .map((f) => path.join(dir, f))
      .filter((f) => fs.statSync(f).isFile())
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      .slice(0, count);
  } catch {
    return [];
  }
};

/**
 * Zip de diagnóstico para enviar ao suporte: logs, situação dos sites, configurações e as capturas
 * (imagem + HTML) das últimas falhas. NUNCA inclui data/browser-profile (onde ficam os logins).
 */
export const GET: APIRoute = () => {
  const zip = new AdmZip();
  for (const f of newest(paths.logs, 3, (n) => n.startsWith('atividade-'))) zip.addLocalFile(f, 'logs');
  for (const f of [paths.siteStates, paths.settings, paths.research]) if (fs.existsSync(f)) zip.addLocalFile(f, 'estado');
  for (const f of newest(paths.screenshots, 120)) zip.addLocalFile(f, 'capturas');
  zip.addFile('LEIA-ME.txt', Buffer.from('Diagnostico do Stock Studio: logs, situacao dos sites, configuracoes e capturas das ultimas falhas.\nNao contem o perfil do navegador nem logins.\n'));
  const name = `StockStudio-diagnostico-${timestamp()}.zip`;
  return new Response(new Uint8Array(zip.toBuffer()), {
    headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' },
  });
};
