import { describe, expect, it } from 'vitest';
import { matchingOperationBody, operationBodyReference } from '../../runtime/tools/operationBodyReference';
import { isOperationDiff } from '../../shared/protocol/operationDiff';
import type { ConversationToolOperation } from './conversationRecoveryState';
import { createHostTranscriptState } from './hostTranscriptState';
import { MAX_RECOVERY_TEXT_UNITS, SessionRecoveryStore, type SessionRecoveryPersistence } from './SessionRecoveryStore';

const sessionId = 'session-active';
const body = 'x'.repeat(99_000);
const cache = createHostTranscriptState('complete');
function operation(index: number, attributed: boolean): ConversationToolOperation {
  return {
    toolUseId: `create-${index}`, toolName: 'Create', executionPhase: 'settled_after_execution',
    operationDiff: { status: 'ready', source: 'tool-result',
      ...(attributed ? { callId: `create-${index}`, sourceSessionId: sessionId } : {}),
      files: [{ path: `file-${index}.ts`, kind: 'added', outcome: 'applied',
        reversible: false, patch: '', submittedContent: body }] },
  };
}

describe('recovery inline evidence budget', () => {
  it.each([true, false])('keeps identity, lineage and queued prompts across incremental overflow (attributed=%s)', async attributed => {
    let saved: unknown;
    const persistence: SessionRecoveryPersistence = {
      get: <T>() => saved as T | undefined,
      update: async (_key, value) => { saved = structuredClone(value); },
    };
    let store = new SessionRecoveryStore(persistence);
    const conversationId = store.createConversation('session-root', cache)!;
    store.selectConversation(conversationId);
    store.adoptSuccessor(conversationId, 'session-root', sessionId, 'compact');
    store.writeConversationQueuedTexts(conversationId, ['First pending request', 'Second pending request']);
    const original = operation(0, attributed);
    try {
      for (let index = 0; index < 31; index++) {
        const evidence = operation(index, attributed);
        expect(isOperationDiff(evidence.operationDiff)).toBe(true);
        expect(store.recordSettledTurn(conversationId, sessionId, `turn-${index}`, null,
          [{ path: `file-${index}.ts`, additions: null, deletions: null }], 'completed', undefined, [evidence])).toBe(true);
        expect(store.writeActiveDisplay(conversationId, sessionId, cache,
          { turnId: 'active-turn', backendTurnId: 'backend-turn', status: 'streaming' })).toBe(true);
        await store.flush();
        await store.dispose();
        store = new SessionRecoveryStore(persistence);
        await store.load();
        expect(store.getSelectedConversationId()).toBe(conversationId);
        expect(store.getSelectedSessionId()).toBe(sessionId);
        expect(store.readConversationQueuedTexts(conversationId)).toEqual(['First pending request', 'Second pending request']);
        expect(store.readConversation(conversationId)?.nodes).toMatchObject([
          { sessionId: 'session-root', relation: 'root' },
          { sessionId, relation: 'compact', parentSessionId: 'session-root' },
        ]);
        expect(store.readDisplay(conversationId)?.turn).toMatchObject({ backendTurnId: 'backend-turn', status: 'streaming' });
      }
      const turns = store.readConversation(conversationId)!.turns;
      expect(turns).toHaveLength(31);
      const retained = turns.flatMap(turn => turn.toolOperations ?? []);
      const units = retained.reduce((total, entry) => total + (entry.operationDiff.status === 'ready'
        ? entry.operationDiff.files.reduce((sum, file) => sum + file.patch.length + (file.submittedContent?.length ?? 0), 0) : 0), 0);
      expect(units).toBeLessThanOrEqual(MAX_RECOVERY_TEXT_UNITS);
      const compacted = store.readTurn(conversationId, 'turn-0')!.toolOperations![0]!.operationDiff;
      expect(isOperationDiff(compacted)).toBe(true);
      if (attributed && original.operationDiff.status === 'ready') {
        const file = original.operationDiff.files[0]!;
        expect(compacted).toMatchObject({ status: 'ready', sourceSessionId: sessionId, callId: 'create-0',
          files: [{ patch: '', reversible: false, bodyRef: operationBodyReference(sessionId, 'create-0', file) }] });
        if (compacted.status !== 'ready') throw new Error('Expected an attributed reference');
        expect(compacted.files[0]?.submittedContent).toBeUndefined();
        const request = { workspace: '/workspace', sourceSessionId: sessionId, callId: 'create-0', file: compacted.files[0]! };
        expect(matchingOperationBody(request, original.operationDiff)).toEqual({ patch: '', submittedContent: body });
        expect(matchingOperationBody({ ...request, sourceSessionId: 'unrelated' }, original.operationDiff)).toBeUndefined();
      } else {
        expect(compacted).toEqual({ status: 'unavailable', reason: 'evicted' });
      }
      store.mergeTurnToolOperations(conversationId, sessionId, 'turn-0', [original]);
      expect(store.readTurn(conversationId, 'turn-0')?.toolOperations?.[0]?.operationDiff).toEqual(compacted);
      expect(store.writeActiveDisplay(conversationId, sessionId, cache,
        { turnId: 'active-turn', backendTurnId: 'backend-turn', status: 'streaming' })).toBe(true);
      await store.flush();
    } finally { await store.dispose(); }
  });
});
