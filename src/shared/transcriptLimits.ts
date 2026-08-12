import type { SessionTranscriptItem } from './bridgeMessages';

export const MAX_SESSION_TRANSCRIPT_ITEMS = 2_000;
export const MAX_SESSION_TRANSCRIPT_TEXT_UNITS = 1_000_000;
/**
 * Most images per session that keep their base64 payload. Older
 * images degrade to placeholder rows (metadata retained, bytes
 * dropped) so a screenshot-heavy session cannot exhaust memory.
 */
export const MAX_RENDERED_SESSION_IMAGES = 64;
/**
 * Total base64 characters of image data one session transcript may
 * hold. Sized for the rendered-image cap at the observed p95 image
 * (~201K base64 chars): 64 x 201K ≈ 13M, with headroom for larger
 * outliers before eviction starts.
 */
export const MAX_SESSION_IMAGE_DATA_UNITS = 16_000_000;

export function transcriptItemTextUnits(
  item: SessionTranscriptItem,
): number {
  switch (item.kind) {
    case 'user':
      return item.id.length + item.kind.length + item.text.length;
    case 'assistant':
      return (
        item.id.length +
        item.kind.length +
        item.turnId.length +
        item.text.length
      );
    case 'thinking':
      return (
        item.id.length +
        item.kind.length +
        item.turnId.length +
        item.text.length +
        item.status.length
      );
    case 'tool':
      return (
        item.id.length +
        item.kind.length +
        item.turnId.length +
        item.toolUseId.length +
        item.toolName.length +
        item.action.length +
        item.status.length +
        (item.latestUpdateKind?.length ?? 0) +
        (item.detail?.length ?? 0) +
        (item.outputTail?.length ?? 0) +
        (item.subagent === undefined
          ? 0
          : item.subagent.type.length +
            item.subagent.description.length +
            (item.subagent.status?.length ?? 0) +
            16)
      );
    case 'changes':
      return (
        item.id.length +
        item.kind.length +
        item.turnId.length +
        item.files.reduce(
          (total, file) => total + file.path.length + 16,
          0,
        )
      );
    case 'diagnostic':
      return (
        item.id.length +
        item.kind.length +
        (item.turnId?.length ?? 0) +
        item.severity.length +
        item.code.length +
        item.message.length
      );
    // Image payloads are governed by the separate image data budget
    // (`enforceTranscriptImageBudget`), not the text-unit budget, so
    // one screenshot does not evict pages of conversation text.
    case 'image':
      return (
        item.id.length +
        item.kind.length +
        item.turnId.length +
        item.origin.length +
        item.mediaType.length +
        16
      );
  }
}

export function transcriptTextUnits(
  transcript: readonly SessionTranscriptItem[],
): number {
  return transcript.reduce(
    (total, item) => total + transcriptItemTextUnits(item),
    0,
  );
}

export function trimTranscriptToLimits(
  transcript: readonly SessionTranscriptItem[],
): {
  readonly transcript: readonly SessionTranscriptItem[];
  readonly trimmed: boolean;
} {
  let firstRetained = Math.max(
    0,
    transcript.length - MAX_SESSION_TRANSCRIPT_ITEMS,
  );
  let textUnits = 0;
  for (
    let index = transcript.length - 1;
    index >= firstRetained;
    index -= 1
  ) {
    const item = transcript[index];
    if (item === undefined) {
      continue;
    }
    const itemUnits = transcriptItemTextUnits(item);
    if (textUnits + itemUnits > MAX_SESSION_TRANSCRIPT_TEXT_UNITS) {
      firstRetained = index + 1;
      break;
    }
    textUnits += itemUnits;
  }
  return {
    transcript:
      firstRetained === 0
        ? transcript
        : transcript.slice(firstRetained),
    trimmed: firstRetained > 0,
  };
}

/** Decoded binary size in bytes of a pure base64 payload. */
export function base64ByteLength(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

/** Total base64 characters of image data held by a transcript. */
export function transcriptImageDataUnits(
  transcript: readonly SessionTranscriptItem[],
): number {
  return transcript.reduce(
    (total, item) =>
      item.kind === 'image' ? total + item.data.length : total,
    0,
  );
}

/**
 * Keeps image bytes for the newest images only: at most
 * `MAX_RENDERED_SESSION_IMAGES` images and
 * `MAX_SESSION_IMAGE_DATA_UNITS` total base64 characters, counted
 * from the transcript tail. Older images keep their transcript item
 * but lose `data` (becoming placeholder rows).
 */
export function enforceTranscriptImageBudget(
  transcript: readonly SessionTranscriptItem[],
): {
  readonly transcript: readonly SessionTranscriptItem[];
  readonly evicted: boolean;
} {
  let retainedImages = 0;
  let retainedUnits = 0;
  let budgetExhausted = false;
  const evictedIndices = new Set<number>();
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (item?.kind !== 'image' || item.data.length === 0) {
      continue;
    }
    // Newest images win strictly: the first image that misses either
    // cap evicts itself and everything older, so retention never
    // skips a newer image in favor of an older smaller one.
    if (
      budgetExhausted ||
      retainedImages >= MAX_RENDERED_SESSION_IMAGES ||
      retainedUnits + item.data.length > MAX_SESSION_IMAGE_DATA_UNITS
    ) {
      budgetExhausted = true;
      evictedIndices.add(index);
      continue;
    }
    retainedImages += 1;
    retainedUnits += item.data.length;
  }
  if (evictedIndices.size === 0) {
    return { transcript, evicted: false };
  }
  return {
    transcript: transcript.map((item, index) =>
      evictedIndices.has(index) && item.kind === 'image'
        ? { ...item, data: '' }
        : item,
    ),
    evicted: true,
  };
}
