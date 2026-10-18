import { clusterActivity } from '../ActivityGroup';
import { describe, expect, it } from 'vitest';
import type { ToolTranscriptItem } from '../../../shared/protocol/toolProtocol';
import { presentScriptResults } from './scriptResults';
import { tokenizeCommand, commandChips, commandCardTitle } from '../../../../packages/chat-ui/src/chat/commandFormatting';

const parent = (text: string): ToolTranscriptItem => ({ id: 'p', turnId: 'turn', kind: 'tool', toolUseId: 'script', toolName: 'Script', action: 'Run script', status: 'completed', progressCount: 0, latestUpdateKind: null,
  resultPreview: { availability: 'available', source: { tool: 'Script', path: 'Tool result', callId: 'script' }, text, truncated: false } });
const child: ToolTranscriptItem = { id: 'c', turnId: 'turn', kind: 'tool', toolUseId: 'command', scriptParentId: 'script', toolName: 'Execute', action: 'Verify changes', detailKind: 'command', detail: 'node test.js', status: 'completed', progressCount: 0, latestUpdateKind: null, outputTail: 'PASS: saved\nPASS: conflict\n\n[Process exited with code 0]' };
const readChild = (path: string, id = path): ToolTranscriptItem => ({ id, turnId: 'turn', kind: 'tool', toolUseId: id,
  scriptParentId: 'script', toolName: 'Read', action: 'Read file', status: 'completed', progressCount: 0, latestUpdateKind: null,
  resultPreview: { availability: 'available', source: { tool: 'Read', path, callId: id }, truncated: false,
    text: `Read C:/workspace/${path}: lines 1-12 (12 lines, 1.0 KiB); the file holds the bytes` } });
