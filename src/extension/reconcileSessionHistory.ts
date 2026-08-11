import type { SessionTranscriptItem } from '../shared/bridgeMessages';
import {
  stableTranscriptId,
  type HostTranscriptState,
} from '../shared/hostTranscriptState';
import { trimTranscriptToLimits } from '../shared/transcriptLimits';

export function reconcileSessionHistory(
  loaded: HostTranscriptState,
  recovered: HostTranscriptState | undefined,
): HostTranscriptState {
  if (recovered === undefined || recovered.transcript.length === 0) {
    return loaded;
  }
  if (loaded.transcript.length === 0) {
    return markPartial(recovered);
  }

  const loadedKeys = loaded.transcript.map(transcriptItemKey);
  const recoveredKeys = recovered.transcript.map(transcriptItemKey);
  const recoveredToLoaded = suffixPrefixOverlap(
    recoveredKeys,
    loadedKeys,
  );
  const loadedToRecovered = suffixPrefixOverlap(
    loadedKeys,
    recoveredKeys,
  );

  if (
    recoveredToLoaded === recovered.transcript.length &&
    recoveredToLoaded <= loaded.transcript.length
  ) {
    return loaded;
  }
  if (
    loadedToRecovered === recovered.transcript.length &&
    loadedToRecovered <= loaded.transcript.length
  ) {
    return loaded;
  }
  if (
    recoveredToLoaded === loaded.transcript.length &&
    recoveredToLoaded <= recovered.transcript.length
  ) {
    return markPartial(recovered);
  }
  if (recoveredToLoaded > 0 && recoveredToLoaded >= loadedToRecovered) {
    return mergeStates(
      [
        ...recovered.transcript,
        ...loaded.transcript.slice(recoveredToLoaded),
      ],
      loaded,
      recovered,
      recovered.transcript.length - recoveredToLoaded > 0,
    );
  }
  if (loadedToRecovered > 0) {
    return mergeStates(
      [
        ...loaded.transcript,
        ...recovered.transcript.slice(loadedToRecovered),
      ],
      loaded,
      recovered,
      true,
    );
  }

  return mergeStates(
    [...loaded.transcript, ...recovered.transcript],
    loaded,
    recovered,
    true,
  );
}

function mergeStates(
  transcript: readonly SessionTranscriptItem[],
  loaded: HostTranscriptState,
  recovered: HostTranscriptState,
  recoveredContentPreserved: boolean,
): HostTranscriptState {
  const bounded = trimTranscriptToLimits(
    uniqueTranscriptIds(transcript),
  );
  const partial =
    recoveredContentPreserved ||
    loaded.historyStatus !== 'complete' ||
    recovered.historyStatus !== 'complete' ||
    loaded.truncated ||
    recovered.truncated ||
    bounded.trimmed;
  return {
    transcript: bounded.transcript,
    historyStatus: partial ? 'partial' : 'complete',
    truncated:
      bounded.trimmed || loaded.truncated || recovered.truncated,
  };
}

function uniqueTranscriptIds(
  transcript: readonly SessionTranscriptItem[],
): readonly SessionTranscriptItem[] {
  const ids = new Set<string>();
  const toolUseIds = new Set<string>();
  return transcript.map((item, index) => {
    let result = item;
    if (ids.has(result.id)) {
      result = { ...result, id: uniqueValue(ids, item, index, item.id) };
    }
    ids.add(result.id);
    // A recovered checkpoint and freshly loaded history of the same
    // session synthesize identical toolUseIds; if the overlap match
    // fails and both copies survive the merge, duplicate toolCallIds
    // crash the webview renderer. Uniquify them the same way as ids.
    if (result.kind === 'tool') {
      if (toolUseIds.has(result.toolUseId)) {
        result = {
          ...result,
          toolUseId: uniqueValue(
            toolUseIds,
            item,
            index,
            result.toolUseId,
          ),
        };
      }
      toolUseIds.add(result.toolUseId);
    }
    return result;
  });
}

function uniqueValue(
  taken: ReadonlySet<string>,
  item: SessionTranscriptItem,
  index: number,
  seed: string,
): string {
  let collision = 0;
  let value = stableTranscriptId(
    item.kind,
    seed,
    transcriptItemKey(item),
    String(index),
  );
  while (taken.has(value)) {
    collision += 1;
    value = stableTranscriptId(
      item.kind,
      seed,
      transcriptItemKey(item),
      String(index),
      String(collision),
    );
  }
  return value;
}

function markPartial(state: HostTranscriptState): HostTranscriptState {
  return state.historyStatus === 'partial'
    ? state
    : { ...state, historyStatus: 'partial' };
}

function suffixPrefixOverlap(
  left: readonly string[],
  right: readonly string[],
): number {
  const maximum = Math.min(left.length, right.length);
  for (let length = maximum; length > 0; length -= 1) {
    let matches = true;
    const leftStart = left.length - length;
    for (let offset = 0; offset < length; offset += 1) {
      if (left[leftStart + offset] !== right[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return length;
    }
  }
  return 0;
}

function transcriptItemKey(item: SessionTranscriptItem): string {
  switch (item.kind) {
    case 'user':
      return JSON.stringify([item.kind, item.text]);
    case 'assistant':
      return JSON.stringify([item.kind, item.text]);
    case 'thinking':
      return JSON.stringify([item.kind, item.text]);
    case 'tool':
      return JSON.stringify([item.kind, item.toolName, item.action]);
    case 'changes':
      return JSON.stringify([
        item.kind,
        item.files.map((file) => file.path),
      ]);
    case 'diagnostic':
      return JSON.stringify([
        item.kind,
        item.severity,
        item.code,
        item.message,
      ]);
  }
}
