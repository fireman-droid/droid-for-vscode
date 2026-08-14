import {
  MAX_CUSTOM_MODEL_KEY_LENGTH,
  isCustomModelBaseUrl,
  type CustomModelProvider,
  type DiscoveredCustomModel,
} from '../../shared/customModelsProtocol';
import { MAX_MODEL_CATALOG_ITEMS } from '../../shared/bridgeMessages';
import {
  isSafeDisplayName,
  isSafeModelId,
} from '../../shared/validateMessage';
import { isStrictRecord as isRecord } from '../../shared/strictValidation';

const MAX_DISCOVERY_RESPONSE_BYTES = 1_048_576;
const DISCOVERY_TIMEOUT_MS = 10_000;

export type ModelDiscoveryFailure =
  | 'aborted'
  | 'http'
  | 'invalid-response'
  | 'response-too-large'
  | 'request-failed'
  | 'timed-out';

export class ModelDiscoveryError extends Error {
  constructor(
    readonly kind: ModelDiscoveryFailure,
    readonly status?: number,
  ) {
    super(kind);
    this.name = 'ModelDiscoveryError';
  }
}

export interface ModelDiscoveryRequest {
  readonly provider: CustomModelProvider;
  readonly baseUrl: string;
  readonly apiKey?: string;
}

export interface CustomModelDiscoveryGateway {
  discover(
    request: ModelDiscoveryRequest,
    signal?: AbortSignal,
  ): Promise<readonly DiscoveredCustomModel[]>;
}

/**
 * Host-only provider discovery. Requests are bounded, redirects are
 * rejected so credentials cannot cross origins, and response JSON is
 * projected to model/display-name strings before it reaches the Bridge.
 */
export function createHttpCustomModelDiscovery(
  fetcher: typeof fetch = fetch,
): CustomModelDiscoveryGateway {
  return {
    async discover(request, signal) {
      validateRequest(request);
      const controller = new AbortController();
      const abortFromCaller = (): void => controller.abort();
      if (signal?.aborted) {
        controller.abort();
      } else {
        signal?.addEventListener('abort', abortFromCaller, { once: true });
      }
      const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
      try {
        const response = await fetcher(modelListUrl(request.baseUrl), {
          method: 'GET',
          headers: discoveryHeaders(request),
          redirect: 'error',
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new ModelDiscoveryError('http', response.status);
        }
        return projectDiscoveryPayload(
          JSON.parse(await readBoundedBody(response)) as unknown,
          request.apiKey,
        );
      } catch (error) {
        if (error instanceof ModelDiscoveryError) {
          throw error;
        }
        if (error instanceof SyntaxError) {
          throw new ModelDiscoveryError('invalid-response');
        }
        if (controller.signal.aborted) {
          throw new ModelDiscoveryError(
            signal?.aborted ? 'aborted' : 'timed-out',
          );
        }
        throw new ModelDiscoveryError('request-failed');
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abortFromCaller);
      }
    },
  };
}

function validateRequest(request: ModelDiscoveryRequest): void {
  if (
    !isCustomModelBaseUrl(request.baseUrl) ||
    (request.apiKey !== undefined &&
      (request.apiKey.length === 0 ||
        request.apiKey.length > MAX_CUSTOM_MODEL_KEY_LENGTH ||
        request.apiKey.trim() !== request.apiKey ||
        /[\u0000-\u001f\u007f-\u009f]/u.test(request.apiKey)))
  ) {
    throw new ModelDiscoveryError('request-failed');
  }
}

function modelListUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.hash = '';
  url.search = '';
  let path = url.pathname.replace(/\/+$/u, '');
  if (path.length === 0 || path === '/') {
    path = '/v1/models';
  } else if (!path.endsWith('/models')) {
    path += '/models';
  }
  url.pathname = path;
  return url.toString();
}

function discoveryHeaders(
  request: ModelDiscoveryRequest,
): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (request.provider === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (request.apiKey !== undefined) {
      headers['x-api-key'] = request.apiKey;
    }
  } else if (request.apiKey !== undefined) {
    headers.authorization = `Bearer ${request.apiKey}`;
  }
  return headers;
}

async function readBoundedBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_DISCOVERY_RESPONSE_BYTES) {
    throw new ModelDiscoveryError('response-too-large');
  }
  if (response.body === null) {
    throw new ModelDiscoveryError('invalid-response');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    total += next.value.byteLength;
    if (total > MAX_DISCOVERY_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ModelDiscoveryError('response-too-large');
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function projectDiscoveryPayload(
  payload: unknown,
  credential: string | undefined,
): DiscoveredCustomModel[] {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : isRecord(payload) && Array.isArray(payload.models)
        ? payload.models
        : null;
  if (rows === null) {
    throw new ModelDiscoveryError('invalid-response');
  }
  const items: DiscoveredCustomModel[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (items.length >= MAX_MODEL_CATALOG_ITEMS) {
      break;
    }
    if (
      !isRecord(row) ||
      !isSafeModelId(row.id) ||
      containsCredential(row.id, credential) ||
      seen.has(row.id)
    ) {
      continue;
    }
    const displayName =
      isSafeDisplayName(row.display_name) &&
      !containsCredential(row.display_name, credential)
        ? row.display_name
        : isSafeDisplayName(row.displayName) &&
            !containsCredential(row.displayName, credential)
          ? row.displayName
          : undefined;
    seen.add(row.id);
    items.push({
      model: row.id,
      ...(displayName === undefined ? {} : { displayName }),
    });
  }
  if (rows.length > 0 && items.length === 0) {
    throw new ModelDiscoveryError('invalid-response');
  }
  return items;
}

function containsCredential(
  value: string,
  credential: string | undefined,
): boolean {
  return credential !== undefined && value.includes(credential);
}
