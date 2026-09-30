import { MockProvider } from './mock.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';

export function createProvider(providerConfig) {
  if (providerConfig.name === 'mock') return new MockProvider();
  return new OpenAICompatibleProvider(providerConfig);
}
