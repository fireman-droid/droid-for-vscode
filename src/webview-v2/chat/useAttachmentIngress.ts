import { useEffect, useRef, type ClipboardEvent, type DragEvent } from 'react';
import type { ImageMediaType } from '../../shared/protocol/attachments';
import { MAX_ATTACHMENT_URI_COUNT, MAX_PENDING_ATTACHMENTS } from '../../shared/protocol/bounds';
import { isImageMediaType, prepareAttachment, readDroppedFileUris, readDroppedRemoteImageUrl } from '../../webview/assistant/attachments/attachmentIngress';

interface IngressOptions {
  readonly owner: string | null;
  readonly conversationId: string | null;
  readonly resetKey: string | number;
  readonly count: number;
  readonly disabled: boolean;
  readonly onNotice: (message: string) => void;
  readonly actions: {
    readonly image: (name: string, mediaType: ImageMediaType, data: string) => void;
    readonly pdf: (name: string, data: string) => void;
    readonly text: (name: string, text: string, truncated: boolean) => void;
    readonly uris: (uris: readonly string[]) => void;
    readonly remoteImage: (url: string) => void;
  };
}

export function useAttachmentIngress(options: IngressOptions) {
  const { owner, conversationId, resetKey, count, disabled, actions, onNotice } = options;
  const scope = useRef({ owner, conversationId, resetKey });
  if (scope.current.owner !== owner || scope.current.conversationId !== conversationId || scope.current.resetKey !== resetKey) scope.current = { owner, conversationId, resetKey };
  const requestScope = scope.current;
  const current = useRef(options);
  current.current = options;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const remaining = Math.max(0, MAX_PENDING_ATTACHMENTS - count);
  const capacityNotice = () => onNotice(`Up to ${MAX_PENDING_ATTACHMENTS} attachments can be staged for one message.`);
  const stageFiles = (files: readonly File[]) => {
    if (disabled || owner === null) return;
    if (files.length > remaining) capacityNotice();
    for (const file of files.slice(0, remaining)) {
      void prepareAttachment(file).then((prepared) => {
        const latest = current.current;
        if (!mounted.current || latest.disabled || scope.current !== requestScope) return;
        switch (prepared.kind) {
          case 'notice': latest.onNotice(prepared.message); break;
          case 'image': latest.actions.image(prepared.name, prepared.mediaType, prepared.data); break;
          case 'pdf': latest.actions.pdf(prepared.name, prepared.data); break;
          case 'text': latest.actions.text(prepared.name, prepared.text, prepared.truncated); break;
        }
      });
    }
  };
  return {
    onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.clipboardData.files).filter((file) => isImageMediaType(file.type));
      if (files.length === 0 || disabled) return;
      if (event.clipboardData.getData('text/plain').length === 0) event.preventDefault();
      stageFiles(files);
    },
    onDragOver: (event: DragEvent) => {
      if (!Array.from(event.dataTransfer.types).some((type) => ['Files', 'text/uri-list', 'application/vnd.code.uri-list', 'text/html'].includes(type))) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
    },
    onDrop: (event: DragEvent) => {
      if (disabled || owner === null) { event.preventDefault(); return; }
      const uris = readDroppedFileUris(event.dataTransfer);
      const files = Array.from(event.dataTransfer.files);
      const remote = readDroppedRemoteImageUrl(event.dataTransfer);
      if (uris.length > 0) {
        event.preventDefault();
        if (uris.length > remaining) capacityNotice();
        if (remaining > 0) actions.uris(uris.slice(0, Math.min(remaining, MAX_ATTACHMENT_URI_COUNT)));
      } else if (files.length > 0) {
        event.preventDefault();
        stageFiles(files);
      } else if (remote !== null) {
        event.preventDefault();
        if (remaining > 0) actions.remoteImage(remote); else capacityNotice();
      }
    },
  };
}
