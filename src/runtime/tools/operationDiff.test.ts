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
    expect(collect({ type: 'tool_result', toolName: 'ApplyPatch', toolUseId: 'patch-1', content: 'Success', isError: false }))
      .toMatchObject({ status: 'ready', callId: 'patch-1', files: [{ path: 'new.ts', kind: 'added', patch: '@@\n+export const ready = true;' }] });
    expect(describeOperation('functions.ApplyPatch', patch, '/workspace'))
      .toMatchObject({ status: 'ready', files: [{ path: 'new.ts', kind: 'added' }] });
  });
  it('keeps consecutive edits separate and publishes only on success', () => {
    const collect = createOperationDiffCollector('/workspace');
    const call = (id: string, old: string, next: string): DroidStreamEvent => ({
      type: 'tool_call', name: 'Edit', toolUseId: id,
      input: { file_path: '/workspace/a.ts', old_str: old, new_str: next },
    });
    const result = (id: string, isError = false): DroidStreamEvent => ({
      type: 'tool_result', toolName: 'Edit', toolUseId: id, content: 'Success', isError,
    });
    expect(collect(call('a', 'one', 'two'))).toBeUndefined();
    const first = collect(result('a'));
    collect(call('b', 'two', 'three'));
    const second = collect(result('b'));
    expect(first).toMatchObject({ status: 'ready', files: [{ patch: '@@\n-one\n+two' }] });
    expect(second).toMatchObject({ status: 'ready', files: [{ patch: '@@\n-two\n+three' }] });
    collect(call('c', 'three', 'four'));
    expect(collect(result('c', true))).toEqual({ status: 'unavailable', reason: 'failed' });
    expect(collect(result('lost'))).toEqual({ status: 'unavailable', reason: 'not-recorded' });
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
  it('does not infer overwrite baselines, repeated replacements, or sensitive content', () => {
    expect(describeOperation('Create', { file_path: '/workspace/a', content: 'new' }, '/workspace'))
      .toMatchObject({ status: 'unavailable', reason: 'unattributed' });
    expect(describeOperation('Edit', { file_path: '/workspace/a', old_str: 'a', new_str: 'b', change_all: true }, '/workspace'))
      .toMatchObject({ status: 'unavailable', reason: 'unattributed' });
    expect(describeOperation('Edit', { file_path: '/workspace/.env', old_str: 'a', new_str: 'b' }, '/workspace'))
      .toMatchObject({ status: 'unavailable', reason: 'restricted' });
  });
});
