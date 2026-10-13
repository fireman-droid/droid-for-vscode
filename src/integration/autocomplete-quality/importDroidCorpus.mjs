import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readCorpus } from './evaluate.mjs';

const [responseFile, targetFile] = process.argv.slice(2);
if (!responseFile || !targetFile) throw new Error('Pass a completed Droid exec JSON response and an output corpus path');
const raw = readFileSync(responseFile, 'utf8');
const response = JSON.parse(raw);
if (response.is_error || typeof response.result !== 'string') throw new Error('Droid did not return a successful text result');
const text = response.result.trim().replace(/^```(?:json)?\s*\n/, '').replace(/\n```$/, '');
const corpus = JSON.parse(text);
corpus.provenance = { source: 'droid-exec', sessionId: response.session_id,
  responseSha256: createHash('sha256').update(raw).digest('hex'), importedAt: new Date().toISOString() };
mkdirSync(path.dirname(path.resolve(targetFile)), { recursive: true });
writeFileSync(targetFile, JSON.stringify(corpus, null, 2));
const checked = readCorpus(targetFile);
console.log(JSON.stringify({ batch: checked.batch, cases: checked.cases.length,
  tests: checked.cases.reduce((count, item) => count + item.tests.length, 0), sha256: checked.sha256,
  categories: Object.fromEntries([...new Set(checked.cases.map(item => item.category))]
    .map(category => [category, checked.cases.filter(item => item.category === category).length])) }));
