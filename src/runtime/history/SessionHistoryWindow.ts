import { randomUUID } from 'node:crypto';
import type { HistoryDirection, HistoryWindowState } from '../../shared/protocol/historyPaging';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import { trimTranscriptToLimits } from '../../shared/transcript/transcriptLimits';
import { isStrictRecord } from '../../shared/validation/strictValidation';
import { projectSessionMessagesAsync } from './asyncHistoryProjection';
import type { SessionHistoryLoader, SessionHistoryResult } from './SessionHistory';

type AvailableHistory = Extract<SessionHistoryResult, { status: 'available' }>;
interface PageLocation {
  readonly sessionId: string;
  readonly cursor?: string;
  readonly limit: number;
  readonly nextCursor: string | null;
  readonly identity: string;
}
const WINDOW_PAGES = 3;
const CACHE_BYTES = 32 * 1024 * 1024;
const CACHE_PAGES = 6;

/** Only page locations survive eviction. Revisiting a page asks the daemon again. */
export class SessionHistoryWindow {
  readonly version = randomUUID();
  readonly locations: PageLocation[] = [];
  private readonly cache = new Map<number, { result: AvailableHistory; bytes: number }>();
  private readonly resultPages = new Map<string, number>();
  private first = 0;
  private last = 0;
  private revision = 0;
  private state: HistoryWindowState | null = null;

  constructor(
    private readonly loader: SessionHistoryLoader,
    readonly cwd: string,
    /** Current physical session first, then its compact/handoff predecessors. */
    readonly sessionIds: readonly string[],
    private readonly tailAnchor?: string,
  ) {}

  async open(initial?: AvailableHistory): Promise<AvailableHistory> {
    const result = await this.read(0, initial);
    await this.project('latest');
    return result;
  }

  snapshot(): HistoryWindowState | null { return this.state; }

  async navigate(direction: HistoryDirection): Promise<HistoryWindowState> {
    if (!this.state) throw new Error('History window is not open');
    const previous = { first: this.first, last: this.last };
    try {
      if (direction === 'latest') this.first = this.last = 0;
      else if (direction === 'older' && this.state.hasOlder) {
        await this.read(this.last + 1);
        this.last++;
        this.first = Math.max(this.first, this.last - WINDOW_PAGES + 1);
      } else if (direction === 'newer' && this.first > 0) {
        this.first--;
        this.last = Math.min(this.last, this.first + WINDOW_PAGES - 1);
      } else return this.state = { ...this.state, revision: ++this.revision };
      await this.project(direction);
      return this.state!;
    } catch (error) {
      this.first = previous.first;
      this.last = previous.last;
      throw error;
    }
  }

  private nextLocation(index: number): Pick<PageLocation, 'sessionId' | 'cursor' | 'limit'> {
    const known = this.locations[index];
    if (known) return known;
    if (index === 0) return { sessionId: this.sessionIds[0]!, limit: 100,
      ...(this.tailAnchor ? { cursor: this.tailAnchor } : {}) };
    const previous = this.locations[index - 1];
    if (!previous) throw new Error('Unknown history page');
    if (previous.nextCursor !== null) {
      if (this.locations.some(location => location.sessionId === previous.sessionId && location.cursor === previous.nextCursor)) {
        throw new Error('History cursor repeated');
      }
      return { sessionId: previous.sessionId, cursor: previous.nextCursor, limit: 100 };
    }
    const sessionId = this.sessionIds[this.sessionIds.indexOf(previous.sessionId) + 1];
    if (!sessionId) throw new Error('No older history');
    return { sessionId, limit: 100 };
  }

  private async read(index: number, initial?: AvailableHistory): Promise<AvailableHistory> {
    const cached = this.cache.get(index);
    if (cached) return cached.result;
    const location = this.nextLocation(index);
    let limit = location.limit;
    let result: AvailableHistory;
    for (;;) {
      const loaded = initial ?? await this.loader.loadHistory({ cwd: this.cwd, ...location, limit });
      initial = undefined;
      if (loaded.status !== 'available') throw new Error('History page could not be loaded');
      result = loaded;
      // A page, unlike a session, must fit the transport budget. Request a
      // smaller official page rather than dropping its oldest messages.
      const oversized = loaded.state.truncated || JSON.stringify(loaded.page?.messages ?? []).length * 2 > CACHE_BYTES / WINDOW_PAGES;
      if (this.locations[index] || !loaded.page || !oversized || loaded.page.messages.length <= 1) break;
      limit = Math.max(1, Math.floor(limit / 2));
    }
    const identity = JSON.stringify(result.page?.messages.map(message =>
      (message as { id?: unknown }).id) ?? result.state.transcript.map(item => item.id));
    const known = this.locations[index];
    if (known && (known.identity !== identity || known.nextCursor !== (result.page?.nextCursor ?? null))) {
      throw new Error('Saved history changed. Return to the latest messages to refresh.');
    }
    this.locations[index] = {
      ...location, limit, identity, nextCursor: result.page?.nextCursor ?? null,
    };
    this.cache.set(index, { result, bytes: JSON.stringify(result.page?.messages ?? result.state.transcript).length * 2 });
    for (const message of result.page?.messages ?? []) {
      for (const block of blocks(message)) {
        if (block.type !== 'tool_result' || typeof block.toolUseId !== 'string') continue;
        const key = `${location.sessionId}:${block.toolUseId}`;
        if (!this.resultPages.has(key)) this.resultPages.set(key, index);
      }
    }
    return result;
  }

