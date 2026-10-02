import type { ClipboardEventHandler, DragEventHandler, ReactNode } from 'react';
import { QuestionCardView } from '@droidvisx/chat-ui/chat/QuestionCardView';
import type { UserTranscriptItem } from '../../shared/protocol/transcript';
import type { MessageEditor } from './editing/useMessageEditor';
import { MAX_TURN_TEXT_LENGTH } from '../../shared/protocol/bounds';
import type { ImageTranscriptItem } from '../../shared/protocol/attachments';
import type { PlanAnchorState } from './transcript/planAnchor';
import { ImageContent } from '../content/MediaPreview';
import { PlanLine } from './PlanLine';
import { EDIT_REJECT_COPY, type EditResendRejection, type EditStageState, type RewindFileInfo } from './editing/editTypes';
import type { AttachmentImageEntry } from './attachments/attachmentImageStore';
import { StagedAttachments, SentAttachments, type AttachmentActions } from './EditAttachments';
import { RestoreFiles } from './RestoreFiles';
import { parseSelectionQuotes } from '@droidvisx/chat-ui/chat/selectionQuote';

export interface QuestionEditing {
  readonly stage: EditStageState | null;
  readonly images: Readonly<Record<string, AttachmentImageEntry>>;
  readonly actions: AttachmentActions;
  readonly disabled: boolean;
  readonly preparing: number;
  readonly isPreparing: () => boolean;
  readonly impact: RewindFileInfo | null;
  readonly rejection: EditResendRejection | null;
  readonly onPaste: ClipboardEventHandler<HTMLTextAreaElement>;
  readonly onDrop: DragEventHandler;
  readonly onDragOver: DragEventHandler;
  readonly settings?: ReactNode;
}

export function QuestionCard({
  item,
  editor,
  placeholder,
  placeholderHeight,
  canResend,
  editAvailable = true,
  images = [],
  plan,
  planRunning = false,
  planChoice = null,
  onPlanToggle,
  edit,
}: {
  readonly item: UserTranscriptItem;
  readonly editor: MessageEditor;
  readonly placeholder?: boolean;
  readonly placeholderHeight?: number;
  readonly canResend: boolean;
  readonly editAvailable?: boolean;
  readonly images?: readonly ImageTranscriptItem[];
  readonly plan?: PlanAnchorState;
  readonly planRunning?: boolean;
  readonly planChoice?: { readonly id: string; readonly expanded: boolean } | null;
  readonly onPlanToggle?: (id: string, expanded: boolean) => void;
  readonly edit: QuestionEditing;
}) {
  const messageId = item.messageId;
  const stage = edit.stage?.messageId === messageId ? edit.stage : null;
  const impact = edit.impact?.messageId === messageId ? edit.impact : null;
  const draft = editor.draft?.messageId === messageId ? editor.draft : null;
  const pending = draft?.phase === 'resending';
  const attachmentDisabled = edit.disabled || stage === null || pending;
  const rejection = draft && edit.rejection !== null && edit.rejection.messageId === messageId && edit.rejection.sequence > draft.rejectionSequence ? EDIT_REJECT_COPY[edit.rejection.reason] : null;
  const originalAttachments = <>
    {images.length ? <div className="v2-sent-attachments">
      {images.map((image) => image.data.length === 0
        ? <p key={image.id} role="note" className="text-xs text-muted-foreground">Image preview unavailable</p>
        : <ImageContent key={image.id} src={`data:${image.mediaType};base64,${image.data}`} alt="Message attachment" thumbnail />)}
    </div> : null}
    {item.attachments?.some((attachment) => attachment.kind !== 'image')
      ? <SentAttachments attachments={item.attachments} /> : null}
  </>;
  const displayEditor = draft && edit.preparing > 0 ? { ...editor, draft: { ...draft, notice: 'Preparing attachments…' } } : editor;
  return <QuestionCardView item={item} editor={displayEditor} quote={parseSelectionQuotes(item.text)} placeholder={placeholder} placeholderHeight={placeholderHeight}
    canResend={canResend && edit.preparing === 0} editAvailable={editAvailable} maxLength={MAX_TURN_TEXT_LENGTH} originalAttachments={originalAttachments}
    stagedAttachments={stage === null ? originalAttachments : stage.attachments.length ? <StagedAttachments stage="edit" attachments={stage.attachments} images={edit.images} actions={edit.actions} disabled={attachmentDisabled} /> : null}
    editSettings={edit.settings} editDisabled={attachmentDisabled} onAttach={edit.actions.handleEditAttachFiles} rejection={rejection}
    onPaste={edit.onPaste} onDrop={edit.onDrop} onDragOver={edit.onDragOver}
    onResend={() => { if (messageId && draft && !edit.isPreparing()) editor.submit(messageId, draft.restoreFiles && impact !== null && impact.restorableCount + impact.createdCount > 0); }}
    restoreFiles={draft && impact ? <RestoreFiles impact={impact} checked={draft.restoreFiles} disabled={pending || draft.resumeOnly} restored={draft.resumeOnly && draft.restoreFiles} openDisabled={edit.disabled || pending} onChange={(restoreFiles) => editor.update(draft.messageId, { restoreFiles })} /> : null}
    plan={plan && onPlanToggle ? <PlanLine key={plan.anchorToolUseId} anchor={plan} running={planRunning} override={planChoice?.id === plan.anchorToolUseId ? planChoice.expanded : null} onToggle={onPlanToggle} /> : null} />;
}
