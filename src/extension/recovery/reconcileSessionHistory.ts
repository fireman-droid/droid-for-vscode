import { type SessionTranscriptItem } from '../../shared/protocol/transcript';
import {
  stableTranscriptId,
  type HostTranscriptState,
} from '../../shared/transcript/hostTranscriptState';
import { trimTranscriptToLimits } from '../../shared/transcript/transcriptLimits';
import { transcriptItemKey } from './transcriptReconcileKey';
import { preserveToolResultPreviews } from '../../shared/transcript/toolResultPreview';
import { preserveSubagentSummaries } from '../../shared/transcript/preserveSubagentSummaries';

/**
 * Merges a freshly loaded session history with a locally recovered
 * checkpoint. User messages align both sides; loaded history owns the
 * shared body, while recovery may supply bounded missing edges.
 */
export function reconcileSessionHistory(
  loaded: HostTranscriptState,
  recovered: HostTranscriptState | undefined,
  options: ReconcileSessionHistoryOptions = {},
): HostTranscriptState {
  if (recovered === undefined || recovered.transcript.length === 0) {
    return loaded;
  }
  if (loaded.transcript.length === 0) {
    if (options.authoritativeLoaded === true && loaded.historyStatus === 'complete') {
      return loaded;
    }
    return markPartial(recovered);
  }
  const transcript = preserveSubagentSummaries(
    preserveToolResultPreviews(loaded.transcript, recovered.transcript), recovered.transcript,
  );
  if (transcript !== loaded.transcript) loaded = { ...loaded, transcript };
  return (
    reconcileByUserAnchors(loaded, recovered, options) ??
    reconcileByOverlap(loaded, recovered, options)
  );
}

export interface ReconcileSessionHistoryOptions {
  /** Startup daemon history owns its complete or bounded current tail. */
  readonly authoritativeLoaded?: boolean;
  /** A background read must keep unknown turns from the live Host tail. */
  readonly preserveLocalTail?: boolean;
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
  options: ReconcileSessionHistoryOptions,
): HostTranscriptState | null {
  const alignment = matchUserAnchors(recovered.transcript, loaded.transcript);
  const { matches } = alignment;
  const firstMatch = matches[0];
  const lastMatch = matches[matches.length - 1];
  if (firstMatch === undefined || lastMatch === undefined) {
    return null;
  }
  const loadedTailIsAuthoritative =
    options.authoritativeLoaded === true &&
    (loaded.historyStatus === 'complete' || loaded.truncated);

  // Sent-attachment chip metadata only exists on the recovered side
  // (loadSession cannot attribute non-image attachment blocks back to
  // chips), so matched anchors adopt it onto the authoritative items.
  loaded = withRecoveredUserMetadata(loaded, recovered.transcript, matches);
  // Live-only rich state (outputTail, tool durations, measured
  // changes line counts) merges back onto the authoritative loaded
  // rows instead of being discarded with the recovered mid-region
  // (bug #36). Field-only: indices stay valid for the head/tail math.
  const enrichment = enrichLoadedFromRecovered(loaded, recovered.transcript, matches);
  loaded = enrichment.state;

  // Duplicate filters are scoped to the adjacent loaded region: a
  // prepended head must not repeat what loaded starts with (resend
  // residue), and an appended tail must not repeat how loaded ends.
  // The same text appearing again far away inside loaded is genuine
  // conversation repetition, not merge duplication.
  const loadedHasNewerTurn = loaded.transcript.some(
    (item, index) => index > lastMatch.loadedIndex && item.kind === 'user',
  );
  const headRegionKeys = keySet(loaded.transcript.slice(0, firstMatch.loadedIndex + 1));
  // Once authoritative daemon history has advanced beyond the last
  // shared user anchor, an unmatched recovery prefix belongs to an
  // older rewind/selection lineage. Prepending it creates phantom
  // dialogue after Reload. Prefix recovery remains valid only when
  // loaded is a compacted suffix with no newer turn of its own.
  const head =
    loadedTailIsAuthoritative || loadedHasNewerTurn
      ? []
      : recovered.transcript
          .slice(0, firstMatch.recoveredIndex)
          .filter((item) => !headRegionKeys.has(transcriptItemKey(item)));
  const tailRegionKeys = keySet(loaded.transcript.slice(lastMatch.loadedIndex));
  const tail = trailingRecoveredItems(
    loaded.transcript,
    recovered.transcript,
    lastMatch,
    alignment.loadedKnowsAnchor,
    options.preserveLocalTail === true,
    !loadedTailIsAuthoritative || options.preserveLocalTail === true,
  ).filter((item) => !tailRegionKeys.has(transcriptItemKey(item)));

  if (head.length === 0 && tail.length === 0 && enrichment.insertions.size === 0) {
    return enrichment.changed ? boundEnriched(loaded) : loaded;
  }
  const body: SessionTranscriptItem[] = [];
  loaded.transcript.forEach((item, index) => {
    body.push(item);
    const inserted = enrichment.insertions.get(index);
    if (inserted !== undefined) {
      body.push(...inserted);
    }
  });
  return mergeStates(
    [...head, ...body, ...tail],
    loaded,
    recovered,
    head.length > 0 || tail.length > 0,
  );
}

