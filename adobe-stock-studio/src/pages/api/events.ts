import type { APIRoute } from 'astro';
import { bus, recentLogs, type LogLine } from '../../lib/bus';
import { engine, type EngineStatus } from '../../lib/engine';
import { historySummary } from '../../lib/history';
import { loadResearch } from '../../lib/research';
import type { ResearchSnapshot } from '../../lib/trends';

/** Server-Sent Events: o painel recebe status, log e pesquisa em tempo real. */
export const GET: APIRoute = async ({ request }) => {
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const onStatus = (s: EngineStatus) => send('status', s);
      const onLog = (l: LogLine) => send('log', l);
      const onResearch = (r: ResearchSnapshot) => send('research', r);
      const onHistory = () => send('history', historySummary());
      bus.on('status', onStatus);
      bus.on('log', onLog);
      bus.on('research', onResearch);
      bus.on('history', onHistory);
      const ping = setInterval(() => send('ping', Date.now()), 20_000);

      cleanup = () => {
        clearInterval(ping);
        bus.off('status', onStatus);
        bus.off('log', onLog);
        bus.off('research', onResearch);
        bus.off('history', onHistory);
        try {
          controller.close();
        } catch {
          /* já fechado */
        }
        cleanup = () => {};
      };
      request.signal.addEventListener('abort', () => cleanup(), { once: true });

      send('status', engine.status);
      send('logs', recentLogs(200));
      send('history', historySummary());
      const research = await loadResearch();
      if (research) send('research', research);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    },
  });
};
