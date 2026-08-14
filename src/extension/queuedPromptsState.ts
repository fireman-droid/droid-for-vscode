import {
  MAX_QUEUED_MESSAGES,
  type QueuePausedReason,
} from '../shared/queueProtocol';

/**
 * Pure state machine for the host-side queued-prompts feature
 * (queued-messages-design.md §4.1). `ChatController` owns the side
 * effects (dispatching through `handleSend`, emitting `queue.state`,
 * diagnostics); every transition decision lives here so the full
 * lifecycle is unit-testable without a controller.
 *
 * The attachment payload type stays generic: the controller stores
 * its private `PendingAttachment` staging entries, the tests store
 * plain markers.
 */

export interface QueuedPrompt<Attachment> {
  readonly queueId: string;
  readonly text: string;
  /** Staging consumed at enqueue time; dispatched with the prompt. */
  readonly attachments: readonly Attachment[];
}

export interface QueuedPromptsState<Attachment> {
  readonly items: readonly QueuedPrompt<Attachment>[];
  readonly paused: QueuePausedReason | null;
}

export function emptyQueuedPromptsState<Attachment>(): QueuedPromptsState<Attachment> {
  return { items: [], paused: null };
}

export type EnqueueRejectReason = 'full' | 'duplicate' | 'empty-text';

export type EnqueueResult<Attachment> =
  | {
      readonly accepted: true;
      readonly state: QueuedPromptsState<Attachment>;
    }
  | { readonly accepted: false; readonly reason: EnqueueRejectReason };

/**
 * Appends a prompt to the tail. FIFO order is strict: there is no
 * priority insert. Rejections leave the state untouched so callers
 * can drop the request silently (mirroring `handleSend`'s defensive
 * style) while logging the reason.
 */
export function enqueuePrompt<Attachment>(
  state: QueuedPromptsState<Attachment>,
  prompt: QueuedPrompt<Attachment>,
): EnqueueResult<Attachment> {
  if (prompt.text.trim().length === 0) {
    return { accepted: false, reason: 'empty-text' };
  }
  if (state.items.length >= MAX_QUEUED_MESSAGES) {
    return { accepted: false, reason: 'full' };
  }
  if (state.items.some((item) => item.queueId === prompt.queueId)) {
    return { accepted: false, reason: 'duplicate' };
  }
  return {
    accepted: true,
    state: { ...state, items: [...state.items, prompt] },
  };
}

/**
 * Replaces the text of a still-queued prompt. Unknown queue ids are
 * reported (not thrown): the prompt may have been dispatched while
 * the edit was in flight, and the authoritative `queue.state` echo
 * corrects the webview.
 */
export function updatePromptText<Attachment>(
  state: QueuedPromptsState<Attachment>,
  queueId: string,
  text: string,
): { readonly state: QueuedPromptsState<Attachment>; readonly updated: boolean } {
  if (text.trim().length === 0) {
    return { state, updated: false };
  }
  const index = state.items.findIndex(
    (item) => item.queueId === queueId,
  );
  const item = state.items[index];
  if (item === undefined) {
    return { state, updated: false };
  }
  return {
    state: {
      ...state,
      items: state.items.map((entry, entryIndex) =>
        entryIndex === index ? { ...item, text } : entry,
      ),
    },
    updated: true,
  };
}

/**
 * Drops one queued prompt. Emptying the queue clears the paused
 * reason: a pause only describes prompts that still exist.
 */
export function removePrompt<Attachment>(
  state: QueuedPromptsState<Attachment>,
  queueId: string,
): { readonly state: QueuedPromptsState<Attachment>; readonly removed: boolean } {
  const items = state.items.filter(
    (item) => item.queueId !== queueId,
  );
  if (items.length === state.items.length) {
    return { state, removed: false };
  }
  return {
    state: {
      items,
      paused: items.length === 0 ? null : state.paused,
    },
    removed: true,
  };
}

export function clearPrompts<Attachment>(): QueuedPromptsState<Attachment> {
  return { items: [], paused: null };
}

/**
 * Moves one queued prompt to the head ("send now",
 * queued-messages-design.md §4.8). This pure transition only owns
 * ordering; the caller decides whether to resume a pause, stop an
 * active turn, and re-evaluate dispatch. Unknown ids are reported,
 * not thrown, mirroring `updatePromptText`.
 */
