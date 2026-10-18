import { randomUUID } from 'node:crypto';
import type { ParentSessionEvent, ParentSessionEventSource } from '../../../runtime/daemon/parentSessionEvents';
import type { RuntimeEvent } from '../../../runtime/runtimeEvents';
import { reconcileSessionHistory } from '../../recovery/reconcileSessionHistory';
import type { ChatController } from '../ChatController';
import { isTurnActive } from '../internals';
import { handleRuntimeEvent } from '../turns/turnRuntimeEvents';
import { handleTurnComplete } from '../turns/turnSettlement';
import { TURN_IDLE_CONFIRM_READS, TURN_IDLE_GRACE_MS, TURN_WATCHDOG_POLL_MS } from '../turns/turnWatchdog';

type Completion = Extract<RuntimeEvent, { type: 'turn-complete' }>;
interface ObservedTurn {
  readonly backendId: string | null;
  readonly turnId: string;
  readonly startedAt: number;
  idleReads: number;
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
  private probe: ReturnType<typeof setInterval> | undefined;
  private pending: { backendId: string | null; generation: number } | null = null;

  constructor(private readonly ctl: ChatController, private readonly source: ParentSessionEventSource) {
    this.subscription = ctl.subscribe(() => { this.synchronize(); queueMicrotask(() => this.drainPending()); });
    this.synchronize();
  }

  dispose(): void {
    this.disposed = true;
    this.clearProbe();
    this.unsubscribe?.();
    this.subscription.dispose();
  }

  private synchronize(): void {
    const state = this.ctl.sessionState;
    if (this.disposed || state.disposed) { this.clearProbe(); this.unsubscribe?.(); return; }
    const turn = this.ctl.turnState.turn;
    if (this.active !== null && (turn?.turnId !== this.active.turnId || !isTurnActive(turn))) {
      this.active = null;
      this.clearProbe();
    }
    if (this.sessionId === state.sessionId && this.generation === state.runtimeGeneration && this.cwd === state.activeRuntimeCwd) return;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.clearProbe();
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
    const turn = this.ctl.turnState.turn;
    if (message.type === 'resync') {
      if (this.ctl.sessionState.sessionOperationInProgress || (isTurnActive(turn) && turn?.turnId !== this.active?.turnId))
        this.pending = { backendId: null, generation: this.ctl.turnState.turnGeneration };
      else void this.resync();
      return;
    }
    if (message.type === 'turn-start') {
      if (!message.automatic) { this.ignoredTurnId = message.turnId; return; }
      // A submitted foreground turn already has its own stream and projection.
      if (isTurnActive(turn) || this.ctl.sessionState.sessionOperationInProgress) {
        this.pending = { backendId: this.pending === null ? message.turnId : null, generation: this.ctl.turnState.turnGeneration };
        return;
      }
      this.adopt(message.turnId);
      return;
    }
    // Overlap is reconciled from authoritative history after foreground release.
    // Never replay cached deltas that the foreground stream may have consumed.
    if (this.pending !== null && message.turnId !== this.active?.backendId) return;
    if (message.turnId === this.ignoredTurnId) return;
    const active = this.active;
    if (active === null || active.backendId !== message.turnId) return;
    if (message.event.type === 'turn-complete') {
      active.completion = message.event;
      if (active.recovering) return;
      this.ctl.effects.flushPendingThinking(this.sessionId!, active.turnId);
      handleTurnComplete(this.ctl, this.sessionId!, active.turnId, message.event);
      this.active = null;
      this.clearProbe();
    } else if (!active.recovering && this.ctl.turnState.turn?.status !== 'stopping') {
      handleRuntimeEvent(this.ctl, this.sessionId!, active.turnId, message.event);
    }
  }

  private drainPending(): void {
    const pending = this.pending;
    if (!pending || this.disposed || this.ctl.sessionState.disposed || isTurnActive(this.ctl.turnState.turn) || this.ctl.sessionState.sessionOperationInProgress) return;
    this.pending = null;
    void this.resync(false, pending.generation === this.ctl.turnState.turnGeneration ? pending.backendId : null);
  }

  private adopt(backendId: string | null): ObservedTurn {
    const ctl = this.ctl;
    const active: ObservedTurn = { backendId, turnId: randomUUID(), startedAt: Date.now(), idleReads: 0, recovering: false };
    this.active = active;
    ctl.effects.beginTurn({
      turnId: active.turnId, status: 'streaming', recovery: true,
      ...(backendId === null ? {} : { backendTurnId: backendId }),
      transportRecovery: {
        messageId: backendId ?? active.turnId,
        get completion() { return active.completion; },
        dispose() {},
      },
    });
    ctl.interactions.beginTurn(this.sessionId!, active.turnId);
    ctl.effects.setSessionRunning(this.sessionId!, true);
    ctl.effects.scheduleRecoveryCheckpoint();
    // An unsolicited turn must be adopted before the webview accepts its deltas.
    ctl.emitSnapshot();
    this.clearProbe();
    this.probe = setInterval(() => { void this.resync(true); }, TURN_WATCHDOG_POLL_MS);
    ctl.recordHost({ level: 'info', name: 'host.subagent.parent-turn-adopted', attributes: { sessionId: this.sessionId! } });
    return active;
  }

  private clearProbe(): void {
    if (this.probe !== undefined) clearInterval(this.probe);
    this.probe = undefined;
  }

  private async resync(probe = false, backendId: string | null = null): Promise<void> {
    const ctl = this.ctl;
    const { runtime, runtimeGeneration, sessionId, activeRuntimeCwd: cwd } = ctl.sessionState;
    if (this.disposed || ctl.sessionState.disposed || this.sessionId !== sessionId || this.generation !== runtimeGeneration) { this.clearProbe(); return; }
    if (this.resyncing || !runtime || !sessionId || !cwd || ctl.sessionState.sessionOperationInProgress) return;
    if (isTurnActive(ctl.turnState.turn) && ctl.turnState.turn?.turnId !== this.active?.turnId) return;
    if (probe && (this.active === null || this.active.recovering || Date.now() - this.active.startedAt < TURN_IDLE_GRACE_MS)) return;
    this.resyncing = true;
    const turnGeneration = ctl.turnState.turnGeneration;
    const observed = this.active;
    try {
      const working = await runtime.readSessionWorkingState?.();
      if (!this.current(sessionId, runtimeGeneration) || ctl.turnState.turnGeneration !== turnGeneration || this.active !== observed) return;
      if (probe && this.active !== null) {
        this.active.idleReads = working === 'idle' ? this.active.idleReads + 1 : 0;
        if (this.active.idleReads < TURN_IDLE_CONFIRM_READS) return;
      }
      if (this.active !== null || working === 'running' || working === 'waiting-for-user') {
        const active = this.active ?? this.adopt(backendId);
        if (active.recovering) return;
        active.recovering = true;
        this.clearProbe();
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
