import { useCallback, useMemo } from 'react';
import { post, createTurnId, type ChatPort } from '../shell/chatIntent';
import { MAX_TURN_TEXT_LENGTH } from '../../../shared/protocol/bounds';
import { type AskUserAnswer } from '../../../shared/bridgeMessages';
import { isTurnActive } from '../state/turnIdentity';
import { type AssistantWebviewState } from '../state/types';
import { type PendingInteraction } from '../state/store';
import type { getVsCodeApi } from '../../bridge/vscode';

export function useMessageActions({
  vscode,
  sessionId,
  connectionStatus,
  conversationTransitionBlocking,
  interactionCount,
  turn,
  transcript,
}: {
  vscode: ChatPort;
  sessionId: string | null;
  connectionStatus: string;
  conversationTransitionBlocking: boolean;
  interactionCount: number;
  turn: AssistantWebviewState['turn'];
  transcript: AssistantWebviewState['transcript'];
}) {
  const handleEditResend = useCallback(
    (messageId: string, text: string, restoreFiles = false): void => {
      const trimmed = text.trim();
      if (
        sessionId === null ||
        conversationTransitionBlocking ||
        connectionStatus !== 'connected' ||
        isTurnActive(turn) ||
        interactionCount > 0 ||
        trimmed.length === 0 ||
        text.length > MAX_TURN_TEXT_LENGTH
      ) {
        return;
      }
      post(vscode, {
        type: 'turn.editResend',
        sessionId,
        turnId: createTurnId(),
        messageId,
        text,
        ...(restoreFiles ? { restoreFiles: true } : {}),
      });
    },
    [
      connectionStatus,
      conversationTransitionBlocking,
      interactionCount,
      sessionId,
      turn,
      vscode,
    ],
  );
  const handleRequestRewindInfo = useCallback(
    (messageId: string): void => {
      if (sessionId !== null && connectionStatus === 'connected') {
        post(vscode, {
          type: 'rewind.info',
          sessionId,
          messageId,
        });
      }
    },
    [connectionStatus, sessionId, vscode],
  );
  // Anchor for Regenerate: the last user message that can start a
  // rewind. Regenerating resends its unchanged text from that point.
  const regenerateAnchor = useMemo(() => {
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
      const item = transcript[i];
      if (item !== undefined && item.kind === 'user') {
        return item.messageId === undefined
          ? null
          : { messageId: item.messageId, text: item.text };
      }
    }
    return null;
  }, [transcript]);
  const handleRegenerate = useCallback((): void => {
    if (regenerateAnchor !== null) {
      handleEditResend(regenerateAnchor.messageId, regenerateAnchor.text);
    }
  }, [handleEditResend, regenerateAnchor]);
  const handlePermissionRespond = useCallback(
    (
      interaction: PendingInteraction,
      selectedOption: string,
      editedSpecContent?: string,
    ): void => {
      post(vscode, {
        type: 'permission.respond',
        sessionId: interaction.sessionId,
        turnId: interaction.turnId,
        requestId: interaction.request.requestId,
        selectedOption,
        ...(editedSpecContent === undefined ? {} : { editedSpecContent }),
      });
    },
    [vscode],
  );
  const handleAskUserRespond = useCallback(
    (
      interaction: PendingInteraction,
      cancelled: boolean,
      answers: readonly AskUserAnswer[],
    ): void => {
      postAskUserResponse(vscode, interaction, cancelled, answers);
    },
    [vscode],
  );
  return {
    handleEditResend,
    handleRequestRewindInfo,
    regenerateAnchor,
    handleRegenerate,
    handlePermissionRespond,
    handleAskUserRespond,
  };
}
function postAskUserResponse(
  vscode: ReturnType<typeof getVsCodeApi>,
  interaction: PendingInteraction,
  cancelled: boolean,
  answers: readonly AskUserAnswer[],
): void {
  post(vscode, {
    type: 'ask-user.respond',
    sessionId: interaction.sessionId,
    turnId: interaction.turnId,
    requestId: interaction.request.requestId,
    cancelled,
    answers,
  });
}
