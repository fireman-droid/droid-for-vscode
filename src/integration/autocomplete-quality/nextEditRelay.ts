import type * as vscode from 'vscode';
import { readCompletionKey, readCompletionSettings, MERCURY_EDIT_ENDPOINT } from '../../extension/autocomplete/settings';
import { asRecord, parsePayload, protocolError, readBody, requestCompletionTransport } from '../../runtime/autocomplete/completionTransport';
import { nextEditAvailable } from './nextEditEvaluation';

/** Relay the packaged Provider's exact prompt, preserving incomplete replies for
 * its own production parser. The temporary Host keeps the configured key. */
export async function relayNextEdit(secrets: vscode.SecretStorage, value: unknown, signal: AbortSignal) {
  if (!nextEditAvailable()) throw new Error('The configured Mercury service is required');
  const input = asRecord(value), body = asRecord(input?.body), settings = readCompletionSettings();
  const messages = body?.messages;
  const message = Array.isArray(messages) && messages.length === 1 ? asRecord(messages[0]) : undefined;
  if (!input || Object.keys(input).some(key => !['kind', 'body'].includes(key)) || !body
    || Object.keys(body).some(key => !['model', 'messages', 'max_tokens', 'stream'].includes(key))
    || body.model !== settings.model || body.stream !== false || body.max_tokens !== Math.max(512, settings.maxTokens)
    || !message || Object.keys(message).some(key => !['role', 'content'].includes(key)) || message.role !== 'user'
    || typeof message.content !== 'string' || message.content.length > 64_000) throw new Error('Invalid native Next Edit request');
  const apiKey = await readCompletionKey(secrets, settings.endpoint);
  if (!apiKey) throw new Error('The configured Mercury key is unavailable');
  const started = Date.now();
  const encoded = await requestCompletionTransport({ endpoint: MERCURY_EDIT_ENDPOINT, apiKey, signal }, body,
    'application/json', async response => {
      if (!response.headers.get('content-type')?.includes('json')) throw protocolError('Unexpected Next Edit response format');
      let raw = '';
      await readBody(response, chunk => { raw += chunk; return false; });
      const payload = parsePayload(raw);
      const choice = Array.isArray(payload.choices) ? asRecord(payload.choices[0]) : undefined;
      if (!choice) throw protocolError('Next Edit returned no choice');
      const content = asRecord(choice.message)?.content;
      return JSON.stringify({ raw: typeof content === 'string' ? content : null,
        finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null });
    });
  return { ...JSON.parse(encoded) as { raw: string | null; finishReason: string | null }, elapsedMs: Date.now() - started };
}
