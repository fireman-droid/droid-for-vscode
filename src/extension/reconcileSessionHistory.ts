import type { SessionTranscriptItem } from '../shared/bridgeMessages';
import {
  stableTranscriptId,
  type HostTranscriptState,
} from '../shared/hostTranscriptState';
import { trimTranscriptToLimits } from '../shared/transcriptLimits';

/**
 * Merges a freshly loaded session history with a locally recovered
 * checkpoint of the same session without repeating shared content.
 *
 * Strategy: user messages are alignment anchors (SDK `messageId`
 * primary, unique trimmed text as fallback for items without one).
 * When both sides share at least one anchor, `loaded` is the
 * authoritative body; `recovered` may only contribute a prefix the SDK
 * no longer returns (rewind branches, compaction) and a suffix the CLI
 * never persisted (crash mid-turn). Everything recovered between the
 * matched anchors is discarded because text-exact item keys are
 * unstable there (thinking length drift, synthesized changes rows).
 * Without any shared anchor the legacy suffix/prefix overlap merge
 * applies unchanged.
 */
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
  return (
    reconcileByUserAnchors(loaded, recovered) ??
    reconcileByOverlap(loaded, recovered)
  );
}

interface AnchorMatch {
  /** Index of the matched user item in the recovered transcript. */
  readonly recoveredIndex: number;
  /** Index of the matched user item in the loaded transcript. */
  readonly loadedIndex: number;
}

function reconcileByUserAnchors(
  loaded: HostTranscriptState,
  recovered: HostTranscriptState,
): HostTranscriptState | null {
  const alignment = matchUserAnchors(
    recovered.transcript,
    loaded.transcript,
  );
  const { matches } = alignment;
  const firstMatch = matches[0];
  const lastMatch = matches[matches.length - 1];
  if (firstMatch === undefined || lastMatch === undefined) {
    return null;
  }

  // Sent-attachment chip metadata only exists on the recovered side
  // (loadSession cannot attribute non-image attachment blocks back to
  // chips), so matched anchors adopt it onto the authoritative items.
  loaded = withRecoveredAttachments(loaded, recovered.transcript, matches);

  // Duplicate filters are scoped to the adjacent loaded region: a
  // prepended head must not repeat what loaded starts with (resend
  // residue), and an appended tail must not repeat how loaded ends.
  // The same text appearing again far away inside loaded is genuine
  // conversation repetition, not merge duplication.
  const headRegionKeys = keySet(
    loaded.transcript.slice(0, firstMatch.loadedIndex + 1),
  );
  const head = recovered.transcript
    .slice(0, firstMatch.recoveredIndex)
    .filter((item) => !headRegionKeys.has(transcriptItemKey(item)));
  const tailRegionKeys = keySet(
    loaded.transcript.slice(lastMatch.loadedIndex),
  );
  const tail = trailingRecoveredItems(
    loaded.transcript,
    recovered.transcript,
    lastMatch,
    alignment.loadedKnowsAnchor,
  ).filter((item) => !tailRegionKeys.has(transcriptItemKey(item)));

  if (head.length === 0 && tail.length === 0) {
    return loaded;
  }
  return mergeStates(
    [...head, ...loaded.transcript, ...tail],
    loaded,
    recovered,
    true,
  );
}

/**
 * Copies `attachments` metadata from matched recovered user anchors
 * onto the corresponding loaded items that lack it, so chips survive a
 * restart even though loaded history cannot reconstruct them.
 */
function withRecoveredAttachments(
  loaded: HostTranscriptState,
  recovered: readonly SessionTranscriptItem[],
  matches: readonly AnchorMatch[],
): HostTranscriptState {
  let transcript: SessionTranscriptItem[] | null = null;
  for (const match of matches) {
    const recoveredItem = recovered[match.recoveredIndex];
    const loadedItem = loaded.transcript[match.loadedIndex];
    if (
      recoveredItem?.kind !== 'user' ||
      loadedItem?.kind !== 'user' ||
      recoveredItem.attachments === undefined ||
      recoveredItem.attachments.length === 0 ||
      loadedItem.attachments !== undefined
    ) {
      continue;
    }
    transcript ??= [...loaded.transcript];
    transcript[match.loadedIndex] = {
      ...loadedItem,
      attachments: recoveredItem.attachments,
    };
  }
  return transcript === null ? loaded : { ...loaded, transcript };
}

/**
 * Recovered items past the last common anchor that loaded is missing:
 * the rest of the final shared turn when loaded persisted nothing
 * after its anchor, plus whole turns the CLI never persisted. Trailing
 * turns whose user anchor loaded already contains are stale duplicate
 * copies — checkpoints written while the old concatenating merge was
 * active carry the conversation twice — and are skipped. When loaded
 * itself has newer turns past the anchor, the whole recovered turn
 * tail is stale and is dropped.
 */