describe('Script result presentation', () => {
  it('deduplicates complete linked JSON arrays despite different presentation formatting', () => {
    const paths = ['src/a.ts', 'src/b.ts'];
    const p = parent(JSON.stringify({ i: 1, result: paths }));
    const c = { ...readChild('matched paths'), toolName: 'Glob' };
    const preview = { availability: 'available' as const, source: c.resultPreview!.source!, text: JSON.stringify(paths), truncated: false };
    const linked = { ...c, resultPreview: preview };
    expect(presentScriptResults([p, linked])).toEqual([linked]);
    for (const other of [{ ...linked, scriptParentId: 'other' },
      { ...linked, resultPreview: { ...preview, truncated: true } },
      { ...linked, resultPreview: { ...preview, text: JSON.stringify(paths.slice(0, 1)) } }]) {
      expect(presentScriptResults([p, other])).toHaveLength(2);
    }
  });
  it('uses i only as a display label and deduplicates linked equal content instead of associating by index', () => {
    const text = [JSON.stringify({ i: 0, result: 'TODO List Updated' }),
      JSON.stringify({ i: 1, result: 'PASS: saved\nPASS: conflict' }),
      JSON.stringify({ i: 2, result: 'Unique note' })].join('\n');
    expect(presentScriptResults([parent(text), child])).toMatchObject([
      { resultPreview: { text: '[2]\nUnique note' } }, child,
    ]);
    expect(presentScriptResults([parent(text), { ...child, scriptParentId: 'other' }])[0])
      .toMatchObject({ resultPreview: { text: '[1]\nPASS: saved\nPASS: conflict\n\n[2]\nUnique note' } });
  });
  it('moves file bodies from the available parent to uniquely linked Read receipts without changing canonical items', () => {
    const read = readChild('project/src/a.ts');
    const other = readChild('project/src/b.ts');
    const text = [JSON.stringify({ file: 'src/a.ts', result: 'line one\nline two\n' }),
      JSON.stringify({ file: 'unmatched.ts', result: 'unique body' })].join('\n');
    const original = [parent(text), read, other];
    const saved = JSON.stringify(original);
    const shown = presentScriptResults(original);
    expect(shown).toMatchObject([{ resultPreview: { text: '[unmatched.ts]\nunique body' } },
      { resultPreview: { text: 'line one\nline two\n', truncated: false, source: read.resultPreview!.source } }, other]);
    expect(JSON.stringify(original)).toBe(saved);
    expect(shown[1]).not.toHaveProperty('filePath');
    expect(shown[1]).not.toHaveProperty('operationDiff');
  });
  it('moves only present file prefixes and preserves truncation while leaving later Read receipts intact', () => {
    const reads = ['src/a.ts', 'src/b.ts', 'src/c.ts'].map(path => readChild(`project/${path}`));
    const text = `${JSON.stringify({ file: 'src/a.ts', result: 'complete\nbody' })}\n{"file":"src/b.ts","result":"partial\\nbody`;
    const p = parent(text);
    const source = p.resultPreview!.source!;
    const shown = presentScriptResults([{ ...p, resultPreview: { availability: 'available', source, text, truncated: true } }, ...reads]);
    expect(shown).toHaveLength(3);
    expect(shown[0]).toMatchObject({ resultPreview: { text: 'complete\nbody', truncated: false } });
    expect(shown[1]).toMatchObject({ resultPreview: { text: 'partial\nbody', truncated: true } });
    expect(shown[2]).toBe(reads[2]);
  });
  it('keeps unlinked, ambiguous, restricted, evicted, and differently sourced file results on the parent', () => {
    const p = parent(JSON.stringify({ file: 'a.ts', result: 'retained body' }));
    const read = readChild('project/a.ts');
    const cases: ToolTranscriptItem[][] = [
      [{ ...read, scriptParentId: 'other' }],
      [read, readChild('another/a.ts')],
      [{ ...read, resultPreview: { availability: 'unavailable', reason: 'restricted' } }],
      [{ ...read, resultPreview: { availability: 'unavailable', reason: 'evicted', source: read.resultPreview!.source } }],
      [readChild('project/b.ts')],
    ];
    for (const children of cases) {
      const shown = presentScriptResults([p, ...children]);
      expect(shown[0]).toMatchObject({ resultPreview: { text: '[a.ts]\nretained body' } });
      expect(shown.slice(1)).toEqual(children);
    }
    const duplicateLabels = parent(`${JSON.stringify({ file: 'a.ts', result: 'first' })}\n${JSON.stringify({ file: 'a.ts', result: 'second' })}`);
    expect(presentScriptResults([duplicateLabels, read])[0]).toMatchObject({ resultPreview: { text: '[a.ts]\nfirst\n\n[a.ts]\nsecond' } });
  });
  it('preserves unique child content and keeps decoded file text beyond the child preview budget', () => {
    const read = readChild('project/a.ts');
    const body = Array.from({ length: 150 }, (_, index) => `line ${index}`).join('\n');
    const shown = presentScriptResults([parent(JSON.stringify({ file: 'a.ts', result: body })), read]);
    expect(shown[0]).toMatchObject({ resultPreview: { text: `[a.ts]\n${body}` } });
    expect(shown[1]).toBe(read);
    const existing = { ...read, resultPreview: { availability: 'available' as const, source: read.resultPreview!.source!, text: 'independent result', truncated: false } };
    expect(presentScriptResults([parent(JSON.stringify({ file: 'a.ts', result: 'other body' })), existing])).toMatchObject([
      { resultPreview: { text: '[a.ts]\nother body' } }, existing,
    ]);
    expect(presentScriptResults([parent(JSON.stringify({ file: 'a.ts', result: 'independent result' })), existing])).toEqual([existing]);
    const receiptLikeBody = 'Source text\nTODO List Updated\nexit 0\nSuccess. Applied changes to the following files:\nM src/a.ts';
    expect(presentScriptResults([parent(JSON.stringify({ file: 'unmatched.ts', result: receiptLikeBody })), child])[0])
      .toMatchObject({ resultPreview: { text: `[unmatched.ts]\n${receiptLikeBody}` } });
  });
  it('deduplicates linked object results including failures while preserving unique and partial output', () => {
    const failed = { ...child, id: 'failed', toolUseId: 'failed', status: 'failed' as const, outputTail: undefined,
      errorMessage: 'Command failed (exit code: 1)\nfetch failed\n[Process exited with code 1]' };
    const text = [JSON.stringify({ part: 0, result: { output: 'fetch failed\n', exitCode: 1 } }),
      JSON.stringify({ part: 1, result: { output: 'PASS: saved\nPASS: conflict\n', exitCode: 0 } }),
      JSON.stringify({ part: 2, result: 'Supplemental result' })].join('\n');
    expect(presentScriptResults([parent(text), failed, child])).toMatchObject([
      { resultPreview: { text: '[2]\nSupplemental result' } }, failed, child,
    ]);
    const preview = parent(text).resultPreview as Extract<NonNullable<ToolTranscriptItem['resultPreview']>, { availability: 'available' }>;
    expect(presentScriptResults([{ ...parent(text), resultPreview: { ...preview, text: text.slice(0, -4), truncated: true } }, failed, child])[0])
      .toMatchObject({ resultPreview: { truncated: true, text: expect.stringContaining('Supplemental res') } });
    expect(presentScriptResults([parent(text), { ...failed, scriptParentId: 'unrelated' }, child])[0])
      .toMatchObject({ resultPreview: { text: expect.stringContaining('fetch failed') } });
  });
  it('does not repeat a background launch receipt already shown by its linked command', () => {
    const background = { ...child, backgroundHint: { fireAndForget: true as const }, outputTail: 'Background process started (PID: 123)\nStatus: Running in background' };
    const receipt = parent('exit null · pid 123 · outputFile C:/temp/job.out');
    expect(presentScriptResults([receipt, background])).toEqual([background]);
    expect(presentScriptResults([receipt, { ...background, scriptParentId: 'other' }])).toEqual([receipt, { ...background, scriptParentId: 'other' }]);
  });
  it('preserves the disclosure identity when a redundant Script row disappears', () => {
    const p = parent('exit 0\nPASS: saved\nPASS: conflict');
    expect(clusterActivity([p, child])[0]!.id).toBe(clusterActivity(presentScriptResults([p, child]))[0]!.id);
  });
  it('shows related command output once and keeps unique Script output', () => {
    const result = presentScriptResults([parent('A unique note\nexit 0\nPASS: saved\nPASS: conflict\n'), child]);
    expect(result).toMatchObject([{ resultPreview: { text: 'A unique note' } }, child]);
    expect(presentScriptResults([parent('exit 0\nPASS: saved\nPASS: conflict'), child])).toEqual([child]);
    const historyChild = { ...child, turnId: 'history-child-message' };
    expect(presentScriptResults([parent('exit 0\nPASS: saved\nPASS: conflict'), historyChild])).toEqual([historyChild]);
  });
  it('does not remove unlinked, unavailable, failed, or truncated evidence', () => {
    const p = parent('PASS: saved\nPASS: conflict');
    expect(presentScriptResults([p, { ...child, scriptParentId: 'other' }])[0]).toEqual(p);
    expect(presentScriptResults([p, { ...child, outputTail: undefined }])[0]).toEqual(p);
    expect(presentScriptResults([{ ...p, status: 'failed' }, child])[0]).toMatchObject({ status: 'failed', resultPreview: { text: p.resultPreview!.availability === 'available' && p.resultPreview.text } });
    expect(presentScriptResults([{ ...p, resultPreview: { ...p.resultPreview as Extract<NonNullable<ToolTranscriptItem['resultPreview']>, { availability: 'available' }>, truncated: true } }, child])).toHaveLength(2);
  });
  it('uses confirmed diff identities before removing an applied-files receipt', () => {
    const p = parent('Success. Applied changes to the following files:\nM C:/workspace/a.ts\nTODO List Updated');
    const patch: ToolTranscriptItem = { ...child, detailKind: undefined, detail: undefined, outputTail: undefined, operationDiff: { status: 'ready', source: 'tool-result', files: [{ path: 'a.ts', kind: 'modified', outcome: 'applied', patch: '@@ -1 +1 @@\n-old\n+new' }] } };
    expect(presentScriptResults([p, patch])).toEqual([patch]);
    expect(presentScriptResults([p, { ...patch, operationDiff: undefined }])).toHaveLength(2);
    expect(presentScriptResults([parent('TODO List Updated')])).toEqual([]);
  });
});

describe('PowerShell here-string command presentation', () => {
  it.each(["'", '"'])('keeps %s here-string bodies out of command names and preserves every byte', quote => {
    const text = `Set-Location C:/workspace\r\n@${quote}\r\nconst x = 'version';\r\nconsole.log("stored");\r\n${quote}@ | node -`;
    expect(commandChips(text)).toEqual(['Set-Location', 'node']);
    expect(tokenizeCommand(text).map(token => token.text).join('')).toBe(text);
    expect(commandCardTitle('Run command', 'Run command', text)).toBe('node -');
  });
  it('handles partial streaming here-strings and ordinary chained commands', () => {
    expect(commandChips("@'\nconst x = 'version';")).toEqual([]);
    expect(commandChips('cd /project; npm run typecheck && npm run build')).toEqual(['cd', 'npm']);
  });
});
