import { clusterActivity } from '../ActivityGroup';
import { describe, expect, it } from 'vitest';
import type { ToolTranscriptItem } from '../../../shared/protocol/toolProtocol';
import { presentScriptResults } from './scriptResults';
import { tokenizeCommand, commandChips, commandCardTitle } from '../../../../packages/chat-ui/src/chat/commandFormatting';

const parent = (text: string): ToolTranscriptItem => ({ id: 'p', turnId: 'turn', kind: 'tool', toolUseId: 'script', toolName: 'Script', action: 'Run script', status: 'completed', progressCount: 0, latestUpdateKind: null,
  resultPreview: { availability: 'available', source: { tool: 'Script', path: 'Tool result', callId: 'script' }, text, truncated: false } });
const child: ToolTranscriptItem = { id: 'c', turnId: 'turn', kind: 'tool', toolUseId: 'command', scriptParentId: 'script', toolName: 'Execute', action: 'Verify changes', detailKind: 'command', detail: 'node test.js', status: 'completed', progressCount: 0, latestUpdateKind: null, outputTail: 'PASS: saved\nPASS: conflict\n\n[Process exited with code 0]' };
describe('Script result presentation', () => {
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
