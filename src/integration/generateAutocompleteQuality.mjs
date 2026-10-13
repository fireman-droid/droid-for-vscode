import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readCorpus } from './autocomplete-quality/evaluate.mjs';

const { values } = parseArgs({ options: { corpus: { type: 'string' }, output: { type: 'string' } } });
if (!values.corpus || !values.output || !process.env.DROID_AUTOCOMPLETE_BRIDGE_URL) {
  throw new Error('Use --corpus file --output file with DROID_AUTOCOMPLETE_BRIDGE_URL set to the current Browser Dev link.');
}
const bridge = new URL(process.env.DROID_AUTOCOMPLETE_BRIDGE_URL);
if (bridge.protocol !== 'http:' || bridge.hostname !== '127.0.0.1') throw new Error('Only a local Browser Dev bridge is supported');
const fragment = new URLSearchParams(bridge.hash.slice(1));
const token = fragment.get('token'), port = fragment.get('bridgePort');
if (!token || !port || !/^\d+$/.test(port)) throw new Error('The Browser Dev link is incomplete');
const endpoint = `http://127.0.0.1:${port}/autocomplete/evaluate`;
async function request(payload) {
  const response = await fetch(endpoint, { method: 'POST', redirect: 'error',
    headers: { Origin: 'http://127.0.0.1:4173', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`Development evaluation endpoint returned HTTP ${response.status}`);
  return response.json();
}
const corpus = readCorpus(values.corpus);
const settings = await request({ kind: 'settings' });
const report = { corpusSha256: corpus.sha256, ...settings, firstAttemptsOnly: true,
  contextMode: 'supplied-fixtures', startedAt: new Date().toISOString(), records: [] };
mkdirSync(path.dirname(path.resolve(values.output)), { recursive: true });
for (const item of corpus.cases) {
  // Deliberately exclude hidden tests and the author's reference solution from the model payload.
  const payload = { prefix: item.prefix, suffix: item.suffix, language: item.language,
    filepath: item.entryFile, references: item.references };
  let result;
  try { result = await request(payload); }
  catch { result = { error: 'evaluation-transport-failed' }; }
  report.records.push({ id: item.id, category: item.category, ...result });
  writeFileSync(values.output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ id: item.id, outcome: result.outcome, elapsedMs: result.elapsedMs, error: result.error }));
  if (result.status === 401 || result.status === 402 || result.status === 403 || result.error === 'evaluation-transport-failed') break;
}
const times = report.records.filter(record => Number.isFinite(record.elapsedMs)).map(record => record.elapsedMs).sort((a, b) => a - b);
console.log(JSON.stringify({ model: report.model, planned: corpus.cases.length, attempted: report.records.length,
  nonempty: report.records.filter(record => record.raw?.trim()).length,
  offered: report.records.filter(record => record.insertion?.trim()).length,
  p50Ms: times[Math.max(0, Math.ceil(times.length * 0.5) - 1)], p95Ms: times[Math.max(0, Math.ceil(times.length * 0.95) - 1)] }));
if (report.records.length !== corpus.cases.length || report.records.some(record => record.error)) process.exitCode = 1;
