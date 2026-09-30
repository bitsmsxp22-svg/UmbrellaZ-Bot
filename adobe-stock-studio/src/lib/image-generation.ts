import type { ChatGPTWeb } from './chatgpt';
import { generateWithFreeSites } from './providers/free-sites';
import type { Settings } from './settings';
import { simulatedImage } from './simulate';

export interface GeneratedImage {
  buffer: Buffer;
  /** De onde veio a imagem (registrado no log de envios). */
  source: string;
}

/**
 * Geração sempre com GPT Image 2:
 *  - "free-sites" (padrão): sites gratuitos de GPT Image 2, sem login e sem chave de API, em rodízio;
 *  - "chatgpt": o próprio ChatGPT (só se o usuário quiser usar uma conta logada).
 * O modo simulação existe apenas para testar o fluxo sem gerar nada de verdade.
 */
export async function generateImage(
  prompt: string,
  title: string,
  settings: Settings,
  signal: AbortSignal,
  chat: () => Promise<ChatGPTWeb>,
): Promise<GeneratedImage> {
  if (settings.simulationMode) return { buffer: await simulatedImage(title, settings.aspectRatio), source: 'Simulação (teste)' };
  if (settings.imageProvider === 'chatgpt') return { buffer: await (await chat()).generateImage(prompt), source: 'GPT Image 2 · ChatGPT' };
  return generateWithFreeSites(prompt, settings, signal);
}
