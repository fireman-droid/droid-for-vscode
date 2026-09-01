import type { HostTranscriptState } from '../hostTranscriptState';
import type { ChatControllerInternals } from './internals';

export async function createDurableForkConversation(
  ctl: ChatControllerInternals,
  sourceConversationId: string,
  sourceSessionId: string,
  successorSessionId: string,
  relation: 'fork' | 'rewind',
  transcript: HostTranscriptState,
): Promise<string | null> {
  const previousSelectedConversationId =
    ctl.recoveryStore.getSelectedConversationId();
  const conversationId = ctl.recoveryStore.forkConversation(
    sourceConversationId,
    sourceSessionId,
    successorSessionId,
    relation,
    transcript,
  );
  if (conversationId === undefined) {
    return null;
  }
  ctl.recoveryStore.selectConversation(conversationId);
  try {
    await ctl.recoveryStore.flush();
    return conversationId;
  } catch {
    ctl.recoveryStore.discardConversation(conversationId);
    ctl.recoveryStore.selectConversation(
      previousSelectedConversationId,
    );
    return null;
  }
}

export async function adoptDurableSuccessor(
  ctl: ChatControllerInternals,
  conversationId: string,
  sourceSessionId: string,
  successorSessionId: string,
  relation: 'compact' | 'handoff',
): Promise<boolean> {
  const previous = ctl.recoveryStore.readConversation(conversationId);
  if (
    previous === undefined ||
    !ctl.recoveryStore.adoptSuccessor(
      conversationId,
      sourceSessionId,
      successorSessionId,
      relation,
    )
  ) {
    return false;
  }
  ctl.recoveryStore.selectConversation(conversationId);
  try {
    await ctl.recoveryStore.flush();
    return true;
  } catch {
    ctl.recoveryStore.restoreConversation(previous);
    ctl.recoveryStore.selectConversation(conversationId);
    return false;
  }
}
