import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { EditResendRejection } from './editTypes';

interface MessageEditDraft {
  readonly messageId: string;
  readonly text: string;
  readonly restoreFiles: boolean;
  readonly phase: 'editing' | 'resending';
  readonly notice: string | null;
}

export interface MessageEditSelection {
  readonly messageId: string;
  readonly start: number;
  readonly end: number;
  readonly direction: 'forward' | 'backward' | 'none';
  readonly scrollTop: number;
  readonly focused: boolean;
}

export interface MessageEditor {
  readonly draft: MessageEditDraft | null;
  readonly selection: RefObject<MessageEditSelection | null>;
  readonly begin: (messageId: string, text: string) => void;
  readonly cancel: () => void;
  readonly submit: (messageId: string, restoreFiles: boolean) => void;
  readonly update: (
    messageId: string,
    patch: Partial<Pick<MessageEditDraft, 'text' | 'restoreFiles' | 'notice'>>,
  ) => void;
}

/** One draft survives the two message surfaces and virtual row eviction. */
export function useMessageEditor({
  conversationId,
  sendSignal,
  rejection,
  onBegin,
  onStageBegin,
  onStageCancel,
  onRequestRewindInfo,
  onResend,
}: {
  readonly conversationId: string | null;
  readonly sendSignal: number;
  readonly rejection: EditResendRejection | null;
  readonly onBegin: () => void;
  readonly onStageBegin: (messageId: string) => void;
  readonly onStageCancel: () => void;
  readonly onRequestRewindInfo: (messageId: string) => void;
  readonly onResend: (messageId: string, text: string, restoreFiles: boolean) => void;
}): MessageEditor {
  const [owner, setOwner] = useState(conversationId);
  const [draft, setDraft] = useState<MessageEditDraft | null>(null);
  const selection = useRef<MessageEditSelection | null>(null);
  if (owner !== conversationId) {
    setOwner(conversationId);
    setDraft(null);
    selection.current = null;
  }

  const begin = useCallback(
    (messageId: string, text: string): void => {
      if (draft?.messageId === messageId && draft.phase === 'editing') return;
      if (draft?.phase === 'editing') onStageCancel();
      onBegin();
      selection.current = {
        messageId,
        start: text.length,
        end: text.length,
        direction: 'none',
        scrollTop: 0,
        focused: true,
      };
      setDraft({ messageId, text, restoreFiles: false, phase: 'editing', notice: null });
      onStageBegin(messageId);
      onRequestRewindInfo(messageId);
    },
    [draft, onBegin, onStageBegin, onStageCancel, onRequestRewindInfo],
  );
  const cancel = useCallback((): void => {
    if (draft?.phase === 'editing') onStageCancel();
    selection.current = null;
    setDraft(null);
  }, [draft, onStageCancel]);
  const update = useCallback<MessageEditor['update']>((messageId, patch) => {
    setDraft((current) =>
      current?.messageId === messageId && current.phase === 'editing'
        ? { ...current, ...patch }
        : current,
    );
  }, []);
  const submit = useCallback(
    (messageId: string, restoreFiles: boolean): void => {
      if (draft?.messageId !== messageId || draft.phase !== 'editing') return;
      setDraft({ ...draft, phase: 'resending' });
      onResend(messageId, draft.text, restoreFiles);
    },
    [draft, onResend],
  );

  // A new send abandons an open historical edit, but never a submitted resend.
  const previousSend = useRef(sendSignal);
  useEffect(() => {
    if (previousSend.current === sendSignal) return;
    previousSend.current = sendSignal;
    if (draft?.phase === 'editing') cancel();
  }, [sendSignal, draft, cancel]);

  useEffect(() => {
    if (rejection === null) return;
    setDraft((current) =>
      current?.phase === 'resending' && current.messageId === rejection.messageId
        ? { ...current, phase: 'editing' }
        : current,
    );
  }, [rejection]);

  useEffect(() => {
    if (draft?.phase !== 'resending') return;
    const timer = setTimeout(() => {
      setDraft((current) => (current === draft ? null : current));
    }, 8000);
    return () => clearTimeout(timer);
  }, [draft]);

  return useMemo(
    () => ({ draft, selection, begin, cancel, submit, update }),
    [draft, begin, cancel, submit, update],
  );
}
