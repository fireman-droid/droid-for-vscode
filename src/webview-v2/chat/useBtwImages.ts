import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import type { BtwImage } from '../../shared/protocol/btwAttachments';
import { MAX_ATTACHMENT_NAME_LENGTH, MAX_IMAGES_PER_TURN } from '../../shared/protocol/bounds';
import { isImageMediaType, prepareAttachment } from '../../webview/assistant/attachments/attachmentIngress';

export interface BtwImagePreview { readonly url: string; readonly bytes: number }
const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
const MAX_PREVIEW_COUNT = 24;

/** Image bytes stay local until send; streaming snapshots contain only image IDs and names. */
export function useBtwImages(disabled: boolean) {
  const [images, setImages] = useState<readonly BtwImage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [reading, setReading] = useState(0);
  const staged = useRef(images);
  const previews = useRef(new Map<string, BtwImagePreview>());
  const pending = useRef(0);
  const scope = useRef<object | null>(null);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  useEffect(() => {
    scope.current = {};
    return () => {
      scope.current = null;
      previews.current.clear();
    };
  }, []);
  const update = (next: readonly BtwImage[]) => { staged.current = next; setImages(next); };
  const trimPreviews = () => {
    const pinned = new Set(staged.current.map((image) => image.id));
    let bytes = [...previews.current.values()].reduce((sum, preview) => sum + preview.bytes, 0);
    for (const [id, preview] of previews.current) {
      if (bytes <= MAX_PREVIEW_BYTES && previews.current.size <= MAX_PREVIEW_COUNT) break;
      if (pinned.has(id)) continue;
      bytes -= preview.bytes;
      previews.current.delete(id);
    }
  };
  const add = (files: readonly File[]) => {
    if (disabledRef.current) return;
    const owner = scope.current;
    setNotice(null);
    for (const file of files) {
      if (!isImageMediaType(file.type)) {
        setNotice('Attach a PNG, JPEG, GIF or WebP image.');
        continue;
      }
      if (staged.current.length + pending.current >= MAX_IMAGES_PER_TURN) {
        setNotice(`Up to ${MAX_IMAGES_PER_TURN} images can be attached to a side question.`);
        break;
      }
      pending.current += 1;
      setReading(pending.current);
      void prepareAttachment(file).then((prepared) => {
        if (scope.current !== owner || owner === null || disabledRef.current) return;
        if (prepared.kind === 'notice') { setNotice(prepared.message); return; }
        if (prepared.kind !== 'image') return;
        const id = crypto.randomUUID();
        const name = prepared.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_ATTACHMENT_NAME_LENGTH) || 'image';
        previews.current.set(id, { url: `data:${prepared.mediaType};base64,${prepared.data}`, bytes: file.size });
        update([...staged.current, { id, name, mediaType: prepared.mediaType, dataBase64: prepared.data }]);
        trimPreviews();
      }).catch(() => {
        if (scope.current === owner && owner !== null) setNotice('This image could not be attached.');
      }).finally(() => {
        pending.current -= 1;
        if (scope.current === owner && owner !== null) setReading(pending.current);
      });
    }
  };
  return {
    images, previews: previews.current, notice, reading,
    add,
    remove: (id: string) => {
      update(staged.current.filter((image) => image.id !== id));
      previews.current.delete(id);
      setNotice(null);
    },
    sent: () => { update([]); setNotice(null); trimPreviews(); },
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
