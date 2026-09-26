import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import type { ConversationToolOperation } from './conversationRecoveryState';
import { SessionRecoveryStore } from './SessionRecoveryStore';

it('persists changed tool evidence to disk once and reloads it without sharing mutable read results', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'droid-operation-checkpoint-'));
  const file = path.join(directory, 'recovery.json');
  let stored: unknown;
  let writes = 0;
  const persistence = {
    get: <T,>(): T | undefined => stored as T | undefined,
    update: async (_key: string, value: unknown) => {
      await writeFile(file, JSON.stringify(value));
      stored = value;
      writes++;
    },
  };
  const store = new SessionRecoveryStore(persistence);
  try {
    const operation: ConversationToolOperation = { toolUseId: 'call', toolName: 'Edit',
      operationDiff: { status: 'ready', source: 'tool-input', callId: 'call', sourceSessionId: 's',
        files: [{ path: 'source.ts', kind: 'modified', patch: '@@\n-before\n+after' }] } };
    const tool: SessionTranscriptItem = { ...operation, id: 'tool-call', kind: 'tool', turnId: 'turn',
      status: 'running', action: 'Edit', progressCount: 0, latestUpdateKind: null };
    const state = { transcript: [tool], historyStatus: 'complete' as const, truncated: false };
    const conversation = store.createConversation('s', state)!;
    const turn = { turnId: 'turn', status: 'streaming' as const };
    store.writeActiveDisplay(conversation, 's', state, turn);
    await store.flush();
    store.writeActiveDisplay(conversation, 's', structuredClone(state), turn);
    await store.flush();
    expect(writes).toBe(1);
    const confirmed: ConversationToolOperation = { ...operation, executionPhase: 'settled_after_execution',
      operationDiff: { status: 'ready', source: 'tool-result', callId: 'call', sourceSessionId: 's',
        files: [{ path: 'source.ts', kind: 'modified', outcome: 'applied', reversible: true, patch: '@@\n-before\n+after' }] } };
    store.writeActiveDisplay(conversation, 's', { ...state, transcript: [{ ...tool, ...confirmed, status: 'completed' }] }, turn);
    await store.flush();
    expect(writes).toBe(2);
    stored = JSON.parse(await readFile(file, 'utf8'));
    const reloaded = new SessionRecoveryStore(persistence);
    await reloaded.load();
    const read = reloaded.readTurn(conversation, 'turn')!;
    expect(read.toolOperations).toEqual([confirmed]);
    if (read.toolOperations?.[0]?.operationDiff.status === 'ready') {
      const file = read.toolOperations[0].operationDiff.files[0] as { patch: string };
      file.patch = 'mutated outside store';
    }
    expect(reloaded.readLatestOperations(conversation)?.toolOperations).toEqual([confirmed]);
    await reloaded.dispose();
  } finally {
    await store.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
