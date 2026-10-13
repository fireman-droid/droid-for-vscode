import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readCorpus } from './autocomplete-quality/evaluate.mjs';
import hostClient from './autocomplete-quality/hostClient.cjs';
import { loadProductionPostprocess } from './autocomplete-quality/production.mjs';

const { values } = parseArgs({ options: { corpus: { type: 'string' }, output: { type: 'string' } } });
if (!values.corpus || !values.output || !process.env.DROID_AUTOCOMPLETE_BRIDGE_URL) {
  throw new Error('Use --corpus file --output file with DROID_AUTOCOMPLETE_BRIDGE_URL set to the current Browser Dev link.');
}
const request = hostClient.createHostClient();
const production = await loadProductionPostprocess();
const corpus = readCorpus(values.corpus);
const settings = await request({ kind: 'settings' });
const report = { corpusSha256: corpus.sha256, ...settings, firstAttemptsOnly: true,
  contextMode: 'supplied-fixtures', postprocessSha256: production.sha256, startedAt: new Date().toISOString(), records: [] };
mkdirSync(path.dirname(path.resolve(values.output)), { recursive: true });
for (const item of corpus.cases) {
  // Deliberately exclude hidden tests and the author's reference solution from the model payload.
  const payload = { prefix: item.prefix, suffix: item.suffix, language: item.language,
    filepath: item.entryFile, references: item.references };
  let result;
  try { result = await request(payload); }
  catch { result = { error: 'evaluation-transport-failed' }; }
  if (typeof result.raw === 'string') {
    const prepared = production.prepare(result.raw, item.prefix, item.suffix, item.language, settings.model);
    result = { ...result, hostOutcome: result.outcome, insertion: prepared.text ?? null, outcome: prepared.outcome };
  }
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
