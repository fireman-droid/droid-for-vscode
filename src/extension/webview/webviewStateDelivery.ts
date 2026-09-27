import type { WebviewReadyMessage, WebviewStateAppliedMessage } from '../../shared/protocol/shell';
import { REPLAYABLE_CHAT_STATE } from '../../shared/protocol/stateDelivery';
import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import type { ChatControllerListener, ControllerHostMessage } from '../chat/hostTypes';

const RETRY_DELAY_MS = 500;
const MAX_DELIVERY_RETRIES = 3;
const RECEIPT_TIMEOUT_MS = 2_000;
const MAX_PENDING_RECEIPTS = 2_048;
type PlanIdentity = { readonly sessionId: string; readonly turnId: string; readonly requestId: string };
type PendingPlan = PlanIdentity & { contentSequence: number | null; stateSequence: number | null; sentAt: number };
const planKey = (identity: PlanIdentity) => JSON.stringify([identity.sessionId, identity.turnId, identity.requestId]);

/** Recover missed state with a fresh snapshot, without re-sending deltas or user actions. */
export function createWebviewStateDelivery(options: {
  readonly isCurrent: () => boolean;
  readonly isVisible: () => boolean;
  readonly postMessage: (message: ControllerHostMessage) => PromiseLike<boolean>;
  readonly replayTo: (listener: ChatControllerListener) => Promise<void>;
  readonly diagnostics?: RuntimeDiagnosticSink;
}) {
  let disposed = false;
  let ready = false;
  let replaying = false;
  let readyReplayQueued = false;
  let dirtySequence: number | null = null;
  let deliveredSnapshot = -1;
  let retries = 0;
  let pageId: string | undefined;
  // Missing middle messages remain pending even when later messages are applied.
  const pending = new Map<number, { snapshot: boolean; sentAt: number }>();
  // Snapshots carry pending interactions but not their edited plan documents.
  // Keep only the latest content/status identities, never document bodies.
  const pendingPlans = new Map<string, PendingPlan>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const current = () => !disposed && options.isCurrent();
  const clearRetry = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const record = (name: string, attributes: Record<string, string | number | boolean>, failed = false) => {
    try { options.diagnostics?.record({ level: failed ? 'warn' : 'debug', name, attributes }); } catch {}
  };
  const needsReplay = () => dirtySequence !== null || pending.size > 0 || pendingPlans.size > 0;
  const scheduleRetry = () => {
    if (!current() || !ready || !options.isVisible() || replaying || timer !== null ||
      !needsReplay() || retries >= MAX_DELIVERY_RETRIES) return;
    const oldest = Math.min(pending.values().next().value?.sentAt ?? Date.now(),
      ...Array.from(pendingPlans.values(), (plan) => plan.sentAt));
    const delay = dirtySequence !== null ? RETRY_DELAY_MS
      : Math.max(0, RECEIPT_TIMEOUT_MS - (Date.now() - oldest));
    timer = setTimeout(() => {
      timer = null;
      if (!current() || !options.isVisible() || !needsReplay()) return;
      retries += 1;
      requestReplay('delivery-retry');
    }, delay);
  };
  const markDirty = (sequence: number) => {
    if (sequence <= deliveredSnapshot) return;
    dirtySequence = Math.max(dirtySequence ?? -1, sequence);
    scheduleRetry();
  };
  const failed = (message: ControllerHostMessage, outcome: 'not-delivered' | 'rejected') => {
    if (!current() || !REPLAYABLE_CHAT_STATE.has(message.type)) return;
    record('host.view.state-delivery', { type: message.type, sequence: message.sequence, outcome }, true);
    if (message.type === 'plan.document.state') scheduleRetry();
    else markDirty(message.sequence);
  };
  const acknowledgePlan = (sequence: number) => {
    for (const [key, plan] of pendingPlans) {
      if (plan.contentSequence === sequence) plan.contentSequence = null;
      if (plan.stateSequence === sequence) plan.stateSequence = null;
      if (plan.contentSequence === null && plan.stateSequence === null) pendingPlans.delete(key);
    }
  };
  const post: ChatControllerListener = (message) => {
    if (!current()) return;
    const visibleWhenPosted = options.isVisible();
    if (message.type === 'plan.document.state') {
      const key = planKey(message), previous = pendingPlans.get(key);
      pendingPlans.set(key, { sessionId: message.sessionId, turnId: message.turnId, requestId: message.requestId,
        contentSequence: message.status === 'ready' ? message.sequence : previous?.contentSequence ?? null,
        stateSequence: message.sequence, sentAt: previous?.sentAt ?? Date.now() });
    } else if (message.type === 'interaction.closed') {
      pendingPlans.delete(planKey(message));
    } else if (message.type === 'host.snapshot') {
      const active = new Set((message.interactions ?? []).map((item) =>
        planKey({ sessionId: item.sessionId, turnId: item.turnId, requestId: item.request.requestId })));
      for (const [key, plan] of pendingPlans) {
        if (plan.sessionId !== message.sessionId || !active.has(key)) pendingPlans.delete(key);
      }
    }
    if (pageId !== undefined && message.type !== 'plan.document.state' && REPLAYABLE_CHAT_STATE.has(message.type)) {
      pending.set(message.sequence, { snapshot: message.type === 'host.snapshot', sentAt: Date.now() });
      if (pending.size > MAX_PENDING_RECEIPTS) {
        const oldest = pending.keys().next().value!;
        pending.delete(oldest);
        markDirty(oldest);
      }
    }
    scheduleRetry();
    // VS Code can report true for a retained hidden view whose JS did not
    // consume the update. Visibility is a catch-up boundary, not an ACK.
    if (!visibleWhenPosted && message.type !== 'plan.document.state' && REPLAYABLE_CHAT_STATE.has(message.type)) markDirty(message.sequence);
    try {
      void Promise.resolve(options.postMessage(message)).then((delivered) => {
        if (!current()) return;
        if (!delivered) { failed(message, 'not-delivered'); return; }
        if (!options.isVisible() && message.type !== 'plan.document.state' && REPLAYABLE_CHAT_STATE.has(message.type)) markDirty(message.sequence);
        if (message.type === 'plan.document.state' && pageId === undefined && visibleWhenPosted && options.isVisible()) {
          acknowledgePlan(message.sequence);
          if (!needsReplay()) { retries = 0; clearRetry(); }
        }
        if (message.type !== 'host.snapshot') return;
        record('host.view.snapshot-delivery', { sequence: message.sequence, outcome: 'posted', connection: message.connection.status });
        if (pageId !== undefined || !visibleWhenPosted || !options.isVisible()) return;
        deliveredSnapshot = Math.max(deliveredSnapshot, message.sequence);
        // A later missed update cannot be covered by an earlier snapshot,
        // even when its postMessage promise resolves after that update.
        if (dirtySequence !== null && dirtySequence <= deliveredSnapshot) {
          dirtySequence = null;
          retries = 0;
          clearRetry();
        }
      }, () => failed(message, 'rejected'));
    } catch { failed(message, 'rejected'); }
  };
  const requestReplay = (reason: 'ready' | 'delivery-retry') => {
    if (!current() || !ready) return;
    if (replaying) { if (reason === 'ready') readyReplayQueued = true; return; }
    clearRetry();
    // A new attempt gets its own receipt window, not the already expired deadline.
    for (const item of pending.values()) item.sentAt = Date.now();
    for (const plan of pendingPlans.values()) plan.sentAt = Date.now();
    replaying = true;
    record('host.view.state-replay', { reason, retry: retries });
    void options.replayTo(post).catch(() => {
      record('host.view.state-replay-failed', { reason, retry: retries }, true);
    }).finally(() => {
      replaying = false;
      if (readyReplayQueued) { readyReplayQueued = false; requestReplay('ready'); }
      else scheduleRetry();
    });
  };
  return {
    post,
    onReady: (message?: WebviewReadyMessage) => {
      if (message?.pageId !== pageId) { pending.clear(); pendingPlans.clear(); deliveredSnapshot = -1; }
      pageId = message?.pageId;
      ready = true; retries = 0; requestReplay('ready');
    },
    onStateApplied: (message: WebviewStateAppliedMessage) => {
      if (!current() || pageId === undefined || message.pageId !== pageId) return;
      const snapshot = message.snapshotSequence;
      if (snapshot !== null && pending.get(snapshot)?.snapshot) {
        deliveredSnapshot = Math.max(deliveredSnapshot, snapshot);
        for (const sequence of pending.keys()) if (sequence <= snapshot) pending.delete(sequence);
        if (dirtySequence !== null && dirtySequence <= snapshot) dirtySequence = null;
        record('host.view.snapshot-delivery', { sequence: snapshot, outcome: 'applied' });
      }
      for (const sequence of message.sequences) { pending.delete(sequence); acknowledgePlan(sequence); }
      if (!needsReplay()) retries = 0;
      clearRetry();
      scheduleRetry();
    },
    onVisible: () => { if (needsReplay()) { retries = 0; scheduleRetry(); } },
    dispose: () => { disposed = true; pending.clear(); pendingPlans.clear(); clearRetry(); },
  };
}
