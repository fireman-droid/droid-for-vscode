import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";

import type {
  AttachmentStage,
  AttachmentKind,
  AttachmentSummary,
  EditAttachmentSummary,
  ImageMediaType,
  SentAttachmentSummary,
} from "../../../shared/bridgeMessages";
import { dismissOverlay } from "../Lightbox";
import { getImagePreview } from "../imagePreviewCache";
import type { AttachmentImageEntry } from "../store";
import {
  isAnimatedWebp,
  StagedImageLightbox,
} from "../StagedImageLightbox";
import { ImageLightbox } from "../TranscriptImage";

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  image: "Image",
  pdf: "PDF",
  text: "File",
  editor: "Editor",
  selection: "Selection",
};

export function AttachmentChip({
  attachment,
  image,
  onRequestImage,
  onReplaceImage,
  onRemove,
}: {
  readonly attachment: AttachmentSummary;
  readonly image?: AttachmentImageEntry;
  readonly onRequestImage?: (attachmentId: string) => void;
  readonly onReplaceImage?: (
    attachmentId: string,
    name: string,
    mediaType: ImageMediaType,
    dataBase64: string,
  ) => void;
  readonly onRemove: (attachmentId: string) => void;
}): React.JSX.Element {
  return (
    <AttachmentTile
      kind={attachment.kind}
      attachmentId={attachment.id}
      name={attachment.name}
      sizeBytes={attachment.sizeBytes}
      image={image}
      onRequestImage={onRequestImage}
      onReplaceImage={onReplaceImage}
      onRemove={() => onRemove(attachment.id)}
    />
  );
}

export function EditAttachmentChip({
  attachment,
  image,
  onRequestImage,
  onReplaceImage,
  onRemove,
}: {
  readonly attachment: EditAttachmentSummary;
  readonly image?: AttachmentImageEntry;
  readonly onRequestImage?: (
    attachmentId: string,
    stage: AttachmentStage,
  ) => void;
  readonly onReplaceImage?: (
    attachmentId: string,
    name: string,
    mediaType: ImageMediaType,
    dataBase64: string,
    stage: AttachmentStage,
  ) => void;
  readonly onRemove: (attachmentId: string) => void;
}): React.JSX.Element {
  return (
    <AttachmentTile
      kind={attachment.kind}
      attachmentId={attachment.id}
      name={attachment.name}
      sizeBytes={attachment.sizeBytes}
      image={image}
      onRequestImage={
        onRequestImage === undefined
          ? undefined
          : (attachmentId) => onRequestImage(attachmentId, "edit")
      }
      onReplaceImage={
        onReplaceImage === undefined
          ? undefined
          : (attachmentId, name, mediaType, dataBase64) =>
              onReplaceImage(
                attachmentId,
                name,
                mediaType,
                dataBase64,
                "edit",
              )
      }
      unrestorable={!attachment.restorable}
      onRemove={() => onRemove(attachment.id)}
    />
  );
}

export function SentAttachmentChip({
  attachment,
}: {
  readonly attachment: SentAttachmentSummary;
}): React.JSX.Element {
  return (
    <AttachmentTile
      kind={attachment.kind}
      name={attachment.name}
      sizeBytes={attachment.sizeBytes}
    />
  );
}

