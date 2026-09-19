import type {
  PermissionRespondMessage,
  PlanDocumentOpenMessage,
} from '../../../shared/bridgeMessages';
import type { InteractionResponsesPort } from './interactionResponsesPort';

export function handlePermissionResponse(
  ctl: InteractionResponsesPort,
  message: PermissionRespondMessage,
): void {
  if (!ctl.effects.ensureActiveRuntimeWorkspaceCurrent()) {
    return;
  }
  const response = ctl.planDocuments.prepareResponse(message);
  if (response === null) {
    return;
  }
  if (
    ctl.interactions.respondPermission(response) &&
    response.selectedOption.startsWith('proceed_new_session') &&
    response.sessionId === ctl.sessionState.sessionId &&
    ctl.turnState.turn?.turnId === response.turnId
  ) {
    ctl.turnState.specHandoff = {
      turnId: response.turnId,
      status: 'expected',
    };
  }
}

export function handlePlanDocumentOpen(
  ctl: InteractionResponsesPort,
  message: PlanDocumentOpenMessage,
): void {
  if (ctl.effects.ensureActiveRuntimeWorkspaceCurrent()) {
    ctl.planDocuments.open(message);
  }
}
