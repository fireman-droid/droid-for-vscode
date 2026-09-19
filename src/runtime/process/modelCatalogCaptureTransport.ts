import {
  DroidServerMethod,
  InitializeSessionResponseSchema,
  InitializeSessionResultSchema,
  LoadSessionResponseSchema,
  LoadSessionResultSchema,
  type AvailableModelConfig,
  type StringFramedDroidClientTransport,
} from '@factory/droid-sdk/node';

type CatalogRequestKind = 'initialize' | 'load';

export interface ModelCatalogCaptureTransport {
  readonly transport: StringFramedDroidClientTransport;
  readAvailableModels(): readonly AvailableModelConfig[] | undefined;
}

export function createModelCatalogCaptureTransport(
  source: StringFramedDroidClientTransport,
): ModelCatalogCaptureTransport {
  const requests = new Map<string, CatalogRequestKind>();
  let availableModels: readonly AvailableModelConfig[] | undefined;

  const captureRequest = (message: string): void => {
    const envelope = parseJsonObject(message);
    if (envelope === undefined || typeof envelope.id !== 'string') {
      return;
    }
    if (envelope.method === DroidServerMethod.INITIALIZE_SESSION) {
      requests.set(envelope.id, 'initialize');
    } else if (envelope.method === DroidServerMethod.LOAD_SESSION) {
      requests.set(envelope.id, 'load');
    }
  };

  const captureResponse = (message: string): void => {
    const envelope = parseJsonObject(message);
    if (envelope === undefined || typeof envelope.id !== 'string') {
      return;
    }
    const request = requests.get(envelope.id);
    if (request === undefined) {
      return;
    }
    requests.delete(envelope.id);

    const response =
      request === 'initialize'
        ? InitializeSessionResponseSchema.safeParse(envelope)
        : LoadSessionResponseSchema.safeParse(envelope);
    if (!response.success || !('result' in response.data)) {
      return;
    }
    const result =
      request === 'initialize'
        ? InitializeSessionResultSchema.safeParse(response.data.result)
        : LoadSessionResultSchema.safeParse(response.data.result);
    if (result.success) {
      availableModels = result.data.availableModels;
    }
  };

  return {
    transport: {
      get isConnected() {
        return source.isConnected;
      },
      async send(message) {
        captureRequest(message);
        await source.send(message);
      },
      onMessage(handler) {
        source.onMessage((message) => {
          captureResponse(message);
          handler(message);
        });
      },
      onError(handler) {
        source.onError(handler);
      },
      async close() {
        await source.close();
      },
    },
    readAvailableModels() {
      return availableModels === undefined ? undefined : [...availableModels];
    },
  };
}

function parseJsonObject(message: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(message);
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
