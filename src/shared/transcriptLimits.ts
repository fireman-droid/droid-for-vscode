import type { SessionTranscriptItem } from './bridgeMessages';

export const MAX_SESSION_TRANSCRIPT_ITEMS = 2_000;
export const MAX_SESSION_TRANSCRIPT_TEXT_UNITS = 1_000_000;

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
        (item.detail?.length ?? 0)
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
