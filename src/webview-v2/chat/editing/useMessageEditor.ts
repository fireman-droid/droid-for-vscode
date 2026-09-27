import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { EditResendRejection } from './editTypes';

interface MessageEditDraft {
  readonly messageId: string;
  readonly text: string;
  readonly restoreFiles: boolean;
  readonly phase: 'editing' | 'resending';
  readonly notice: string | null;
  readonly rejectionSequence: number;
  readonly resumeOnly: boolean;
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
  readonly onResend: (messageId: string, text: string, restoreFiles: boolean) => boolean | void;
}): MessageEditor {
  const [owner, setOwner] = useState(conversationId);
  const [draft, setDraft] = useState<MessageEditDraft | null>(null);
  const selection = useRef<MessageEditSelection | null>(null);
  const submitted = useRef<{ messageId: string; rejectionSequence: number } | null>(null);
  if (owner !== conversationId) {
    setOwner(conversationId);
    setDraft(null);
    selection.current = null;
    submitted.current = null;
  }

  const begin = useCallback(
    (messageId: string, text: string): void => {
      if (submitted.current !== null) return;
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
      setDraft({ messageId, text, restoreFiles: false, phase: 'editing', notice: null, rejectionSequence: rejection?.sequence ?? -1, resumeOnly: false });
      onStageBegin(messageId);
      onRequestRewindInfo(messageId);
    },
    [draft, rejection, onBegin, onStageBegin, onStageCancel, onRequestRewindInfo],
  );
  const cancel = useCallback((): void => {
    if (submitted.current !== null) return;
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
      if (submitted.current !== null || draft?.messageId !== messageId || draft.phase !== 'editing') return;
      const rejectionSequence = rejection?.sequence ?? -1;
      submitted.current = { messageId, rejectionSequence };
      if (onResend(messageId, draft.text, !draft.resumeOnly && restoreFiles) === false) {
        submitted.current = null;
        return;
      }
      setDraft({ ...draft, restoreFiles, phase: 'resending', notice: null, rejectionSequence });
    },
    [draft, rejection, onResend],
  );

  // A new send abandons an open historical edit, but never a submitted resend.
  const previousSend = useRef(sendSignal);
  useEffect(() => {
    if (previousSend.current === sendSignal) return;
    previousSend.current = sendSignal;
    if (draft?.phase === 'editing') cancel();
  }, [sendSignal, draft, cancel]);

  useEffect(() => {
    const pending = submitted.current;
    if (rejection === null || pending === null || rejection.messageId !== pending.messageId || rejection.sequence <= pending.rejectionSequence) return;
    submitted.current = null;
    setDraft((current) =>
      current?.phase === 'resending' && current.messageId === rejection.messageId
        ? { ...current, phase: 'editing', resumeOnly: current.resumeOnly || rejection.reason === 'resume-failed' }
        : current,
    );
  }, [rejection]);

  return useMemo(
    () => ({ draft, selection, begin, cancel, submit, update }),
    [draft, begin, cancel, submit, update],
  );
}