function trailingRecoveredItems(
  loaded: readonly SessionTranscriptItem[],
  recovered: readonly SessionTranscriptItem[],
  lastMatch: AnchorMatch,
  loadedKnowsAnchor: (item: SessionTranscriptItem) => boolean,
): readonly SessionTranscriptItem[] {
  const firstTrailingUser = nextUserIndex(
    recovered,
    lastMatch.recoveredIndex,
  );
  const sameTurnRemainder =
    lastMatch.loadedIndex === loaded.length - 1
      ? recovered.slice(
          lastMatch.recoveredIndex + 1,
          firstTrailingUser === -1 ? recovered.length : firstTrailingUser,
        )
      : [];
  if (firstTrailingUser === -1) {
    return sameTurnRemainder;
  }
  const loadedHasNewerTurn = loaded.some(
    (item, index) =>
      index > lastMatch.loadedIndex && item.kind === 'user',
  );
  if (loadedHasNewerTurn) {
    return sameTurnRemainder;
  }
  let start = firstTrailingUser;
  while (start !== -1 && loadedKnowsAnchor(recovered[start]!)) {
    start = nextUserIndex(recovered, start);
  }
  return start === -1
    ? sameTurnRemainder
    : [...sameTurnRemainder, ...recovered.slice(start)];
}

function nextUserIndex(
  transcript: readonly SessionTranscriptItem[],
  after: number,
): number {
  for (let index = after + 1; index < transcript.length; index += 1) {
    if (transcript[index]!.kind === 'user') {
      return index;
    }
  }
  return -1;
}

function keySet(
  items: readonly SessionTranscriptItem[],
): ReadonlySet<string> {
  return new Set(items.map(transcriptItemKey));
}

interface UserAnchor {
  /** Index of the user item in its transcript. */
  readonly itemIndex: number;
  readonly messageId: string | undefined;
  readonly text: string;
}

interface AnchorAlignment {
  readonly matches: readonly AnchorMatch[];
  /**
   * True when loaded already contains this user item's anchor
   * (`messageId`, or loaded-unique trimmed text for items without
   * one). Trailing recovered turns with a known anchor are stale
   * duplicates, not turns the CLI failed to persist.
   */
  readonly loadedKnowsAnchor: (item: SessionTranscriptItem) => boolean;
}

function matchUserAnchors(
  recovered: readonly SessionTranscriptItem[],
  loaded: readonly SessionTranscriptItem[],
): AnchorAlignment {
  const recoveredAnchors = userAnchors(recovered);
  const loadedAnchors = userAnchors(loaded);
  const loadedByMessageId = new Map<string, number>();
  for (let index = loadedAnchors.length - 1; index >= 0; index -= 1) {
    const anchor = loadedAnchors[index];
    if (anchor !== undefined && anchor.messageId !== undefined) {
      loadedByMessageId.set(anchor.messageId, index);
    }
  }
  const uniqueRecoveredTexts = uniqueTexts(recoveredAnchors);
  const uniqueLoadedTexts = uniqueTexts(loadedAnchors);
  const loadedByUniqueText = new Map<string, number>();
  for (const [index, anchor] of loadedAnchors.entries()) {
    if (uniqueLoadedTexts.has(anchor.text)) {
      loadedByUniqueText.set(anchor.text, index);
    }
  }

  const matches: AnchorMatch[] = [];
  let lastLoadedAnchor = -1;
  for (const anchor of recoveredAnchors) {
    const candidate =
      anchor.messageId !== undefined
        ? loadedByMessageId.get(anchor.messageId)
        : uniqueRecoveredTexts.has(anchor.text)
          ? loadedByUniqueText.get(anchor.text)
          : undefined;
    if (candidate === undefined || candidate <= lastLoadedAnchor) {
      continue;
    }
    const loadedAnchor = loadedAnchors[candidate];
    if (loadedAnchor === undefined) {
      continue;
    }
    matches.push({
      recoveredIndex: anchor.itemIndex,
      loadedIndex: loadedAnchor.itemIndex,
    });
    lastLoadedAnchor = candidate;
  }
  return {
    matches,
    loadedKnowsAnchor: (item) =>
      item.kind === 'user' &&
      (item.messageId !== undefined
        ? loadedByMessageId.has(item.messageId)
        : loadedByUniqueText.has(item.text.trim())),
  };
}

function userAnchors(
  transcript: readonly SessionTranscriptItem[],
): readonly UserAnchor[] {
  const anchors: UserAnchor[] = [];
  for (const [itemIndex, item] of transcript.entries()) {
    if (item.kind === 'user') {
      anchors.push({
        itemIndex,
        messageId: item.messageId,
        text: item.text.trim(),
      });
    }
  }
  return anchors;
}

function uniqueTexts(
  anchors: readonly UserAnchor[],
): ReadonlySet<string> {
  const seen = new Map<string, number>();
  for (const anchor of anchors) {
    seen.set(anchor.text, (seen.get(anchor.text) ?? 0) + 1);
  }
  return new Set(
    [...seen.entries()]
      .filter(([, count]) => count === 1)
      .map(([text]) => text),
  );
}

/** Legacy whole-run overlap merge for histories without shared anchors. */
function reconcileByOverlap(
  loaded: HostTranscriptState,
  recovered: HostTranscriptState,
): HostTranscriptState {
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
    // `data` is deliberately excluded: a recovered checkpoint holds a
    // placeholder (empty data) for the same image the loaded history
    // carries in full, and the two must merge as one item.
    case 'image':
      return JSON.stringify([
        item.kind,
        item.origin,
        item.mediaType,
        item.byteLength,
        item.generated,
      ]);
  }
}
