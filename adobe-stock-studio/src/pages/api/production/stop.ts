import type { APIRoute } from 'astro';
import { engine } from '../../../lib/engine';
import { json } from '../../../lib/http';

export const POST: APIRoute = async () => {
  const result = await engine.stop();
  return json({ ...result, status: engine.status }, result.ok ? 200 : 409);
};
