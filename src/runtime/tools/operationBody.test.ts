import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOperationDiff, MAX_OPERATION_BODY_UNITS, type OperationDiff } from '../../shared/protocol/operationDiff';
import { createOperationDiffCollector } from './operationDiff';
import { parseOperationResult, type OperationTool } from './operationResult';
import { readOperationBody, type OperationBodyRequest } from './operationBody';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
const workspace = '/workspace';
const sessionId = 'body-session';
const callId = 'edit-body';
const message = (id: string, role: string, content: unknown[], parentId?: string) => ({
  type: 'message', id, parentId, timestamp: '2026-10-04T00:00:00.000Z', message: { role, content },
});
async function logFixture(name: string, input: unknown, content: string, includeResult = true) {
  const directory = await mkdtemp(join(tmpdir(), 'droid-operation-body-'));
  directories.push(directory);
  const records = [
    { type: 'session_start', version: 2, id: sessionId },
    message('prompt', 'user', [{ type: 'text', text: 'edit' }]),
    message('call', 'assistant', [{ type: 'tool_use', id: callId, name, input }], 'prompt'),
    ...(includeResult ? [message('result', 'user', [{ type: 'tool_result', tool_use_id: callId, content }], 'call')] : []),
  ];
  const file = join(directory, `${sessionId}.jsonl`);
  await writeFile(file, records.map(record => JSON.stringify(record)).join('\n') + '\n');
  return { directory, file };
}
function ready(value: OperationDiff): Extract<OperationDiff, { status: 'ready' }> {
  expect(isOperationDiff(value)).toBe(true);
  if (value.status !== 'ready') throw new Error(`Operation was dropped: ${value.reason}`);
  return value;
}
function request(value: OperationDiff, path = 'large.ts'): OperationBodyRequest {
  const file = ready(value).files.find(file => file.path === path);
  if (!file?.bodyRef) throw new Error('Large body reference was not recorded');
  return { workspace, sourceSessionId: sessionId, callId, file };
}
function applyPatch(size = 25_000) {
  const before = 'a'.repeat(size);
  const after = 'b'.repeat(size);
  const patch = `@@ -1 +1 @@\n-${before}\n+${after}`;
  const input = `*** Begin Patch\n*** Update File: /workspace/large.ts\n@@\n-${before}\n+${after}\n*** Update File: /workspace/small.ts\n@@\n-old\n+new\n*** End Patch`;
  const content = JSON.stringify({ success: true, files: [
    { file_path: '/workspace/large.ts', display_operation: 'update', diff: patch },
    { file_path: '/workspace/small.ts', display_operation: 'update', diff: '@@ -1 +1 @@\n-old\n+new' },
  ] });
  return { input, content, patch };
}

