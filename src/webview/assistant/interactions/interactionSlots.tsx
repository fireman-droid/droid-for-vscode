import type { AskUserAnswer, WebviewToHostMessage } from '../../../shared/bridgeMessages';
import { InteractionPanel } from './Interactions';
import { isFooterInteraction } from './interactionPlacement';
import type { PendingInteraction } from '../state/store';

interface MessagePoster {
  postMessage(message: WebviewToHostMessage): void;
}

export function buildInteractionSlots(
  requests: readonly PendingInteraction[],
  onPermissionRespond: (
    interaction: PendingInteraction,
    selectedOption: string,
    editedSpecContent?: string,
  ) => void,
  onAskUserRespond: (
    interaction: PendingInteraction,
    cancelled: boolean,
    answers: readonly AskUserAnswer[],
  ) => void,
  vscode: MessagePoster,
): {
  readonly inlineInteraction: React.JSX.Element | null;
  readonly footerInteraction: React.JSX.Element | null;
} {
  const active = requests[0];
  if (active === undefined) {
    return { inlineInteraction: null, footerInteraction: null };
  }
  const panel = (
    <InteractionPanel
      requests={requests}
      onPermissionRespond={onPermissionRespond}
      onAskUserRespond={onAskUserRespond}
      onPlanDocumentOpen={(interaction) =>
        vscode.postMessage({
          type: 'plan.document.open',
          sessionId: interaction.sessionId,
          turnId: interaction.turnId,
          requestId: interaction.request.requestId,
        })
      }
    />
  );
  return isFooterInteraction(active)
    ? { inlineInteraction: null, footerInteraction: panel }
    : { inlineInteraction: panel, footerInteraction: null };
}
