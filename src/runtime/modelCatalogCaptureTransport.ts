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
  readLastCallTokenUsage(): CapturedLastCallTokenUsage;
}

export type CapturedLastCallTokenUsage =
  | { readonly status: 'missing' }
  | { readonly status: 'invalid' }
  | {
      readonly status: 'available';
      readonly used: number;
    };

export function createModelCatalogCaptureTransport(
  source: StringFramedDroidClientTransport,
): ModelCatalogCaptureTransport {
  const requests = new Map<string, CatalogRequestKind>();
  let availableModels: readonly AvailableModelConfig[] | undefined;
  let lastCallTokenUsage: CapturedLastCallTokenUsage = {
    status: 'missing',
  };

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
      if (request === 'load' && hasLastCallTokenUsage(envelope.result)) {
        lastCallTokenUsage = { status: 'invalid' };
      }
      return;
    }
    const result =
      request === 'initialize'
        ? InitializeSessionResultSchema.safeParse(response.data.result)
        : LoadSessionResultSchema.safeParse(response.data.result);
    if (result.success) {
      availableModels = result.data.availableModels;
      lastCallTokenUsage =
        request === 'load'
          ? captureLastCallTokenUsage(
              'lastCallTokenUsage' in result.data
                ? result.data.lastCallTokenUsage
                : undefined,
            )
          : { status: 'missing' };
    } else if (
      request === 'load' &&
      hasLastCallTokenUsage(response.data.result)
    ) {
      lastCallTokenUsage = { status: 'invalid' };
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
      return availableModels === undefined
        ? undefined
        : [...availableModels];
    },
    readLastCallTokenUsage() {
      return { ...lastCallTokenUsage };
    },
  };
}

/**
 * Reduces the provider's latest-call fields to the bounded numerator
 * used by the Context meter. Cumulative token totals never enter this
 * projection.
 */
export function captureLastCallTokenUsage(
  value: unknown,
): CapturedLastCallTokenUsage {
  if (value === undefined) {
    return { status: 'missing' };
  }
  if (typeof value !== 'object' || value === null) {
    return { status: 'invalid' };
  }
  const record = value as Record<string, unknown>;
  const outputTokens = record.outputTokens ?? 0;
  if (
    !isSafeTokenCount(record.inputTokens) ||
    !isSafeTokenCount(record.cacheReadTokens) ||
    !isSafeTokenCount(outputTokens)
  ) {
    return { status: 'invalid' };
  }
  const used =
    record.inputTokens + record.cacheReadTokens + outputTokens;
  return Number.isSafeInteger(used)
    ? { status: 'available', used }
    : { status: 'invalid' };
}

function hasLastCallTokenUsage(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, 'lastCallTokenUsage')
  );
}

function isSafeTokenCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseJsonObject(
  message: string,
): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(message);
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
