import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { evaluateTrajectory } from './autocomplete-quality/nextEditScoring.mjs';

const [corpusPath, responsePath, output] = process.argv.slice(2);
assert.ok(corpusPath && responsePath && output, 'Usage: node gradeNextEditQuality.mjs corpus.json responses.json|--reference output-directory');
const content = readFileSync(corpusPath, 'utf8'), corpus = JSON.parse(content);
assert.equal(corpus.mode, 'next-edit');
const hash = createHash('sha256').update(content).digest('hex');
const reference = responsePath === '--reference';
const response = reference ? undefined : JSON.parse(readFileSync(responsePath, 'utf8'));
if (response) {
  assert.equal(response.corpusSha256, hash);
  assert.equal(response.contextMode, 'native-edit-history-case-isolated');
  assert.deepEqual(response.records.map(row => row.id), corpus.cases.map(item => item.id));
}
mkdirSync(output, { recursive: true });
const report = { corpusSha256: hash, mode: reference ? 'oracle-validation' : 'native-model-quality',
  model: response?.model, packageSha256: response?.packageSha256,
  promptVariant: response?.promptVariant ?? (reference ? undefined : 'production'), records: [] };
for (const [index, item] of corpus.cases.entries()) {
  const result = await evaluateTrajectory(item, response?.records[index], output, { reference });
  report.records.push(result);
  writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ id: item.id, compiled: result.compiled, passed: result.passed,
    responseHealthy: result.responseHealthy, unnecessaryEdit: result.unnecessaryEdit,
    failed: result.tests.filter(test => !test.passed).map(test => test.name), diagnostics: result.diagnostics }));
}
console.log(JSON.stringify({ total: report.records.length, compiled: report.records.filter(row => row.compiled).length,
  passed: report.records.filter(row => row.passed).length, tests: report.records.reduce((n, row) => n + row.tests.length, 0),
  groups: reference ? undefined : [true, false].map(expectedChange => {
    const records = report.records.filter(row => row.expectedChange === expectedChange);
    return { expectedChange, total: records.length, passed: records.filter(row => row.passed).length,
      unnecessaryEdits: records.filter(row => row.unnecessaryEdit).length };
  }) }));
if (report.records.some(row => !row.passed)) process.exitCode = 1;
