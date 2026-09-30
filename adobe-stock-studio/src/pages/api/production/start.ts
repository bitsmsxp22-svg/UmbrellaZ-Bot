import type { APIRoute } from 'astro';
import { engine } from '../../../lib/engine';
import { json } from '../../../lib/http';

export const POST: APIRoute = () => {
  const result = engine.start();
  return json({ ...result, status: engine.status }, result.ok ? 200 : 409);
};
