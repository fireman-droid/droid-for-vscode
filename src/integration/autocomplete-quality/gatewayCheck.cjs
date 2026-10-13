// Run through withAutocompleteGateway.mjs. Exercises real Host boundaries without
// calling a model or changing the user's settings.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHostClient } = require('./hostClient.cjs');

async function main() {
  const bridge = new URL(JSON.parse(readFileSync(process.env.DROID_AUTOCOMPLETE_GATEWAY_FILE, 'utf8')).url);
  const parameters = new URLSearchParams(bridge.hash.slice(1));
  const origin = `http://127.0.0.1:${parameters.get('bridgePort')}`;
  const headers = { Origin: 'http://127.0.0.1:4173', Authorization: `Bearer ${parameters.get('token')}` };
  const settings = await createHostClient()({ kind: 'settings' });
  assert.ok(settings.model && settings.rawTransport);
  const check = async (name, expected, url, options) => {
    const response = await fetch(origin + url, { ...options, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, expected, name);
    await response.arrayBuffer();
    console.log('PASS ' + name);
  };
  await check('rejects missing authentication', 403, '/autocomplete/evaluate', { method: 'POST' });
  await check('rejects another origin', 403, '/autocomplete/evaluate', {
    method: 'POST', headers: { ...headers, Origin: 'https://example.invalid' } });
  await check('rejects other methods', 403, '/autocomplete/evaluate', { headers });
  await check('rejects unknown routes', 404, '/unknown', { method: 'POST', headers });
  const body = { model: settings.model, prompt: 'const x = ', suffix: ';', max_tokens: 32, temperature: 0, stream: true };
  for (const [name, changes] of [
    ['rejects another model', { model: 'not-the-configured-model' }],
    ['rejects endpoint substitution', { endpoint: 'https://example.invalid' }],
    ['rejects excess token limit', { max_tokens: 1025 }],
    ['rejects malformed stop sequences', { stop: 'invalid' }],
    ['rejects nonnumeric sampling', { temperature: 'invalid' }],
  ]) await check(name, 400, '/autocomplete/evaluate', {
    method: 'POST', headers, body: JSON.stringify({ kind: 'raw-fim', body: { ...body, ...changes } }) });
  const context = { currentFilePath: 'main.ts', currentFileContent: 'const x = 1;', cursorLine: 0,
    cursorCharacter: 12, editableRegionStartLine: 0, editableRegionEndLine: 0,
    recentlyViewedSnippets: [], editDiffHistory: [] };
  for (const [name, input] of [
    ['Next Edit rejects endpoint substitution', { kind: 'next-edit', context, endpoint: 'https://example.invalid' }],
    ['Next Edit rejects another model', { kind: 'next-edit', context, model: 'not-the-configured-model' }],
    ['Next Edit rejects out-of-source positions', { kind: 'next-edit', context: { ...context, cursorLine: 1 } }],
    ['Next Edit rejects invalid snippets', { kind: 'next-edit', context: { ...context, recentlyViewedSnippets: [{}] } }],
    ['inspection rejects excess token budget', { kind: 'next-edit-inspect', context, maxTokens: 1025 }],
    ['inspection rejects invalid token budget', { kind: 'next-edit-inspect', context, maxTokens: '1024' }],
    ['production evaluation rejects token overrides', { kind: 'next-edit', context, maxTokens: 1024 }],
  ]) await check(name, 400, '/autocomplete/evaluate', { method: 'POST', headers, body: JSON.stringify(input) });
  await assert.rejects(createHostClient()({ kind: 'next-edit', context: null }), /HTTP 400 \(invalid-request\)/);
  console.log('PASS preserves classified errors without exposing response bodies');
  console.log('Model gateway checks passed; no model calls made.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
