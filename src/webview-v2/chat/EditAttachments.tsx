import { useEffect, useRef, useState } from 'react';
import { Paperclip } from 'lucide-react';
import type { AttachmentKind, AttachmentSummary, EditAttachmentSummary, SentAttachmentSummary } from '../../shared/protocol/attachments';
import type { AttachmentStage } from '../../shared/bridgeMessages';
import type { AttachmentImageEntry } from './attachments/attachmentImageStore';
import type { useAttachmentActions } from './attachments/useAttachmentActions';
import { ATTACHMENT_KIND_LABELS, formatAttachmentBytes } from './attachments/attachmentPresentation';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, Popover, PopoverClose, PopoverContent, PopoverTrigger } from '../ui/overlays';
import { StagedImagePreview } from '../content/StagedImagePreview';
import { MAX_ATTACHMENT_IMAGE_BYTES } from '../../shared/protocol/attachmentImageProtocol';

export type AttachmentActions = ReturnType<typeof useAttachmentActions>;

export function AttachmentMenu({ actions, disabled, owner }: {
  readonly actions: AttachmentActions;
  readonly disabled: boolean;
  readonly owner?: string;
}) {
  const choices = owner === undefined ? [
    ['Attach files', actions.handleAttachFiles],
    ['Active editor', actions.handleAttachEditor],
    ['Editor selection', actions.handleAttachSelection],
    ['Problems', actions.handleAttachProblems],
    ['Git changes', actions.handleAttachGitChanges],
  ] as const : [
    ['Attach files', actions.handleEditAttachFiles],
    ['Active editor', actions.handleEditAttachEditor],
    ['Editor selection', actions.handleEditAttachSelection],
    ['Problems', actions.handleEditAttachProblems],
    ['Git changes', actions.handleEditAttachGitChanges],
  ] as const;
  return <Popover>
    <PopoverTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={owner === undefined ? 'Attach to message' : 'Attach to edited message'} disabled={disabled}><Paperclip /></Button></PopoverTrigger>
    <PopoverContent data-editor-popup-owner={owner} className="w-48 space-y-0.5" aria-label="Attachment sources">
      {choices.map(([label, action]) => <PopoverClose key={label} asChild>
        <Button variant="ghost" size="sm" className="w-full justify-start" disabled={disabled} onClick={action}>{label}</Button>
      </PopoverClose>)}
    </PopoverContent>
  </Popover>;
}

export function StagedAttachments({ attachments, images, actions, disabled, stage }: {
  readonly attachments: readonly (AttachmentSummary | EditAttachmentSummary)[];
  readonly images: Readonly<Record<string, AttachmentImageEntry>>;
  readonly actions: AttachmentActions;
  readonly disabled: boolean;
  readonly stage?: AttachmentStage;
}) {
  if (attachments.length === 0) return null;
  return <div aria-label={stage === 'edit' ? 'Attachments to resend' : 'Pending attachments'} className="v2-staged-attachments">
    {attachments.map((attachment) => <AttachmentTile key={attachment.id} attachment={attachment}
      image={images[attachment.id]} actions={actions} disabled={disabled} stage={stage} />)}
  </div>;
}

export function SentAttachments({ attachments }: { readonly attachments: readonly SentAttachmentSummary[] }) {
  return <div aria-label="Attachments sent with this message" className="v2-sent-attachments">
    {attachments.filter((attachment) => attachment.kind !== 'image').map((attachment, index) => (
      <AttachmentTile key={`${attachment.name}:${index}`} attachment={attachment} />
    ))}
  </div>;
}

function AttachmentTile({ attachment, image, actions, disabled = false, stage }: {
  readonly attachment: SentAttachmentSummary | AttachmentSummary | EditAttachmentSummary;
  readonly image?: AttachmentImageEntry;
  readonly actions?: AttachmentActions;
  readonly disabled?: boolean;
  readonly stage?: AttachmentStage;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = 'id' in attachment ? attachment.id : undefined;
  const missing = 'restorable' in attachment && !attachment.restorable;
  const readImage = actions?.handleAttachmentReadImage;
  useEffect(() => {
    if (id !== undefined && attachment.kind === 'image' && image === undefined && !missing && !disabled) readImage?.(id, stage);
  }, [id, attachment.kind, image, readImage, missing, disabled, stage]);
  const ready = image?.status === 'ready' ? image : null;
  return <div className="v2-attachment-thumb" data-unrestorable={missing || undefined}>
    <Button ref={trigger} variant="plain" size="none" aria-label={`Preview ${attachment.name}`}
      title={`${attachment.name}${missing ? ' · Original unavailable; remove or reattach' : ''}${'truncated' in attachment && attachment.truncated ? ' · Truncated' : ''}`}
      onClick={(event) => { event.stopPropagation(); setOpen(true); }}
      className={ready ? 'v2-attachment-image' : 'v2-attachment-file'}>
      {ready ? <img src={`data:${ready.mediaType};base64,${ready.dataBase64}`} alt={attachment.name} />
        : <>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M9.5 2.5h-4A1.5 1.5 0 0 0 4 4v8a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 12 12V5L9.5 2.5ZM9.5 2.5V5H12" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <span className="v2-attachment-badge">{fileBadge(attachment.name, attachment.kind)}</span>
        </>}
    </Button>
    {id !== undefined && actions ? <Button variant="plain" size="none" className="v2-attachment-remove" disabled={disabled} aria-label={`Remove attachment ${attachment.name}`}
      onClick={(event) => { event.stopPropagation(); stage === 'edit' ? actions.handleEditAttachmentRemove(id) : actions.handleAttachmentRemove(id); }}>×</Button> : null}
    {open && ready && id !== undefined && actions ? <StagedImagePreview maxBytes={MAX_ATTACHMENT_IMAGE_BYTES} name={attachment.name} data={ready.dataBase64} mediaType={ready.mediaType} returnFocus={trigger.current}
      onClose={() => setOpen(false)} onSave={(data, mediaType) => {
        if (!disabled) actions.handleAttachmentReplaceImage(id, attachment.name, mediaType, data, stage);
      }} /> : null}
    {open && !ready ? <Dialog open onOpenChange={setOpen}>
      <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus({ preventScroll: true }); }}>
        <DialogTitle className="pr-8 break-words text-sm font-medium">{attachment.name}</DialogTitle>
        <DialogDescription className="mt-2 text-xs text-muted-foreground">{ATTACHMENT_KIND_LABELS[attachment.kind]} · {formatAttachmentBytes(attachment.sizeBytes)}</DialogDescription>
        {'truncated' in attachment && attachment.truncated ? <p className="mt-2 text-xs text-muted-foreground">Truncated</p> : null}
        {attachment.kind === 'image' ? <p role="status" className="mt-2 text-xs">{missing || image?.status === 'unavailable' ? 'Image preview unavailable' : 'Loading image preview…'}</p> : null}
        {missing ? <p className="mt-2 text-xs text-destructive">The original attachment is no longer retained. Remove it or attach it again before resending.</p> : null}
      </DialogContent>
    </Dialog> : null}
  </div>;
}

function fileBadge(name: string, kind: AttachmentKind): string {
  const separator = name.lastIndexOf('.');
  if (separator > 0 && separator < name.length - 1) return name.slice(separator + 1, separator + 5).toUpperCase();
  if (kind === 'pdf') return 'PDF';
  if (kind === 'selection') return 'SEL';
  if (kind === 'editor') return 'ED';
  return 'FILE';
}
