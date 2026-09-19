import { BRIDGE_PROTOCOL_VERSION } from '../../shared/bridgeMessages';
import type { ChatControllerListener } from './ChatController';
import type { BrowserReplayPort } from './browserReplayPort';

export async function replayControllerTo(
  ctl: BrowserReplayPort,
  listener: ChatControllerListener,
): Promise<void> {
  if (ctl.sessionState.initialization === null) {
    ctl.handleMessage({
      type: 'webview.ready',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
    });
    return;
  }
  await ctl.sessionState.initialization;
  await ctl.effects.waitForWorkspaceTransition();
  if (ctl.sessionState.disposed || !ctl.effects.ensureActiveRuntimeWorkspaceCurrent()) {
    return;
  }
  ctl.emitTo(listener, ctl.effects.buildHostSnapshot());
  if (ctl.sessionState.sessionId !== null) {
    await ctl.reviewCoordinator?.replayTo(ctl.sessionState.sessionId, (message) =>
      ctl.emitTo(listener, message),
    );
  }
  ctl.interactions.replayPendingTo(({ sessionId, turnId, request }) => {
    ctl.emitTo(listener, {
      type: 'interaction.request',
      sessionId,
      turnId,
      request,
    });
  });
  ctl.planDocuments.replayTo((message) => {
    ctl.emitTo(listener, message);
  });
}
