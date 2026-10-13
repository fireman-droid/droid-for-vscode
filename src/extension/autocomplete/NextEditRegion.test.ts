import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configureParserAssets } from './kilo/continuedev/core/util/treeSitter';
import { nextEditRegion } from './NextEditRegion';

let assets: string;
beforeAll(() => {
  const require = createRequire(import.meta.url);
  assets = mkdtempSync(path.join(tmpdir(), 'droid-edit-region-'));
  cpSync(path.join(path.dirname(require.resolve('web-tree-sitter')), 'tree-sitter.wasm'), path.join(assets, 'tree-sitter.wasm'));
  mkdirSync(path.join(assets, 'grammars'));
  for (const language of ['typescript', 'python', 'go']) {
    cpSync(path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out', `tree-sitter-${language}.wasm`),
      path.join(assets, 'grammars', `tree-sitter-${language}.wasm`));
  }
  configureParserAssets(assets);
});
afterAll(() => {
  if (path.dirname(assets) !== path.resolve(tmpdir())) throw Error('Unexpected parser asset directory');
  rmSync(assets, { recursive: true, force: true });
});

describe('Next Edit syntax boundaries', () => {
  it.each(['\n', '\r\n'])('includes the adjacent function closing line with %j line endings', async eol => {
    const lines = ['export function label(value: string) {', "  const suffix = '}';", '  return value + suffix;', '}', '',
      'export function format(value: string) {', '  return value;', '}', '',
      'export function literal(value: string) {', '  return value;', '}'];
    const region = await nextEditRegion('main.ts', lines.join(eol), 0);
    expect(region).toEqual({ startLine: 0, endLine: 11 });
    expect(lines.slice(region.startLine, region.endLine + 1).at(-1)).toBe('}');
  });
  it('includes the beginning of a function cut by the upper edge', async () => {
    const lines = ['export function calculate() {', ...Array.from({ length: 14 }, (_, i) => `  const v${i} = ${i};`), '  return v13;', '}'];
    expect(await nextEditRegion('main.ts', lines.join('\n'), 8)).toEqual({ startLine: 0, endLine: 16 });
  });
  it('keeps Python suites complete without counting braces in strings', async () => {
    const lines = ['def first(value):', '    return value', '', 'def transform(value):', "    bracket = '}'",
      ...Array.from({ length: 7 }, (_, i) => `    value += ${i}`), '    return value'];
    expect(await nextEditRegion('main.py', lines.join('\n'), 0)).toEqual({ startLine: 0, endLine: 12 });
  });
  it('includes the Go declaration closing brace', async () => {
    const lines = ['package sample', '', 'func total() int {', ...Array.from({ length: 9 }, (_, i) => `  v${i} := ${i}`), '  return v8', '}'];
    expect(await nextEditRegion('main.go', lines.join('\n'), 0)).toEqual({ startLine: 0, endLine: 13 });
  });
  it('retains the bounded window when completing a declaration would exceed 25 lines', async () => {
    const lines = ['export function longTask() {', ...Array.from({ length: 35 }, (_, i) => `  const v${i} = ${i};`), '}'];
    expect(await nextEditRegion('main.ts', lines.join('\n'), 8)).toEqual({ startLine: 3, endLine: 18 });
  });
  it('uses the line window for an unsupported language and for incomplete syntax', async () => {
    const text = 'function stillTyping(\n' + '  value,\n'.repeat(30);
    expect(await nextEditRegion('main.ts', text, 7)).toEqual({ startLine: 2, endLine: 17 });
    expect(await nextEditRegion('main.unknown', text, 7)).toEqual({ startLine: 2, endLine: 17 });
  });
});
