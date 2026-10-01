import { MockProvider } from './mock.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';

/** Retorna o provedor do servidor, ou null quando tudo roda pela cota do visitante (sem chave). */
export function createProvider(providerConfig) {
  if (providerConfig.name === 'none') return null;
  if (providerConfig.name === 'mock') return new MockProvider({ quotaImages: providerConfig.mockQuota || 0 });
  return new OpenAICompatibleProvider(providerConfig);
}
