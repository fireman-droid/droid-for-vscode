import { randomUUID } from 'node:crypto';
import type { ParentSessionEvent, ParentSessionEventSource } from '../../../runtime/daemon/parentSessionEvents';
import type { RuntimeEvent } from '../../../runtime/runtimeEvents';
import { reconcileSessionHistory } from '../../recovery/reconcileSessionHistory';
import type { ChatController } from '../ChatController';
import { isTurnActive } from '../internals';
import { createTurnActivityState } from '../turns/turnActivityState';
import { handleRuntimeEvent } from '../turns/turnRuntimeEvents';
import { handleTurnComplete } from '../turns/turnSettlement';

type Completion = Extract<RuntimeEvent, { type: 'turn-complete' }>;
interface ObservedTurn {
  readonly backendId: string | null;
  readonly turnId: string;
  recovering: boolean;
  completion?: Completion;
}

/** Receives automatic daemon turns after the submitted foreground stream closes. */
export class ParentFollowup {
  private unsubscribe: (() => void) | undefined;
  private readonly subscription;
  private sessionId: string | null = null;
  private generation = -1;
  private cwd: string | null = null;
  private active: ObservedTurn | null = null;
  private ignoredTurnId: string | null = null;
  private resyncing = false;
  private disposed = false;
  private pending: { turnId: string; generation: number; events: ParentSessionEvent[]; overflow: boolean } | null = null;

  constructor(private readonly ctl: ChatController, private readonly source: ParentSessionEventSource) {
    this.subscription = ctl.subscribe(() => { this.synchronize(); queueMicrotask(() => this.drainPending()); });
    this.synchronize();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.subscription.dispose();
  }

  private synchronize(): void {
    const state = this.ctl.sessionState;
    if (this.disposed || state.disposed) { this.unsubscribe?.(); return; }
    if (this.sessionId === state.sessionId && this.generation === state.runtimeGeneration && this.cwd === state.activeRuntimeCwd) return;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.sessionId = state.sessionId;
    this.generation = state.runtimeGeneration;
    this.cwd = state.activeRuntimeCwd;
    this.active = null;
    this.ignoredTurnId = null;
    this.pending = null;
    if (state.sessionId === null || state.activeRuntimeCwd === null) return;
    const sessionId = state.sessionId;
    const generation = state.runtimeGeneration;
    this.unsubscribe = this.source.watchParent(sessionId, state.activeRuntimeCwd, (event) => {
      if (!this.current(sessionId, generation)) return;
      this.observe(event);
    });
  }

  private current(sessionId: string, generation: number): boolean {
    return !this.disposed && !this.ctl.sessionState.disposed &&
      this.ctl.sessionState.sessionId === sessionId && this.ctl.sessionState.runtimeGeneration === generation;
  }

  private observe(message: ParentSessionEvent): void {
    if (message.type === 'resync') { void this.resync(); return; }
    const turn = this.ctl.turnState.turn;
    if (this.active !== null && (turn?.turnId !== this.active.turnId || !isTurnActive(turn))) this.active = null;
    if (message.type === 'turn-start') {
      if (!message.automatic) { this.ignoredTurnId = message.turnId; return; }
      // A submitted foreground turn already has its own stream and projection.
      if (isTurnActive(turn) || this.ctl.sessionState.sessionOperationInProgress) {
        this.pending = { turnId: message.turnId, generation: this.ctl.turnState.turnGeneration, events: [], overflow: this.pending !== null };
        return;
      }
      this.adopt(message.turnId);
      return;
    }
    if (this.pending?.turnId === message.turnId) {
      if (this.pending.events.length < 512) this.pending.events.push(message);
      else this.pending.overflow = true;
      return;
    }
    if (message.turnId === this.ignoredTurnId) return;
    const active = this.active;
    if (active === null || active.backendId !== message.turnId) return;
    if (message.event.type === 'turn-complete') {
      active.completion = message.event;
      if (active.recovering) return;
      this.ctl.effects.flushPendingThinking(this.sessionId!, active.turnId);
      handleTurnComplete(this.ctl, this.sessionId!, active.turnId, message.event);
      this.active = null;
    } else if (!active.recovering && this.ctl.turnState.turn?.status !== 'stopping') {
      handleRuntimeEvent(this.ctl, this.sessionId!, active.turnId, message.event);
    }
  }

