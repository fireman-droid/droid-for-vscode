import { describe, expect, it, vi } from 'vitest';
import type { SessionMessage } from '@factory/droid-sdk';
import type { DroidStreamEvent } from '@factory/droid-sdk/node';
import { ScriptEvidence } from './scriptEvidence';
import { convertToolNotification } from '../events/convertToolNotification';
import { normalizeSdkEvent } from '../events/normalizeSdkEvent';
import { createOperationDiffCollector } from './operationDiff';
import { extractResultPreview } from './toolResultPreview';
import { readReceipt, readableScriptOutput } from '../../shared/transcript/scriptOutput';

const input = { input: '*** Begin Patch\n*** Update File: C:/workspace/a.ts\n@@\n-old\n+new\n*** Update File: C:/workspace/b.ts\n@@\n-before\n+after\n*** End Patch' };
const call = { type: 'tool_use', id: 'patch', name: 'ApplyPatch', input,
  scriptExecution: { runId: 'script', outerToolUseId: 'script' } };
const notification = { type: 'create_message', message: { id: 'm', role: 'assistant', content: [call], createdAt: 1, updatedAt: 1 } };
const body = JSON.stringify({ success: true, files: [
  { file_path: 'C:/workspace/a.ts', display_operation: 'update', diff: '@@ -1 +1 @@\n-old\n+new' },
  { file_path: 'C:/workspace/b.ts', display_operation: 'update', diff: '@@ -1 +1 @@\n-before\n+after' },
] });
const saved = { file: 'session.jsonl', bytes: 100, messages: [
  { id: 'm', role: 'assistant', content: [call], createdAt: 1, updatedAt: 1 },
  { id: 'r', role: 'tool', content: [{ type: 'tool_result', toolUseId: 'patch', content: body }], createdAt: 2, updatedAt: 2 },
] as unknown as SessionMessage[] };
const receipt: DroidStreamEvent = { type: 'tool_result', toolUseId: 'patch', toolName: 'ApplyPatch', content: 'Success. Applied changes to the following files:\nM C:/workspace/a.ts\nM C:/workspace/b.ts', isError: false };
const finish: DroidStreamEvent = { type: 'tool_result', toolUseId: 'script', toolName: 'Script', content: 'done', isError: false };

describe('Script evidence from native notifications and saved results', () => {
  it('retains explicit parents through SDK conversion and Runtime normalization', () => {
    const converted = convertToolNotification(notification);
    const events = Array.isArray(converted) ? converted : [converted];
    const tool = events.find(event => event?.type === 'tool_call')! as DroidStreamEvent;
    expect(normalizeSdkEvent(tool, 'C:/workspace')).toMatchObject({ type: 'tool-start', scriptParentId: 'script' });
    const evidence = new ScriptEvidence('session', 'C:/workspace');
    evidence.observe({ params: { sessionId: 'other', notification } });
    expect(evidence.fields({ type: 'tool_call', name: 'ApplyPatch', toolUseId: 'patch', input })).toEqual({});
    evidence.observe({ params: { sessionId: 'session', notification } });
    expect(evidence.fields({ type: 'tool_call', name: 'ApplyPatch', toolUseId: 'patch', input })).toEqual({ scriptParentId: 'script' });
  });

  it('repairs both operation diffs from the exact saved pair when the live event only has a receipt', async () => {
    const read = vi.fn(async () => saved);
    const evidence = new ScriptEvidence('session', 'C:/workspace', read);
    evidence.observe({ params: { sessionId: 'session', notification } });
    const collect = createOperationDiffCollector('C:/workspace', 'session');
    collect({ type: 'tool_call', toolUseId: 'patch', name: 'ApplyPatch', input });
    const missing = collect(receipt);
    expect(missing).toEqual({ status: 'unavailable', reason: 'not-recorded' });
    evidence.track(receipt, missing);
    expect(await evidence.recover({ ...finish, toolUseId: 'unrelated-script' })).toEqual([]);
    expect(read).not.toHaveBeenCalled();
    expect(await evidence.recover(finish)).toMatchObject([{ type: 'tool-result', toolUseId: 'patch', isError: false,
      operationDiff: { status: 'ready', source: 'tool-result', files: [
        { path: 'a.ts', outcome: 'applied', reversible: true }, { path: 'b.ts', outcome: 'applied', reversible: true },
      ] } }]);
    expect(await evidence.recover(finish)).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('does not invent evidence from missing or ambiguous saved pairs', async () => {
    for (const value of [null, { ...saved, messages: [saved.messages[0]!] },
      { ...saved, messages: [...saved.messages, saved.messages[0]!] }]) {
      const evidence = new ScriptEvidence('session', 'C:/workspace', async () => value);
      evidence.observe({ params: { sessionId: 'session', notification } });
      evidence.track(receipt, { status: 'unavailable', reason: 'not-recorded' });
      expect(await evidence.recover(finish)).toEqual([]);
    }
  });

  it('formats Script parts before sensitive-content checks and removes only the completed trailer', () => {
    const source = { tool: 'Script', path: 'Tool result', callId: 'script' };
    const result = extractResultPreview([{ type: 'text', text: '{"part":0,"result":"TODO List Updated"}\n{"part":1,"result":"const value = 1;\\nexport { value };"}' },
      { type: 'text', text: '[Script completed · 0.8 s elapsed · 2 calls · 1 background execute running · log: C:/logs/call.log]' }], source);
    expect(result).toMatchObject({ availability: 'available', truncated: false });
    if (result.availability !== 'available') throw new Error('Missing Script output');
    expect(readableScriptOutput(result.text)).toBe('[1]\nconst value = 1;\nexport { value };');
    const longParts = JSON.stringify({ part: 1, result: Array.from({ length: 150 }, (_, i) => `line ${i}`).join('\n') });
    expect(extractResultPreview(longParts, source)).toMatchObject({ availability: 'available', text: longParts, truncated: false });
    expect(extractResultPreview('{"part":0,"result":"api_key = \\u0073k-secretvalue123456789"}', source)).toEqual({ availability: 'unavailable', reason: 'restricted' });
    expect(extractResultPreview('Job failed: Script completed unexpectedly', source)).toMatchObject({ text: 'Job failed: Script completed unexpectedly' });
    expect(readReceipt('Read C:/workspace/a.ts: lines 1-37 (37 lines, 1.3 KiB); the file holds the bytes')).toEqual({ start: '1', end: '37', size: '1.3 KiB' });
    expect(readReceipt('const text = "Read a.ts";')).toBeUndefined();
  });
});
