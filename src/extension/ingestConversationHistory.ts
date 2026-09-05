import type { SessionTranscriptItem } from '../shared/bridgeMessages';
import { trimTranscriptToLimits } from '../shared/transcriptLimits';
import type { HostTranscriptState } from './hostTranscriptState';

interface TranscriptTurn {
  readonly user: Extract<SessionTranscriptItem, { kind: 'user' }>;
  readonly items: readonly SessionTranscriptItem[];
}

export function ingestConversationHistory(
  canonical: HostTranscriptState,
  loaded: HostTranscriptState,
  options: { readonly allowUnanchoredAppend?: boolean } = {},
): HostTranscriptState {
  if (canonical.transcript.length === 0) {
    return {
      ...loaded,
      transcript: loaded.transcript
        .filter((item) => item.kind !== 'changes')
        .map((item) => ({ ...item })),
    };
  }
  const canonicalTurns = splitTurns(canonical.transcript);
  const loadedTurns = splitTurns(loaded.transcript);
  if (
    canonicalTurns.length === 0 ||
    canonicalTurns.length > loadedTurns.length ||
    canonicalTurns.some(
      (turn, index) => turn.user.text !== loadedTurns[index]?.user.text,
    )
  ) {
    if (
      options.allowUnanchoredAppend === true &&
      loadedTurns.length > 0
    ) {
      const appended = loadedTurns
        .flatMap((turn) => [turn.user, ...turn.items])
        .filter((item) => item.kind !== 'changes')
        .map((item) => ({ ...item }));
      const bounded = trimTranscriptToLimits([
        ...canonical.transcript,
        ...appended,
      ]);
      return {
        transcript: bounded.transcript,
        historyStatus:
          bounded.trimmed || canonical.truncated || loaded.truncated
            ? 'partial'
            : loaded.historyStatus,
        truncated:
          canonical.truncated ||
          loaded.truncated ||
          bounded.trimmed,
      };
    }
    return markPartial(canonical);
  }
  const enriched = [...canonical.transcript];
  for (let index = 0; index < canonicalTurns.length; index += 1) {
    enrichTurn(
      enriched,
      canonicalTurns[index]!,
      loadedTurns[index]!,
    );
  }
  const appended = loadedTurns
    .slice(canonicalTurns.length)
    .flatMap((turn) => [turn.user, ...turn.items])
    .filter((item) => item.kind !== 'changes')
    .map((item) => ({ ...item }));
  const bounded = trimTranscriptToLimits([...enriched, ...appended]);
  return {
    transcript: bounded.transcript,
    historyStatus:
      bounded.trimmed || canonical.truncated
        ? 'partial'
        : loaded.historyStatus,
    truncated:
      canonical.truncated ||
      loaded.truncated ||
      bounded.trimmed,
  };
}

function splitTurns(
  transcript: readonly SessionTranscriptItem[],
): readonly TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  let current: {
    user: Extract<SessionTranscriptItem, { kind: 'user' }>;
    items: SessionTranscriptItem[];
  } | null = null;
  for (const item of transcript) {
    if (item.kind === 'user') {
      current = { user: item, items: [] };
      turns.push(current);
    } else if (current !== null) {
      current.items.push(item);
    }
  }
  return turns;
}

function enrichTurn(
  target: SessionTranscriptItem[],
  canonical: TranscriptTurn,
  loaded: TranscriptTurn,
): void {
  const loadedByKind = new Map<
    SessionTranscriptItem['kind'],
    SessionTranscriptItem[]
  >();
  for (const item of loaded.items) {
    if (item.kind === 'changes') {
      continue;
    }
    const items = loadedByKind.get(item.kind) ?? [];
    items.push(item);
    loadedByKind.set(item.kind, items);
  }
  const kindIndexes = new Map<SessionTranscriptItem['kind'], number>();
  const canonicalCounts = new Map<
    SessionTranscriptItem['kind'],
    number
  >();
  for (const item of canonical.items) {
    if (item.kind === 'changes') {
      continue;
    }
    const index = kindIndexes.get(item.kind) ?? 0;
    kindIndexes.set(item.kind, index + 1);
    canonicalCounts.set(item.kind, index + 1);
    const loadedItem = loadedByKind.get(item.kind)?.[index];
    if (loadedItem === undefined) {
      continue;
    }
    const targetIndex = target.findIndex(
      (candidate) => candidate.id === item.id,
    );
    if (targetIndex >= 0) {
      target[targetIndex] = enrichItem(item, loadedItem);
    }
  }
  const loadedIndexes = new Map<
    SessionTranscriptItem['kind'],
    number
  >();
  const missing = loaded.items.flatMap((item) => {
    if (item.kind === 'changes') {
      return [];
    }
    const index = loadedIndexes.get(item.kind) ?? 0;
    loadedIndexes.set(item.kind, index + 1);
    return index < (canonicalCounts.get(item.kind) ?? 0)
      ? []
      : [{ ...item }];
  });
  if (missing.length === 0) {
    return;
  }
  const userIndex = target.findIndex(
    (item) => item.id === canonical.user.id,
  );
  const nextUserOffset = target
    .slice(userIndex + 1)
    .findIndex((item) => item.kind === 'user');
  const insertAt =
    nextUserOffset < 0
      ? target.length
      : userIndex + 1 + nextUserOffset;
  target.splice(insertAt, 0, ...missing);
}

function enrichItem(
  canonical: SessionTranscriptItem,
  loaded: SessionTranscriptItem,
): SessionTranscriptItem {
  if (canonical.kind !== loaded.kind) {
    return canonical;
  }
  switch (canonical.kind) {
    case 'assistant': {
      const candidate = loaded as Extract<
        SessionTranscriptItem,
        { kind: 'assistant' }
      >;
      return candidate.text.length > canonical.text.length
        ? {
            ...canonical,
            text: candidate.text,
          }
        : canonical;
    }
    case 'thinking': {
      const candidate = loaded as Extract<
        SessionTranscriptItem,
        { kind: 'thinking' }
      >;
      return candidate.text.length > canonical.text.length
        ? {
            ...canonical,
            text: candidate.text,
            truncated: candidate.truncated,
            status: candidate.status,
          }
        : canonical;
    }
    case 'tool': {
      const candidate = loaded as Extract<
        SessionTranscriptItem,
        { kind: 'tool' }
      >;
      return {
        ...candidate,
        id: canonical.id,
        turnId: canonical.turnId,
        toolUseId: canonical.toolUseId,
      };
    }
    case 'ask-user-result': {
      if (
        loaded.kind !== 'ask-user-result' ||
        canonical.status !== 'answered' || loaded.status !== 'answered' ||
        canonical.answers.length !== loaded.answers.length ||
        !canonical.answers.every((answer, index) =>
          answer.topic === loaded.answers[index]?.topic &&
          answer.answer === loaded.answers[index]?.answer)
      ) {
        return canonical;
      }
      return {
        ...canonical,
        answers: canonical.answers.map((answer, index) => {
          const question = answer.question ?? loaded.answers[index]?.question;
          return question === undefined ? answer : { ...answer, question };
        }),
      };
    }
    case 'image': {
      const candidate = loaded as Extract<
        SessionTranscriptItem,
        { kind: 'image' }
      >;
      return canonical.data.length === 0 && candidate.data.length > 0
        ? { ...canonical, data: candidate.data }
        : canonical;
    }
    default:
      return canonical;
  }
}

function markPartial(
  state: HostTranscriptState,
): HostTranscriptState {
  return state.historyStatus === 'partial'
    ? state
    : { ...state, historyStatus: 'partial' };
}
