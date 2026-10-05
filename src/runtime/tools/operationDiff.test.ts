import { describe, expect, it } from 'vitest';
import { createOperationDiffCollector, describeOperation } from './operationDiff';
import type { DroidStreamEvent } from '@factory/droid-sdk/node';
import { isOperationDiff, operationDiffWithChanges } from '../../shared/protocol/operationDiff';

describe('operation change evidence', () => {
  it('drops context-only and identical edits, including saved evidence, while retaining metadata changes', () => {
    const unchanged = describeOperation('ApplyPatch', [
      '*** Begin Patch', '*** Update File: /workspace/a.ts', '@@', ' import { Module } from "nest";',
      '*** End Patch',
    ].join('\n'), '/workspace');
    expect(unchanged).toEqual({ status: 'unavailable', reason: 'unchanged' });
    expect(isOperationDiff(unchanged)).toBe(true);
    expect(describeOperation('Edit', { file_path: '/workspace/a.ts', old_str: 'same', new_str: 'same' }, '/workspace'))
      .toEqual(unchanged);
    const saved = { status: 'ready', source: 'successful-tool-input', files: [
      { path: 'context.ts', kind: 'modified', patch: '@@\n same' },
      { path: 'identical.ts', kind: 'modified', patch: '@@\n-same\n+same' },
      { path: 'changed.ts', kind: 'modified', patch: '@@\n-old\n+new' },
      { path: 'moved.ts', previousPath: 'old.ts', kind: 'renamed', patch: '@@' },
      { path: 'deleted.ts', kind: 'deleted', patch: '@@' },
      { path: 'empty.ts', kind: 'added', patch: '@@' },
    ] } as const;
    expect(operationDiffWithChanges(saved)).toMatchObject({ status: 'ready', files: saved.files.slice(2) });
    expect(operationDiffWithChanges({ ...saved, files: [saved.files[0]] })).toEqual(unchanged);
  });

  it('captures namespaced tools and freeform patches using the same native operation identity', () => {
    const collect = createOperationDiffCollector('/workspace');
    const patch = '*** Begin Patch\n*** Add File: /workspace/new.ts\n+export const ready = true;\n*** End Patch';
    collect({ type: 'tool_call', name: 'functions.ApplyPatch', toolUseId: 'patch-1',
      input: { input: patch } });
    expect(collect({ type: 'tool_result', toolName: 'ApplyPatch', toolUseId: 'patch-1', content: JSON.stringify({
      success: true, files: [{ file_path: '/workspace/new.ts', display_operation: 'create', content: 'export const ready = true;\n' }],
    }), isError: false })).toMatchObject({ status: 'ready', source: 'tool-result', callId: 'patch-1',
      files: [{ path: 'new.ts', kind: 'added', outcome: 'applied', patch: '@@ -0,0 +1,1 @@\n+export const ready = true;' }] });
    expect(describeOperation('functions.ApplyPatch', patch, '/workspace'))
      .toMatchObject({ status: 'ready', files: [{ path: 'new.ts', kind: 'added' }] });
  });
  it('keeps consecutive edits separate and distinguishes proposals from confirmed results', () => {
    const collect = createOperationDiffCollector('/workspace');
    const call = (id: string, old: string, next: string): DroidStreamEvent => ({
      type: 'tool_call', name: 'Edit', toolUseId: id,
      input: { file_path: '/workspace/a.ts', old_str: old, new_str: next },
    });
    const result = (id: string, old: string, next: string, isError = false): DroidStreamEvent => ({
      type: 'tool_result', toolName: 'Edit', toolUseId: id, content: isError ? 'Edit failed' : JSON.stringify({
        success: true, file_path: '/workspace/a.ts', linesAdded: 1, linesRemoved: 1,
        diffLines: [{ type: 'removed', content: old, lineNumber: { old: 1 } },
          { type: 'added', content: next, lineNumber: { new: 1 } }],
      }), isError,
    });
    expect(collect(call('a', 'one', 'two'))).toMatchObject({ status: 'ready', source: 'tool-input', callId: 'a' });
    const first = collect(result('a', 'one', 'two'));
    collect(call('b', 'two', 'three'));
    const second = collect(result('b', 'two', 'three'));
    expect(first).toMatchObject({ status: 'ready', source: 'tool-result', files: [{ outcome: 'applied', patch: '@@ -1,1 +1,1 @@\n-one\n+two' }] });
    expect(second).toMatchObject({ status: 'ready', source: 'tool-result', files: [{ outcome: 'applied', patch: '@@ -1,1 +1,1 @@\n-two\n+three' }] });
    collect(call('c', 'three', 'four'));
    expect(collect(result('c', 'three', 'four', true))).toEqual({ status: 'unavailable', reason: 'failed' });
    expect(collect(result('lost', 'a', 'b'))).toEqual({ status: 'unavailable', reason: 'not-recorded' });
  });
  it('groups patch files and preserves deletion and move semantics without invented lines', () => {
    expect(describeOperation('ApplyPatch', { input: [
      '*** Begin Patch', '*** Add File: /workspace/new.ts', '+new',
      '*** Update File: /workspace/old.ts', '*** Move to: /workspace/moved.ts', '@@', '-a', '+b',
      '*** Delete File: /workspace/gone.ts', '*** End Patch',
    ].join('\n') }, '/workspace')).toMatchObject({ status: 'ready', files: [
      { path: 'new.ts', kind: 'added', patch: '@@\n+new' },
      { path: 'moved.ts', previousPath: 'old.ts', kind: 'renamed', patch: '@@\n-a\n+b' },
      { path: 'gone.ts', kind: 'deleted', patch: '@@' },
    ] });
  });
  it('keeps overwrite and repeated-replacement input proposed and sensitive file content excluded', () => {
    expect(describeOperation('Create', { file_path: '/workspace/a', content: 'new' }, '/workspace'))
      .toMatchObject({ status: 'ready', source: 'tool-input', files: [{ path: 'a', kind: 'added', patch: '@@ -0,0 +1,1 @@\n+new\n\\ No newline at end of file' }] });
    expect(describeOperation('Edit', { file_path: '/workspace/a', old_str: 'a', new_str: 'b', change_all: true }, '/workspace'))
      .toMatchObject({ status: 'ready', source: 'tool-input', files: [{ path: 'a', kind: 'modified', message: 'Proposed replacement applies to every matching occurrence.' }] });
    expect(describeOperation('Edit', { file_path: '/workspace/.env', old_str: 'a', new_str: 'b' }, '/workspace'))
      .toMatchObject({ status: 'ready', source: 'tool-input', files: [{ path: '.env', contentRestricted: true, patch: '', reversible: false }] });
  });
});

