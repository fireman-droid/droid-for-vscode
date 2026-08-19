import { describe, expect, it } from 'vitest';

import {
  parseProviderModelsStateMessage,
  parseProviderModelsWebviewMessage,
} from './customModelsProtocol';

describe('provider custom-model protocol', () => {
  it('accepts a provider save request without credential material', () => {
    expect(parseProviderModelsWebviewMessage({
      type: 'providerModels.saveProvider',
      sessionId: 'session-1',
      displayName: 'Team API',
      protocol: 'openai',
      rootUrl: 'https://api.example.com',
      setApiKey: true,
    })).toEqual({
      type: 'providerModels.saveProvider',
      sessionId: 'session-1',
      displayName: 'Team API',
      protocol: 'openai',
      rootUrl: 'https://api.example.com',
      setApiKey: true,
    });
  });

  it('rejects credential-shaped provider save requests', () => {
    expect(parseProviderModelsWebviewMessage({
      type: 'providerModels.saveProvider',
      sessionId: 'session-1',
      displayName: 'Team API',
      protocol: 'openai',
      rootUrl: 'https://api.example.com',
      apiKey: 'not-allowed-over-bridge',
    })).toBeNull();
  });

  it('accepts only bounded, projected provider state', () => {
    expect(parseProviderModelsStateMessage({
      type: 'providerModels.state',
      sequence: 1,
      sessionId: 'session-1',
      providers: {
        status: 'ready',
        providers: [{
          id: 'provider-1',
          displayName: 'Team API',
          protocol: 'openai',
          rootUrl: 'https://api.example.com',
          apiBaseUrl: 'https://api.example.com/v1',
          hasApiKey: true,
          imported: false,
          modelCount: 2,
          latestTest: {
            status: 'passed',
            summary: '2 of 2 models replied.',
            latencyMs: 80,
          },
          modelTests: [{
            model: 'claude-sonnet-5',
            status: 'passed',
            summary: 'OK',
            latencyMs: 40,
          }],
        }],
      },
    })?.providers.status).toBe('ready');
  });
});
