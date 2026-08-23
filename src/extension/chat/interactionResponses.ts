import type {
  PermissionRespondMessage,
  PlanDocumentOpenMessage,
} from '../../shared/bridgeMessages';
import {
  ensureActiveRuntimeWorkspaceCurrent,
} from './runtimeLifecycle';
import type { ChatControllerInternals } from './internals';

export function handlePermissionResponse(
  ctl: ChatControllerInternals,
  message: PermissionRespondMessage,
): void {
  if (!ensureActiveRuntimeWorkspaceCurrent(ctl)) {
    return;
  }
  const response = ctl.planDocuments.prepareResponse(message);
  if (response === null) {
    return;
  }
  if (
    ctl.interactions.respondPermission(response) &&
    response.selectedOption.startsWith('proceed_new_session') &&
    response.sessionId === ctl.sessionId &&
    ctl.turn?.turnId === response.turnId
  ) {
    ctl.specHandoff = {
      turnId: response.turnId,
      status: 'expected',
    };
  }
}

export function handlePlanDocumentOpen(
  ctl: ChatControllerInternals,
  message: PlanDocumentOpenMessage,
): void {
  if (ensureActiveRuntimeWorkspaceCurrent(ctl)) {
    ctl.planDocuments.open(message);
  }
}