describe('recorded operation bodies', () => {
  it('keeps a large real ApplyPatch result and neighboring files, then reads only the selected source body', async () => {
    const { input, content, patch } = applyPatch();
    const collect = createOperationDiffCollector(workspace, sessionId);
    collect({ type: 'tool_call', name: 'ApplyPatch', toolUseId: callId, input: { input } });
    const result = collect({ type: 'tool_result', toolName: 'ApplyPatch', toolUseId: callId, content, isError: false })!;
    const files = ready(result).files;
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ path: 'large.ts', patch: '', bodyRef: { patchUnits: patch.length, contentUnits: 0 } });
    expect(files[1]?.patch).toContain('-old\n+new');
    expect(JSON.stringify(result).length).toBeLessThan(1_000);
    const { directory } = await logFixture('ApplyPatch', input, content);
    expect(await readOperationBody(request(JSON.parse(JSON.stringify(result))), { sessionsDirectory: directory })).toEqual({ patch });
  });

  it.each<OperationTool>(['create', 'write'])('preserves %s content beyond the transcript content budget across reload', async tool => {
    const text = 'body content\n'.repeat(11_000);
    const input = { file_path: '/workspace/large.ts', content: text };
    const content = JSON.stringify({ success: true, file_path: input.file_path });
    const summary = parseOperationResult(tool, input, content, workspace, callId, sessionId);
    expect(ready(summary).files[0]?.submittedContent).toBeUndefined();
    const { directory } = await logFixture(tool, input, content);
    expect(await readOperationBody(request(summary), { sessionsDirectory: directory })).toEqual({ patch: '', submittedContent: text });
  });

  it('accepts a structured Edit result above the old JSON source budget without growing inline transport', async () => {
    const before = 'old value '.repeat(3_000);
    const after = 'new value '.repeat(3_000);
    const input = { file_path: '/workspace/large.ts', old_str: before, new_str: after };
    const content = JSON.stringify({ success: true, file_path: input.file_path, linesAdded: 2, linesRemoved: 2, diffLines: [
      { type: 'removed', content: before, lineNumber: { old: 1 } }, { type: 'removed', content: before, lineNumber: { old: 2 } },
      { type: 'added', content: after, lineNumber: { new: 1 } }, { type: 'added', content: after, lineNumber: { new: 2 } },
    ] });
    expect(content.length).toBeGreaterThan(96_000);
    const summary = parseOperationResult('edit', input, content, workspace, callId, sessionId);
    const { directory } = await logFixture('Edit', input, content);
    const body = await readOperationBody(request(summary), { sessionsDirectory: directory });
    expect(body?.patch).toBe(`@@ -1,2 +1,2 @@\n-${before}\n-${before}\n+${after}\n+${after}`);
  });

  it('reads an unflushed result through the existing daemon client and stops on its exact message pair', async () => {
    const { input, content, patch } = applyPatch();
    const summary = parseOperationResult('applypatch', input, content, workspace, callId, sessionId);
    const { directory } = await logFixture('ApplyPatch', input, content, false);
    const newest = [
      { id: 'result', content: [{ type: 'tool_result', toolUseId: callId, content }] },
      ...Array.from({ length: 99 }, (_, index) => ({ id: `filler-${index}`, content: [] })),
    ];
    const readMessagePage = vi.fn(async (_session: string, options: { cursor?: string }) => options.cursor === undefined
      ? newest : [{ id: 'call', content: [{ type: 'tool_use', id: callId, name: 'ApplyPatch', input }] }]);
    expect(await readOperationBody(request(summary), { sessionsDirectory: directory, readMessagePage })).toEqual({ patch });
    expect(readMessagePage.mock.calls).toEqual([
      [sessionId, { limit: 100 }], [sessionId, { limit: 100, cursor: 'filler-98' }],
    ]);
  });

  it('rejects another file, call, session or changed source body instead of substituting current content', async () => {
    const { input, content } = applyPatch();
    const summary = parseOperationResult('applypatch', input, content, workspace, callId, sessionId);
    const target = request(summary);
    const { directory, file } = await logFixture('ApplyPatch', input, content);
    for (const changed of [
      { ...target, file: { ...target.file, path: 'other.ts' } },
      { ...target, callId: 'other-call' },
      { ...target, sourceSessionId: 'other-session' },
      { ...target, file: { ...target.file, bodyRef: { ...target.file.bodyRef!, digest: 'f'.repeat(64) } } },
    ]) expect(await readOperationBody(changed, { sessionsDirectory: directory })).toBeUndefined();
    const altered = await logFixture('ApplyPatch', input, content.replace('b'.repeat(25_000), 'c'.repeat(25_000)));
    expect(await readOperationBody(target, { sessionsDirectory: altered.directory })).toBeUndefined();
    await writeFile(file, JSON.stringify({ type: 'session_start', version: 2, id: 'different-session' }) + '\n');
    expect(await readOperationBody(target, { sessionsDirectory: directory })).toBeUndefined();
  });

  it('keeps sensitive results excluded and enforces a separate bounded body limit', () => {
    const text = 'x'.repeat(150_000);
    const restricted = ready(parseOperationResult('create', { file_path: '/workspace/.env', content: text },
      JSON.stringify({ success: true, file_path: '/workspace/.env' }), workspace, callId, sessionId));
    expect(restricted.files[0]).toMatchObject({ patch: '', contentRestricted: true });
    expect(restricted.files[0]?.bodyRef).toBeUndefined();
    expect(JSON.stringify(restricted)).not.toContain(text);
    const oversized = ready(parseOperationResult('create', { file_path: '/workspace/large.ts', content: 'x'.repeat(MAX_OPERATION_BODY_UNITS + 1) },
      JSON.stringify({ success: true, file_path: '/workspace/large.ts' }), workspace, callId, sessionId)).files[0];
    expect(oversized).toMatchObject({ path: 'large.ts', outcome: 'applied', patch: '', reversible: false });
    expect(oversized?.message).toContain('preview limit');
    expect(oversized?.bodyRef).toBeUndefined();
    expect(oversized?.submittedContent).toBeUndefined();
  });

  it('retains a large file outcome and neighboring patch when only one body exceeds the detail limit', () => {
    const { input, content } = applyPatch(260_000);
    const files = ready(parseOperationResult('applypatch', input, content, workspace, callId, sessionId)).files;
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ path: 'large.ts', outcome: 'applied', patch: '', reversible: false });
    expect(files[0]?.bodyRef).toBeUndefined();
    expect(files[0]?.message).toContain('preview limit');
    expect(files[1]?.patch).toContain('-old\n+new');
  });
});