/**
 * Re-applies the shared transcript bounds after field enrichment
 * added text (outputTail) to an otherwise unchanged loaded body.
 */
function boundEnriched(loaded: HostTranscriptState): HostTranscriptState {
  const bounded = trimTranscriptToLimits(loaded.transcript);
  if (bounded.transcript === loaded.transcript) {
    return loaded;
  }
  return {
    transcript: bounded.transcript,
    historyStatus: bounded.trimmed ? 'partial' : loaded.historyStatus,
    truncated: loaded.truncated || bounded.trimmed,
  };
}

interface RecoveredEnrichment {
  readonly state: HostTranscriptState;
  /** True when at least one loaded item gained a recovered field. */
  readonly changed: boolean;
  /**
   * Recovered-only canonical settlement and diagnostic rows to insert
   * after the given loaded index (end of the matched turn segment).
   */
  readonly insertions: ReadonlyMap<number, readonly SessionTranscriptItem[]>;
}

/**
 * Merges the live-only rich state of a recovered checkpoint back onto
 * the authoritative loaded rows, per matched turn segment (anchor →
 * next user item on both sides):
 *
 * - tool rows regain `outputTail` and `durationMs` (history
 *   projection never produces either). Pairing is exact-first
 *   (toolName + detail + filePath + target, FIFO), then FIFO by
 *   toolName for the leftovers — misaligned repeats of the same tool
 *   inside one turn are the accepted worst case.
 * - changes rows regain measured per-file additions/deletions
 *   (history synthesizes them as null).
 * - thinking rows regain `durationMs` when history lacks it.
 * - diagnostic rows (never persisted by the CLI) are re-inserted at
 *   the end of their turn segment, re-homed to the loaded turnId.
 */
function enrichLoadedFromRecovered(
  loaded: HostTranscriptState,
  recovered: readonly SessionTranscriptItem[],
  matches: readonly AnchorMatch[],
): RecoveredEnrichment {
  let transcript: SessionTranscriptItem[] | null = null;
  let changed = false;
  const insertions = new Map<number, SessionTranscriptItem[]>();

  const replace = (index: number, item: SessionTranscriptItem): void => {
    transcript ??= [...loaded.transcript];
    transcript[index] = item;
    changed = true;
  };

  for (const match of matches) {
    const loadedEnd = segmentEnd(loaded.transcript, match.loadedIndex);
    const recoveredEnd = segmentEnd(recovered, match.recoveredIndex);
    const loadedSegment: number[] = [];
    for (let index = match.loadedIndex + 1; index < loadedEnd; index += 1) {
      loadedSegment.push(index);
    }
    const recoveredSegment = recovered.slice(match.recoveredIndex + 1, recoveredEnd);
    enrichSegmentTools(loaded.transcript, loadedSegment, recoveredSegment, replace);
    const missingChanges = enrichSegmentChanges(
      loaded.transcript,
      loadedSegment,
      recoveredSegment,
      replace,
    );
    enrichSegmentThinking(loaded.transcript, loadedSegment, recoveredSegment, replace);
    enrichSegmentMessageTimes(loaded.transcript, loadedSegment, recoveredSegment, replace);
    const diagnostics = segmentDiagnostics(
      loaded.transcript,
      loadedSegment,
      recoveredSegment,
    );
    const additions = [...missingChanges, ...diagnostics];
    if (additions.length > 0) {
      insertions.set(loadedEnd - 1, additions);
    }
  }

  return {
    state: transcript === null ? loaded : { ...loaded, transcript },
    changed,
    insertions,
  };
}

