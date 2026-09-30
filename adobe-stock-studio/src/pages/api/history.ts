import type { APIRoute } from 'astro';
import { historyCsv, historySummary, readHistory } from '../../lib/history';
import { json } from '../../lib/http';

export const GET: APIRoute = ({ url }) => {
  const entries = readHistory();
  if (url.searchParams.get('format') === 'csv') {
    return new Response(historyCsv(entries), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="log-envios-adobe-stock-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }
  const limit = Math.min(1000, Number(url.searchParams.get('limit') ?? 300));
  return json({ summary: historySummary(entries), entries: entries.slice(0, limit) });
};
