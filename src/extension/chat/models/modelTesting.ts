import type { CustomModelProvider } from '../../../shared/protocol/customModelsProtocol';
import { resolveHttpApiBase } from '../../../shared/validation/providerEndpoint';

const TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 8_192;
const MAX_REPLY_LENGTH = 512;

export interface ModelTestResult {
  readonly status: 'passed' | 'failed';
  readonly summary: string;
  readonly latencyMs: number;
}

/** A bounded, host-only inference probe; catalog reachability is never a test. */
export async function testCustomModel(
  request: {
    readonly protocol: CustomModelProvider;
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly model: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<ModelTestResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const anthropic = request.protocol === 'anthropic';
    const url = new URL(
      anthropic ? 'messages' : 'chat/completions',
      `${resolveHttpApiBase(request.protocol, request.baseUrl).replace(/\/+$/u, '')}/`,
    );
    const body = anthropic
      ? {
          model: request.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
        }
      : {
          model: request.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
        };
    const response = await fetcher(url, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: anthropic
        ? {
            'content-type': 'application/json',
            'x-api-key': request.apiKey,
            'anthropic-version': '2023-06-01',
          }
        : {
            'content-type': 'application/json',
            authorization: `Bearer ${request.apiKey}`,
          },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return {
        status: 'failed',
        summary: `Provider returned ${response.status}.`,
        latencyMs: Date.now() - started,
      };
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES || text.trim().length === 0) {
      return {
        status: 'failed',
        summary: 'Provider returned no usable reply.',
        latencyMs: Date.now() - started,
      };
    }
    const reply = readReply(text, request.protocol);
    return reply === null
      ? {
          status: 'failed',
          summary: 'Provider returned no usable reply.',
          latencyMs: Date.now() - started,
        }
      : { status: 'passed', summary: reply, latencyMs: Date.now() - started };
  } catch {
    return {
      status: 'failed',
      summary: controller.signal.aborted
        ? 'Model test timed out.'
        : 'Could not reach this model.',
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function readReply(body: string, protocol: CustomModelProvider): string | null {
  try {
    const payload = JSON.parse(body) as {
      content?: Array<{ text?: unknown }>;
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const value =
      protocol === 'anthropic'
        ? payload.content?.find((part) => typeof part.text === 'string')?.text
        : payload.choices?.[0]?.message?.content;
    if (typeof value !== 'string') {
      return null;
    }
    const summary = value.replace(/\s+/gu, ' ').trim().slice(0, MAX_REPLY_LENGTH);
    return summary.length === 0 ? null : summary;
  } catch {
    return null;
  }
}
