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

/** Shared grouping before either UI projects rows: images stay with prompts, one copy/action tail per reply. */
export function describeTranscript(transcript: readonly SessionTranscriptItem[], { includePlanSnapshots = false }: { readonly includePlanSnapshots?: boolean } = {}): {
  readonly descriptors: readonly TranscriptDescriptor[];
  readonly replyTails: ReadonlyMap<string, string>;
} {
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

  const replyTails = new Map<string, string>();
  let run: AssistantGroupDescriptor[] = [];
  const flushRun = (): void => {
    if (run.length === 0) return;
    // Restored replies can end with tool-only groups after their last text.
    const tail = run[run.length - 1]!;
    const text = run.flatMap((descriptor) => descriptor.items
      .filter((item): item is Extract<SessionTranscriptItem, { kind: 'assistant' }> => item.kind === 'assistant')
      .map((item) => item.text)).filter((text) => text.length > 0).join('\n\n');
    replyTails.set(tail.id, text);
    run = [];
  };
  for (const descriptor of descriptors) {
    if (descriptor.kind === 'assistant') run.push(descriptor);
    else flushRun();
  }
  flushRun();
  return { descriptors, replyTails };
}
