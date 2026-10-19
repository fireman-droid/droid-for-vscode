import * as vscode from 'vscode';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createAutocompleteEvaluation } from '../../extension/dev/AutocompleteEvaluation';
import { readCompletionKey, readCompletionSettings, validateCompletionEndpoint } from '../../extension/autocomplete/settings';
import { FimCompletionError, readFimResponse } from '../../runtime/autocomplete/FimClient';
import { requestCompletionTransport } from '../../runtime/autocomplete/completionTransport';

// Loaded only as Droid's temporary development entry. Normal SecretStorage owns
// credentials; the runner receives a local capability, never the provider key.
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  if (context.extensionMode !== vscode.ExtensionMode.Development || context.extension.id !== 'droidvisx.droidvisx') {
    throw new Error('The evaluation gateway requires a Droid development Host.');
  }
  const config = JSON.parse(readFileSync(path.join(context.extensionPath, 'gateway-config.json'), 'utf8')) as { workspace: string };
  const comparable = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (vscode.workspace.workspaceFolders?.length !== 1 ||
      comparable(vscode.workspace.workspaceFolders[0].uri.fsPath) !== comparable(config.workspace)) {
    throw new Error('The evaluation gateway requires its temporary workspace.');
  }
  const token = randomBytes(32).toString('base64url');
  const evaluation = createAutocompleteEvaluation(context.secrets);
  const lifetime = new AbortController();
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.headers.authorization !== `Bearer ${token}`
      || request.headers.origin !== 'http://127.0.0.1:4173') {
      response.writeHead(403); response.end(); return;
    }
    if (request.url === '/shutdown') {
      response.writeHead(204); response.end();
      lifetime.abort(); server.close();
      void vscode.commands.executeCommand('workbench.action.closeWindow');
      return;
    }
    if (request.url !== '/autocomplete/evaluate') { response.writeHead(404); response.end(); return; }
    const aborted = new AbortController();
    response.once('close', () => aborted.abort());
    const signal = AbortSignal.any([lifetime.signal, aborted.signal]);
    try {
      request.setEncoding('utf8');
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 256_000) throw new Error('Evaluation body too large');
      }
      const input: unknown = JSON.parse(body);
      const kind = input && typeof input === 'object' && 'kind' in input ? input.kind : undefined;
      let result: unknown;
      if (kind === 'raw-fim') result = await rawFim(context.secrets, input, signal);
      else {
        result = await evaluation(input, signal);
        if (kind === 'settings') result = { ...(result as object), rawTransport: true };
      }
      if (!response.destroyed) {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(result));
      }
    } catch (error) {
      if (!response.destroyed) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'evaluation-failed',
          code: error instanceof FimCompletionError ? error.code : 'invalid-request',
          status: error instanceof FimCompletionError ? error.status : undefined }));
      }
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Gateway did not bind a TCP port');
  writeFileSync(path.join(context.extensionPath, 'gateway.json'), JSON.stringify({
    url: `http://127.0.0.1:4173/live#bridgePort=${address.port}&token=${token}`,
  }), { mode: 0o600 });
  context.subscriptions.push({ dispose() { lifetime.abort(); server.closeAllConnections(); server.close(); } });
}

async function rawFim(secrets: vscode.SecretStorage, value: unknown, signal: AbortSignal) {
  const settings = readCompletionSettings();
  if (settings.protocol !== 'fim' || validateCompletionEndpoint(settings.endpoint, settings.protocol)) {
    throw new Error('Raw evaluation requires the configured native FIM service');
  }
  if (!value || typeof value !== 'object' || !('body' in value) || !value.body || typeof value.body !== 'object') {
    throw new Error('Missing FIM body');
  }
  const body = value.body as Record<string, unknown>;
  const allowed = new Set(['model', 'prompt', 'suffix', 'max_tokens', 'temperature', 'stream',
    'stop', 'presence_penalty', 'frequency_penalty', 'repetition_penalty', 'top_p', 'top_k']);
  if (Object.keys(body).some(key => !allowed.has(key)) || body.model !== settings.model
      || typeof body.prompt !== 'string' || typeof body.suffix !== 'string'
      || body.prompt.length + body.suffix.length > 64_000 || typeof body.stream !== 'boolean'
      || typeof body.max_tokens !== 'number' || !Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 1024
      || (body.stop !== undefined && (!Array.isArray(body.stop) || body.stop.length > 20
        || body.stop.some(stop => typeof stop !== 'string' || stop.length > 200)))) throw new Error('Invalid FIM body');
  for (const key of ['temperature', 'presence_penalty', 'frequency_penalty', 'repetition_penalty', 'top_p', 'top_k']) {
    if (body[key] !== undefined && (typeof body[key] !== 'number' || !Number.isFinite(body[key]))) throw new Error('Invalid sampling option');
  }
  const apiKey = await readCompletionKey(secrets, settings.endpoint);
  if (!apiKey) throw new Error('The configured FIM key is unavailable');
  const started = Date.now();
  const raw = await requestCompletionTransport({ endpoint: settings.endpoint, apiKey, signal }, body,
    'text/event-stream, application/json', readFimResponse);
  return { model: settings.model, protocol: settings.protocol, raw, elapsedMs: Date.now() - started };
}