  private drainPending(): void {
    const pending = this.pending;
    if (!pending || this.disposed || this.ctl.sessionState.disposed || isTurnActive(this.ctl.turnState.turn) || this.ctl.sessionState.sessionOperationInProgress) return;
    this.pending = null;
    if (pending.generation !== this.ctl.turnState.turnGeneration || pending.overflow) { void this.resync(); return; }
    this.adopt(pending.turnId);
    for (const event of pending.events) this.observe(event);
  }

  private adopt(backendId: string | null): ObservedTurn {
    const ctl = this.ctl;
    const active: ObservedTurn = { backendId, turnId: randomUUID(), recovering: false };
    this.active = active;
    ctl.effects.discardPendingThinking();
    ctl.turnState.turnGeneration += 1;
    ctl.turnState.turn = {
      turnId: active.turnId, status: 'streaming', activity: createTurnActivityState(), recovery: true,
      ...(backendId === null ? {} : { backendTurnId: backendId }),
      transportRecovery: {
        messageId: backendId ?? active.turnId,
        get completion() { return active.completion; },
        dispose() {},
      },
    };
    ctl.interactions.beginTurn(this.sessionId!, active.turnId);
    ctl.effects.setSessionRunning(this.sessionId!, true);
    ctl.effects.scheduleRecoveryCheckpoint();
    // An unsolicited turn must be adopted before the webview accepts its deltas.
    ctl.emitSnapshot();
    ctl.recordHost({ level: 'info', name: 'host.subagent.parent-turn-adopted', attributes: { sessionId: this.sessionId! } });
    return active;
  }

  private async resync(): Promise<void> {
    const ctl = this.ctl;
    const { runtime, runtimeGeneration, sessionId, activeRuntimeCwd: cwd } = ctl.sessionState;
    if (this.resyncing || !runtime || !sessionId || !cwd || ctl.sessionState.sessionOperationInProgress) return;
    if (isTurnActive(ctl.turnState.turn) && ctl.turnState.turn?.turnId !== this.active?.turnId) return;
    this.resyncing = true;
    const turnGeneration = ctl.turnState.turnGeneration;
    try {
      const working = await runtime.readSessionWorkingState?.();
      if (!this.current(sessionId, runtimeGeneration) || ctl.turnState.turnGeneration !== turnGeneration) return;
      if (this.active !== null || working === 'running' || working === 'waiting-for-user') {
        const active = this.active ?? this.adopt(null);
        if (active.recovering) return;
        active.recovering = true;
        // The existing recovery path owns gap reconciliation and final settlement;
        // continued notifications only supply the matching terminal outcome.
        ctl.effects.reconcileDaemonTurn(runtime, runtimeGeneration, sessionId, cwd);
      } else if (working === 'idle') {
        const loaded = await ctl.sessionHistory.loadHistory({ sessionId, cwd });
        if (!this.current(sessionId, runtimeGeneration) || ctl.turnState.turnGeneration !== turnGeneration || loaded.status !== 'available') return;
        ctl.recoveryState.transcript = reconcileSessionHistory(loaded.state, ctl.recoveryState.transcript, { authoritativeLoaded: true });
        ctl.effects.scheduleRecoveryCheckpoint();
        ctl.emitSnapshot();
      }
    } catch {
      ctl.recordHost({ level: 'warn', name: 'host.subagent.parent-resync', attributes: { outcome: 'failed', sessionId } });
    } finally { this.resyncing = false; }
  }
}
