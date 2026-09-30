import fs from 'node:fs/promises';
import path from 'node:path';
import type { APIRoute } from 'astro';
import { paths } from '../../../../lib/paths';
import { isSafeFileName } from '../../../../lib/util';

const KINDS: Record<string, { dir: string; type: string; download: boolean }> = {
  thumb: { dir: paths.thumbs, type: 'image/webp', download: false },
  csv: { dir: paths.csvArchive, type: 'text/csv; charset=utf-8', download: true },
};

/** Serve miniaturas e CSVs arquivados (apenas nomes simples, sem caminhos). */
export const GET: APIRoute = async ({ params }) => {
  const kind = KINDS[params.kind ?? ''];
  const name = params.name ?? '';
  if (!kind || !isSafeFileName(name)) return new Response('Não encontrado', { status: 404 });
  try {
    const data = await fs.readFile(path.join(kind.dir, name));
    return new Response(data, {
      headers: {
        'content-type': kind.type,
        'cache-control': kind.download ? 'no-store' : 'max-age=86400',
        ...(kind.download ? { 'content-disposition': `attachment; filename="${name}"` } : {}),
      },
    });
  } catch {
    return new Response('Não encontrado', { status: 404 });
  }
};