function segmentEnd(
  transcript: readonly SessionTranscriptItem[],
  anchorIndex: number,
): number {
  const next = nextUserIndex(transcript, anchorIndex);
  return next === -1 ? transcript.length : next;
}

type ToolItem = Extract<SessionTranscriptItem, { kind: 'tool' }>;

function toolPairingKey(item: ToolItem): string {
  return JSON.stringify([
    item.toolName,
    item.detail ?? null,
    item.filePath ?? null,
    item.target ?? null,
  ]);
}

function enrichSegmentTools(
  loaded: readonly SessionTranscriptItem[],
  loadedSegment: readonly number[],
  recoveredSegment: readonly SessionTranscriptItem[],
  replace: (index: number, item: SessionTranscriptItem) => void,
): void {
  const recoveredTools = recoveredSegment.filter(
    (item): item is ToolItem => item.kind === 'tool',
  );
  if (recoveredTools.length === 0) {
    return;
  }
  const exactQueues = new Map<string, ToolItem[]>();
  for (const tool of recoveredTools) {
    const key = toolPairingKey(tool);
    const queue = exactQueues.get(key);
    if (queue === undefined) {
      exactQueues.set(key, [tool]);
    } else {
      queue.push(tool);
    }
  }
  const consumed = new Set<ToolItem>();
  const paired = new Map<number, ToolItem>();
  for (const index of loadedSegment) {
    const item = loaded[index];
    if (item?.kind !== 'tool') {
      continue;
    }
    const candidate = exactQueues.get(toolPairingKey(item))?.shift();
    if (candidate !== undefined) {
      consumed.add(candidate);
      paired.set(index, candidate);
    }
  }
  const nameQueues = new Map<string, ToolItem[]>();
  for (const tool of recoveredTools) {
    if (consumed.has(tool)) {
      continue;
    }
    const queue = nameQueues.get(tool.toolName);
    if (queue === undefined) {
      nameQueues.set(tool.toolName, [tool]);
    } else {
      queue.push(tool);
    }
  }
  for (const index of loadedSegment) {
    const item = loaded[index];
    if (item?.kind !== 'tool') {
      continue;
    }
    const candidate = paired.get(index) ?? nameQueues.get(item.toolName)?.shift();
    if (candidate === undefined) {
      continue;
    }
    const outputTail =
      item.outputTail === undefined && candidate.outputTail !== undefined
        ? { outputTail: candidate.outputTail }
        : {};
    const durationMs =
      item.durationMs === undefined && candidate.durationMs !== undefined
        ? { durationMs: candidate.durationMs }
        : {};
    if (Object.keys(outputTail).length === 0 && Object.keys(durationMs).length === 0) {
      continue;
    }
    replace(index, { ...item, ...outputTail, ...durationMs });
  }
}

function enrichSegmentChanges(
  loaded: readonly SessionTranscriptItem[],
  loadedSegment: readonly number[],
  recoveredSegment: readonly SessionTranscriptItem[],
  replace: (index: number, item: SessionTranscriptItem) => void,
): readonly Extract<SessionTranscriptItem, { kind: 'changes' }>[] {
  const recoveredChanges = recoveredSegment.filter(
    (item): item is Extract<SessionTranscriptItem, { kind: 'changes' }> =>
      item.kind === 'changes',
  );
  if (recoveredChanges.length === 0) {
    return [];
  }
  let cursor = 0;
  for (const index of loadedSegment) {
    const item = loaded[index];
    if (item?.kind !== 'changes') {
      continue;
    }
    const candidate = recoveredChanges[cursor];
    if (candidate === undefined) {
      return recoveredChanges.slice(cursor);
    }
    cursor += 1;
    if (!sameChangedFiles(item.files, candidate.files)) {
      replace(index, { ...item, files: candidate.files });
    }
  }
  return recoveredChanges.slice(cursor);
}

