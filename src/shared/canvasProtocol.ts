import {
  hasExactKeys,
  isStrictRecord,
  type UnknownRecord,
} from './strictValidation';

export const CANVAS_VIEWS = ['preview', 'code', 'diff'] as const;
export type CanvasView = (typeof CANVAS_VIEWS)[number];

export const CANVAS_VIEWPORTS = ['desktop', 'tablet', 'mobile'] as const;
export type CanvasViewport = (typeof CANVAS_VIEWPORTS)[number];

export const MAX_CANVAS_ARTIFACT_ID_LENGTH = 160;
export const MAX_CANVAS_TITLE_LENGTH = 120;
export const MAX_CANVAS_FEEDBACK_LENGTH = 4_000;
export const MAX_CANVAS_ELEMENT_DESCRIPTOR_LENGTH = 480;
export const MAX_CANVAS_CODE_SOURCE_LENGTH = 512 * 1024;
export const MAX_CANVAS_BASELINES = 8;
export const MAX_INLINE_PREVIEW_HTML_LENGTH = 512 * 1024;

export interface CanvasInlineArtifact {
  readonly artifactId: string;
  readonly title: string;
}

export interface PreviewInlineHtmlMessage {
  readonly type: 'preview.inlineHtml';
  readonly sessionId: string;
  readonly html: string;
  readonly artifactId?: string;
  readonly title?: string;
}

export interface CanvasSelectionDescriptor {
  readonly tag: string;
  readonly id?: string;
  readonly classes?: string;
  readonly text?: string;
  readonly path: string;
}

export interface CanvasFeedbackDraftMessage {
  readonly type: 'canvas.feedbackDraft';
  readonly sequence: number;
  readonly text: string;
}

export type CanvasPanelMessage =
  | {
      readonly type: 'canvas.reload';
      readonly generation: number;
      readonly revision: number;
    }
  | {
      readonly type: 'canvas.openInEditor';
      readonly generation: number;
      readonly revision: number;
    }
  | {
      readonly type: 'canvas.feedback';
      readonly generation: number;
      readonly revision: number;
      readonly feedback: string;
      readonly selection?: CanvasSelectionDescriptor;
    };

const SAFE_ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const SAFE_DESCRIPTOR_TEXT = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/u;
const SAFE_SINGLE_LINE = /^[^\u0000-\u001F\u007F]*$/u;

export function isCanvasArtifactId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CANVAS_ARTIFACT_ID_LENGTH &&
    SAFE_ARTIFACT_ID.test(value)
  );
}

export function isCanvasTitle(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_CANVAS_TITLE_LENGTH &&
    SAFE_SINGLE_LINE.test(value)
  );
}

export function parseCanvasFeedbackDraftMessage(
  value: UnknownRecord,
): CanvasFeedbackDraftMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'text']) ||
    value.type !== 'canvas.feedbackDraft' ||
    !isSequence(value.sequence) ||
    !isBoundedText(value.text, MAX_CANVAS_FEEDBACK_LENGTH)
  ) {
    return undefined;
  }
  return {
    type: 'canvas.feedbackDraft',
    sequence: value.sequence,
    text: value.text,
  };
}

export function parseCanvasInlinePreviewMessage(
  value: UnknownRecord,
  isSessionId: (candidate: unknown) => candidate is string,
): PreviewInlineHtmlMessage | undefined {
  if (
    !hasExactKeys(
      value,
      ['type', 'sessionId', 'html'],
      ['artifactId', 'title'],
    ) ||
    value.type !== 'preview.inlineHtml' ||
    !isSessionId(value.sessionId) ||
    typeof value.html !== 'string' ||
    value.html.length === 0 ||
    value.html.length > MAX_INLINE_PREVIEW_HTML_LENGTH ||
    (value.artifactId !== undefined &&
      !isCanvasArtifactId(value.artifactId)) ||
    (value.title !== undefined && !isCanvasTitle(value.title)) ||
    ((value.artifactId === undefined) !== (value.title === undefined))
  ) {
    return undefined;
  }
  return {
    type: 'preview.inlineHtml',
    sessionId: value.sessionId,
    html: value.html,
    ...(value.artifactId === undefined
      ? {}
      : { artifactId: value.artifactId, title: value.title as string }),
  };
}

export function parseCanvasPanelMessage(
  value: unknown,
): CanvasPanelMessage | undefined {
  if (!isStrictRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }
  if (
    value.type === 'canvas.reload' ||
    value.type === 'canvas.openInEditor'
  ) {
    if (
      !hasExactKeys(value, ['type', 'generation', 'revision']) ||
      !isSequence(value.generation) ||
      !isSequence(value.revision)
    ) {
      return undefined;
    }
    return {
      type: value.type,
      generation: value.generation,
      revision: value.revision,
    };
  }
  if (
    value.type !== 'canvas.feedback' ||
    !hasExactKeys(
      value,
      ['type', 'generation', 'revision', 'feedback'],
      ['selection'],
    ) ||
    !isSequence(value.generation) ||
    !isSequence(value.revision) ||
    !isBoundedText(value.feedback, MAX_CANVAS_FEEDBACK_LENGTH)
  ) {
    return undefined;
  }
  const selection =
    value.selection === undefined
      ? undefined
      : parseCanvasSelection(value.selection);
  if (value.selection !== undefined && selection === undefined) {
    return undefined;
  }
  return {
    type: 'canvas.feedback',
    generation: value.generation,
    revision: value.revision,
    feedback: value.feedback,
    ...(selection === undefined ? {} : { selection }),
  };
}

function parseCanvasSelection(
  value: unknown,
): CanvasSelectionDescriptor | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['tag', 'path'], ['id', 'classes', 'text']) ||
    !isDescriptor(value.tag, 40) ||
    !isDescriptor(value.path, MAX_CANVAS_ELEMENT_DESCRIPTOR_LENGTH) ||
    (value.id !== undefined && !isDescriptor(value.id, 120)) ||
    (value.classes !== undefined && !isDescriptor(value.classes, 200)) ||
    (value.text !== undefined && !isDescriptor(value.text, 240))
  ) {
    return undefined;
  }
  return {
    tag: value.tag,
    path: value.path,
    ...(value.id === undefined ? {} : { id: value.id }),
    ...(value.classes === undefined ? {} : { classes: value.classes }),
    ...(value.text === undefined ? {} : { text: value.text }),
  };
}

function isDescriptor(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    SAFE_SINGLE_LINE.test(value)
  );
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum &&
    SAFE_DESCRIPTOR_TEXT.test(value)
  );
}

function isSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