export function promotePrompt<Attachment>(
  state: QueuedPromptsState<Attachment>,
  queueId: string,
): {
  readonly state: QueuedPromptsState<Attachment>;
  readonly promoted: boolean;
} {
  const index = state.items.findIndex(
    (item) => item.queueId === queueId,
  );
  const item = state.items[index];
  if (item === undefined) {
    return { state, promoted: false };
  }
  if (index === 0) {
    return { state, promoted: true };
  }
  return {
    state: {
      ...state,
      items: [
        item,
        ...state.items.filter((entry) => entry.queueId !== queueId),
      ],
    },
    promoted: true,
  };
}

export function resumeQueue<Attachment>(
  state: QueuedPromptsState<Attachment>,
): QueuedPromptsState<Attachment> {
  return state.paused === null ? state : { ...state, paused: null };
}

/**
 * Applies the terminal-status pause policy: only `completed`
 * dispatches automatically. Stop (`interrupted`) means the user's
 * plan changed; `failed` would cascade prompts into a broken
 * runtime. Both keep the queue and suspend dispatch until the user
 * resumes or clears. An empty queue never pauses — a later enqueue
 * while idle must dispatch immediately.
 */
export function pauseAfterTerminal<Attachment>(
  state: QueuedPromptsState<Attachment>,
  status: 'interrupted' | 'failed',
): QueuedPromptsState<Attachment> {
  if (state.items.length === 0 || state.paused !== null) {
    return state;
  }
  return {
    ...state,
    paused: status === 'interrupted' ? 'stopped' : 'turn-failed',
  };
}

/** Marks a dispatch attempt vetoed by a transient guard. */
export function markDispatchBlocked<Attachment>(
  state: QueuedPromptsState<Attachment>,
): QueuedPromptsState<Attachment> {
  return { ...state, paused: 'dispatch-blocked' };
}

/** Dequeues the head prompt after a successful dispatch. */
export function dropDispatchedPrompt<Attachment>(
  state: QueuedPromptsState<Attachment>,
  queueId: string,
): QueuedPromptsState<Attachment> {
  const items = state.items.filter(
    (item) => item.queueId !== queueId,
  );
  return {
    items,
    paused: items.length === 0 ? null : state.paused,
  };
}

/**
 * Guard inputs mirrored from `ChatController.handleSend` so the
 * dispatch decision and the send acceptance can never drift apart.
 */
export interface QueueDispatchGuards {
  readonly turnActive: boolean;
  readonly connected: boolean;
  readonly hasRuntime: boolean;
  readonly hasSession: boolean;
  readonly hasPendingInteractions: boolean;
  readonly sessionOperationInProgress: boolean;
  readonly settingsUpdateInProgress: boolean;
}

export type QueueDispatchDecision<Attachment> =
  /** Nothing to do: empty queue or explicit pause. */
  | { readonly kind: 'idle' }
  /** A turn is running or the session is offline; retry on the next trigger. */
  | { readonly kind: 'wait' }
  /** A transient guard holds the send path; pause and tell the user. */
  | { readonly kind: 'blocked' }
  /** Dispatch the head prompt now. */
  | {
      readonly kind: 'dispatch';
      readonly prompt: QueuedPrompt<Attachment>;
    };

/**
 * Decides what `maybeDispatchQueue` should do
 * (queued-messages-design.md §4.3/§4.4). An active turn and a
 * disconnected or runtime-less session are ordinary waiting states —
 * the next terminal turn or reconnect triggers a fresh evaluation.
 * Occupied transient guards (pending interaction, session operation,
 * settings update) turn into `blocked` so the queue does not spin:
 * the user resumes explicitly once the transient state clears.
 */
export function evaluateQueueDispatch<Attachment>(
  state: QueuedPromptsState<Attachment>,
  guards: QueueDispatchGuards,
): QueueDispatchDecision<Attachment> {
  const prompt = state.items[0];
  if (prompt === undefined || state.paused !== null) {
    return { kind: 'idle' };
  }
  if (
    guards.turnActive ||
    !guards.connected ||
    !guards.hasRuntime ||
    !guards.hasSession
  ) {
    return { kind: 'wait' };
  }
  if (
    guards.hasPendingInteractions ||
    guards.sessionOperationInProgress ||
    guards.settingsUpdateInProgress
  ) {
    return { kind: 'blocked' };
  }
  return { kind: 'dispatch', prompt };
}