function sameChangedFiles(
  left: Extract<SessionTranscriptItem, { kind: 'changes' }>['files'],
  right: Extract<SessionTranscriptItem, { kind: 'changes' }>['files'],
): boolean {
  return (
    left.length === right.length &&
    left.every((file, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        file.path === other.path &&
        file.additions === other.additions &&
        file.deletions === other.deletions
      );
    })
  );
}

function enrichSegmentThinking(
  loaded: readonly SessionTranscriptItem[],
  loadedSegment: readonly number[],
  recoveredSegment: readonly SessionTranscriptItem[],
  replace: (index: number, item: SessionTranscriptItem) => void,
): void {
  const recoveredThinking = recoveredSegment.filter(
    (item): item is Extract<SessionTranscriptItem, { kind: 'thinking' }> =>
      item.kind === 'thinking',
  );
  if (recoveredThinking.length === 0) {
    return;
  }
  let cursor = 0;
  for (const index of loadedSegment) {
    const item = loaded[index];
    if (item?.kind !== 'thinking') {
      continue;
    }
    const candidate = recoveredThinking[cursor];
    if (candidate === undefined) {
      return;
    }
    cursor += 1;
    if (item.durationMs === undefined && candidate.durationMs !== undefined) {
      replace(index, { ...item, durationMs: candidate.durationMs });
    }
  }
}

/**
 * Recovered diagnostic rows of one turn segment, deduped and re-homed
 * to the loaded segment's turnId so grouping stays coherent.
 */
function segmentDiagnostics(
  loaded: readonly SessionTranscriptItem[],
  loadedSegment: readonly number[],
  recoveredSegment: readonly SessionTranscriptItem[],
): SessionTranscriptItem[] {
  const diagnostics = recoveredSegment.filter(
    (item): item is Extract<SessionTranscriptItem, { kind: 'diagnostic' }> =>
      item.kind === 'diagnostic',
  );
  if (diagnostics.length === 0) {
    return [];
  }
  let segmentTurnId: string | null = null;
  const existingKeys = new Set<string>();
  for (const index of loadedSegment) {
    const item = loaded[index];
    if (item === undefined) {
      continue;
    }
    existingKeys.add(transcriptItemKey(item));
    if (segmentTurnId === null && item.kind !== 'user' && item.turnId !== null) {
      segmentTurnId = item.turnId;
    }
  }
  const inserted: SessionTranscriptItem[] = [];
  for (const diagnostic of diagnostics) {
    const key = transcriptItemKey(diagnostic);
    if (existingKeys.has(key)) {
      continue;
    }
    existingKeys.add(key);
    inserted.push({ ...diagnostic, turnId: segmentTurnId });
  }
  return inserted;
}

/**
 * Copies attachments and observed times from matched recovered user anchors
 * when authoritative history lacks them, without replacing recorded metadata.
 */
function withRecoveredUserMetadata(
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
      loadedItem?.kind !== 'user'
    ) {
      continue;
    }
    const attachments = loadedItem.attachments === undefined && recoveredItem.attachments?.length
      ? { attachments: recoveredItem.attachments } : {};
    const timestamp = loadedItem.timestamp === undefined && recoveredItem.timestamp !== undefined
      ? { timestamp: recoveredItem.timestamp } : {};
    if (Object.keys(attachments).length === 0 && Object.keys(timestamp).length === 0) continue;
    transcript ??= [...loaded.transcript];
    transcript[match.loadedIndex] = {
      ...loadedItem,
      ...attachments,
      ...timestamp,
    };
  }
  return transcript === null ? loaded : { ...loaded, transcript };
}

