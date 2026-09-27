import type { DroidRuntime } from '../../../runtime/DroidRuntime';
import { isTurnActive } from '../internals';
import type { SessionCleanupPort, RuntimeClosePort, RuntimeDisposePort } from './runtimeLifecyclePort';

// Releases session-scoped features before replacing a session or closing the window.

export function resetSessionMetadata(
  ctl: SessionCleanupPort,
  preserveConversationState = false,
  preserveSessionWork = false,
): void {
  ctl.missionState.detachRuntime();
  ctl.customModelState.cancelDiscovery();
  ctl.metadata.reset();
  ctl.turnState.specHandoff = null;
  if (!preserveConversationState) {
    ctl.effects.clearPendingAttachments();
  }
  // Runs while sessionId still names the old session, so the
  // discard diagnostic lands on the session that owned the queue.
  if (!preserveSessionWork) ctl.effects.discardQueuedPrompts();
  // Discard-on-close: any session rebind abandons the hidden fork.
  if (!preserveSessionWork) ctl.btwSideChat?.reset();
}

export function closeRuntime(ctl: RuntimeClosePort, runtime: DroidRuntime, preserveBackendTurn = false): Promise<void> {
  if (ctl.sessionState.runtime === runtime) ctl.turnState.turn?.changesLedger?.cancel();
  return ctl.sessionState.closeRuntime(runtime, preserveBackendTurn);
}

/**
 * Dispose every managed runtime without killing daemon turns: an active
 * background-capable runtime is detached instead of interrupted. */
export async function closeAllRuntimesForDispose(
  ctl: RuntimeDisposePort,
): Promise<void> {
  ctl.missionState.stopSubscription();
  const keepTurn =
    isTurnActive(ctl.turnState.turn) &&
    ctl.sessionState.runtime?.supportsBackgroundTurns?.() === true;
  const preserved = keepTurn ? ctl.sessionState.runtime : null;
  ctl.sessionState.runtime = null;
  const results = await Promise.allSettled([
    ...[...ctl.sessionState.managedRuntimes].map((runtime) =>
      closeRuntime(ctl, runtime, runtime === preserved),
    ),
    ctl.recoveryStore.dispose(),
  ]);
  const recoveryResult = results.at(-1);
  if (recoveryResult?.status === 'rejected') throw recoveryResult.reason;
}
