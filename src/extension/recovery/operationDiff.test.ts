import { describe, expect, it } from 'vitest';
import { createTurnActivityState, projectToolEvent } from '../chat/turns/turnActivityState';
import { createHostTranscriptState, projectHostTranscriptMessage } from './hostTranscriptState';
import { parseRecoveryTranscript } from './conversationRecoveryParser';
import { readHostMessage } from '../../webview-v2/bridge/validateHostMessage';
import { preserveToolResultPreviews, enforceToolResultBudget } from '../../shared/transcript/toolResultPreview';
import { upsertTool } from '../../webview-v2/chat/transcript/toolTranscript';
import type { ToolActivityMessage } from '../../shared/protocol/toolProtocol';
import type { OperationDiff } from '../../shared/protocol/operationDiff';
import { projectSessionMessages } from '../../runtime/history/projectSessionHistory';
import { ingestConversationHistory } from './ingestConversationHistory';

describe('operation Diff identity and recovery', () => {
  it('refreshes a saved malformed hunk from the same raw result without replacing its recorded content or identity', () => {
    const input = '*** Begin Patch\n*** Update File: /workspace/a.ts\n@@\n-old\n+new\n*** End Patch';
    const patch = '@@ -1,4 +1,4 @@\n header\n-old\n+new\n footer';
    const history = projectSessionMessages([
      { role: 'user', id: 'prompt', content: [{ type: 'text', text: 'Update file' }] },
      { role: 'assistant', id: 'answer', content: [{ type: 'tool_use', id: 'patch', name: 'ApplyPatch', input: { input } }] },
      { role: 'tool', id: 'result', content: [{ type: 'tool_result', toolUseId: 'patch', isError: false,
        content: JSON.stringify({ success: true, files: [{ file_path: '/workspace/a.ts', display_operation: 'update', diff: patch }] }) }] },
    ], { workspaceRoot: '/workspace' });
    if (history.status !== 'available') throw new Error('History projection failed');
    const tool = history.state.transcript.find(item => item.kind === 'tool')!;
    if (tool.kind !== 'tool' || tool.operationDiff?.status !== 'ready') throw new Error('Missing tool result');
    const saved = { ...tool, id: 'live-row', turnId: 'live-turn', operationDiff: { ...tool.operationDiff,
      files: [{ ...tool.operationDiff.files[0]!, patch, reversible: false, message: 'Diff line counts are inconsistent.' }] } };
    const canonical = { historyStatus: 'complete' as const, truncated: false,
      transcript: [history.state.transcript[0]!, saved] };
    const expected = { ...tool.operationDiff, files: [{ path: 'a.ts', kind: 'modified', outcome: 'applied',
      patch: patch.replace('-1,4 +1,4', '-1,3 +1,3'), reversible: true }] };
    expect(ingestConversationHistory(canonical, history.state).transcript[1])
      .toMatchObject({ id: 'live-row', turnId: 'live-turn', operationDiff: expected });
    expect(preserveToolResultPreviews([tool], [saved])[0]).toMatchObject({ operationDiff: expected });
    const differentContent = { ...saved, operationDiff: { ...saved.operationDiff,
      files: [{ ...saved.operationDiff.files[0]!, patch: patch.replace('+new', '+another') }] } };
    expect(preserveToolResultPreviews([tool], [differentContent])[0]).toMatchObject({ operationDiff: differentContent.operationDiff });
  });

  it('reconstructs successful historical edits and replaces old missing-data markers only for the same raw call', () => {
    const result = (before: string, after: string) => JSON.stringify({ success: true, file_path: '/workspace/a.ts',
      linesAdded: 1, linesRemoved: 1, diffLines: [
        { type: 'removed', content: before, lineNumber: { old: 1 } },
        { type: 'added', content: after, lineNumber: { new: 1 } },
      ] });
    const history = projectSessionMessages([
      { role: 'user', id: 'prompt', content: [{ type: 'text', text: 'Update file' }] },
      { role: 'assistant', id: 'answer', content: [
        { type: 'tool_use', id: 'edit-1', name: 'Edit', input: { file_path: '/workspace/a.ts', old_str: 'one', new_str: 'two' } },
        { type: 'tool_use', id: 'edit-2', name: 'Edit', input: { file_path: '/workspace/a.ts', old_str: 'two', new_str: 'three' } },
        { type: 'tool_use', id: 'edit-failed', name: 'Edit', input: { file_path: '/workspace/a.ts', old_str: 'three', new_str: 'four' } },
      ] },
      { role: 'tool', id: 'results', content: [
        { type: 'tool_result', toolUseId: 'edit-1', content: result('one', 'two'), isError: false },
        { type: 'tool_result', toolUseId: 'edit-2', content: result('two', 'three'), isError: false },
        { type: 'tool_result', toolUseId: 'edit-failed', content: 'No match', isError: true },
      ] },
    ], { workspaceRoot: '/workspace' });
    expect(history.status).toBe('available');
    if (history.status !== 'available') throw new Error('History projection failed');
    const tools = history.state.transcript.filter((item) => item.kind === 'tool');
    expect(tools.map((item) => item.operationDiff)).toMatchObject([
      { status: 'ready', callId: 'edit-1', files: [{ patch: '@@ -1,1 +1,1 @@\n-one\n+two' }] },
      { status: 'ready', callId: 'edit-2', files: [{ patch: '@@ -1,1 +1,1 @@\n-two\n+three' }] },
      { status: 'unavailable', reason: 'failed' },
    ]);
    const canonicalTool = { ...tools[0]!, id: 'live-row', turnId: 'live-turn', toolUseId: 'edit-1',
      operationDiff: { status: 'unavailable' as const, reason: 'not-recorded' as const } };
    const canonical = { historyStatus: 'complete' as const, truncated: false,
      transcript: [history.state.transcript[0]!, canonicalTool] };
    expect(ingestConversationHistory(canonical, history.state).transcript[1])
      .toMatchObject({ id: 'live-row', turnId: 'live-turn', toolUseId: 'edit-1', operationDiff: tools[0]!.operationDiff });
    expect(preserveToolResultPreviews(tools, [canonicalTool])[0]).toMatchObject({ operationDiff: tools[0]!.operationDiff });
    expect(ingestConversationHistory({ ...canonical, transcript: [canonical.transcript[0]!, { ...canonicalTool, toolUseId: 'different' }] }, history.state).transcript[1])
      .toMatchObject({ operationDiff: { status: 'unavailable', reason: 'not-recorded' } });
    expect(preserveToolResultPreviews(tools, [{ ...canonicalTool, operationDiff: { status: 'unavailable', reason: 'evicted' } }])[0])
      .toMatchObject({ operationDiff: { status: 'unavailable', reason: 'evicted' } });
  });
  it('keeps immutable operation evidence through Host, Bridge, reload and history enrichment', () => {
    const operationDiff: OperationDiff = { status: 'ready', source: 'successful-tool-input',
      files: [{ path: 'a.ts', kind: 'modified', patch: '@@\n-old\n+new' }] };
    const completed = projectToolEvent(createTurnActivityState(), {
      type: 'tool-result', toolUseId: 'call-1', toolName: 'Edit', action: 'Edit file', isError: false, operationDiff,
    });
    const message: ToolActivityMessage = { type: 'tool.activity', sequence: 1, sessionId: 's1', turnId: 't1', ...completed.projection! };
    expect(readHostMessage(message)).toEqual(message);
    const host = projectHostTranscriptMessage(createHostTranscriptState('complete'), message);
    const recovered = parseRecoveryTranscript(host);
    expect(recovered?.transcript[0]).toMatchObject({ operationDiff });
    const items = upsertTool([], message);
    expect(items[0]).toMatchObject({ operationDiff });
    const loaded = items.map((item) => {
      if (item.kind !== 'tool') return item;
      const { operationDiff: _, ...metadata } = item;
      return metadata;
    });
    expect(preserveToolResultPreviews(loaded, recovered!.transcript)[0]).toMatchObject({ operationDiff });
    const modified = upsertTool(items, { ...message, sequence: 2, operationDiff: { ...operationDiff, files: [{ path: 'a.ts', kind: 'modified', patch: '@@\n-new\n+later' }] } });
    expect(modified[0]).toMatchObject({ operationDiff });
  });
  it('bounds retained operation content and rejects malformed paths at the bridge', () => {
    const base = { id: 'call', kind: 'tool' as const, turnId: 't1', toolUseId: 'call', toolName: 'Edit',
      action: 'Edit file', status: 'completed' as const, progressCount: 0, latestUpdateKind: null };
    const operationDiff = { status: 'ready' as const, source: 'successful-tool-input' as const,
      files: [{ path: 'a.ts', kind: 'modified' as const, patch: '@@\n+' + 'x'.repeat(20_000) }] };
    const items = enforceToolResultBudget(Array.from({ length: 8 }, (_, index) => ({ ...base, id: String(index), operationDiff }))).items;
    expect(items[0]?.operationDiff).toMatchObject({ status: 'unavailable', reason: 'evicted' });
    expect(items.at(-1)?.operationDiff).toEqual(operationDiff);
    const { id: _, kind: __, ...fields } = base;
    expect(readHostMessage({ ...fields, type: 'tool.activity', sequence: 1, sessionId: 's1',
      operationDiff: { ...operationDiff, files: [{ ...operationDiff.files[0], path: '../escape' }] } })).toBeUndefined();
  });
});
