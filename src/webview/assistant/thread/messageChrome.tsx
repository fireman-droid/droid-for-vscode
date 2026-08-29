import { useAuiState } from "@assistant-ui/react";
import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

import { isPlanLive, type PlanAnchorState } from "../planAnchor";
import { PlanLine } from "../PlanLine";
import type {
  EditResendRejection,
  EditStageState,
  RewindFileInfo,
  UserEditorEnv,
} from "../Thread";
import { AssistantMessage } from "./AssistantMessage";
import {
  readMessageText,
  readUserAttachments,
  readUserMessageId,
} from "./readers";
import { UserMessage } from "./UserMessage";

/**
 * Per-thread chrome the virtualizer's module-level UserMessage
 * component cannot close over (plan line, edit card, rewind).
 */
export interface ThreadMessageChrome {
  readonly planAnchors: ReadonlyMap<string, PlanAnchorState> | null;
  readonly running: boolean;
  readonly activeTurnId: string | null;
  readonly editingMessageId: string | null;
  readonly editStage: EditStageState | null;
  readonly rejection: EditResendRejection | null;
  readonly editorEnv: UserEditorEnv;
  readonly editResendEnabled: boolean;
  readonly rewindInfo: RewindFileInfo | null;
  readonly onRequestRewindInfo: (messageId: string) => void;
  readonly onEditResend: (
    messageId: string,
    text: string,
    restoreFiles?: boolean,
  ) => void;
  readonly onBeginEdit: (messageId: string) => void;
  readonly onCancelEdit: () => void;
  readonly onSubmitEdit: () => void;
  readonly onReopenEdit: (messageId: string) => void;
}

export const ThreadMessageChromeContext =
  createContext<ThreadMessageChrome | null>(null);

export interface PinnedMessageLayout {
  readonly messageId: string | null;
}

export const PinnedMessageContext =
  createContext<PinnedMessageLayout>({
    messageId: null,
  });

export const MessageSurfaceContext =
  createContext<"flow" | "pinned">("flow");

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
  const pinnedPlaceholder = surface === "flow" && isPinnedMessage;
  const plan = chrome.planAnchors?.get(message.id);
  const hasImage = content.some(
    (part) =>
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "data" &&
      "name" in part &&
      part.name === "droid-image",
  );
  const attachments = readUserAttachments(message.metadata).filter(
    (item) => !hasImage || item.kind !== "image",
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
      editing={
        !pinnedPlaceholder &&
        messageId !== null &&
        messageId === chrome.editingMessageId
      }
      pinnedPlaceholder={pinnedPlaceholder}
      editStage={chrome.editStage}
      rejection={chrome.rejection}
      editorEnv={chrome.editorEnv}
      editResendEnabled={chrome.editResendEnabled}
      rewindInfo={chrome.rewindInfo}
      onRequestRewindInfo={chrome.onRequestRewindInfo}
      onEditResend={chrome.onEditResend}
      onBeginEdit={chrome.onBeginEdit}
      onCancelEdit={chrome.onCancelEdit}
      onSubmitEdit={chrome.onSubmitEdit}
      onReopenEdit={chrome.onReopenEdit}
    />
  );
}

/** Stable identity: MessageById memos on each field of this object. */
export const THREAD_MESSAGE_COMPONENTS = {
  UserMessage: ThreadUserMessage,
  AssistantMessage,
};
