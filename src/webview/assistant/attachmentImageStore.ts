import type {
  AttachmentSummary,
  EditAttachmentSummary,
  HostToWebviewMessage,
  ImageMediaType,
} from '../../shared/bridgeMessages';
import type { AssistantWebviewState } from './store';

export type AttachmentImageEntry =
  | { readonly status: 'unavailable' }
  | {
      readonly status: 'ready';
      readonly name: string;
      readonly mediaType: ImageMediaType;
      readonly dataBase64: string;
    };

type AttachmentMessage = Extract<
  HostToWebviewMessage,
  {
    type:
      | 'session.attachments'
      | 'session.attachmentImageData'
      | 'session.editAttachments';
  }
>;

export function reduceAttachmentMessage(
  state: AssistantWebviewState,
  event: AttachmentMessage,
): AssistantWebviewState {
  if (event.sessionId !== state.sessionId) {
    return { ...state, sequence: event.sequence };
  }
  if (event.type === 'session.attachments') {
    return {
      ...state,
      sequence: event.sequence,
      attachments: event.attachments,
      attachmentImages: retainAttachmentImages(
        state.attachmentImages,
        event.attachments,
        state.editAttachments?.attachments ?? [],
      ),
    };
  }
  if (event.type === 'session.editAttachments') {
    return {
      ...state,
      sequence: event.sequence,
      editAttachments: {
        messageId: event.messageId,
        attachments: event.attachments,
      },
      attachmentImages: retainAttachmentImages(
        state.attachmentImages,
        state.attachments,
        event.attachments,
      ),
    };
  }
  return {
    ...state,
    sequence: event.sequence,
    attachmentImages: {
      ...state.attachmentImages,
      [event.attachmentId]:
        event.status === 'ready'
          ? {
              status: 'ready',
              name: event.name,
              mediaType: event.mediaType,
              dataBase64: event.dataBase64,
            }
          : { status: 'unavailable' },
    },
  };
}

function retainAttachmentImages(
  images: Readonly<Record<string, AttachmentImageEntry>>,
  main: readonly AttachmentSummary[],
  edit: readonly EditAttachmentSummary[],
): Readonly<Record<string, AttachmentImageEntry>> {
  const retainedIds = new Set([
    ...main.filter(({ kind }) => kind === 'image').map(({ id }) => id),
    ...edit.filter(({ kind }) => kind === 'image').map(({ id }) => id),
  ]);
  return Object.fromEntries(
    Object.entries(images).filter(([id]) => retainedIds.has(id)),
  );
}
