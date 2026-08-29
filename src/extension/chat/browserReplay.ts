import { BRIDGE_PROTOCOL_VERSION } from '../../shared/bridgeMessages';
import type { ChatControllerListener } from '../ChatController';
import { buildHostSnapshot } from './hostSnapshot';
import type { ChatControllerInternals } from './internals';
import {
  ensureActiveRuntimeWorkspaceCurrent,
  waitForWorkspaceTransition,
} from './runtimeLifecycle';

export async function replayControllerTo(
  ctl: ChatControllerInternals,
  listener: ChatControllerListener,
): Promise<void> {
  if (ctl.initialization === null) {
    ctl.handleMessage({
      type: 'webview.ready',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
    });
    return;
  }
  await ctl.initialization;
  await waitForWorkspaceTransition(ctl);
  if (
    ctl.disposed ||
    !ensureActiveRuntimeWorkspaceCurrent(ctl)
  ) {
    return;
  }
  ctl.emitTo(listener, buildHostSnapshot(ctl));
  if (ctl.sessionId !== null) {
    await ctl.reviewCoordinator?.replayTo(
      ctl.sessionId,
      (message) => ctl.emitTo(listener, message),
    );
  }
  ctl.interactions.replayPendingTo(
    ({ sessionId, turnId, request }) => {
      ctl.emitTo(listener, {
        type: 'interaction.request',
        sessionId,
        turnId,
        request,
      });
    },
  );
  ctl.planDocuments.replayTo((message) => {
    ctl.emitTo(listener, message);
  });
}
