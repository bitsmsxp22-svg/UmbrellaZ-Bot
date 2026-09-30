import type { APIRoute } from 'astro';
import { json } from '../../lib/http';
import { loadSettings } from '../../lib/settings';
import { realEsrganStatus } from '../../lib/upscale';

export const GET: APIRoute = async () => json(realEsrganStatus(await loadSettings()));
