import type { ChatController } from '../ChatController';
import { emitIdeState, reconnectControllerIde } from '../ideIntegration';
import { replaceRuntime, sessionReplacementEligibility } from './runtimeLifecycle';
import { isTurnActive, isUsableWorkspace } from '../internals';

export const SESSION_CONNECTION_RETRY_MS = 30_000;

/** Maintains the selected conversation, never replays a prompt or creates a new chat. */
export class SessionConnectionMaintenance {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private disposed = false;
  private running = false;

  constructor(private readonly ctl: ChatController) {}

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.schedule();
  }

  /** A focus/ready event can expedite recovery, but cannot overlap an attempt. */
  async check(): Promise<void> {
    if (!this.started || this.disposed || this.running) return;
    clearTimeout(this.timer);
    this.running = true;
    try {
      await this.recover();
    } catch {
      // Recovery owns this error boundary; retry later without logging SDK payloads.
      this.ctl.recordHost({ level: 'warn', name: 'host.connection.auto-recovery-failed' });
    } finally {
      this.running = false;
      this.schedule();
    }
  }

  private async recover(): Promise<void> {
    const ctl = this.ctl;
    const state = ctl.sessionState;
    const workspace = ctl.getWorkspaceContext();
    if (state.disposed || !state.initialization || !state.sessionId ||
        state.automaticRecoveryBlocked || state.workspaceTransition || !isUsableWorkspace(workspace) ||
        ctl.btwSideChat?.isBusy() || sessionReplacementEligibility(ctl).kind !== 'eligible') return;
    const sessionId = state.sessionId;
    const cwd = state.activeRuntimeCwd ?? state.historyWorkspace?.cwd ?? workspace.cwd;
    if (workspace.cwd !== cwd || !ctl.ensureWorkspaceCurrent()) return;
    const transport = ctl.nativeIde?.readTransport?.(sessionId);
    emitIdeState(ctl);
    // The SDK owns short socket gaps. Authentication needs an explicit sign-in.
    if (transport === 'recovering' || transport === 'auth-error') return;
    if (state.connection.status === 'unavailable' || transport === 'failed') {
      state.sessionOperationInProgress = true;
      state.connection = { status: 'connecting' };
      ctl.emitSnapshot();
      ctl.recordHost({ level: 'info', name: 'host.connection.auto-recovery-started', attributes: { sessionId } });
      try {
        await replaceRuntime(ctl, { kind: 'resume', sessionId, cwd }, {
          preserveSessionWork: true, preserveBackendTurn: true,
        });
      } finally {
        state.sessionOperationInProgress = false;
        ctl.effects.resumeRecoveredIdeReconnect();
      }
      return;
    }
    // Rebinding an IDE channel may replace an idle worker; never do it to a live turn.
    if (state.connection.status !== 'connected' || ctl.childSession || isTurnActive(ctl.turnState.turn)) return;
    const ide = ctl.nativeIde?.read(sessionId).status;
    if (ide === 'error' || ide === 'disconnected' || ide === 'reconnect-required' || ide === 'idle') {
      await reconnectControllerIde(ctl, sessionId, true);
    }
  }

  private schedule(): void {
    if (!this.started || this.disposed) return;
    this.timer = setTimeout(() => { void this.check(); }, SESSION_CONNECTION_RETRY_MS);
    this.timer.unref?.();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}
