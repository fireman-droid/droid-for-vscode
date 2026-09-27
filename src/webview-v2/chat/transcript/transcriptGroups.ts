import type { SessionTranscriptItem } from '../../../shared/protocol/transcript';

export interface UserMessageDescriptor {
  readonly kind: 'user';
  readonly item: Extract<SessionTranscriptItem, { kind: 'user' }>;
  readonly images: Extract<SessionTranscriptItem, { kind: 'image' }>[];
}

export interface AssistantGroupDescriptor {
  readonly kind: 'assistant';
  readonly id: string;
  readonly turnId: string;
  readonly items: SessionTranscriptItem[];
}

export type TranscriptDescriptor = UserMessageDescriptor | AssistantGroupDescriptor;

interface TranscriptDescription {
  readonly descriptors: readonly TranscriptDescriptor[];
  readonly replyTails: ReadonlyMap<string, string>;
  readonly replyTimestamps: ReadonlyMap<string, number | undefined>;
}
interface ReplyRun { readonly groups: readonly AssistantGroupDescriptor[]; readonly text: string; readonly timestamp: number | undefined }
interface TranscriptProjection extends TranscriptDescription { readonly runs: ReadonlyMap<string, ReplyRun> }
const groupText = new WeakMap<AssistantGroupDescriptor, string>();
const sameItems = <T>(before: readonly T[], after: readonly T[]) =>
  before.length === after.length && before.every((item, index) => item === after[index]);
function replyText(group: AssistantGroupDescriptor): string {
  const cached = groupText.get(group);
  if (cached !== undefined) return cached;
  const text = group.items.flatMap((item) => item.kind === 'assistant' && item.text.length > 0 ? [item.text] : []).join('\n\n');
  groupText.set(group, text);
  return text;
}
function replyTimestamp(groups: readonly AssistantGroupDescriptor[]): number | undefined {
  for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex--) {
    const items = groups[groupIndex]!.items;
    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex--) {
      const item = items[itemIndex]!;
      if (item.kind === 'assistant') return item.timestamp;
    }
  }
  return undefined;
}

/** Shared grouping before either UI projects rows: images stay with prompts, one copy/action tail per reply. */
function projectTranscript(transcript: readonly SessionTranscriptItem[], includePlanSnapshots: boolean, previous?: TranscriptProjection): TranscriptProjection {
  const descriptors: TranscriptDescriptor[] = [];
  const groups = new Map<string, AssistantGroupDescriptor>();
  const appendToGroup = (item: Exclude<SessionTranscriptItem, { kind: 'user' }>): void => {
    const key = item.turnId ?? `diagnostic:${item.id}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = { kind: 'assistant', id: `assistant-turn:${key}`, turnId: key, items: [] };
      groups.set(key, group);
      descriptors.push(group);
    }
    group.items.push(item);
  };
  let pendingUserImages: Extract<SessionTranscriptItem, { kind: 'image' }>[] = [];
  const flushPendingUserImages = (): void => {
    for (const image of pendingUserImages) appendToGroup(image);
    pendingUserImages = [];
  };
  for (const item of transcript) {
    // Workspace snapshots include manual edits; they belong to Review, not an AI reply.
    if (item.kind === 'changes') continue;
    if (item.kind === 'user') {
      descriptors.push({ kind: 'user', item, images: pendingUserImages });
      pendingUserImages = [];
      continue;
    }
    if (item.kind === 'image' && item.origin === 'user') {
      const last = descriptors[descriptors.length - 1];
      if (last?.kind === 'user') last.images.push(item);
      else pendingUserImages.push(item);
      continue;
    }
    flushPendingUserImages();
    // Todo snapshots have a single plan line under their creating prompt.
    if (!includePlanSnapshots && item.kind === 'tool' && item.detailKind === 'plan') continue;
    appendToGroup(item);
  }
  flushPendingUserImages();

  if (previous) {
    const byId = new Map(previous.descriptors.map((descriptor) => [descriptor.kind === 'user' ? descriptor.item.id : descriptor.id, descriptor]));
    for (let index = 0; index < descriptors.length; index++) {
      const descriptor = descriptors[index]!;
      const cached = byId.get(descriptor.kind === 'user' ? descriptor.item.id : descriptor.id);
      if (descriptor.kind === 'user' && cached?.kind === 'user' && descriptor.item === cached.item && sameItems(descriptor.images, cached.images) ||
        descriptor.kind === 'assistant' && cached?.kind === 'assistant' && descriptor.turnId === cached.turnId && sameItems(descriptor.items, cached.items)) {
        descriptors[index] = cached!;
      }
    }
  }

  const replyTails = new Map<string, string>();
  const replyTimestamps = new Map<string, number | undefined>();
  const runs = new Map<string, ReplyRun>();
  let run: AssistantGroupDescriptor[] = [];
  const flushRun = (): void => {
    if (run.length === 0) return;
    // Restored replies can end with tool-only groups after their last text.
    const tail = run[run.length - 1]!;
    const cached = previous?.runs.get(tail.id);
    const entry = cached && sameItems(cached.groups, run) ? cached
      : { groups: run, text: run.map(replyText).filter((text) => text.length > 0).join('\n\n'), timestamp: replyTimestamp(run) };
    runs.set(tail.id, entry);
    replyTails.set(tail.id, entry.text);
    replyTimestamps.set(tail.id, entry.timestamp);
    run = [];
  };
  for (const descriptor of descriptors) {
    if (descriptor.kind === 'assistant') run.push(descriptor);
    else flushRun();
  }
  flushRun();
  const previousTails = previous && [...previous.replyTails];
  const previousTimestamps = previous && [...previous.replyTimestamps];
  return {
    descriptors: previous && sameItems(previous.descriptors, descriptors) ? previous.descriptors : descriptors,
    replyTails: previous && previous.replyTails.size === replyTails.size &&
      [...replyTails].every(([id, text], index) => previousTails![index]?.[0] === id && previousTails![index]?.[1] === text) ? previous.replyTails : replyTails,
    replyTimestamps: previous && previous.replyTimestamps.size === replyTimestamps.size &&
      [...replyTimestamps].every(([id, timestamp], index) => previousTimestamps![index]?.[0] === id && previousTimestamps![index]?.[1] === timestamp) ? previous.replyTimestamps : replyTimestamps,
    runs,
  };
}

export function describeTranscript(transcript: readonly SessionTranscriptItem[], { includePlanSnapshots = false }: { readonly includePlanSnapshots?: boolean } = {}): TranscriptDescription {
  const { descriptors, replyTails, replyTimestamps } = projectTranscript(transcript, includePlanSnapshots);
  return { descriptors, replyTails, replyTimestamps };
}

/** Retains only the current projection; rewinds and history replacements drop removed groups. */
export function createTranscriptSelector({ includePlanSnapshots = false }: { readonly includePlanSnapshots?: boolean } = {}) {
  let input: readonly SessionTranscriptItem[] | undefined;
  let projection: TranscriptProjection | undefined;
  let result: TranscriptDescription | undefined;
  return (transcript: readonly SessionTranscriptItem[]): TranscriptDescription => {
    if (transcript !== input) {
      projection = projectTranscript(transcript, includePlanSnapshots, projection);
      result = { descriptors: projection.descriptors, replyTails: projection.replyTails, replyTimestamps: projection.replyTimestamps };
      input = transcript;
    }
    return result!;
  };
}
