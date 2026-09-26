import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import { assistantWebviewReducer, initialAssistantWebviewState } from '../../webview/assistant/state/store';
import type { AssistantWebviewState } from '../../webview/assistant/state/types';
import type { ConversationToolOperation } from './conversationRecoveryState';
import { hydrateHostTranscriptState, projectHostTranscriptMessage } from './hostTranscriptState';
import { mergeToolOperations } from './operationEvidenceState';
import { SessionRecoveryStore } from './SessionRecoveryStore';
import { collapseStoredConversationCatalog } from '../chat/sessions/sessionCatalogProjection';

const history = (): SessionTranscriptItem[] => Array.from({ length: 1_999 }, (_, index) => ({
  id: `old-${index}`, kind: 'assistant', turnId: `old-${index}`, text: 'History '.repeat(20),
}));
const evidence = (): ConversationToolOperation[] => Array.from({ length: 1_000 }, (_, index) => ({
  toolUseId: `call-${index}`, toolName: 'Edit', executionPhase: 'settled_after_execution',
  operationDiff: { status: 'ready', source: 'tool-result', callId: `call-${index}`, sourceSessionId: 's',
    files: [{ path: `src/file-${index}.ts`, kind: 'modified', outcome: 'applied', reversible: true,
      patch: '@@ -1 +1 @@\n-old value\n+new value' }] },
}));

describe('streaming load regressions', () => {
  it('retains all deltas over a full transcript in Host and Webview', () => {
    let host = hydrateHostTranscriptState({ transcript: history(), historyStatus: 'complete', truncated: false });
    let webview: AssistantWebviewState = { ...initialAssistantWebviewState, sessionId: 's', transcript: history(),
      turn: { turnId: 'active', status: 'streaming' as const, activity: 'responding' as const } };
    const startHost = performance.now();
    for (let sequence = 1; sequence <= 10_000; sequence++) host = projectHostTranscriptMessage(host, {
      type: 'assistant.delta', sessionId: 's', turnId: 'active', sequence, delta: 'word ',
    });
    const hostMs = performance.now() - startHost;
    const startWebview = performance.now();
    for (let sequence = 1; sequence <= 10_000; sequence++) webview = assistantWebviewReducer(webview, {
      type: 'host.message', message: { type: 'assistant.delta', sessionId: 's', turnId: 'active', sequence, delta: 'word ' },
    });
    process.stdout.write(JSON.stringify({ workload: '2000 rows / 10000 deltas', hostMs,
      webviewMs: performance.now() - startWebview }) + '\n');
    expect(host.transcript).toHaveLength(2_000);
    expect(host.transcript.at(-1)).toMatchObject({ text: 'word '.repeat(10_000) });
    expect(webview.transcript.at(-1)).toMatchObject({ text: 'word '.repeat(10_000) });
  });

  it('preserves a large operation ledger without writing unchanged checkpoints', async () => {
    let writes = 0;
    const store = new SessionRecoveryStore({ get: () => undefined, update: async () => { writes++; } });
    const operations = evidence();
    const transcript = operations.map((operation, index): SessionTranscriptItem => ({
      ...operation, id: `tool-${index}`, kind: 'tool', turnId: 'active', action: 'Edit',
      status: 'completed', progressCount: 0, latestUpdateKind: null,
    }));
    const state = { transcript, historyStatus: 'complete' as const, truncated: false };
    const conversation = store.createConversation('s', state)!;
    const turn = { turnId: 'active', status: 'streaming' as const };
    store.writeActiveDisplay(conversation, 's', state, turn);
    await store.flush();
    const initialWrites = writes;
    const start = performance.now();
    for (let index = 0; index < 20; index++) store.writeActiveDisplay(conversation, 's', state, turn);
    const checkpointMs = performance.now() - start;
    const startMerge = performance.now();
    for (let index = 0; index < 20; index++) expect(mergeToolOperations(operations, operations)).toEqual(operations);
    process.stdout.write(JSON.stringify({ workload: '1000 operations / 20 unchanged checkpoints', checkpointMs,
      mergeMs: performance.now() - startMerge }) + '\n');
    await store.flush();
    expect(writes).toBe(initialWrites);
    expect(store.readTurn(conversation, 'active')?.toolOperations).toEqual(operations);
    await store.dispose();
  });

  it('projects the catalog and latest changes of an evidence-heavy conversation', async () => {
    const store = new SessionRecoveryStore({ get: () => undefined, update: async () => {} });
    const state = { transcript: [], historyStatus: 'complete' as const, truncated: false };
    const conversation = store.createConversation('s', state)!;
    const operations = evidence().slice(0, 100);
    for (let index = 0; index < 100; index++) store.recordSettledTurn(conversation, 's', `turn-${index}`,
      null, [{ path: `src/turn-${index}.ts`, additions: 1, deletions: 0 }], 'completed', undefined, operations);
    const catalog = { status: 'ready' as const, items: [{ id: 's', title: 'Synthetic session',
      messageCount: 100, modifiedTime: '2026-09-26T00:00:00.000Z', active: true, isFavorite: false }] };
    const start = performance.now();
    for (let index = 0; index < 100; index++) {
      expect(collapseStoredConversationCatalog(catalog, store).items[0]?.id).toBe('s');
      expect(store.readLatestChanges(conversation)?.turnId).toBe('turn-99');
    }
    process.stdout.write(JSON.stringify({ workload: '100 turns x 100 operations / 100 snapshot metadata reads',
      metadataMs: performance.now() - start }) + '\n');
    await store.dispose();
  });
});
