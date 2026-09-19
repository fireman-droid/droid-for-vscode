import {
  ModelProvider,
  ReasoningEffort,
  type StringFramedDroidClientTransport,
} from '@factory/droid-sdk/node';
import { describe, expect, it, vi } from 'vitest';

import { createModelCatalogCaptureTransport } from './modelCatalogCaptureTransport';

describe('createModelCatalogCaptureTransport', () => {
  it.each([
    ['droid.initialize_session', 'sessionId'],
    ['droid.load_session', 'session'],
  ] as const)(
    'captures the public model catalog from %s responses',
    async (method, responseKind) => {
      const source = createTransportHarness();
      const capture = createModelCatalogCaptureTransport(source.transport);
      const forwarded = vi.fn();
      capture.transport.onMessage(forwarded);

      await capture.transport.send(
        JSON.stringify({
          type: 'request',
          id: 'request-1',
          method,
        }),
      );
      const result = {
        session: { messages: [] },
        settings: {
          modelId: 'model-sol',
          reasoningEffort: ReasoningEffort.Medium,
        },
        availableModels: [availableModel()],
        ...(responseKind === 'sessionId' ? { sessionId: 'session-1' } : {}),
      };
      const message = JSON.stringify({
        jsonrpc: '2.0',
        factoryApiVersion: '1.0.0',
        type: 'response',
        id: 'request-1',
        result,
      });
      source.receive(message);

      expect(capture.readAvailableModels()).toEqual([availableModel()]);
      expect(forwarded).toHaveBeenCalledWith(message);
    },
  );

  it('ignores unrelated, malformed, and schema-invalid messages', async () => {
    const source = createTransportHarness();
    const capture = createModelCatalogCaptureTransport(source.transport);
    const forwarded = vi.fn();
    capture.transport.onMessage(forwarded);

    await capture.transport.send(
      JSON.stringify({
        type: 'request',
        id: 'request-1',
        method: 'droid.get_context_stats',
      }),
    );
    source.receive('not json');
    source.receive(
      JSON.stringify({
        jsonrpc: '2.0',
        factoryApiVersion: '1.0.0',
        type: 'response',
        id: 'request-1',
        result: { availableModels: [availableModel()] },
      }),
    );

    expect(capture.readAvailableModels()).toBeUndefined();
    expect(forwarded).toHaveBeenCalledTimes(2);
  });
});

function availableModel() {
  return {
    id: 'model-sol',
    displayName: 'Model Sol',
    shortDisplayName: 'Sol',
    modelProvider: ModelProvider.FACTORY,
    supportedReasoningEfforts: [
      ReasoningEffort.Low,
      ReasoningEffort.Medium,
      ReasoningEffort.High,
    ],
    defaultReasoningEffort: ReasoningEffort.Medium,
    isCustom: false,
  };
}

function createTransportHarness(): {
  readonly transport: StringFramedDroidClientTransport;
  readonly receive: (message: string) => void;
} {
  let messageHandler: ((message: string) => void) | undefined;
  return {
    transport: {
      isConnected: true,
      send: vi.fn(async () => {}),
      onMessage(handler) {
        messageHandler = handler;
      },
      onError: vi.fn(),
      close: vi.fn(async () => {}),
    },
    receive(message) {
      messageHandler?.(message);
    },
  };
}
