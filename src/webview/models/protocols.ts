import type { CustomModelProvider } from '../../shared/protocol/customModelsProtocol';

export const PROTOCOLS: Record<CustomModelProvider, { name: string; route: string; hint: string }> = {
  anthropic: {
    name: 'Anthropic Messages',
    route: '/v1/messages',
    hint: 'For an Anthropic-compatible Messages endpoint.',
  },
  openai: {
    name: 'OpenAI Responses',
    route: '/responses',
    hint: 'Requires the Responses API. Most chat-completions gateways need the option below.',
  },
  'generic-chat-completion-api': {
    name: 'OpenAI Chat Completions',
    route: '/chat/completions',
    hint: 'For third-party OpenAI-compatible gateways using Chat Completions.',
  },
};
