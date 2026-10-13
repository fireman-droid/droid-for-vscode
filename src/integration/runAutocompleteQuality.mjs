import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { evaluateCase, readCorpus } from './autocomplete-quality/evaluate.mjs';
import { assertFixtureContext } from './autocomplete-quality/fixtureContext.cjs';

const { values } = parseArgs({ options: {
  corpus: { type: 'string' }, responses: { type: 'string' }, output: { type: 'string' },
  reference: { type: 'boolean' }, reviewed: { type: 'boolean' },
} });
if (!values.corpus || !values.output || !values.reviewed || Boolean(values.reference) === Boolean(values.responses)) {
  throw new Error('Use --corpus file --output directory --reviewed with either --reference or --responses file. Review code before execution.');
}
const corpus = readCorpus(values.corpus);
const responses = values.responses ? JSON.parse(readFileSync(values.responses, 'utf8')) : undefined;
if (responses && responses.corpusSha256 !== corpus.sha256) throw new Error('Response corpus hash does not match');
if (responses?.contextMode === 'native-context-case-isolated') {
  for (const record of responses.records) {
    const item = corpus.cases.find(item => item.id === record.id);
    if (!item) throw new Error('Unknown native response case');
    const allowed = [item.entryFile, ...item.references.map(file => file.path)].map(file => `${item.id}/${file}`);
    for (const request of record.requests) assertFixtureContext(request.prompt, allowed);
  }
}
const directory = path.resolve(values.output);
mkdirSync(directory, { recursive: true });
const report = { corpusSha256: corpus.sha256, author: corpus.author, batch: corpus.batch,
  mode: values.reference ? 'oracle-validation' : 'model-quality', model: responses?.model,
  contextMode: responses?.contextMode, packageSha256: responses?.packageSha256, typing: responses?.typing, records: [] };
for (const item of corpus.cases) {
  const response = responses?.records.find(record => record.id === item.id);
  const insertion = values.reference ? item.referenceInsertion : response?.insertion;
  let result;
  try {
    result = typeof insertion === 'string' && insertion.trim()
      ? await evaluateCase(item, insertion, directory)
      : { id: item.id, category: item.category, compiled: false, passed: false, tests: [], error: 'No usable suggestion' };
  } catch (error) { result = { id: item.id, category: item.category, passed: false, error: String(error) }; }
  report.records.push(result);
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ id: item.id, passed: result.passed, compiled: result.compiled,
    tests: result.tests?.length, failed: result.tests?.filter(test => !test.passed).map(test => test.name),
    diagnostics: result.diagnostics, error: result.error, timedOut: result.timedOut }));
}
const passed = report.records.filter(record => record.passed).length;
console.log(JSON.stringify({ mode: report.mode, cases: report.records.length, passed, failed: report.records.length - passed }));
if (passed !== report.records.length) process.exitCode = 1;
