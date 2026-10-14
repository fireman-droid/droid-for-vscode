import { AskUserResultSchema, type AskUserResult, type DaemonSessionController,
  type PendingAskUserRequest } from '@factory/droid-sdk';
import type { RetainedDaemonSession } from './sessionHandle';
import type { InteractionTransport } from './permissionDispatch';

interface PendingQuestion {
  request: PendingAskUserRequest;
  readonly owner: RetainedDaemonSession | undefined;
  readonly cancellation: AbortController;
  replayed: boolean;
}

/** The SDK buffers inactive-session answers and replays them after self-resume. */
export function bindDaemonAskUser(
  controller: DaemonSessionController,
  handles: ReadonlyMap<string, RetainedDaemonSession>,
  report: (error: unknown, owner?: RetainedDaemonSession) => void,
  transport: InteractionTransport,
): () => void {
  const active = new Map<string, PendingQuestion>();
  const answered = new WeakMap<RetainedDaemonSession, Set<string>>();
  const key = (request: PendingAskUserRequest) => JSON.stringify([request.sessionId, request.toolCallId]);
  const remember = (state: PendingQuestion) => {
    if (!state.owner) return;
    let ids = answered.get(state.owner);
    if (!ids) { ids = new Set(); answered.set(state.owner, ids); }
    ids.add(state.request.toolCallId);
  };
  const currentRequest = (state: PendingQuestion) => controller.getPendingAskUserRequests().find(
    request => request.sessionId === state.request.sessionId && request.toolCallId === state.request.toolCallId,
  );
  const dispatch = async (state: PendingQuestion): Promise<void> => {
    const signal = state.cancellation.signal;
    let result: AskUserResult = { cancelled: true, answers: [] };
    try {
      if (state.owner?.handlers.askUserHandler) {
        result = AskUserResultSchema.parse(await state.owner.handlers.askUserHandler({
          toolCallId: state.request.toolCallId, questions: state.request.questions,
        }, signal));
      }
    } catch (error) {
      if (!signal.aborted) report(error, state.owner);
    }
    while (!signal.aborted) {
      let revision: number | undefined;
      try {
        await transport.waitUntilReady();
        if (signal.aborted) return;
        // loadSession can replace the wire ID for the same tool invocation.
        const request = currentRequest(state);
        if (!request) { state.cancellation.abort(); return; }
        state.request = request;
        state.replayed = false;
        revision = transport.revision();
        await controller.respondToAskUser({ requestId: request.requestId, sessionId: request.sessionId, result });
        remember(state);
        return;
      } catch (error) {
        if (signal.aborted) return;
        const current = revision !== undefined && transport.isReady() && revision === transport.revision();
        report(error, current ? state.owner : undefined);
        // Retry only a prompt explicitly replayed by recovery. Reuse its answer,
        // while SDK resolution always wins over an ambiguous old RPC failure.
        if (current || !state.replayed) return;
      }
    }
  };
  const requested = (request: PendingAskUserRequest) => {
    const owner = handles.get(request.sessionId);
    if (owner && answered.get(owner)?.has(request.toolCallId)) return;
    const id = key(request);
    const previous = active.get(id);
    if (previous && previous.owner === owner && !previous.cancellation.signal.aborted) {
      previous.request = request;
      previous.replayed = true;
      return;
    }
    previous?.cancellation.abort();
    const state: PendingQuestion = { request, owner, cancellation: new AbortController(), replayed: false };
    active.set(id, state);
    void dispatch(state).finally(() => {
      if (active.get(id) === state) active.delete(id);
    });
  };
  const resolved = (requestId: string, result: AskUserResult | undefined) => {
    for (const state of active.values()) {
      if (state.request.requestId !== requestId) continue;
      if (result !== undefined) {
        // This also fires when SDK accepts an answer into its inactive-session
        // buffer, before loadSession re-emits the request under a new wire ID.
        remember(state);
        state.cancellation.abort();
      } else {
        // loadSession clears then restores prompts synchronously. Reconcile
        // after that batch so an unchanged question keeps its form and draft.
        queueMicrotask(() => {
          if (state.cancellation.signal.aborted) return;
          const pending = currentRequest(state);
          if (pending) state.request = pending;
          else state.cancellation.abort();
        });
      }
    }
  };
  controller.on('askUserRequested', requested);
  controller.on('askUserResolved', resolved);
  return () => {
    controller.off('askUserRequested', requested);
    controller.off('askUserResolved', resolved);
    for (const state of active.values()) state.cancellation.abort();
    active.clear();
  };
}
