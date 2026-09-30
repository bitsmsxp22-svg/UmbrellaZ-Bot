import type { APIRoute } from 'astro';
import { recentLogs } from '../../lib/bus';
import { engine } from '../../lib/engine';
import { historySummary } from '../../lib/history';
import { json } from '../../lib/http';
import { loadResearch } from '../../lib/research';

export const GET: APIRoute = async () =>
  json({ status: engine.status, logs: recentLogs(200), research: await loadResearch(), history: historySummary() });
