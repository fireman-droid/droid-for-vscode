import type { DroidRuntime } from '../../../runtime/DroidRuntime';
import { type ConnectionState } from '../../../shared/protocol/shell';
import type { WorkspaceContext } from '../hostTypes';
export class SessionLifecycleState {
  runtime: DroidRuntime | null = null;
  connection: ConnectionState = { status: 'idle' };
  conversationId: string | null = null;
  sessionId: string | null = null;
  runtimeGeneration = 0;
  activeRuntimeCwd: string | null = null;
  initialization: Promise<void> | null = null;
  workspaceContextGeneration = 0;
  workspaceTransition: Promise<void> | null = null;
  sessionOperationInProgress = false;
  readonly managedRuntimes = new Set<DroidRuntime>();
  private readonly runtimeClosures = new Map<DroidRuntime, Promise<void>>();
  private readonly closedRuntimes = new WeakSet<DroidRuntime>();
  disposed = false;
  disposal: Promise<void> | null = null;
  constructor(public workspaceContext: WorkspaceContext) {}

  closeRuntime(runtime: DroidRuntime, preserveBackendTurn = false): Promise<void> {
    if (this.closedRuntimes.has(runtime)) {
      return Promise.resolve();
    }
    const existing = this.runtimeClosures.get(runtime);
    if (existing) {
      return existing;
    }
    const closure = Promise.resolve()
      .then(() =>
        runtime.dispose(preserveBackendTurn ? { preserveBackendTurn: true } : undefined),
      )
      .then(() => {
        this.closedRuntimes.add(runtime);
        this.managedRuntimes.delete(runtime);
      })
      .finally(() => {
        if (this.runtimeClosures.get(runtime) === closure) {
          this.runtimeClosures.delete(runtime);
        }
      });
    this.runtimeClosures.set(runtime, closure);
    return closure;
  }
}