describe('ApplyPatch result count reconciliation', () => {
  const input = ['*** Begin Patch', '*** Update File: /workspace/a.ts', '@@',
    '-old a', '-old b', '-old c', '+new a', '+new b', '+new c', '*** End Patch'].join('\n');
  const truncatedContext = ['@@ -46,9 +46,9 @@', ' ', ' intro', ' ',
    '-old a', '-old b', '-old c', '+new a', '+new b', '+new c', ' ', ' ## Projects'].join('\n');
  const corrected = truncatedContext.replace('-46,9 +46,9', '-46,8 +46,8');
  function collect(patch: string, submitted = input, isError = false) {
    const collector = createOperationDiffCollector('/workspace', 'session-patch');
    collector({ type: 'tool_call', name: 'ApplyPatch', toolUseId: 'patch', input: { input: submitted } });
    return collector({ type: 'tool_result', toolName: 'ApplyPatch', toolUseId: 'patch', isError,
      content: JSON.stringify({ success: true, files: [{ file_path: '/workspace/a.ts', display_operation: 'update', diff: patch }] }) });
  }

  it('reconciles the reported 9-line hunk with its 8 recorded lines when every submitted change is confirmed', () => {
    expect(collect(truncatedContext)).toEqual({ status: 'ready', source: 'tool-result', callId: 'patch',
      sourceSessionId: 'session-patch', files: [{ path: 'a.ts', kind: 'modified', outcome: 'applied',
        patch: corrected, reversible: true }] });
  });

  it('preserves valid earlier hunks and repairs only the final context count', () => {
    const submitted = input.replace('@@\n-old a', '@@\n-first\n+second\n@@\n-old a');
    const prefix = '@@ -1 +1 @@\n-first\n+second\n';
    expect(collect(prefix + truncatedContext, submitted)).toMatchObject({ files: [{ patch: prefix + corrected, reversible: true }] });
  });

  it.each([
    { name: 'missing replacement', patch: truncatedContext.replace('-old c\n', '').replace('+new c\n', '') },
    { name: 'missing addition', patch: truncatedContext.replace('+new c\n', '') },
    { name: 'altered replacement', patch: truncatedContext.replace('+new c\n', '+unexpected\n') },
    { name: 'reordered edits', patch: truncatedContext.replace('+new a\n+new b', '+new b\n+new a') },
    { name: 'unequal deficits', patch: truncatedContext.replace('-46,9 +46,9', '-46,9 +46,10') },
    { name: 'excess recorded lines', patch: truncatedContext.replace('-46,9 +46,9', '-46,7 +46,7') },
    { name: 'truncated nonfinal hunk', patch: truncatedContext + '\n@@ -60 +60 @@\n-end\n+last' },
  ])('retains the original warning and prevents undo for $name', ({ patch }) => {
    expect(collect(patch)).toMatchObject({ files: [{ patch, reversible: false,
      message: expect.stringContaining('line counts are inconsistent') }] });
  });

  it('does not grant undo when the SDK marks the otherwise recoverable result as failed', () => {
    expect(collect(truncatedContext, input, true)).toMatchObject({ files: [{ outcome: 'uncertain', reversible: false }] });
  });
});
