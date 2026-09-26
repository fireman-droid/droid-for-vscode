import { describe, expect, it } from 'vitest';
import type { ConversationToolOperation } from './conversationRecoveryState';
import { mergeToolOperations } from './operationEvidenceState';

function result(session: string, toolUseId = 'call'): ConversationToolOperation {
  return { toolUseId, toolName: 'Edit', executionPhase: 'settled_after_execution',
    operationDiff: { status: 'ready', source: 'tool-result', callId: 'canonical', sourceSessionId: session,
      files: [{ path: `${session}.ts`, kind: 'modified', outcome: 'applied', patch: '@@\n-old\n+new' }] } };
}
const unavailable = (reason: 'not-recorded' | 'failed' = 'not-recorded'): ConversationToolOperation => ({
  toolUseId: 'call', toolName: 'Edit', operationDiff: { status: 'unavailable', reason },
});

describe('operation evidence merging', () => {
  it('keeps parent and child evidence distinct when their tool IDs are reused', () => {
    const parent = result('parent');
    const child = result('child');
    expect(mergeToolOperations([parent], [child])).toEqual([parent, child]);
    // An unavailable update cannot pick an author when more than one call matches.
    expect(mergeToolOperations([parent, child], [unavailable()])).toEqual([parent, child, unavailable()]);
  });

  it('enriches one unavailable call and keeps confirmed evidence during later replay', () => {
    const confirmed = result('parent');
    const saved = mergeToolOperations([unavailable()], [confirmed]);
    expect(saved).toEqual([confirmed]);
    expect(mergeToolOperations(saved, [unavailable('failed')])).toEqual([confirmed]);
    expect(mergeToolOperations(saved, [structuredClone(confirmed)])).toEqual([confirmed]);
  });

  it('updates an aliased tool ID using the same canonical call, then finds it by its new ID', () => {
    const aliased = result('parent', 'new-alias');
    const updated = mergeToolOperations([result('parent')], [aliased]);
    expect(updated).toEqual([aliased]);
    expect(mergeToolOperations(updated, [{ ...unavailable(), toolUseId: 'new-alias' }])).toEqual([aliased]);
  });

  it('retains exact file metadata on input evidence replay and accepts changed input evidence', () => {
    const confirmed = result('parent');
    if (confirmed.operationDiff.status !== 'ready') throw new Error('Fixture must be ready');
    const input: ConversationToolOperation = { ...confirmed,
      operationDiff: { ...confirmed.operationDiff, source: 'tool-input' } };
    expect(mergeToolOperations([input], [structuredClone(input)])).toEqual([input]);
    const changed = { ...input, operationDiff: { ...confirmed.operationDiff,
      source: 'tool-input' as const, files: [{ ...confirmed.operationDiff.files[0]!, message: 'Changed detail' }] } };
    expect(mergeToolOperations([input], [changed])).toEqual([changed]);
  });
});
