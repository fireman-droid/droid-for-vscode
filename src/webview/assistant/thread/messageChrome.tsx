import { useAuiState } from '@assistant-ui/react';
import { createContext, useContext, type ReactNode } from 'react';

import { isPlanLive, type PlanAnchorState } from '../transcript/planAnchor';
import { PlanLine } from '../transcript/PlanLine';
import {
  type EditResendRejection,
  type EditStageState,
  type RewindFileInfo,
} from '../editing/editTypes';
import { type UserEditorEnv } from '../editing/userEditorEnv';
import type { MessageEditor } from '../editing/useMessageEditor';
import { AssistantMessage } from './AssistantMessage';
import { readMessageText, readUserAttachments, readUserMessageId } from './readers';
import { UserMessage } from './UserMessage';

/**
 * Per-thread chrome the virtualizer's module-level UserMessage
 * component cannot close over (plan line, edit card, rewind).
 */
export interface ThreadMessageChrome {
  readonly planAnchors: ReadonlyMap<string, PlanAnchorState> | null;
  readonly running: boolean;
  readonly activeTurnId: string | null;
  readonly editor: MessageEditor;
  readonly editStage: EditStageState | null;
  readonly rejection: EditResendRejection | null;
  readonly editorEnv: UserEditorEnv;
  readonly editResendEnabled: boolean;
  readonly rewindInfo: RewindFileInfo | null;
}

export const ThreadMessageChromeContext = createContext<ThreadMessageChrome | null>(null);

export interface PinnedMessageLayout {
  readonly messageId: string | null;
  readonly messageHeight: number;
}

export const PinnedMessageContext = createContext<PinnedMessageLayout>({
  messageId: null,
  messageHeight: 0,
});

export const MessageSurfaceContext = createContext<'flow' | 'pinned'>('flow');

function ThreadUserMessage(): ReactNode {
  const chrome = useContext(ThreadMessageChromeContext);
  const pinned = useContext(PinnedMessageContext);
  const surface = useContext(MessageSurfaceContext);
  const message = useAuiState((state) => state.message);
  if (chrome === null) {
    return null;
  }
  const content = Array.isArray(message.content) ? message.content : [];
  const messageId = readUserMessageId(message.metadata);
  const isPinnedMessage = pinned.messageId === message.id;
  const pinnedPlaceholder = surface === 'flow' && isPinnedMessage;
  const plan = chrome.planAnchors?.get(message.id);
  const hasImage = content.some(
    (part) =>
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      part.type === 'data' &&
      'name' in part &&
      part.name === 'droid-image',
  );
  const attachments = readUserAttachments(message.metadata).filter(
    (item) => !hasImage || item.kind !== 'image',
  );
  return (
    <UserMessage
      text={readMessageText(content)}
      messageId={messageId}
      attachments={attachments}
      planLine={
        plan === undefined ? null : (
          <PlanLine
            key={plan.anchorToolUseId}
            anchor={plan}
            running={isPlanLive(plan, chrome.running, chrome.activeTurnId)}
          />
        )
      }
      editor={chrome.editor}
      pinnedPlaceholder={pinnedPlaceholder}
      placeholderHeight={pinned.messageHeight}
      editStage={chrome.editStage}
      rejection={chrome.rejection}
      editorEnv={chrome.editorEnv}
      editResendEnabled={chrome.editResendEnabled}
      rewindInfo={chrome.rewindInfo}
    />
  );
}

/** Stable identity: MessageById memos on each field of this object. */
export const THREAD_MESSAGE_COMPONENTS = {
  UserMessage: ThreadUserMessage,
  AssistantMessage,
};