function AttachmentTile({
  kind,
  attachmentId,
  name,
  sizeBytes,
  image,
  unrestorable = false,
  onRequestImage,
  onReplaceImage,
  onRemove,
}: {
  readonly kind: AttachmentKind;
  readonly attachmentId?: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly image?: AttachmentImageEntry;
  readonly unrestorable?: boolean;
  readonly onRequestImage?: (attachmentId: string) => void;
  readonly onReplaceImage?: (
    attachmentId: string,
    name: string,
    mediaType: ImageMediaType,
    dataBase64: string,
  ) => void;
  readonly onRemove?: () => void;
}): React.JSX.Element {
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => {
    if (
      kind === "image" &&
      attachmentId !== undefined &&
      image === undefined
    ) {
      onRequestImage?.(attachmentId);
    }
  }, [attachmentId, image, kind, onRequestImage]);
  const imageSrc =
    kind !== "image"
      ? undefined
      : image?.status === "ready"
        ? `data:${image.mediaType};base64,${image.dataBase64}`
        : getImagePreview(name, sizeBytes);
  const stagedImage =
    image?.status === "ready" &&
    attachmentId !== undefined &&
    onReplaceImage !== undefined
      ? image
      : null;
  const openPreview = (event: ReactMouseEvent): void => {
    event.stopPropagation();
    setPreviewOpen(true);
  };
  return (
    <span
      className={`dvx-attachment-thumb${
        unrestorable ? " dvx-attachment-unrestorable" : ""
      }`}
      title={name}
    >
      <button
        type="button"
        className={
          imageSrc !== undefined
            ? "dvx-attachment-thumb-preview"
            : "dvx-attachment-thumb-file"
        }
        aria-label={`Preview ${name}`}
        onClick={openPreview}
      >
        {imageSrc !== undefined ? (
          <img
            className="dvx-attachment-thumb-image"
            src={imageSrc}
            alt={name}
          />
        ) : (
          <>
            <FileGlyph />
            <span className="dvx-attachment-thumb-ext">
              {fileBadge(name, kind)}
            </span>
          </>
        )}
      </button>
      {onRemove !== undefined ? (
        <button
          type="button"
          className="dvx-attachment-thumb-remove"
          aria-label={`Remove attachment ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      ) : null}
      {previewOpen && imageSrc !== undefined && stagedImage !== null ? (
        <StagedImageLightbox
          src={imageSrc}
          mediaType={stagedImage.mediaType}
          annotatable={
            stagedImage.mediaType !== "image/gif" &&
            (stagedImage.mediaType !== "image/webp" ||
              !isAnimatedWebp(stagedImage.dataBase64))
          }
          onSave={(dataBase64, mediaType) =>
            onReplaceImage?.(
              attachmentId!,
              name,
              mediaType,
              dataBase64,
            )
          }
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
      {previewOpen && imageSrc !== undefined && stagedImage === null ? (
        <ImageLightbox src={imageSrc} onClose={() => setPreviewOpen(false)} />
      ) : null}
      {previewOpen && imageSrc === undefined ? (
        <FilePreview
          kind={kind}
          name={name}
          sizeBytes={sizeBytes}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </span>
  );
}

function FilePreview({
  kind,
  name,
  sizeBytes,
  onClose,
}: {
  readonly kind: AttachmentKind;
  readonly name: string;
  readonly sizeBytes: number;
  readonly onClose: () => void;
}): React.JSX.Element {
  const closedRef = useRef(false);
  const close = (): void => {
    if (closedRef.current) {
      return;
    }
    closedRef.current = true;
    onClose();
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const closeFromBackdrop = (event: ReactMouseEvent): void => {
    if (event.target !== event.currentTarget || closedRef.current) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    closedRef.current = true;
    dismissOverlay(onClose);
  };
  return createPortal(
    <div
      className="dvx-image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="File preview"
      onPointerDown={closeFromBackdrop}
      onClick={closeFromBackdrop}
    >
      <div
        className="dvx-file-preview"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <FileGlyph />
        <div className="dvx-file-preview-name">{name}</div>
        <div className="dvx-file-preview-meta">
          {ATTACHMENT_KIND_LABELS[kind]} · {formatBytes(sizeBytes)}
        </div>
      </div>
      <div className="dvx-image-lightbox-actions">
        <button
          type="button"
          className="dvx-image-lightbox-close"
          aria-label="Close file preview"
          onClick={(event) => {
            event.stopPropagation();
            close();
          }}
        >
          ✕
        </button>
      </div>
    </div>,
    document.body,
  );
}

function FileGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M9.5 2.5h-4A1.5 1.5 0 0 0 4 4v8a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 12 12V5L9.5 2.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 2.5V5H12"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function fileBadge(name: string, kind: AttachmentKind): string {
  const separator = name.lastIndexOf(".");
  if (separator > 0 && separator < name.length - 1) {
    return name.slice(separator + 1, separator + 5).toUpperCase();
  }
  if (kind === "pdf") {
    return "PDF";
  }
  if (kind === "selection") {
    return "SEL";
  }
  if (kind === "editor") {
    return "ED";
  }
  return "FILE";
}

function formatBytes(byteLength: number): string {
  if (byteLength >= 1_048_576) {
    return `${(byteLength / 1_048_576).toFixed(1)} MB`;
  }
  if (byteLength >= 1_024) {
    return `${Math.round(byteLength / 1_024)} KB`;
  }
  return `${byteLength} B`;
}