/** Only exact replies inside a matched user turn may recover their observed time. */
function enrichSegmentMessageTimes(
  loaded: readonly SessionTranscriptItem[],
  loadedSegment: readonly number[],
  recoveredSegment: readonly SessionTranscriptItem[],
  replace: (index: number, item: SessionTranscriptItem) => void,
): void {
  type Reply = Extract<SessionTranscriptItem, { kind: 'assistant' }>;
  const replies = new Map<string, Reply[]>();
  for (const item of recoveredSegment) {
    if (item.kind !== 'assistant') continue;
    const queue = replies.get(item.text) ?? [];
    queue.push(item);
    replies.set(item.text, queue);
  }
  for (const index of loadedSegment) {
    const item = loaded[index];
    if (item?.kind !== 'assistant') continue;
    const candidate = replies.get(item.text)?.shift();
    if (item.timestamp === undefined && candidate?.timestamp !== undefined) {
      replace(index, { ...item, timestamp: candidate.timestamp });
    }
  }
}

/** Returns the proven missing suffix after the final shared user anchor. */
function trailingRecoveredItems(
  loaded: readonly SessionTranscriptItem[],
  recovered: readonly SessionTranscriptItem[],
  lastMatch: AnchorMatch,
  loadedKnowsAnchor: (item: SessionTranscriptItem) => boolean,
  preserveLocalTail: boolean,
  preserveWholeLocalTail: boolean,
): readonly SessionTranscriptItem[] {
  const firstTrailingUser = nextUserIndex(recovered, lastMatch.recoveredIndex);
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
  if (!preserveWholeLocalTail) {
    return sameTurnRemainder;
  }
  const loadedHasNewerTurn = loaded.some(
    (item, index) => index > lastMatch.loadedIndex && item.kind === 'user',
  );
  if (loadedHasNewerTurn && !preserveLocalTail) {
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

function keySet(items: readonly SessionTranscriptItem[]): ReadonlySet<string> {
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

function uniqueTexts(anchors: readonly UserAnchor[]): ReadonlySet<string> {
  const seen = new Map<string, number>();
  for (const anchor of anchors) {
    seen.set(anchor.text, (seen.get(anchor.text) ?? 0) + 1);
  }
  return new Set(
    [...seen.entries()].filter(([, count]) => count === 1).map(([text]) => text),
  );
}

/** Legacy whole-run overlap merge for histories without shared anchors. */
function reconcileByOverlap(
  loaded: HostTranscriptState,
  recovered: HostTranscriptState,
  options: ReconcileSessionHistoryOptions,
): HostTranscriptState {
  if (
    options.authoritativeLoaded === true &&
    (loaded.historyStatus === 'complete' || loaded.truncated)
  ) {
    return loaded;
  }
  const loadedKeys = loaded.transcript.map(transcriptItemKey);
  const recoveredKeys = recovered.transcript.map(transcriptItemKey);
  const recoveredToLoaded = suffixPrefixOverlap(recoveredKeys, loadedKeys);
  const loadedToRecovered = suffixPrefixOverlap(loadedKeys, recoveredKeys);

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
      [...recovered.transcript, ...loaded.transcript.slice(recoveredToLoaded)],
      loaded,
      recovered,
      recovered.transcript.length - recoveredToLoaded > 0,
    );
  }
  if (loadedToRecovered > 0) {
    return mergeStates(
      [...loaded.transcript, ...recovered.transcript.slice(loadedToRecovered)],
      loaded,
      recovered,
      true,
    );
  }

  // With no anchor and no overlap, chronology cannot be proven. A complete
  // public history is still the authoritative current body, while recovery
  // may contain an older rewind branch or a checkpoint left behind by a
  // previously selected session turn. Keep that disconnected local material
  // as a prefix, never as the tail: appending it after newer daemon history
  // makes stale user rows look current and hides latest-turn surfaces such as
  // ReviewDock.
  return mergeStates(
    [...recovered.transcript, ...loaded.transcript],
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
  const bounded = trimTranscriptToLimits(uniqueTranscriptIds(transcript));
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
    truncated: bounded.trimmed || loaded.truncated || recovered.truncated,
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
          toolUseId: uniqueValue(toolUseIds, item, index, result.toolUseId),
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
  let value = stableTranscriptId(item.kind, seed, transcriptItemKey(item), String(index));
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

function suffixPrefixOverlap(left: readonly string[], right: readonly string[]): number {
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