  private async project(direction: HistoryDirection): Promise<void> {
    const pages: { index: number; result: AvailableHistory }[] = [];
    for (let index = this.last; index >= this.first; index--) pages.push({ index, result: await this.read(index) });
    const items: SessionTranscriptItem[] = [];
    let truncated = false;
    for (let offset = 0; offset < pages.length;) {
      const sessionId = this.locations[pages[offset]!.index]!.sessionId;
      const group: AvailableHistory[] = [];
      do { group.push(pages[offset++]!.result); }
      while (offset < pages.length && this.locations[pages[offset]!.index]!.sessionId === sessionId);
      const messages = group.flatMap(page => page.page?.messages ?? []);
      const missingResults = new Map<number, Set<string>>();
      for (const message of messages) for (const block of blocks(message)) {
        if (block.type !== 'tool_use' || typeof block.id !== 'string') continue;
        const resultIndex = this.resultPages.get(`${sessionId}:${block.id}`);
        if (resultIndex === undefined || resultIndex >= this.first && resultIndex <= this.last) continue;
        const ids = missingResults.get(resultIndex) ?? new Set<string>();
        ids.add(block.id);
        missingResults.set(resultIndex, ids);
      }
      for (const [index, ids] of missingResults) {
        const result = await this.read(index);
        for (const message of result.page?.messages ?? []) {
          if (!isStrictRecord(message)) continue;
          const content = blocks(message).filter(block => block.type === 'tool_result' &&
            typeof block.toolUseId === 'string' && ids.has(block.toolUseId));
          if (content.length) messages.push({ ...message, content });
        }
      }
      const result = group.length === 1 && missingResults.size === 0 ? group[0]! : group.every(page => page.page !== undefined)
        ? await projectSessionMessagesAsync(messages, {
          workspaceRoot: this.cwd, sourceSessionId: sessionId,
        }) : group[0]!;
      if (result.status !== 'available') throw new Error('History page could not be displayed');
      truncated ||= result.state.truncated;
      // Keep optional task summaries, which are supplied outside message pages.
      const summaries = new Map(group.flatMap(page => page.state.transcript.flatMap(item =>
        item.kind === 'tool' && item.subagent ? [[item.toolUseId, item.subagent] as const] : [])));
      items.push(...result.state.transcript.map(item => item.kind === 'tool' && summaries.has(item.toolUseId)
        ? { ...item, subagent: summaries.get(item.toolUseId)! } : item));
    }
    const unique = [...new Map(items.map(item => [item.id, item])).values()];
    const bounded = trimTranscriptToLimits(unique);
    // Keep the page the reader requested. Evict the opposite edge if the
    // combined window exceeds a budget; it remains reachable in either direction.
    const windowBytes = pages.reduce((sum, page) => sum + (this.cache.get(page.index)?.bytes ?? 0), 0);
    if ((truncated || bounded.trimmed || windowBytes > CACHE_BYTES) && this.first < this.last) {
      if (direction === 'older') this.first++;
      else this.last--;
      await this.project(direction);
      return;
    }
    const oldest = this.locations[this.last]!;
    this.state = {
      version: this.version, revision: ++this.revision,
      items: bounded.transcript,
      hasOlder: oldest.nextCursor !== null || this.sessionIds.indexOf(oldest.sessionId) < this.sessionIds.length - 1,
      hasNewer: this.first > 0,
      loading: null, error: null, truncated: truncated || bounded.trimmed,
      ...(this.tailAnchor ? { tailAnchor: this.tailAnchor } : {}),
    };
    let bytes = [...this.cache.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    for (const [index, entry] of this.cache) {
      if (this.cache.size <= CACHE_PAGES && bytes <= CACHE_BYTES) break;
      if (index >= this.first && index <= this.last) continue;
      this.cache.delete(index);
      bytes -= entry.bytes;
    }
  }
}

function blocks(message: unknown): Record<string, unknown>[] {
  return isStrictRecord(message) && Array.isArray(message.content) ? message.content.filter(isStrictRecord) : [];
}
