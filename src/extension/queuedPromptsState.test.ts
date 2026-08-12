import { describe, expect, it } from 'vitest';

import { MAX_QUEUED_MESSAGES } from '../shared/queueProtocol';
import {
  clearPrompts,
  dropDispatchedPrompt,
  emptyQueuedPromptsState,
  enqueuePrompt,
  evaluateQueueDispatch,
  markDispatchBlocked,
  pauseAfterTerminal,
  removePrompt,
  resumeQueue,
  updatePromptText,
  type QueueDispatchGuards,
  type QueuedPromptsState,
} from './queuedPromptsState';

type Marker = string;

function prompt(queueId: string, text = `text ${queueId}`) {
  return { queueId, text, attachments: [] as Marker[] };
}

function filled(
  ...queueIds: string[]
): QueuedPromptsState<Marker> {
  let state = emptyQueuedPromptsState<Marker>();
  for (const queueId of queueIds) {
    const result = enqueuePrompt(state, prompt(queueId));
    if (!result.accepted) {
      throw new Error(`enqueue rejected: ${result.reason}`);
    }
    state = result.state;
  }
  return state;
}

const openGuards: QueueDispatchGuards = {
  turnActive: false,
  connected: true,
  hasRuntime: true,
  hasSession: true,
  hasPendingInteractions: false,
  sessionOperationInProgress: false,
  settingsUpdateInProgress: false,
};

describe('queuedPromptsState', () => {
  it('keeps FIFO order and rejects duplicates, blanks, and overflow', () => {
    let state = filled('queue-1', 'queue-2', 'queue-3');
    expect(state.items.map(({ queueId }) => queueId)).toEqual([
      'queue-1',
      'queue-2',
      'queue-3',
    ]);

    expect(enqueuePrompt(state, prompt('queue-2'))).toEqual({
      accepted: false,
      reason: 'duplicate',
    });
    expect(
      enqueuePrompt(state, prompt('queue-4', '   \n\t ')),
    ).toEqual({ accepted: false, reason: 'empty-text' });

    for (let index = state.items.length; index < MAX_QUEUED_MESSAGES; index += 1) {
      const result = enqueuePrompt(state, prompt(`fill-${index}`));
      expect(result.accepted).toBe(true);
      if (result.accepted) {
        state = result.state;
      }
    }
    expect(state.items).toHaveLength(MAX_QUEUED_MESSAGES);
    expect(enqueuePrompt(state, prompt('queue-overflow'))).toEqual({
      accepted: false,
      reason: 'full',
    });
  });

  it('updates queued text and ignores dispatched or blank edits', () => {
    const state = filled('queue-1', 'queue-2');
    const updated = updatePromptText(state, 'queue-2', 'edited text');
    expect(updated.updated).toBe(true);
    expect(updated.state.items[1]).toMatchObject({
      queueId: 'queue-2',
      text: 'edited text',
    });
    // The first item is untouched, order preserved.
    expect(updated.state.items[0]).toMatchObject({ queueId: 'queue-1' });

    expect(updatePromptText(state, 'queue-gone', 'text').updated).toBe(
      false,
    );
    expect(updatePromptText(state, 'queue-1', '   ').updated).toBe(false);
  });

  it('removes single prompts and clears the pause when emptied', () => {
    let state = pauseAfterTerminal(filled('queue-1', 'queue-2'), 'interrupted');
    expect(state.paused).toBe('stopped');

    const first = removePrompt(state, 'queue-1');
    expect(first.removed).toBe(true);
    expect(first.state.paused).toBe('stopped');

    const missing = removePrompt(first.state, 'queue-1');
    expect(missing.removed).toBe(false);
    expect(missing.state).toBe(first.state);

    const last = removePrompt(first.state, 'queue-2');
    expect(last.removed).toBe(true);
    expect(last.state).toEqual({ items: [], paused: null });

    state = clearPrompts();
    expect(state).toEqual({ items: [], paused: null });
  });

  it('pauses after Stop and failure but never on an empty queue', () => {
    expect(
      pauseAfterTerminal(filled('queue-1'), 'interrupted').paused,
    ).toBe('stopped');
    expect(pauseAfterTerminal(filled('queue-1'), 'failed').paused).toBe(
      'turn-failed',
    );
    expect(
      pauseAfterTerminal(emptyQueuedPromptsState<Marker>(), 'failed')
        .paused,
    ).toBeNull();
    // An existing pause reason is preserved, not overwritten.
    const blocked = markDispatchBlocked(filled('queue-1'));
    expect(pauseAfterTerminal(blocked, 'interrupted').paused).toBe(
      'dispatch-blocked',
    );
  });

  it('resumes an explicitly paused queue', () => {
    const paused = pauseAfterTerminal(filled('queue-1'), 'failed');
    const resumed = resumeQueue(paused);
    expect(resumed.paused).toBeNull();
    expect(resumed.items).toHaveLength(1);
    const untouched = resumeQueue(resumed);
    expect(untouched).toBe(resumed);
  });

  it('decides idle, wait, blocked, and dispatch from the guard set', () => {
    const state = filled('queue-1', 'queue-2');

    expect(
      evaluateQueueDispatch(emptyQueuedPromptsState<Marker>(), openGuards),
    ).toEqual({ kind: 'idle' });
    expect(
      evaluateQueueDispatch(
        pauseAfterTerminal(state, 'interrupted'),
        openGuards,
      ),
    ).toEqual({ kind: 'idle' });

    expect(
      evaluateQueueDispatch(state, { ...openGuards, turnActive: true }),
    ).toEqual({ kind: 'wait' });
    expect(
      evaluateQueueDispatch(state, { ...openGuards, connected: false }),
    ).toEqual({ kind: 'wait' });
    expect(
      evaluateQueueDispatch(state, { ...openGuards, hasRuntime: false }),
    ).toEqual({ kind: 'wait' });
    expect(
      evaluateQueueDispatch(state, { ...openGuards, hasSession: false }),
    ).toEqual({ kind: 'wait' });

    expect(
      evaluateQueueDispatch(state, {
        ...openGuards,
        hasPendingInteractions: true,
      }),
    ).toEqual({ kind: 'blocked' });
    expect(
      evaluateQueueDispatch(state, {
        ...openGuards,
        sessionOperationInProgress: true,
      }),
    ).toEqual({ kind: 'blocked' });
    expect(
      evaluateQueueDispatch(state, {
        ...openGuards,
        settingsUpdateInProgress: true,
      }),
    ).toEqual({ kind: 'blocked' });

    const decision = evaluateQueueDispatch(state, openGuards);
    expect(decision).toMatchObject({
      kind: 'dispatch',
      prompt: { queueId: 'queue-1' },
    });
  });

  it('drops the dispatched head and clears the pause when the queue empties', () => {
    const state = filled('queue-1', 'queue-2');
    const shorter = dropDispatchedPrompt(state, 'queue-1');
    expect(shorter.items.map(({ queueId }) => queueId)).toEqual([
      'queue-2',
    ]);
    const empty = dropDispatchedPrompt(
      markDispatchBlocked(shorter),
      'queue-2',
    );
    expect(empty).toEqual({ items: [], paused: null });
  });
});
