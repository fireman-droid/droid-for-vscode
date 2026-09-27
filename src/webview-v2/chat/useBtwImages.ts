import { useEffect, useMemo, useReducer, type ClipboardEvent, type DragEvent } from 'react';
import type { BtwImage } from '../../shared/protocol/btwAttachments';
import { MAX_ATTACHMENT_NAME_LENGTH, MAX_IMAGES_PER_TURN } from '../../shared/protocol/bounds';
import { isImageMediaType, prepareAttachment } from './attachments/attachmentIngress';

export interface BtwImagePreview { readonly url: string; readonly bytes: number }
const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
const MAX_PREVIEW_COUNT = 24;

/** Image bytes stay local until send; streaming snapshots contain only image IDs and names. */
export function useBtwImages(sessionId: string | null, disabled: boolean) {
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  const scope = useMemo(() => ({
    active: true,
    images: [] as readonly BtwImage[],
    notice: null as string | null,
    pending: 0,
    previews: new Map<string, BtwImagePreview>(),
  }), [sessionId]);
  useEffect(() => {
    scope.active = true;
    return () => {
      scope.active = false;
      scope.images = [];
      scope.previews.clear();
    };
  }, [scope]);
  const setNotice = (notice: string | null) => { scope.notice = notice; refresh(); };
  const trimPreviews = () => {
    const pinned = new Set(scope.images.map((image) => image.id));
    let bytes = [...scope.previews.values()].reduce((sum, preview) => sum + preview.bytes, 0);
    for (const [id, preview] of scope.previews) {
      if (bytes <= MAX_PREVIEW_BYTES && scope.previews.size <= MAX_PREVIEW_COUNT) break;
      if (pinned.has(id)) continue;
      bytes -= preview.bytes;
      scope.previews.delete(id);
    }
  };
  const add = (files: readonly File[]) => {
    if (disabled || sessionId === null || !scope.active) return;
    setNotice(null);
    for (const file of files) {
      if (!isImageMediaType(file.type)) {
        setNotice('Attach a PNG, JPEG, GIF or WebP image.');
        continue;
      }
      if (scope.images.length + scope.pending >= MAX_IMAGES_PER_TURN) {
        setNotice(`Up to ${MAX_IMAGES_PER_TURN} images can be attached to a side question.`);
        break;
      }
      scope.pending += 1;
      refresh();
      void prepareAttachment(file).then((prepared) => {
        if (!scope.active) return;
        if (prepared.kind === 'notice') { setNotice(prepared.message); return; }
        if (prepared.kind !== 'image') return;
        const id = crypto.randomUUID();
        const name = prepared.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_ATTACHMENT_NAME_LENGTH) || 'image';
        scope.previews.set(id, { url: `data:${prepared.mediaType};base64,${prepared.data}`, bytes: file.size });
        scope.images = [...scope.images, { id, name, mediaType: prepared.mediaType, dataBase64: prepared.data }];
        trimPreviews();
      }).catch(() => {
        if (scope.active) setNotice('This image could not be attached.');
      }).finally(() => {
        scope.pending -= 1;
        if (scope.active) refresh();
      });
    }
  };
  return {
    images: scope.images, previews: scope.previews, notice: scope.notice, reading: scope.pending,
    add, isReading: () => scope.pending > 0,
    remove: (id: string) => {
      scope.images = scope.images.filter((image) => image.id !== id);
      scope.previews.delete(id);
      setNotice(null);
    },
    sent: (ids: readonly string[]) => {
      scope.images = scope.images.filter((image) => !ids.includes(image.id));
      trimPreviews();
      setNotice(null);
    },
    onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
      if (!files.length || disabled) return;
      if (!event.clipboardData.getData('text/plain')) event.preventDefault();
      add(files);
    },
    onDragOver: (event: DragEvent) => {
      if (!Array.from(event.dataTransfer.types).includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
    },
    onDrop: (event: DragEvent) => {
      if (!event.dataTransfer.files.length) return;
      event.preventDefault();
      add(Array.from(event.dataTransfer.files));
    },
  };
}
