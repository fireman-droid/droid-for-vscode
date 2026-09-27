import type { MessageEditor } from './editing/useMessageEditor';
import type { useAttachmentActions } from './attachments/useAttachmentActions';
import { useAttachmentIngress } from './useAttachmentIngress';

export function useEditAttachmentIngress({ editor, conversationId, actions, count, disabled }: {
  readonly editor: MessageEditor;
  readonly conversationId: string | null;
  readonly actions: ReturnType<typeof useAttachmentActions>;
  readonly count: number;
  readonly disabled: boolean;
}) {
  const owner = editor.draft?.phase === 'editing' ? editor.draft.messageId : null;
  return useAttachmentIngress({
    owner, conversationId, resetKey: 0, count, disabled,
    onNotice: (notice) => { if (owner !== null) editor.update(owner, { notice }); },
    actions: {
      image: actions.handleEditAttachImage, pdf: actions.handleEditAttachPdf,
      text: actions.handleEditAttachTextFile, uris: actions.handleEditAttachUris,
      remoteImage: actions.handleEditAttachRemoteImage,
    },
  });
}
